import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const STATE_BLOB = 'daily-usage.json';
const MAX_STATE_BYTES = 16_384;
const MAX_CONFLICT_ATTEMPTS = 5;

export function createAzureUsageGate({ account, container, limit = 50, blobName = STATE_BLOB,
  blobClient, now = () => new Date() }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Azure daily request limit must be an integer from 1 to 100.');
  if (!blobClient) {
    if (typeof account !== 'string' || !/^[a-z0-9]{3,24}$/.test(account)
        || typeof container !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container)
        || container.includes('--'))
      throw new Error('Azure usage storage account or container name is invalid.');
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`,
      new ManagedIdentityCredential(), { retryOptions: { maxTries: 1 } });
    blobClient = service.getContainerClient(container).getBlockBlobClient(blobName);
  }

  async function readState(today, signal) {
    const response = await blobClient.download(0, undefined, { abortSignal: signal });
    if (!response.etag || !response.readableStreamBody
        || (response.contentLength !== undefined && response.contentLength > MAX_STATE_BYTES)) {
      response.readableStreamBody?.destroy();
      throw new Error('Invalid usage state.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.readableStreamBody) {
      size += chunk.length;
      if (size > MAX_STATE_BYTES) throw new Error('Usage state too large.');
      chunks.push(chunk);
    }
    const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (!state || typeof state !== 'object' || Array.isArray(state)
        || typeof state.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.day)
        || new Date(`${state.day}T00:00:00Z`).toISOString().slice(0, 10) !== state.day
        || state.day > today)
      throw new Error('Invalid usage state.');
    // Migrate the existing shared ledger in place without resetting its call count.
    const count = Object.hasOwn(state, 'count') ? state.count
      : Object.hasOwn(state, 'calls') ? state.calls
      : Object.hasOwn(state, 'reservedMicros') && (state.reservedMicros === 0 || state.day < today) ? 0 : undefined;
    if (!Number.isSafeInteger(count) || count < 0
        || (state.count !== undefined && state.calls !== undefined && state.count !== state.calls))
      throw new Error('Invalid usage count.');
    return { etag: response.etag, count: state.day === today ? count : 0 };
  }

  return {
    async status() {
      try {
        const day = now().toISOString().slice(0, 10);
        const { count } = await readState(day, AbortSignal.timeout(5000));
        return { available: true, day, used: count, limit, remaining: Math.max(0, limit - count) };
      } catch {
        return { available: false, limit, remaining: null };
      }
    },
    async reserve({ signal } = {}) {
      try {
        for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt++) {
          signal?.throwIfAborted();
          const today = now().toISOString().slice(0, 10);
          const { etag, count } = await readState(today, signal);
          if (count >= limit) throw new Error('Daily limit reached.');
          const body = JSON.stringify({ day: today, count: count + 1 });
          try {
            signal?.throwIfAborted();
            if (now().toISOString().slice(0, 10) !== today) continue;
            await blobClient.upload(body, Buffer.byteLength(body), {
              abortSignal: signal,
              conditions: { ifMatch: etag },
              blobHTTPHeaders: { blobContentType: 'application/json' },
            });
            signal?.throwIfAborted();
            if (now().toISOString().slice(0, 10) !== today)
              throw new Error('UTC day changed during admission.');
            return { used: count + 1, limit };
          } catch (error) {
            if (error?.statusCode === 412 && !signal?.aborted) continue;
            throw error;
          }
        }
        throw new Error('Reservation conflict.');
      } catch (error) {
        if (signal?.aborted) throw new Error('Azure planning was cancelled.');
        if (error?.message === 'Daily limit reached.')
          throw new Error('Azure daily planning limit reached.');
        throw new Error('Azure planning usage could not be reserved; no model request was sent.');
      }
    },
  };
}
