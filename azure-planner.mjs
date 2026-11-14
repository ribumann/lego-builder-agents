import { ManagedIdentityCredential } from '@azure/identity';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CONTENT_BYTES = 128_000;
const SCOPE = 'https://cognitiveservices.azure.com/.default';

export function createAzurePlanner({ endpoint, deployment, credential = new ManagedIdentityCredential(), fetchImpl = fetch }) {
  if (typeof endpoint !== 'string'
      || !/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com\/?$/i.test(endpoint))
    throw new Error('Azure OpenAI endpoint must be an HTTPS resource endpoint in the public Azure cloud.');
  if (typeof deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment))
    throw new Error('Azure OpenAI deployment name is invalid.');
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21`;

  return async function planAzure({ prompt, signal }) {
    if (typeof prompt !== 'string' || !prompt || Buffer.byteLength(prompt) > 32_000)
      throw new Error('Azure planning prompt is invalid or too large.');
    try {
      const token = await credential.getToken(SCOPE, { abortSignal: signal });
      if (!token?.token) throw new Error('No managed identity token.');
      const response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 12000,
          response_format: { type: 'json_object' },
        }),
      });
      if (!response.ok || !response.body) {
        response.body?.cancel().catch(() => {});
        throw new Error('Azure OpenAI request failed.');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error('Azure response too large.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
      const choice = envelope?.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason !== 'stop' || typeof content !== 'string'
          || Buffer.byteLength(content) > MAX_CONTENT_BYTES)
        throw new Error('Azure response was incomplete.');
      return JSON.parse(content);
    } catch (error) {
      if (signal?.aborted) throw new Error('Azure planning was cancelled.');
      throw new Error('Azure planning failed or returned an invalid response. No retry or fallback was attempted.');
    }
  };
}

let planner;
export function planAzure(request) {
  planner ??= createAzurePlanner({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  });
  return planner(request);
}
