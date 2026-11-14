import { ManagedIdentityCredential } from '@azure/identity';

const SCOPE = 'https://cognitiveservices.azure.com/.default';
const MAX_SAMPLES = 16_000 * 60;
const MAX_RESPONSE_BYTES = 64_000;

export function validateSpeechAudio(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 46 || audio.length > 44 + MAX_SAMPLES * 2
      || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE'
      || audio.readUInt32LE(4) !== audio.length - 8
      || audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16
      || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
      || audio.readUInt32LE(24) !== 16_000 || audio.readUInt32LE(28) !== 32_000
      || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
      || audio.toString('ascii', 36, 40) !== 'data'
      || audio.readUInt32LE(40) !== audio.length - 44 || (audio.length - 44) % 2 !== 0)
    throw new Error('Speech audio must be a canonical 16 kHz mono PCM WAV of at most 60 seconds.');
  return { seconds: (audio.length - 44) / 32_000 };
}

async function readResponse(response) {
  if (!response.ok || !response.body) {
    response.body?.cancel().catch(() => {});
    throw new Error('Azure Speech request failed.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Azure Speech response is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
}

// The caller must enforce consent and authenticated access. reserve must be a
// verified speech reservation against the same durable ledger as text inference.
export function createAzureSpeechTranscriber({ endpoint, resourceId, reserve,
  credential = new ManagedIdentityCredential(), fetchImpl = fetch }) {
  const resource = typeof resourceId === 'string'
    && /^\/subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/resourceGroups\/[\w().-]{1,90}\/providers\/Microsoft\.CognitiveServices\/accounts\/([a-z0-9][a-z0-9-]{0,62})$/i.exec(resourceId);
  if (!resource || endpoint !== `https://${resource[1].toLowerCase()}.cognitiveservices.azure.com`)
    throw new Error('Speech requires a matching resource ID and custom-domain HTTPS endpoint.');
  if (typeof reserve !== 'function' || typeof fetchImpl !== 'function')
    throw new Error('Speech requires a verified budget reservation and transport.');

  return async function transcribe({ audio, language, signal }) {
    const { seconds } = validateSpeechAudio(audio);
    const audioCopy = Buffer.from(audio);
    if (!['en-US', 'de-DE', 'fr-FR', 'it-IT', 'es-ES', 'pt-PT'].includes(language))
      throw new Error('Speech language is unsupported.');
    signal?.throwIfAborted();
    try {
      await reserve({ seconds, signal });
    } catch {
      throw new Error('Speech budget could not be reserved; no audio was sent.');
    }
    signal?.throwIfAborted();
    try {
      const token = await credential.getToken(SCOPE, { abortSignal: signal });
      if (!token?.token) throw new Error('Missing managed identity token.');
      signal?.throwIfAborted();
      const url = `${endpoint}/stt/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`;
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal,
        headers: {
          Authorization: `Bearer aad#${resourceId}#${token.token}`,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
        },
        body: audioCopy,
      });
      const result = await readResponse(response);
      if (result?.RecognitionStatus !== 'Success' || typeof result.DisplayText !== 'string'
          || !result.DisplayText.trim() || result.DisplayText.length > 4_000)
        throw new Error('Speech recognition did not return a transcript.');
      return { transcript: result.DisplayText };
    } catch {
      if (signal?.aborted) throw new Error('Speech transcription was cancelled.');
      throw new Error('Azure Speech transcription failed; no retry was attempted.');
    }
  };
}
