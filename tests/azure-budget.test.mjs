import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAzureBudgetGate, verifyDeploymentConfig, verifyRetailPrices } from '../azure-budget.mjs';

const endpoint = 'https://example-openai.openai.azure.com/';
const deployment = 'example-model';
const resourceId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/example-rg/providers/Microsoft.CognitiveServices/accounts/example-openai';
const now = () => new Date('2026-11-14T12:00:00Z');
const verifyPrices = async () => {};
const verifyConfig = async () => {};
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
const gate = (blobClient, options = {}) => createAzureBudgetGate({
  endpoint, deployment, resourceId, blobClient, now, verifyPrices, verifyConfig, ...options,
});

test('reserves worst-case dollar amounts atomically, never exceeding $50', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":48900000}');
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => gate(blob).reserve()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.deepEqual(blob.state(), { day: '2026-11-14', reservedMicros: 50_000_000 });
  await assert.rejects(gate(blob).reserve(), error => error.code === 'BUDGET_EXHAUSTED');
});

test('rollover is atomic and calls are denied near midnight or on bad state', async () => {
  const blob = fakeBlob('{"day":"2026-11-13","reservedMicros":50000000}');
  assert.deepEqual(await gate(blob).reserve(), { reservedMicros: 550_000, dailyLimitMicros: 50_000_000 });
  const midnight = () => new Date('2026-11-14T23:54:01Z');
  await assert.rejects(gate(blob, { now: midnight }).reserve(), error => error.code === 'BUDGET_WINDOW_CLOSED');
  for (const body of [undefined, '{}', '{"day":"2026-11-15","reservedMicros":0}', 'x'.repeat(257)]) {
    await assert.rejects(gate(fakeBlob(body)).reserve(), error => error.code === 'BUDGET_UNAVAILABLE');
  }
});

test('pricing and storage failures deny reservations without disclosing details', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}');
  await assert.rejects(gate(blob, { verifyPrices: async () => { throw new Error('private'); } }).reserve(),
    error => error.code === 'BUDGET_UNAVAILABLE' && !error.message.includes('private'));
  assert.equal(blob.state().reservedMicros, 0);
  assert.throws(() => gate(blob, { endpoint: 'https://other.openai.azure.com' }), /matching Azure OpenAI/);
});

test('deployment verification rejects a different model, SKU, region, or key-enabled account', async () => {
  const account = { name: 'example-openai', kind: 'OpenAI', location: 'swedencentral',
    properties: { customSubDomainName: 'example-openai', disableLocalAuth: true, provisioningState: 'Succeeded' } };
  const model = { sku: { name: 'DataZoneStandard' }, properties: { provisioningState: 'Succeeded',
    model: { format: 'OpenAI', name: 'gpt-5.4', version: '2026-03-05' } } };
  const credential = { async getToken() { return { token: 'test-token' }; } };
  const verify = (a, m) => verifyDeploymentConfig({ resourceId, deployment, credential,
    fetchImpl: async url => new Response(JSON.stringify(url.includes('/deployments/') ? m : a)) });
  await verify(account, model);
  await assert.rejects(verify({ ...account, location: 'westeurope' }, model));
  await assert.rejects(verify({ ...account, properties: { ...account.properties, disableLocalAuth: false } }, model));
  await assert.rejects(verify(account, { ...model, sku: { name: 'GlobalStandard' } }));
  await assert.rejects(verify(account, { ...model, properties: { ...model.properties, model: { ...model.properties.model, name: 'other' } } }));
});

test('pricing verification rejects missing, ambiguous and increased retail meters', async () => {
  const item = (skuName, retailPrice) => ({ productName: 'Azure OpenAI GPT5', armRegionName: 'swedencentral',
    skuName, currencyCode: 'USD', type: 'Consumption', unitOfMeasure: '1M', tierMinimumUnits: 0,
    retailPrice, effectiveStartDate: '2026-03-01T00:00:00Z' });
  const input = item('5.4 inp Dz', 2.75);
  const output = item('5.4 opt Dz', 16.5);
  const verify = Items => verifyRetailPrices({ now: now(), fetchImpl: async () =>
    new Response(JSON.stringify({ Items, NextPageLink: null })) });
  await verify([input, output]);
  await assert.rejects(verify([input]));
  await assert.rejects(verify([input, output, output]));
  await assert.rejects(verify([input, { ...output, retailPrice: 16.51 }]));
});
