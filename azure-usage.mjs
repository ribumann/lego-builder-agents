import { ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const STATE_BLOB = 'daily-usage.json';
const MAX_STATE_BYTES = 256;
const MAX_CONFLICT_ATTEMPTS = 5;

export function createAzureUsageGate({ account, container, limit = 12, blobClient, now = () => new Date() }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Azure daily request limit must be an integer from 1 to 100.');
  if (!blobClient) {
    if (typeof account !== 'string' || !/^[a-z0-9]{3,24}$/.test(account)
        || typeof container !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container)
        || container.includes('--'))
      throw new Error('Azure usage storage account or container name is invalid.');
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`,
      new ManagedIdentityCredential(), { retryOptions: { maxTries: 1 } });
    blobClient = service.getContainerClient(container).getBlockBlobClient(STATE_BLOB);
  }

  return {
    async reserve({ signal } = {}) {
      try {
        for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS; attempt++) {
          const today = now().toISOString().slice(0, 10);
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
              || !Number.isInteger(state.count) || state.count < 0 || state.count > 100
              || new Date(`${state.day}T00:00:00Z`).toISOString().slice(0, 10) !== state.day
              || state.day > today)
            throw new Error('Invalid usage state.');
          const count = state.day === today ? state.count : 0;
          if (count >= limit) throw new Error('Daily limit reached.');
          const body = JSON.stringify({ day: today, count: count + 1 });
          try {
            await blobClient.upload(body, Buffer.byteLength(body), {
              abortSignal: signal,
              conditions: { ifMatch: response.etag },
              blobHTTPHeaders: { blobContentType: 'application/json' },
            });
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
