import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const ENDPOINT = 'https://bricklab-ai-rer5x4xnttoge.openai.azure.com';
const DEPLOYMENT = 'bricklab-planner-gpt54';
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

export async function verifyRetailPrices({ signal, now, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetchImpl(PRICE_URL, { redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok || !response.body) throw new Error('Pricing unavailable.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error('Pricing response too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
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

export function createAzureBudgetGate({ account, container, endpoint, deployment, blobClient,
  now = () => new Date(), verifyPrices = verifyRetailPrices }) {
  if (typeof endpoint !== 'string' || endpoint.replace(/\/$/, '') !== ENDPOINT || deployment !== DEPLOYMENT)
    throw new Error('Azure budget only supports the approved GPT-5.4 deployment.');
  if (!blobClient) {
    if (typeof account !== 'string' || !/^[a-z0-9]{3,24}$/.test(account)
        || typeof container !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container)
        || container.includes('--'))
      throw new Error('Azure budget storage account or container name is invalid.');
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`,
      new ManagedIdentityCredential(), { retryOptions: { maxTries: 1 } });
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
        await verifyPrices({ signal, now: now() });
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
