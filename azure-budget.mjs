import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { createHmac } from 'node:crypto';

const DAILY_LIMIT = 50_000_000;
const DEFAULT_DAILY_CALLS = 12;
const MAX_DAILY_CALLS = 100;
const MAX_CLIENT_CALLS = 3;
// Reserve for 128k input tokens despite the adapter's 32k-byte prompt ceiling.
// The output ceiling includes visible and reasoning tokens.
const RESERVATION = 128_000 * 2.75 + 12_000 * 16.5;
const MAX_STATE_BYTES = 16_384;
const MAX_CLIENTS = 100;
const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PRICE_FILTER = "productName eq 'Azure OpenAI GPT5' and armRegionName eq 'swedencentral' and (skuName eq '5.4 inp Dz' or skuName eq '5.4 opt Dz')";
const PRICE_URL = `https://prices.azure.com/api/retail/prices?%24filter=${encodeURIComponent(PRICE_FILTER)}`;
const POLICY_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function boundedJSON(response, limit) {
  if (!response.ok || !response.body) throw new Error('Verification unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Verification response too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

export async function verifyDeploymentConfig({ resourceId, deployment, contentFilterPolicy,
  credential, signal, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const token = await credential.getToken('https://management.azure.com/.default', { abortSignal: combined });
  if (!token?.token) throw new Error('Management identity unavailable.');
  const get = async (path, apiVersion = '2023-05-01') => boundedJSON(await fetchImpl(`https://management.azure.com${path}?api-version=${apiVersion}`, {
    headers: { Authorization: `Bearer ${token.token}` }, redirect: 'error', signal: combined,
  }), 256_000);
  const account = await get(resourceId);
  const model = await get(`${resourceId}/deployments/${encodeURIComponent(deployment)}`);
  const policy = await get(`${resourceId}/raiPolicies/${encodeURIComponent(contentFilterPolicy)}`, '2024-10-01');
  const accountName = resourceId.slice(resourceId.lastIndexOf('/') + 1).toLowerCase();
  if (account.location?.toLowerCase() !== 'swedencentral' || account.kind !== 'OpenAI'
      || account.name?.toLowerCase() !== accountName
      || account.properties?.customSubDomainName?.toLowerCase() !== accountName
      || account.properties?.disableLocalAuth !== true
      || account.properties?.provisioningState !== 'Succeeded'
      || model.sku?.name !== 'DataZoneStandard' || model.properties?.provisioningState !== 'Succeeded'
      || model.properties?.model?.format !== 'OpenAI' || model.properties?.model?.name !== 'gpt-5.4'
      || model.properties?.model?.version !== '2026-03-05'
      || !isSafeContentFilterPolicy(policy, contentFilterPolicy))
    throw new Error('Deployment or content filter does not match the reviewed configuration.');
}

export function isSafeContentFilterPolicy(policy, expectedName) {
  if (!policy || policy.name?.toLowerCase() !== expectedName?.toLowerCase()
      || policy.properties?.basePolicyName !== 'Microsoft.Default'
      || policy.properties?.mode !== 'Blocking'
      || !Array.isArray(policy.properties?.contentFilters)) return false;
  const filters = policy.properties.contentFilters;
  const hasBlockingFilter = (name, source, checkSeverity = false) => {
    const matches = filters.filter(filter => filter?.name === name && filter?.source === source);
    return matches.length === 1 && matches[0].enabled === true && matches[0].blocking === true
      && (!checkSeverity || ['Low', 'Medium'].includes(matches[0].severityThreshold));
  };
  for (const name of ['Hate', 'Sexual', 'Selfharm', 'Violence']) {
    if (!hasBlockingFilter(name, 'Prompt', true) || !hasBlockingFilter(name, 'Completion', true))
      return false;
  }
  return hasBlockingFilter('Jailbreak', 'Prompt')
    && hasBlockingFilter('Protected Material Text', 'Completion')
    && hasBlockingFilter('Protected Material Code', 'Completion');
}

export async function verifyRetailPrices({ signal, now, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetchImpl(PRICE_URL, { redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await boundedJSON(response, 1_048_576);
  if (!Array.isArray(data.Items) || data.NextPageLink) throw new Error('Incomplete pricing response.');
  for (const [sku, ceiling] of [['5.4 inp Dz', 2.75], ['5.4 opt Dz', 16.5]]) {
    const matches = data.Items.filter(item => item.productName === 'Azure OpenAI GPT5'
      && item.armRegionName === 'swedencentral' && item.skuName === sku && item.currencyCode === 'USD'
      && item.type === 'Consumption' && item.unitOfMeasure === '1M' && item.tierMinimumUnits === 0
      && Number.isFinite(item.retailPrice) && Date.parse(item.effectiveStartDate) <= now.getTime());
    matches.sort((a, b) => Date.parse(b.effectiveStartDate) - Date.parse(a.effectiveStartDate));
    if (!matches.length || matches[0].retailPrice <= 0 || matches[0].retailPrice > ceiling
        || (matches[1] && matches[1].effectiveStartDate === matches[0].effectiveStartDate))
      throw new Error('Pricing not verified.');
  }
}

export function createAzurePrincipalKey({ secret, tenantId, objectId }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32)
    throw new Error('Azure principal-rate-limit secret must contain at least 32 bytes.');
  if (typeof tenantId !== 'string' || !GUID.test(tenantId)
      || typeof objectId !== 'string' || !GUID.test(objectId))
    throw new Error('Azure authenticated principal is invalid.');
  return createHmac('sha256', secret)
    .update(`${tenantId.toLowerCase()}:${objectId.toLowerCase()}`).digest('hex');
}

export function createAzureBudgetGate({ account, container, endpoint, deployment, resourceId, contentFilterPolicy,
  blobClient, dailyCallLimit = DEFAULT_DAILY_CALLS, dailyClientLimit = MAX_CLIENT_CALLS,
  clientHashSecret, requireClientKey = false, enforceDailyCallQuota = true,
  credential = new ManagedIdentityCredential(), now = () => new Date(),
  verifyPrices = verifyRetailPrices, verifyConfig = verifyDeploymentConfig }) {
  const match = typeof resourceId === 'string' && /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w().-]{1,90}\/providers\/Microsoft\.CognitiveServices\/accounts\/([a-z0-9][a-z0-9-]{0,62})$/i.exec(resourceId);
  if (!match || typeof endpoint !== 'string'
      || endpoint.replace(/\/$/, '').toLowerCase() !== `https://${match[1].toLowerCase()}.openai.azure.com`
      || typeof deployment !== 'string' || !POLICY_NAME_PATTERN.test(deployment)
      || typeof contentFilterPolicy !== 'string' || !POLICY_NAME_PATTERN.test(contentFilterPolicy))
    throw new Error('Azure budget requires a matching Azure OpenAI resource ID, endpoint, deployment and content filter policy.');
  if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > MAX_DAILY_CALLS
      || !Number.isInteger(dailyClientLimit) || dailyClientLimit < 1 || dailyClientLimit > MAX_CLIENT_CALLS
      || typeof enforceDailyCallQuota !== 'boolean')
    throw new Error(`Azure planning limits must be 1-${MAX_DAILY_CALLS} calls per day and 1-${MAX_CLIENT_CALLS} per client.`);
  if (requireClientKey && (typeof clientHashSecret !== 'string' || Buffer.byteLength(clientHashSecret) < 32))
    throw new Error('Hosted Azure planning requires a 32-byte client rate-limit secret.');
  if (!blobClient) {
    if (typeof account !== 'string' || !/^[a-z0-9]{3,24}$/.test(account)
        || typeof container !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container)
        || container.includes('--'))
      throw new Error('Azure budget storage account or container name is invalid.');
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`,
      credential, { retryOptions: { maxTries: 1 } });
    blobClient = service.getContainerClient(container).getBlockBlobClient('daily-budget.json');
  }

  function currentDay() {
    const date = now();
    const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    if (nextMidnight - date.getTime() <= 360_000)
      throw failure('BUDGET_WINDOW_CLOSED', 'Azure planning is unavailable near the UTC day boundary.');
    return date.toISOString().slice(0, 10);
  }

  return {
    async reserve({ signal, clientKey } = {}) {
      try {
        currentDay();
        if (requireClientKey && (typeof clientKey !== 'string' || !/^[0-9a-f]{64}$/.test(clientKey)))
          throw new Error('Client rate limit could not be verified.');
        if (clientKey !== undefined && !/^[0-9a-f]{64}$/.test(clientKey))
          throw new Error('Client rate limit could not be verified.');
        await Promise.all([
          verifyPrices({ signal, now: now() }),
          verifyConfig({ resourceId, deployment, contentFilterPolicy, credential, signal }),
        ]);
        for (let attempt = 0; attempt < 5; attempt++) {
          const today = currentDay();
          const response = await blobClient.download(0, undefined, { abortSignal: signal });
          if (!response.etag || !response.readableStreamBody
              || (response.contentLength !== undefined && response.contentLength > MAX_STATE_BYTES)) {
            response.readableStreamBody?.destroy();
            throw new Error('Invalid budget state.');
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of response.readableStreamBody) {
            size += chunk.length;
            if (size > MAX_STATE_BYTES) throw new Error('Budget state too large.');
            chunks.push(chunk);
          }
          const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
          const previousClients = state?.clientCalls === undefined ? {} : state.clientCalls;
          // Legacy spend may include cheaper modalities, so it cannot safely imply a call count.
          const previousCalls = state?.calls === undefined
            ? enforceDailyCallQuota && state?.day === today && state?.reservedMicros > 0 ? dailyCallLimit : 0 : state.calls;
          if (!state || typeof state !== 'object' || Array.isArray(state)
              || typeof state.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.day)
              || !Number.isSafeInteger(state.reservedMicros) || state.reservedMicros < 0
              || state.reservedMicros > DAILY_LIMIT
              || !Number.isInteger(previousCalls) || previousCalls < 0 || previousCalls > 100
              || !previousClients || typeof previousClients !== 'object' || Array.isArray(previousClients)
              || Object.keys(previousClients).length > MAX_CLIENTS
              || Object.entries(previousClients).some(([key, count]) =>
                !/^[0-9a-f]{64}$/.test(key) || !Number.isInteger(count) || count < 1 || count > 100)
              || Object.values(previousClients).reduce((sum, count) => sum + count, 0) > previousCalls
              || new Date(`${state.day}T00:00:00Z`).toISOString().slice(0, 10) !== state.day
              || state.day > today)
            throw new Error('Invalid budget state.');
          const spent = state.day === today ? state.reservedMicros : 0;
          const calls = state.day === today ? previousCalls : 0;
          const clients = state.day === today ? previousClients : {};
          if (enforceDailyCallQuota && calls >= dailyCallLimit)
            throw failure('BUDGET_CALL_LIMIT', 'The Azure daily planning request limit is exhausted.');
          if (enforceDailyCallQuota && clientKey && (clients[clientKey] ?? 0) >= dailyClientLimit)
            throw failure('BUDGET_CLIENT_LIMIT', 'The Azure per-client planning limit is exhausted.');
          if (spent + RESERVATION > DAILY_LIMIT)
            throw failure('BUDGET_EXHAUSTED', 'The Azure daily inference budget is exhausted.');
          const clientCalls = { ...clients };
          if (clientKey) clientCalls[clientKey] = (clientCalls[clientKey] ?? 0) + 1;
          const body = JSON.stringify({ day: today, reservedMicros: spent + RESERVATION,
            calls: calls + 1, clientCalls });
          try {
            if (currentDay() !== today) throw new Error('UTC day changed.');
            await blobClient.upload(body, Buffer.byteLength(body), {
              abortSignal: signal, conditions: { ifMatch: response.etag },
              blobHTTPHeaders: { blobContentType: 'application/json' },
            });
            if (currentDay() !== today) throw new Error('UTC day changed.');
            return { reservedMicros: spent + RESERVATION, dailyLimitMicros: DAILY_LIMIT,
              calls: calls + 1, dailyCallLimit };
          } catch (error) {
            if (error?.statusCode === 412 && !signal?.aborted) continue;
            throw error;
          }
        }
        throw new Error('Reservation conflicts.');
      } catch (error) {
        if (signal?.aborted) throw failure('CANCELLED', 'Azure planning was cancelled.');
        if (['BUDGET_EXHAUSTED', 'BUDGET_WINDOW_CLOSED', 'BUDGET_CALL_LIMIT', 'BUDGET_CLIENT_LIMIT'].includes(error?.code))
          throw error;
        throw failure('BUDGET_UNAVAILABLE', 'Azure inference budget or pricing could not be verified; no model request was sent.');
      }
    },
  };
}
