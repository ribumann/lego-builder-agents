const MAX_PROMPT_BYTES = 32_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CONTENT_BYTES = 128_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class CompatiblePlannerError extends Error {}
const fail = message => { throw new CompatiblePlannerError(message); };
const malformed = () => fail('Compatible AI returned a malformed or incomplete response.');

function validateEndpoint(endpoint) {
  // Check spelling before URL normalization: no credentials, queries, fragments,
  // escaped hosts/paths, abbreviated IPv4, backslashes or dot-segment rewriting.
  const match = typeof endpoint === 'string' && endpoint.length <= 2048
    && /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?(\/[a-zA-Z0-9/._~-]*)?$/.exec(endpoint);
  if (!match || match[0] !== endpoint
      || (match[3] !== undefined && (+match[3] < 1 || +match[3] > 65535))
      || match[4]?.split('/').some(segment => segment === '.' || segment === '..'))
    fail('Compatible AI endpoint must be an explicit HTTPS URL or literal loopback HTTP URL, without credentials, query, fragment or normalized path.');
  let url;
  try { url = new URL(endpoint); }
  catch { fail('Compatible AI endpoint is invalid.'); }
  if (url.hostname !== match[2].toLowerCase()
      || (!url.hostname.startsWith('[') && (url.hostname.length > 253
        || !url.hostname.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))))
      || (url.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(url.hostname)))
    fail('Compatible AI endpoint must use HTTPS except for literal 127.0.0.1 or [::1] HTTP.');
}

/**
 * Server-only, opt-in factory: { enabled:false, endpoint, model, apiKey?,
 * fetchImpl? }. endpoint is the complete chat-completions URL, not a base URL.
 * status() is configuration-only and discloses neither endpoint nor credentials.
 * plan({ prompt, signal? }) posts one user message, stream:false, JSON-object
 * output and max_tokens:12000. It returns a parsed JSON object; the caller must
 * validate custom-spec geometry. No preflight, retries, fallback or deployment.
 */
export function createOpenAICompatiblePlanner(configuration = {}) {
  if (!object(configuration) || Object.keys(configuration).some(key =>
    !['enabled', 'endpoint', 'model', 'apiKey', 'fetchImpl'].includes(key)))
    fail('Compatible AI configuration is invalid.');
  const { enabled = false, endpoint, model, apiKey, fetchImpl = fetch } = configuration;
  if (typeof enabled !== 'boolean') fail('Compatible AI enabled must be a boolean.');
  if (enabled || endpoint !== undefined) validateEndpoint(endpoint);
  if ((enabled || model !== undefined) && (typeof model !== 'string'
      || model.length > 256 || !/^[a-zA-Z0-9]/.test(model) || /[^a-zA-Z0-9:/._-]/.test(model)))
    fail('Compatible AI model must be a 1-256 character model identifier.');
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.length
      || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)))
    fail('Compatible AI API key must be a nonempty printable token without whitespace.');
  if (typeof fetchImpl !== 'function') fail('Compatible AI transport is invalid.');

  return {
    status() {
      return { enabled, state: enabled ? 'configured' : 'off',
        message: enabled
          ? 'Compatible AI is configured. Availability and authentication are unverified; only explicit planning sends a prompt.'
          : 'Compatible AI is off.' };
    },

    async plan(request) {
      if (!enabled) fail('Compatible AI is off.');
      if (!object(request) || Object.keys(request).some(key => !['prompt', 'signal'].includes(key))
          || typeof request.prompt !== 'string' || !request.prompt.trim()
          || Buffer.byteLength(request.prompt) > MAX_PROMPT_BYTES
          || (request.signal !== undefined && !(request.signal instanceof AbortSignal)))
        fail('Compatible AI planning request is invalid or too large.');
      const { prompt, signal } = request;
      try {
        if (signal?.aborted) fail('Compatible AI planning was cancelled.');
        const response = await fetchImpl(endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json',
            ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }) },
          body: JSON.stringify({
            model, messages: [{ role: 'user', content: prompt }],
            stream: false, max_tokens: 12000, response_format: { type: 'json_object' },
          }),
        });
        if (!response.ok || response.redirected || !response.body) {
          response.body?.cancel().catch(() => {});
          if (response.redirected || (response.status >= 300 && response.status < 400))
            fail('Compatible AI redirects are not allowed.');
          if (response.status === 401 || response.status === 403)
            fail('Compatible AI denied access. Check the server-side authentication and model configuration.');
          if (response.status === 429)
            fail('Compatible AI rate or quota limit reached. No retry was attempted.');
          fail('Compatible AI service returned an HTTP failure. No retry was attempted.');
        }
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            if (signal?.aborted) fail('Compatible AI planning was cancelled.');
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) fail('Compatible AI returned an oversized response.');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (signal?.aborted) fail('Compatible AI planning was cancelled.');
        let envelope;
        try {
          envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
        } catch { malformed(); }
        if (!object(envelope) || envelope.error !== undefined
            || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) malformed();
        const choice = envelope.choices[0];
        if (!object(choice) || choice.finish_reason !== 'stop'
            || (choice.index !== undefined && choice.index !== 0) || !object(choice.message)
            || choice.message.role !== 'assistant' || choice.message.refusal != null
            || choice.message.tool_calls != null || choice.message.function_call != null
            || typeof choice.message.content !== 'string'
            || Buffer.byteLength(choice.message.content) > MAX_CONTENT_BYTES) malformed();
        let result;
        try { result = JSON.parse(choice.message.content); }
        catch { malformed(); }
        if (!object(result)) malformed();
        return result;
      } catch (error) {
        if (signal?.aborted) throw new CompatiblePlannerError('Compatible AI planning was cancelled.');
        if (error instanceof CompatiblePlannerError) throw error;
        throw new CompatiblePlannerError('Compatible AI service could not be reached. No retry was attempted.');
      }
    },
  };
}
