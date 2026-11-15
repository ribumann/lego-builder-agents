import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAzureUsageGate } from '../azure-usage.mjs';

function fakeBlob(initial) {
  let contents = initial;
  let version = 0;
  return {
    async download() {
      if (contents === undefined) throw Object.assign(new Error('missing'), { statusCode: 404 });
      return { etag: `"${version}"`, contentLength: Buffer.byteLength(contents),
        readableStreamBody: Readable.from([Buffer.from(contents)]) };
    },
    async upload(body, _length, options) {
      if (options.conditions.ifMatch !== `"${version}"`)
        throw Object.assign(new Error('conflict'), { statusCode: 412 });
      contents = body;
      version++;
    },
    state() { return JSON.parse(contents); },
  };
}
const now = () => new Date('2026-11-14T12:00:00Z');

test('reserves atomically across callers, caps daily use, and persists across instances', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","count":0}');
  const gate = () => createAzureUsageGate({ blobClient: blob, limit: 3, now });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => gate().reserve()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.deepEqual(blob.state(), { day: '2026-11-14', count: 3 });
  await assert.rejects(gate().reserve(), /daily planning limit reached/);
});

test('rolls over only from a valid prior UTC day, and never creates missing state', async () => {
  const blob = fakeBlob('{"day":"2026-11-13","count":12}');
  assert.deepEqual(await createAzureUsageGate({ blobClient: blob, limit: 3, now }).reserve(), { used: 1, limit: 3 });
  assert.deepEqual(blob.state(), { day: '2026-11-14', count: 1 });
  for (const body of [undefined, '{}', '{"day":"2026-11-15","count":0}', '{"day":"2026-02-31","count":0}', 'x'.repeat(257)]) {
    await assert.rejects(createAzureUsageGate({ blobClient: fakeBlob(body), limit: 3, now }).reserve(), /no model request was sent/);
  }
});

test('fails closed on storage failure, conflict exhaustion, or cancellation', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","count":0}');
  blob.upload = async () => { throw Object.assign(new Error('private storage detail'), { statusCode: 412 }); };
  await assert.rejects(createAzureUsageGate({ blobClient: blob, limit: 3, now }).reserve(), /no model request was sent/);
  const controller = new AbortController();
  controller.abort();
  blob.download = async () => { throw new Error('private storage detail'); };
  await assert.rejects(createAzureUsageGate({ blobClient: blob, limit: 3, now }).reserve({ signal: controller.signal }), /cancelled/);
  assert.throws(() => createAzureUsageGate({ blobClient: blob, limit: 101, now }), /1 to 100/);
});
