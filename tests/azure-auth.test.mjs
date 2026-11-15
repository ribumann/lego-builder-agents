import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { createAzureAccessTokenVerifier, getAzureAuthConfig } from '../azure-auth.mjs';

const tenantId = '11111111-1111-4111-8111-111111111111';
const apiClientId = '22222222-2222-4222-8222-222222222222';
const spaClientId = '33333333-3333-4333-8333-333333333333';
const objectId = '44444444-4444-4444-8444-444444444444';
const requiredScope = 'BrickLab.Plan';
const requiredRole = 'BrickLab.Planner';
const config = { tenantId, apiClientId, spaClientId, requiredScope, requiredRole };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const jwks = async header => {
  if (header.kid !== 'fixture-key') throw new Error('No matching key.');
  return publicKey;
};

async function signedToken(claims = {}, signer = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tid: tenantId, oid: objectId, azp: spaClientId, ver: '2.0',
    scp: requiredScope, roles: [requiredRole], ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(issuer).setAudience(apiClientId).setIssuedAt(now)
    .setNotBefore(now - 1).setExpirationTime(now + 300).sign(signer);
}

test('Azure auth configuration is strictly single-tenant and scopes the browser to the API', () => {
  assert.deepEqual(getAzureAuthConfig({
    BRICKLAB_ENTRA_TENANT_ID: tenantId,
    BRICKLAB_ENTRA_API_CLIENT_ID: apiClientId,
    BRICKLAB_ENTRA_SPA_CLIENT_ID: spaClientId,
    BRICKLAB_ENTRA_REQUIRED_SCOPE: requiredScope,
    BRICKLAB_ENTRA_REQUIRED_ROLE: requiredRole,
  }), { tenantId, apiClientId, spaClientId, requiredScope, requiredRole });
  assert.throws(() => getAzureAuthConfig({}), /settings are missing or invalid/);
  assert.throws(() => getAzureAuthConfig({
    BRICKLAB_ENTRA_TENANT_ID: 'common',
    BRICKLAB_ENTRA_API_CLIENT_ID: apiClientId,
    BRICKLAB_ENTRA_SPA_CLIENT_ID: spaClientId,
    BRICKLAB_ENTRA_REQUIRED_SCOPE: requiredScope,
    BRICKLAB_ENTRA_REQUIRED_ROLE: requiredRole,
  }), /settings are missing or invalid/);
});

test('Azure verifier validates signature, tenant, audience, authorized client, scope and role', async () => {
  const verify = createAzureAccessTokenVerifier(config, { jwks });
  const token = await signedToken();
  assert.deepEqual(await verify(`Bearer ${token}`), { tenantId, objectId });
  const failures = [
    signedToken({ tid: '55555555-5555-4555-8555-555555555555' }),
    signedToken({ azp: '55555555-5555-4555-8555-555555555555' }),
    signedToken({ scp: 'User.Read' }),
    signedToken({ roles: ['BrickLab.Reader'] }),
    signedToken({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
    new SignJWT({
      tid: tenantId, oid: objectId, azp: spaClientId, ver: '2.0',
      scp: requiredScope, roles: [requiredRole],
    }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
      .setIssuer('https://login.microsoftonline.com/55555555-5555-4555-8555-555555555555/v2.0')
      .setAudience(apiClientId).setIssuedAt().setExpirationTime('5m').sign(privateKey),
  ];
  for (const tokenFailure of failures)
    await assert.rejects(verify(`Bearer ${await tokenFailure}`), error =>
      error.code === 'AUTH_FORBIDDEN' || error.code === 'AUTH_INVALID');
  const wrongAudience = await new SignJWT({
    tid: tenantId, oid: objectId, azp: spaClientId, ver: '2.0',
    scp: requiredScope, roles: [requiredRole],
  }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(issuer).setAudience(spaClientId).setIssuedAt()
    .setExpirationTime('5m').sign(privateKey);
  await assert.rejects(verify(`Bearer ${wrongAudience}`), error => error.code === 'AUTH_INVALID');
});

test('Azure verifier rejects absent, malformed, expired and oversized bearer tokens', async () => {
  const verify = createAzureAccessTokenVerifier(config, { jwks });
  await assert.rejects(verify(undefined), error => error.code === 'AUTH_REQUIRED');
  await assert.rejects(verify('Basic secret'), error => error.code === 'AUTH_REQUIRED');
  await assert.rejects(verify(`Bearer ${'a'.repeat(16_385)}`), error => error.code === 'AUTH_REQUIRED');
  const expired = await new SignJWT({
    tid: tenantId, oid: objectId, azp: spaClientId, ver: '2.0',
    scp: requiredScope, roles: [requiredRole],
  }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(issuer).setAudience(apiClientId).setIssuedAt()
    .setExpirationTime(-1).sign(privateKey);
  await assert.rejects(verify(`Bearer ${expired}`), error => error.code === 'AUTH_INVALID');
});
