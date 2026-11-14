import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAzurePlanner } from '../azure-planner.mjs';

const endpoint = 'https://bricklab-example.openai.azure.com';
const credential = { async getToken() { return { token: 'test-token' }; } };
const envelope = (content, reason = 'stop') => JSON.stringify({
  choices: [{ finish_reason: reason, message: { content } }],
});

test('Azure planner sends a bounded authenticated request and returns parsed JSON', async () => {
  let request;
  const plan = createAzurePlanner({ endpoint, deployment: 'small-model', credential,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(envelope('{"model":"custom"}'));
    } });
  assert.deepEqual(await plan({ prompt: 'design a lighthouse' }), { model: 'custom' });
  assert.match(request.url, /\/deployments\/small-model\/chat\/completions\?/);
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(request.options.body).max_tokens, 12000);
});

test('Azure planner rejects untrusted endpoints and incomplete or oversized responses', async () => {
  assert.throws(() => createAzurePlanner({ endpoint: 'https://evil.example', deployment: 'model', credential }));
  for (const body of [envelope('{"model":"custom"}', 'length'), 'x'.repeat(1_048_577),
    envelope('x'.repeat(128_001)), envelope('not json')]) {
    const plan = createAzurePlanner({ endpoint, deployment: 'model', credential,
      fetchImpl: async () => new Response(body) });
    await assert.rejects(plan({ prompt: 'brief' }), /Azure planning failed/);
  }
});

test('Azure planner forwards cancellation and never exposes provider errors', async () => {
  const controller = new AbortController();
  const plan = createAzurePlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      throw new Error('sensitive provider detail');
    } });
  await assert.rejects(plan({ prompt: 'brief', signal: controller.signal }), /^Error: Azure planning was cancelled\.$/);
  const failing = createAzurePlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async () => { throw new Error('sensitive provider detail'); } });
  await assert.rejects(failing({ prompt: 'brief' }), error => !error.message.includes('sensitive'));
  const rejected = createAzurePlanner({ endpoint, deployment: 'model', credential,
    fetchImpl: async () => new Response('sensitive provider detail', { status: 403 }) });
  await assert.rejects(rejected({ prompt: 'brief' }), error => !error.message.includes('sensitive'));
});
