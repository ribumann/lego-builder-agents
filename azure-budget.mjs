import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const DAILY_LIMIT = 50_000_000;
// Reserve for 128k input tokens despite the adapter's 32k-byte prompt ceiling.
// The output ceiling includes visible and reasoning tokens.
const RESERVATION = 128_000 * 2.75 + 12_000 * 16.5;
const MAX_STATE_BYTES = 256;
const PRICE_FILTER = "productName eq 'Azure OpenAI GPT5' and armRegionName eq 'swedencentral' and (skuName eq '5.4 inp Dz' or skuName eq '5.4 opt Dz')";
const PRICE_URL = `https://prices.azure.com/api/retail/prices?%24filter=${encodeURIComponent(PRICE_FILTER)}`;

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

export async function verifyDeploymentConfig({ resourceId, deployment, credential, signal, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const token = await credential.getToken('https://management.azure.com/.default', { abortSignal: combined });
  if (!token?.token) throw new Error('Management identity unavailable.');
  const get = async path => boundedJSON(await fetchImpl(`https://management.azure.com${path}?api-version=2023-05-01`, {
    headers: { Authorization: `Bearer ${token.token}` }, redirect: 'error', signal: combined,
  }), 256_000);
  const account = await get(resourceId);
  const model = await get(`${resourceId}/deployments/${encodeURIComponent(deployment)}`);
  const accountName = resourceId.slice(resourceId.lastIndexOf('/') + 1).toLowerCase();
  if (account.location?.toLowerCase() !== 'swedencentral' || account.kind !== 'OpenAI'
      || account.name?.toLowerCase() !== accountName
      || account.properties?.customSubDomainName?.toLowerCase() !== accountName
      || account.properties?.disableLocalAuth !== true
      || account.properties?.provisioningState !== 'Succeeded'
      || model.sku?.name !== 'DataZoneStandard' || model.properties?.provisioningState !== 'Succeeded'
      || model.properties?.model?.format !== 'OpenAI' || model.properties?.model?.name !== 'gpt-5.4'
      || model.properties?.model?.version !== '2026-03-05')
    throw new Error('Deployment does not match the priced configuration.');
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

export function createAzureBudgetGate({ account, container, endpoint, deployment, resourceId, blobClient,
  credential = new ManagedIdentityCredential(), now = () => new Date(),
  verifyPrices = verifyRetailPrices, verifyConfig = verifyDeploymentConfig }) {
  const match = typeof resourceId === 'string' && /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w().-]{1,90}\/providers\/Microsoft\.CognitiveServices\/accounts\/([a-z0-9][a-z0-9-]{0,62})$/i.exec(resourceId);
  if (!match || typeof endpoint !== 'string'
      || endpoint.replace(/\/$/, '').toLowerCase() !== `https://${match[1].toLowerCase()}.openai.azure.com`
      || typeof deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment))
    throw new Error('Azure budget requires a matching Azure OpenAI resource ID, endpoint and deployment.');
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
    async reserve({ signal } = {}) {
      try {
        currentDay();
        await Promise.all([
          verifyPrices({ signal, now: now() }),
          verifyConfig({ resourceId, deployment, credential, signal }),
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
          if (!state || typeof state !== 'object' || Array.isArray(state)
              || typeof state.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.day)
              || !Number.isSafeInteger(state.reservedMicros) || state.reservedMicros < 0
              || state.reservedMicros > DAILY_LIMIT
              || new Date(`${state.day}T00:00:00Z`).toISOString().slice(0, 10) !== state.day
              || state.day > today)
            throw new Error('Invalid budget state.');
          const spent = state.day === today ? state.reservedMicros : 0;
          if (spent + RESERVATION > DAILY_LIMIT)
            throw failure('BUDGET_EXHAUSTED', 'The Azure daily inference budget is exhausted.');
          const body = JSON.stringify({ day: today, reservedMicros: spent + RESERVATION });
          try {
            if (currentDay() !== today) throw new Error('UTC day changed.');
            await blobClient.upload(body, Buffer.byteLength(body), {
              abortSignal: signal, conditions: { ifMatch: response.etag },
              blobHTTPHeaders: { blobContentType: 'application/json' },
            });
            if (currentDay() !== today) throw new Error('UTC day changed.');
            return { reservedMicros: spent + RESERVATION, dailyLimitMicros: DAILY_LIMIT };
          } catch (error) {
            if (error?.statusCode === 412 && !signal?.aborted) continue;
            throw error;
          }
        }
        throw new Error('Reservation conflicts.');
      } catch (error) {
        if (signal?.aborted) throw failure('CANCELLED', 'Azure planning was cancelled.');
        if (error?.code === 'BUDGET_EXHAUSTED' || error?.code === 'BUDGET_WINDOW_CLOSED') throw error;
        throw failure('BUDGET_UNAVAILABLE', 'Azure inference budget or pricing could not be verified; no model request was sent.');
      }
    },
  };
}
