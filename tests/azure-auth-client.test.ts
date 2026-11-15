import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountInfo, Configuration, PopupRequest, SilentRequest } from '@azure/msal-browser';
import { createAzureAccessTokenProvider } from '../src/azure-auth';

const config = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  apiClientId: '22222222-2222-4222-8222-222222222222',
  clientId: '33333333-3333-4333-8333-333333333333',
  requiredScope: 'BrickLab.Plan',
  scope: 'api://22222222-2222-4222-8222-222222222222/BrickLab.Plan',
};
const account: AccountInfo = {
  homeAccountId: 'home', environment: 'login.microsoftonline.com',
  tenantId: config.tenantId, username: 'test@example.com', localAccountId: 'local',
};
const tokenResult = { accessToken: 'signed-api-token', account };
const authConfigResponse = () => new Response(JSON.stringify(config));

function client(overrides: Partial<{
  active: AccountInfo | null;
  accounts: AccountInfo[];
  loginPopup(request: PopupRequest): Promise<typeof tokenResult>;
  acquireTokenSilent(request: SilentRequest): Promise<typeof tokenResult>;
  acquireTokenPopup(request: PopupRequest): Promise<typeof tokenResult>;
}> = {}) {
  const calls: string[] = [];
  let active = overrides.active ?? null;
  const application = {
    async initialize() { calls.push('initialize'); },
    getActiveAccount() { return active; },
    getAllAccounts() { return overrides.accounts ?? []; },
    setActiveAccount(value: AccountInfo | null) { active = value; calls.push('setActiveAccount'); },
    async loginPopup(request: PopupRequest) {
      calls.push(`loginPopup:${request.scopes.join(',')}`);
      return overrides.loginPopup ? overrides.loginPopup(request) : tokenResult;
    },
    async acquireTokenSilent(request: SilentRequest) {
      calls.push(`acquireTokenSilent:${request.scopes.join(',')}`);
      return overrides.acquireTokenSilent ? overrides.acquireTokenSilent(request) : tokenResult;
    },
    async acquireTokenPopup(request: PopupRequest) {
      calls.push(`acquireTokenPopup:${request.scopes.join(',')}`);
      return overrides.acquireTokenPopup ? overrides.acquireTokenPopup(request) : tokenResult;
    },
  };
  return { application, calls };
}

test('Azure client silently acquires an API-scoped token and configures session-only MSAL cache', async () => {
  const fixture = client({ active: account });
  let msalConfig: Configuration | undefined;
  const provider = createAzureAccessTokenProvider({
    fetchImpl: async () => authConfigResponse(),
    clientFactory: configuration => { msalConfig = configuration; return fixture.application; },
  });
  assert.equal(await provider(), 'signed-api-token');
  assert.equal(msalConfig?.auth?.clientId, config.clientId);
  assert.equal(msalConfig?.auth?.authority, `https://login.microsoftonline.com/${config.tenantId}`);
  assert.equal(msalConfig?.cache?.cacheLocation, 'sessionStorage');
  assert.deepEqual(fixture.calls, ['initialize', `acquireTokenSilent:${config.scope}`]);
});

test('Azure client starts sign-in only from explicit token acquisition and uses the returned token', async () => {
  const fixture = client();
  let requested: PopupRequest | undefined;
  const provider = createAzureAccessTokenProvider({
    fetchImpl: async () => authConfigResponse(),
    clientFactory: () => ({
      ...fixture.application,
      async loginPopup(request) { requested = request; return tokenResult; },
    }),
  });
  assert.equal(await provider(), 'signed-api-token');
  assert.deepEqual(requested?.scopes, [config.scope]);
  assert.ok(fixture.calls.includes('initialize'));
});

test('Azure client falls back to one interactive token request only for interaction-required errors', async () => {
  const fixture = client({ active: account, acquireTokenSilent: async () => {
    throw Object.assign(new Error('interaction required'), { errorCode: 'interaction_required' });
  } });
  const provider = createAzureAccessTokenProvider({
    fetchImpl: async () => authConfigResponse(),
    clientFactory: () => fixture.application,
  });
  assert.equal(await provider(), 'signed-api-token');
  assert.deepEqual(fixture.calls, [
    'initialize', `acquireTokenSilent:${config.scope}`, `acquireTokenPopup:${config.scope}`,
  ]);
});

test('Azure client fails closed on bad server configuration or sign-in errors', async () => {
  const missing = createAzureAccessTokenProvider({
    fetchImpl: async () => new Response('{}', { status: 503 }),
    clientFactory: () => { throw new Error('must not initialize'); },
  });
  await assert.rejects(missing(), /No planning request was sent/);
  const invalidConfig = createAzureAccessTokenProvider({
    fetchImpl: async () => new Response(JSON.stringify({ ...config, apiClientId: 'attacker' })),
    clientFactory: () => { throw new Error('must not initialize'); },
  });
  await assert.rejects(invalidConfig(), /No planning request was sent/);
});
