import { createRemoteJWKSet, jwtVerify } from 'jose';

const GUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CLAIM_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const MAX_TOKEN_BYTES = 16_384;

function invalidSettings() {
  throw new Error('Azure Entra authentication settings are missing or invalid.');
}

export function getAzureAuthConfig(env = process.env) {
  const tenantId = env.BRICKLAB_ENTRA_TENANT_ID;
  const apiClientId = env.BRICKLAB_ENTRA_API_CLIENT_ID;
  const spaClientId = env.BRICKLAB_ENTRA_SPA_CLIENT_ID;
  const requiredScope = env.BRICKLAB_ENTRA_REQUIRED_SCOPE;
  const requiredRole = env.BRICKLAB_ENTRA_REQUIRED_ROLE;
  if (typeof tenantId !== 'string' || !GUID.test(tenantId)
      || typeof apiClientId !== 'string' || !GUID.test(apiClientId)
      || typeof spaClientId !== 'string' || !GUID.test(spaClientId)
      || typeof requiredScope !== 'string' || !CLAIM_NAME.test(requiredScope)
      || typeof requiredRole !== 'string' || !CLAIM_NAME.test(requiredRole))
    invalidSettings();
  return {
    tenantId: tenantId.toLowerCase(),
    apiClientId: apiClientId.toLowerCase(),
    spaClientId: spaClientId.toLowerCase(),
    requiredScope,
    requiredRole,
  };
}

export function createAzureAccessTokenVerifier(config, { jwks } = {}) {
  if (!config || !GUID.test(config.tenantId) || !GUID.test(config.apiClientId)
      || !GUID.test(config.spaClientId) || !CLAIM_NAME.test(config.requiredScope)
      || !CLAIM_NAME.test(config.requiredRole))
    invalidSettings();
  const tenantId = config.tenantId.toLowerCase();
  const apiClientId = config.apiClientId.toLowerCase();
  const spaClientId = config.spaClientId.toLowerCase();
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const signingKeys = jwks ?? createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));

  return async function verifyAzureAccessToken(authorization) {
    if (typeof authorization !== 'string' || Buffer.byteLength(authorization) > MAX_TOKEN_BYTES)
      throw Object.assign(new Error('Azure sign-in is required.'), { code: 'AUTH_REQUIRED', statusCode: 401 });
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization);
    if (!match) throw Object.assign(new Error('Azure sign-in is required.'), { code: 'AUTH_REQUIRED', statusCode: 401 });
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], signingKeys, {
        algorithms: ['RS256'],
        issuer,
        audience: apiClientId,
        requiredClaims: ['exp', 'iat', 'tid', 'oid'],
        maxTokenAge: 90 * 60,
        clockTolerance: 60,
      }));
    } catch {
      throw Object.assign(new Error('Azure sign-in could not be verified.'), { code: 'AUTH_INVALID', statusCode: 401 });
    }

    const scopes = typeof payload.scp === 'string' ? payload.scp.split(/\s+/) : [];
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    if (payload.ver !== '2.0' || typeof payload.tid !== 'string' || payload.tid.toLowerCase() !== tenantId
        || typeof payload.oid !== 'string' || !GUID.test(payload.oid)
        || typeof payload.azp !== 'string' || payload.azp.toLowerCase() !== spaClientId
        || !scopes.includes(config.requiredScope) || !roles.includes(config.requiredRole))
      throw Object.assign(new Error('Azure sign-in is not authorized for planning.'), { code: 'AUTH_FORBIDDEN', statusCode: 403 });

    return { tenantId, objectId: payload.oid.toLowerCase() };
  };
}
