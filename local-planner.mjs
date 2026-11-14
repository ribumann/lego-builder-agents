import { Agent, request } from 'node:http';

const MAX_BODY_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 128_000;
const MAX_TIMEOUT_MS = 90_000;
const modelIdentifier = value => typeof value === 'string'
  && value.length <= 256 && /^[a-zA-Z0-9]/.test(value)
  && !/[^a-zA-Z0-9:/._-]/.test(value);
const canonicalModel = name => name.lastIndexOf(':') > name.lastIndexOf('/') ? name : `${name}:latest`;
const cloudModel = name => /:.*cloud/i.test(name);
const trustNotice = 'Start the trusted host Ollama service with OLLAMA_NO_CLOUD=1. Model metadata checks cannot prove the service is offline or not proxying.';
const missingModel = 'Local model is missing. Run `ollama pull MODEL` manually on the server host, replacing MODEL with the configured model name; no download was attempted.';
const localError = message => new Error(`${message} ${trustNotice}`);

/**
 * Configuration-only construction/status. Only explicit plan() calls contact the
 * trusted loopback service: GET /api/tags, then POST /api/generate. Each response
 * is capped at 1 MiB and the entire operation shares one <=90 second deadline.
 * Ollama generation is non-streaming JSON, capped at 12000 predicted tokens,
 * with keep_alive:0. No automatic pulls, retries, tools, or fallback providers.
 */
export function createLocalPlanner({ enabled, model, url = 'http://127.0.0.1:11434', timeoutMs = MAX_TIMEOUT_MS }) {
  if (typeof enabled !== 'boolean')
    throw localError('Local AI enabled must be a boolean.');
  const validModel = modelIdentifier(model);
  if (enabled && model !== '' && !validModel)
    throw localError('Local model must be a 1–256 character identifier using letters, numbers, colon, slash, dot, underscore or hyphen, starting with a letter or number.');

  let base;
  if (enabled) {
    // Validate the original spelling, not just URL's normalized hostname/path:
    // URL alone accepts abbreviated/integer IPv4, dot segments and empty ?/#.
    const match = typeof url === 'string'
      && /^http:\/\/(127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?\/?$/.exec(url);
    if (!match || match[0] !== url || (match[2] !== undefined && (+match[2] < 1 || +match[2] > 65535)))
      throw localError('Local AI URL must use HTTP and literal 127.0.0.1 or [::1], an optional valid port, and no credentials, path, query or fragment.');
    base = new URL(url).origin;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
      throw localError('Local AI timeout must be greater than zero and at most 90000 milliseconds.');
  }
  const configuredModel = validModel ? model : '';
  let busy = false;

  return {
    status() {
      const state = !enabled ? 'off' : !configuredModel ? 'missing-model' : 'configured';
      const message = state === 'off'
        ? 'Local AI is off. Set BRICKLAB_LOCAL_AI=1 and BRICKLAB_LOCAL_MODEL to opt in.'
        : state === 'missing-model'
          ? 'Set BRICKLAB_LOCAL_MODEL to an installed local Ollama model.'
          : 'Local AI is configured. Only an explicit plan request checks model metadata and generates a response.';
      return { enabled, model: configuredModel, state,
        message: `${message} Service availability and authentication are unverified. ${trustNotice}` };
    },

    async plan(prompt) {
      if (!enabled) throw localError('Local AI is off. Set BRICKLAB_LOCAL_AI=1 to opt in.');
      if (!configuredModel) throw localError('Set BRICKLAB_LOCAL_MODEL to an installed local Ollama model.');
      if (typeof prompt !== 'string') throw localError('Local AI prompt must be a string.');
      if (busy) throw localError('A local AI request is already in progress. Wait for it to finish.');
      if (cloudModel(configuredModel))
        throw localError('Cloud-tagged models are not allowed for local AI.');
      busy = true;
      const controller = new AbortController();
      // Native HTTP with our own agent: never use fetch's global dispatcher or
      // http.globalAgent, and never opt into proxyEnv/environment proxy routing.
      // Disable keep-alive and destroy the agent when this explicit plan ends.
      const agent = new Agent({ keepAlive: false });
      let timedOut = false;
      let failure;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const fail = message => {
        failure = localError(message);
        throw failure;
      };
      const requestJSON = async (path, body) => {
        const response = await new Promise((resolve, reject) => {
          const req = request(`${base}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? { Accept: 'application/json' }
              : { Accept: 'application/json', 'Content-Type': 'application/json' },
            agent,
            signal: controller.signal,
          }, resolve);
          req.on('error', reject);
          req.end(body === undefined ? undefined : JSON.stringify(body));
        });
        try {
          // node:http never follows redirects; reject before reading their body.
          if (response.statusCode >= 300 && response.statusCode < 400)
            fail('Local Ollama redirects are not allowed. Check the trusted host service configuration.');
          if (response.statusCode === 404) fail(missingModel);
          if (response.statusCode === 401 || response.statusCode === 403)
            fail('Local Ollama denied access. Check authentication on the trusted server host; this adapter does not send credentials.');
          if (response.statusCode < 200 || response.statusCode >= 300)
            fail('Local Ollama returned an HTTP error. Check the trusted host service; no retry or fallback was attempted.');
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response) {
            bytes += chunk.byteLength;
            if (bytes > MAX_BODY_BYTES) fail('Local Ollama response exceeded the 1 MiB size limit.');
            chunks.push(chunk);
          }
          if (!response.complete) fail('Local Ollama returned an incomplete response.');
          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
            return JSON.parse(text);
          } catch {
            fail('Local Ollama returned malformed JSON or invalid UTF-8; no fallback was attempted.');
          }
        } finally {
          // Stop immediately on limits, timeout or rejected status, even when
          // the service leaves its body open indefinitely.
          if (failure || timedOut) controller.abort();
          response.destroy();
        }
      };

      try {
        // Never send the brief during metadata preflight.
        const tags = await requestJSON('/api/tags');
        if (!tags || !Array.isArray(tags.models) || tags.error !== undefined
            || !tags.models.every(item => item && typeof item === 'object'
              && !Array.isArray(item) && modelIdentifier(item.name)))
          fail('Local Ollama returned unknown or malformed model metadata. No prompt was sent.');
        const selected = tags.models.filter(item => canonicalModel(item.name) === canonicalModel(configuredModel));
        if (!selected.length) fail(missingModel);
        for (const item of selected) {
          if ((item.model !== undefined && (!modelIdentifier(item.model)
                || canonicalModel(item.model) !== canonicalModel(configuredModel)))
              || ['remote_model', 'remote_host'].some(key => item[key] !== undefined && item[key] !== '')
              || cloudModel(item.name))
            fail('Local model metadata is remote or untrusted. No prompt was sent.');
        }
        const result = await requestJSON('/api/generate', {
          model: configuredModel, prompt, stream: false, format: 'json',
          options: { num_predict: 12000 }, keep_alive: 0,
        });
        if (!result || Array.isArray(result) || result.error !== undefined
            || result.done !== true || typeof result.response !== 'string')
          fail('Local Ollama returned an incomplete or error response; no fallback was attempted.');
        if (Buffer.byteLength(result.response, 'utf8') > MAX_RESPONSE_BYTES)
          fail('Local Ollama final response exceeded the 128000-byte size limit.');
        return result.response;
      } catch {
        if (timedOut) throw localError('Local Ollama request timed out. Check the trusted host service or choose a smaller installed model; no retry was attempted.');
        if (failure) throw failure;
        throw localError('Could not complete the local Ollama request. Start `ollama serve` on the server host and check its configuration; redirects are not allowed.');
      } finally {
        clearTimeout(timer);
        controller.abort();
        agent.destroy();
        busy = false;
      }
    },
  };
}

