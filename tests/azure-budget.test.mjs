import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { createAzureAccessTokenVerifier } from '../azure-auth.mjs';
import { createAzureBudgetGate, createAzurePrincipalKey, isSafeContentFilterPolicy,
  verifyDeploymentConfig, verifyRetailPrices } from '../azure-budget.mjs';

const endpoint = 'https://example-openai.openai.azure.com/';
const deployment = 'example-model';
const contentFilterPolicy = 'bricklab-public-safe';
const resourceId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/example-rg/providers/Microsoft.CognitiveServices/accounts/example-openai';
const now = () => new Date('2026-11-14T12:00:00Z');
const verifyPrices = async () => {};
const verifyConfig = async () => {};
const contentFilters = [
  ...['Hate', 'Sexual', 'Selfharm', 'Violence'].flatMap(name =>
    ['Prompt', 'Completion'].map(source => ({
      name, source, enabled: true, blocking: true, severityThreshold: 'Medium',
    }))),
  { name: 'Jailbreak', source: 'Prompt', enabled: true, blocking: true },
  { name: 'Protected Material Text', source: 'Completion', enabled: true, blocking: true },
  { name: 'Protected Material Code', source: 'Completion', enabled: true, blocking: true },
];
const policy = { name: contentFilterPolicy, properties: {
  basePolicyName: 'Microsoft.Default', mode: 'Blocking', contentFilters,
} };
const tenantId = '11111111-1111-4111-8111-111111111111';
const apiClientId = '22222222-2222-4222-8222-222222222222';
const spaClientId = '33333333-3333-4333-8333-333333333333';
const principalSecret = 'fixture principal hashing secret longer than thirty-two bytes';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const verifyPrincipal = createAzureAccessTokenVerifier({
  tenantId, apiClientId, spaClientId, requiredScope: 'BrickLab.Plan', requiredRole: 'BrickLab.Planner',
}, { jwks: async header => {
  if (header.kid !== 'budget-fixture-key') throw new Error('Unknown fixture key.');
  return publicKey;
} });

async function tokenFor(objectId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tid: tenantId, oid: objectId, azp: spaClientId, ver: '2.0',
    scp: 'BrickLab.Plan', roles: ['BrickLab.Planner'],
  }).setProtectedHeader({ alg: 'RS256', kid: 'budget-fixture-key' })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(apiClientId).setIssuedAt(nowSeconds).setNotBefore(nowSeconds - 1)
    .setExpirationTime(nowSeconds + 300).sign(privateKey);
}

async function verifiedClientKey(objectId) {
  const token = await tokenFor(objectId);
  const principal = await verifyPrincipal(`Bearer ${token}`);
  return { token, key: createAzurePrincipalKey({ secret: principalSecret, ...principal }) };
}

const objectId = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function fakeBlob(initial, { synchronizedReads = 0, beforeUpload, failUpload = false } = {}) {
  let contents = initial;
  let version = 0;
  let readCount = 0;
  let releaseReads;
  const readBarrier = new Promise(resolve => { releaseReads = resolve; });
  return {
    async download(_offset, _count, { abortSignal } = {}) {
      if (contents === undefined) throw Object.assign(new Error('missing'), { statusCode: 404 });
      if (abortSignal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      const snapshot = { etag: `"${version}"`, contents };
      if (readCount < synchronizedReads) {
        readCount++;
        if (readCount === synchronizedReads) releaseReads();
        await readBarrier;
      }
      return { etag: snapshot.etag, contentLength: Buffer.byteLength(snapshot.contents),
        readableStreamBody: Readable.from([Buffer.from(snapshot.contents)]) };
    },
    async upload(body, _length, options) {
      await beforeUpload?.(options);
      if (options.abortSignal?.aborted)
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      if (failUpload) throw new Error('private storage failure');
      if (options.conditions.ifMatch !== `"${version}"`)
        throw Object.assign(new Error('conflict'), { statusCode: 412 });
      contents = body;
      version++;
    },
    state() { return JSON.parse(contents); },
  };
}
const gate = (blobClient, options = {}) => createAzureBudgetGate({
  endpoint, deployment, resourceId, contentFilterPolicy, blobClient, now, verifyPrices, verifyConfig, ...options,
});

test('reserves worst-case dollar amounts atomically, never exceeding $50', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":48900000,"calls":89,"clientCalls":{}}');
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => gate(blob, { dailyCallLimit: 100 }).reserve()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(blob.state().reservedMicros, 50_000_000);
  assert.equal(blob.state().calls, 91);
  await assert.rejects(gate(blob, { dailyCallLimit: 100 }).reserve(), error => error.code === 'BUDGET_EXHAUSTED');
});

test('rollover is atomic and calls are denied near midnight or on bad state', async () => {
  const blob = fakeBlob('{"day":"2026-11-13","reservedMicros":50000000}');
  assert.deepEqual(await gate(blob).reserve(), {
    reservedMicros: 550_000, dailyLimitMicros: 50_000_000, calls: 1, dailyCallLimit: 12,
  });
  assert.deepEqual(blob.state(), { day: '2026-11-14', reservedMicros: 550_000, calls: 1, clientCalls: {} });
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

test('public allowance is read-only, global and explicit about unavailable or exhausted state', async () => {
  const blob = fakeBlob(JSON.stringify({ day: '2026-11-14', reservedMicros: 27_500_000, calls: 50, clientCalls: {} }));
  const budget = gate(blob, { dailyCallLimit: 50 });
  assert.deepEqual(await budget.status(), { available: true, day: '2026-11-14', used: 50, limit: 50, remaining: 0 });
  assert.equal(blob.state().calls, 50, 'Status cannot reserve or refund');
  assert.deepEqual(await gate(fakeBlob('{}'), { dailyCallLimit: 50 }).status(),
    { available: false, limit: 50, remaining: null });
  const dollars = gate(fakeBlob('{"day":"2026-11-14","reservedMicros":50000000,"calls":90}'), { dailyCallLimit: 100 });
  assert.equal((await dollars.status()).remaining, 0, 'Spend ceiling may exhaust before configured call ceiling');
});
test('deployment verification rejects a different model, SKU, region, or key-enabled account', async () => {
  const account = { name: 'example-openai', kind: 'OpenAI', location: 'swedencentral',
    properties: { customSubDomainName: 'example-openai', disableLocalAuth: true, provisioningState: 'Succeeded' } };
  const model = { sku: { name: 'DataZoneStandard' }, properties: { provisioningState: 'Succeeded',
    raiPolicyName: contentFilterPolicy,
    model: { format: 'OpenAI', name: 'gpt-5.4', version: '2026-03-05' } } };
  const credential = { async getToken() { return { token: 'test-token' }; } };
  const verify = (a, m, p = policy) => verifyDeploymentConfig({ resourceId, deployment, contentFilterPolicy, credential,
    fetchImpl: async url => new Response(JSON.stringify(url.includes('/deployments/') ? m
      : url.includes('/raiPolicies/') ? p : a)) });
  await verify(account, model);
  for (const raiPolicyName of [undefined, 'Microsoft.DefaultV2', 'unattached-policy'])
    await assert.rejects(verify(account, { ...model, properties: { ...model.properties, raiPolicyName } }),
      /Deployment or content filter/);
  await assert.rejects(verify({ ...account, location: 'westeurope' }, model));
  await assert.rejects(verify({ ...account, properties: { ...account.properties, disableLocalAuth: false } }, model));
  await assert.rejects(verify(account, { ...model, sku: { name: 'GlobalStandard' } }));
  await assert.rejects(verify(account, { ...model, properties: { ...model.properties, model: { ...model.properties.model, name: 'other' } } }));
  await assert.rejects(verify(account, model, {
    ...policy, properties: { ...policy.properties, contentFilters: contentFilters.map(filter =>
      filter.name === 'Hate' && filter.source === 'Prompt' ? { ...filter, blocking: false } : filter) },
  }));
  await assert.rejects(verify(account, model, {
    ...policy, properties: { ...policy.properties, contentFilters: contentFilters.filter(filter =>
      !(filter.name === 'Jailbreak' && filter.source === 'Prompt')) },
  }));
  await assert.rejects(verify(account, model, {
    ...policy, properties: { ...policy.properties, mode: 'Asynchronous_filter' },
  }));
});

test('shared blob reservations enforce atomic global and per-client caps across gate instances', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}');
  const clientA = 'a'.repeat(64);
  const clientB = 'b'.repeat(64);
  const instances = Array.from({ length: 3 }, () => gate(blob, { dailyCallLimit: 3, dailyClientLimit: 2 }));
  const requests = [
    instances[0].reserve({ clientKey: clientA }),
    instances[1].reserve({ clientKey: clientA }),
    instances[2].reserve({ clientKey: clientB }),
    instances[0].reserve({ clientKey: clientB }),
    instances[1].reserve({ clientKey: 'c'.repeat(64) }),
  ];
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(blob.state().calls, 3);
  assert.equal(Object.values(blob.state().clientCalls).reduce((sum, count) => sum + count, 0), 3);
  await assert.rejects(instances[1].reserve({ clientKey: 'd'.repeat(64) }),
    error => error.code === 'BUDGET_CALL_LIMIT');
});

test('a concurrent burst from one verified principal stops at its shared client cap', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}', { synchronizedReads: 5 });
  const principal = await verifiedClientKey(objectId(1));
  const clientKeys = Array.from({ length: 5 }, () => principal.key);
  const gates = Array.from({ length: clientKeys.length }, () => gate(blob, {
    dailyCallLimit: 12, dailyClientLimit: 3, clientHashSecret: principalSecret, requireClientKey: true,
  }));
  const results = await Promise.allSettled(gates.map((instance, index) =>
    instance.reserve({ clientKey: clientKeys[index] })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.deepEqual(results.filter(result => result.status === 'rejected')
    .map(result => result.reason.code), ['BUDGET_CLIENT_LIMIT', 'BUDGET_CLIENT_LIMIT']);
  assert.deepEqual(blob.state(), {
    day: '2026-11-14', reservedMicros: 1_650_000, calls: 3, clientCalls: { [principal.key]: 3 },
  });
});

test('simultaneous distinct verified principals cannot exceed the shared call cap', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}', { synchronizedReads: 6 });
  const principals = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    verifiedClientKey(objectId(index + 10))));
  const gates = Array.from({ length: principals.length }, () => gate(blob, {
    dailyCallLimit: 4, dailyClientLimit: 3, clientHashSecret: principalSecret, requireClientKey: true,
  }));
  const results = await Promise.allSettled(gates.map((instance, index) =>
    instance.reserve({ clientKey: principals[index].key })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  assert.deepEqual(results.filter(result => result.status === 'rejected')
    .map(result => result.reason.code), ['BUDGET_CALL_LIMIT', 'BUDGET_CALL_LIMIT']);
  const state = blob.state();
  assert.equal(state.calls, 4);
  assert.equal(state.reservedMicros, 2_200_000);
  assert.equal(Object.values(state.clientCalls).reduce((sum, count) => sum + count, 0), 4);
  assert.ok(Object.values(state.clientCalls).every(count => count === 1));
});

test('distinct verified principals contend atomically at the shared dollar ceiling', async () => {
  const blob = fakeBlob(JSON.stringify({
    day: '2026-11-14', reservedMicros: 48_900_000, calls: 89, clientCalls: {},
  }), { synchronizedReads: 6 });
  const principals = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    verifiedClientKey(objectId(index + 20))));
  const gates = Array.from({ length: principals.length }, () => gate(blob, {
    dailyCallLimit: 100, dailyClientLimit: 3, clientHashSecret: principalSecret, requireClientKey: true,
  }));
  const results = await Promise.allSettled(gates.map((instance, index) =>
    instance.reserve({ clientKey: principals[index].key })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter(result => result.status === 'rejected')
    .every(result => result.reason.code === 'BUDGET_EXHAUSTED'), true);
  const state = blob.state();
  assert.equal(state.calls, 91);
  assert.equal(state.reservedMicros, 50_000_000);
  assert.equal(Object.values(state.clientCalls).reduce((sum, count) => sum + count, 0), 2);
});

test('tampered principal claims cannot choose a budget identity', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}');
  const alice = await verifiedClientKey(objectId(30));
  const bob = await verifiedClientKey(objectId(31));
  const instance = gate(blob, {
    dailyCallLimit: 12, dailyClientLimit: 3, clientHashSecret: principalSecret, requireClientKey: true,
  });
  const reserveForToken = async token => {
    const principal = await verifyPrincipal(`Bearer ${token}`);
    const clientKey = createAzurePrincipalKey({ secret: principalSecret, ...principal });
    return instance.reserve({ clientKey });
  };
  await reserveForToken(alice.token);
  const [header, encodedPayload, signature] = alice.token.split('.');
  const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  claims.oid = objectId(31);
  const spoofedToken = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  await assert.rejects(reserveForToken(spoofedToken), error => error.code === 'AUTH_INVALID');
  await reserveForToken(bob.token);
  assert.deepEqual(blob.state().clientCalls, { [alice.key]: 1, [bob.key]: 1 });
  assert.equal(blob.state().calls, 2);
});

test('aborted or failed writes do not partially reserve; a committed reservation is not refunded', async () => {
  const initial = '{"day":"2026-11-14","reservedMicros":0}';
  const controller = new AbortController();
  const alice = await verifiedClientKey(objectId(40));
  const bob = await verifiedClientKey(objectId(41));
  const options = { clientHashSecret: principalSecret, requireClientKey: true };
  const cancelledBlob = fakeBlob(initial, {
    synchronizedReads: 2,
    beforeUpload: upload => {
      if (upload.abortSignal === controller.signal) controller.abort();
    },
  });
  const cancelledAndLive = await Promise.allSettled([
    gate(cancelledBlob, options).reserve({ signal: controller.signal, clientKey: alice.key }),
    gate(cancelledBlob, options).reserve({ clientKey: bob.key }),
  ]);
  assert.deepEqual(cancelledAndLive.map(result => result.status), ['rejected', 'fulfilled']);
  assert.equal(cancelledAndLive[0].reason.code, 'CANCELLED');
  assert.equal(cancelledBlob.state().calls, 1);
  assert.deepEqual(cancelledBlob.state().clientCalls, { [bob.key]: 1 });

  const failedBlob = fakeBlob(initial, { failUpload: true });
  await assert.rejects(gate(failedBlob, options).reserve({ clientKey: alice.key }),
    error => error.code === 'BUDGET_UNAVAILABLE');
  assert.deepEqual(failedBlob.state(), JSON.parse(initial));

  const committedBlob = fakeBlob(initial);
  const committedSignal = new AbortController();
  await gate(committedBlob, options).reserve({
    signal: committedSignal.signal, clientKey: alice.key,
  });
  committedSignal.abort();
  assert.equal(committedBlob.state().calls, 1);
  assert.equal(committedBlob.state().clientCalls[alice.key], 1);
});

test('per-client UTC-day limits are shared and are never refunded', async () => {
  const blob = fakeBlob('{"day":"2026-11-14","reservedMicros":0}');
  const clientKey = 'e'.repeat(64);
  const first = gate(blob, { dailyCallLimit: 12, dailyClientLimit: 2 });
  const second = gate(blob, { dailyCallLimit: 12, dailyClientLimit: 2 });
  await first.reserve({ clientKey });
  await second.reserve({ clientKey });
  await assert.rejects(first.reserve({ clientKey }), error => error.code === 'BUDGET_CLIENT_LIMIT');
  assert.equal(blob.state().calls, 2);
  assert.equal(blob.state().clientCalls[clientKey], 2);
});

test('legacy ledger state with prior spend fails closed until rollover; empty state migrates safely', async () => {
  const secret = 'secure test secret with at least thirty-two bytes';
  const clientKey = createAzurePrincipalKey({ secret,
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '22222222-2222-4222-8222-222222222222' });
  assert.match(clientKey, /^[0-9a-f]{64}$/);
  assert.notEqual(clientKey, createAzurePrincipalKey({ secret,
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '33333333-3333-4333-8333-333333333333' }));
  assert.throws(() => createAzurePrincipalKey({ secret: 'short',
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '22222222-2222-4222-8222-222222222222' }), /32 bytes/);
  assert.throws(() => createAzurePrincipalKey({ secret,
    tenantId: '11111111-1111-4111-8111-111111111111', objectId: 'not-a-guid' }), /principal is invalid/);
  assert.throws(() => gate(fakeBlob('{}'), { requireClientKey: true }), /32-byte client rate-limit secret/);
  const protectedGate = gate(fakeBlob('{"day":"2026-11-14","reservedMicros":0}'), {
    requireClientKey: true, clientHashSecret: secret,
  });
  await assert.rejects(protectedGate.reserve(), error => error.code === 'BUDGET_UNAVAILABLE');
  const old = fakeBlob('{"day":"2026-11-14","reservedMicros":550000}');
  await assert.rejects(gate(old).reserve(), error => error.code === 'BUDGET_CALL_LIMIT');
  assert.deepEqual(old.state(), { day: '2026-11-14', reservedMicros: 550000 });
  const empty = fakeBlob('{"day":"2026-11-14","reservedMicros":0}');
  await gate(empty).reserve();
  assert.equal(empty.state().calls, 1);
});

test('client cap and daily-call limit settings cannot be raised beyond their supported maximum', async () => {
  assert.throws(() => gate(fakeBlob('{}'), { dailyCallLimit: 101 }), /1-100 calls per day/);
  assert.throws(() => gate(fakeBlob('{}'), { dailyClientLimit: 4 }), /1-3 per client/);
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
