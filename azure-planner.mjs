import { ManagedIdentityCredential } from '@azure/identity';
import { validatePlanningImage } from './planning-image.mjs';
import { COLOR_NAMES } from './src/brick-colors.mjs';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CONTENT_BYTES = 128_000;
const SCOPE = 'https://cognitiveservices.azure.com/.default';

class AzurePlannerError extends Error {}

const providerCodes = new Map([
  ['429', 'rate-limit'], ['RateLimitExceeded', 'rate-limit'], ['RateLimitReached', 'rate-limit'],
  ['TooManyRequests', 'rate-limit'], ['rate_limit_exceeded', 'rate-limit'],
  ['insufficient_quota', 'quota'], ['QuotaExceeded', 'quota'],
  ['DeploymentNotFound', 'deployment'], ['OperationNotSupported', 'unsupported-operation'],
  ['InvalidApiVersionParameter', 'unsupported-api-version'],
  ['BadRequest', 'invalid-request'], ['invalid_request_error', 'invalid-request'],
  ['content_filter', 'content-filter'], ['ResponsibleAIPolicyViolation', 'content-filter'],
]);

export function getAzurePlannerDiagnostic(error) {
  return error instanceof AzurePlannerError ? error.providerDiagnostic : undefined;
}

async function providerDiagnostic(response) {
  const diagnostic = { status: response.status,
    category: response.status === 429 ? 'rate-limit' : 'http-error' };
  for (const [header, field] of [
    ['retry-after', 'retryAfterSeconds'], ['retry-after-ms', 'retryAfterMs'],
    ['x-ms-retry-after-ms', 'retryAfterMs'],
    ['x-ratelimit-limit-requests', 'requestLimit'], ['x-ratelimit-remaining-requests', 'requestsRemaining'],
    ['x-ratelimit-limit-tokens', 'tokenLimit'], ['x-ratelimit-remaining-tokens', 'tokensRemaining'],
  ]) {
    const value = response.headers.get(header);
    if (value !== null && /^\d{1,10}$/.test(value) && Number(value) <= 1_000_000_000)
      diagnostic[field] = Number(value);
  }
  if (!response.body) return { ...diagnostic, details: 'missing' };
  const reader = response.body.getReader();
  let timeout;
  try {
    const read = async () => {
      const chunks = [];
      let size = 0;
      for (let reads = 0; reads < 128; reads++) {
        const { done, value } = await reader.read();
        if (done) {
          try {
            return { details: 'parsed', error: JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))?.error };
          } catch { return { details: 'invalid-json' }; }
        }
        size += value.byteLength;
        if (size > 16_384) return { details: 'too-large' };
        chunks.push(value);
      }
      return { details: 'too-many-chunks' };
    };
    const result = await Promise.race([
      read().catch(() => ({ details: 'unavailable' })),
      new Promise(resolve => { timeout = setTimeout(() => resolve({ details: 'timeout' }), 1000); }),
    ]);
    diagnostic.details = result.details;
    for (const [value, field] of [
      [result.error?.code, 'code'], [result.error?.innererror?.code ?? result.error?.inner_error?.code, 'innerCode'],
    ]) {
      if (providerCodes.has(value)) {
        diagnostic[field] = value;
        diagnostic.category = providerCodes.get(value);
      }
    }
    if (response.status === 429 && typeof result.error?.message === 'string') {
      if (/\btoken rate limit\b/i.test(result.error.message)) diagnostic.category = 'token-rate-limit';
      else if (/\b(?:request|call) rate limit\b/i.test(result.error.message)) diagnostic.category = 'request-rate-limit';
    }
    return diagnostic;
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
  }
}

const objectSchema = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const integerEnum = (min, max) => ({
  type: 'integer', enum: Array.from({ length: max - min + 1 }, (_, index) => min + index),
});
const brickProperties = {
  x: { $ref: '#/$defs/horizontal' }, y: { $ref: '#/$defs/vertical' }, z: { $ref: '#/$defs/horizontal' },
  width: { $ref: '#/$defs/dimension' }, height: { $ref: '#/$defs/dimension' }, depth: { $ref: '#/$defs/dimension' },
  color: { type: 'string', enum: COLOR_NAMES }, part: { type: 'string', enum: ['frame', 'detail'] },
};
const brickSchema = { anyOf: [
  objectSchema(brickProperties),
  objectSchema({ ...brickProperties, repeat: objectSchema({
    count: { $ref: '#/$defs/repeatCount' },
    dx: { type: 'integer', description: 'Integer stride from -127 to 127; all repeated bricks must remain in bounds.' },
    dy: { type: 'integer', description: 'Integer stride from -63 to 63; all repeated bricks must remain in bounds.' },
    dz: { type: 'integer', description: 'Integer stride from -127 to 127; all repeated bricks must remain in bounds.' },
  }) }),
] };
const bricksSchema = { type: 'array', items: brickSchema };
const designSchema = { anyOf: [
  objectSchema({ name: { type: 'string' }, bricks: bricksSchema }),
  objectSchema({ name: { type: 'string' }, objects: {
    type: 'array', items: objectSchema({ name: { type: 'string' }, bricks: bricksSchema }),
  } }),
] };

export function createAzurePlanner({ endpoint, deployment,
  credential = new ManagedIdentityCredential(), fetchImpl = fetch }) {
  if (typeof endpoint !== 'string'
      || !/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com\/?$/i.test(endpoint))
    throw new Error('Azure OpenAI endpoint must be an HTTPS resource endpoint in the public Azure cloud.');
  if (typeof deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment))
    throw new Error('Azure OpenAI deployment name is invalid.');
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21`;

  return async function planAzure({ prompt, world, signal, image: rawImage, imageConsent }) {
    if (typeof prompt !== 'string' || !prompt || Buffer.byteLength(prompt) > 32_000)
      throw new Error('Azure planning prompt is invalid or too large.');
    if (world !== undefined && !['jurassic', 'space'].includes(world))
      throw new Error('Azure planning world is invalid.');
    const image = validatePlanningImage(rawImage, imageConsent);
    try {
      signal?.throwIfAborted();
      let token;
      try { token = await credential.getToken(SCOPE, { abortSignal: signal }); }
      catch { throw new AzurePlannerError('Azure managed identity is unavailable. Check the hosting identity configuration.'); }
      if (!token?.token) throw new AzurePlannerError('Azure managed identity is unavailable. Check the hosting identity configuration.');
      signal?.throwIfAborted();
      const response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: image
            ? [{ type: 'text', text: prompt }, { type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.data}` } }]
            : prompt }],
          max_completion_tokens: 12000,
          response_format: { type: 'json_schema', json_schema: {
            name: 'bricklab_custom_design', strict: true, schema: { ...objectSchema({
              world: { type: 'string', enum: world ? [world] : ['jurassic', 'space'] },
              model: { type: 'string', enum: ['custom'] },
              color: { type: 'string', enum: COLOR_NAMES },
              longTail: { type: 'boolean', enum: [false] },
              wideWings: { type: 'boolean', enum: [false] },
              budget: { type: 'integer', description: 'Expanded brick budget from 1 to 8192; at least the sum of all repeat counts and single bricks.' },
              design: designSchema,
            }), $defs: {
              horizontal: integerEnum(-64, 63), vertical: integerEnum(0, 63),
              dimension: integerEnum(1, 8),
              // A straight nonzero integer stride cannot fit more than 128 positions.
              repeatCount: integerEnum(2, 128),
            } },
          } },
        }),
      });
      if (!response.ok || !response.body) {
        const diagnostic = await providerDiagnostic(response);
        const failure = message => Object.assign(new AzurePlannerError(message), {
          providerDiagnostic: diagnostic, ...(response.status === 429 ? { statusCode: 429 } : {}),
        });
        if (response.status === 401 || response.status === 403)
          throw failure('Azure OpenAI denied model access. Check the managed identity role and resource configuration.');
        if (response.status === 429)
          throw failure('Azure OpenAI rate or quota limit reached. No retry was attempted.');
        throw failure('Azure OpenAI service is unavailable. No retry was attempted.');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new AzurePlannerError('Azure OpenAI returned an oversized response.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let envelope;
      try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
      catch { throw new AzurePlannerError('Azure OpenAI returned a malformed or incomplete response.'); }
      const choice = envelope?.choices?.[0];
      const content = choice?.message?.content;
      const promptBlocked = envelope?.prompt_filter_results?.some(result =>
        hasBlockedFilter(result?.content_filter_results ?? result));
      const completionBlocked = envelope?.choices?.some(result =>
        result?.finish_reason === 'content_filter'
          || hasBlockedFilter(result?.content_filter_results ?? result));
      if (promptBlocked || completionBlocked)
        throw new AzurePlannerError('Azure content safety filters blocked the planning request or response.');
      if (choice?.finish_reason !== 'stop' || typeof content !== 'string'
          || Buffer.byteLength(content) > MAX_CONTENT_BYTES)
        throw new AzurePlannerError('Azure OpenAI returned a malformed or incomplete response.');
      try { return JSON.parse(content); }
      catch { throw new AzurePlannerError('Azure OpenAI returned a malformed or incomplete response.'); }
    } catch (error) {
      if (signal?.aborted) throw new Error('Azure planning was cancelled.');
      if (error instanceof AzurePlannerError) throw error;
      throw new Error('Azure OpenAI service could not be reached. No retry was attempted.');
    }
  };
}

function hasBlockedFilter(value) {
  if (!value || typeof value !== 'object') return false;
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (current.filtered === true) return true;
    pending.push(...Object.values(current).filter(item => item && typeof item === 'object'));
  }
  return false;
}

let planner;
export function planAzure(request) {
  planner ??= createAzurePlanner({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  });
  return planner(request);
}
