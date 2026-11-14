import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAzureSpeechTranscriber, validateSpeechAudio } from '../azure-speech.mjs';

const endpoint = 'https://bricklab-speech.cognitiveservices.azure.com';
const resourceId = '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/bricklab/providers/Microsoft.CognitiveServices/accounts/bricklab-speech';
function wav(samples = 16000) {
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}

test('bounds and verifies the actual WAV format and duration', () => {
  assert.equal(validateSpeechAudio(wav(960000)).seconds, 60);
  assert.throws(() => validateSpeechAudio(wav(960001)), /at most 60 seconds/);
  for (const change of [
    b => b.writeUInt16LE(2, 22), b => b.writeUInt32LE(48000, 24),
    b => b.writeUInt32LE(0, 40), b => b.write('JUNK', 36),
  ]) {
    const input = wav(); change(input);
    assert.throws(() => validateSpeechAudio(input), /canonical/);
  }
});

test('reserves first and uses managed identity and the documented Speech bearer', async () => {
  const steps = [];
  const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId,
    reserve: async ({ seconds }) => { assert.equal(seconds, 1); steps.push('reserve'); },
    credential: { async getToken(scope) { steps.push('token'); assert.equal(scope, 'https://cognitiveservices.azure.com/.default'); return { token: 'test-token' }; } },
    fetchImpl: async (url, options) => {
      steps.push('request');
      assert.equal(url, `${endpoint}/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple`);
      assert.equal(options.headers.Authorization, `Bearer aad#${resourceId}#test-token`);
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: 'Build a lighthouse.' }));
    },
  });
  assert.deepEqual(await transcribe({ audio: wav(), language: 'en-US' }), { transcript: 'Build a lighthouse.' });
  assert.deepEqual(steps, ['reserve', 'token', 'request']);
});

test('invalid input, cancellation and budget failure never send audio', async () => {
  let sent = 0, reserved = 0;
  const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId,
    reserve: async () => { reserved++; throw new Error('private budget details'); },
    fetchImpl: async () => { sent++; },
  });
  await assert.rejects(transcribe({ audio: Buffer.alloc(4), language: 'en-US' }), /canonical/);
  await assert.rejects(transcribe({ audio: wav(), language: 'unknown' }), /unsupported/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribe({ audio: wav(), language: 'en-US', signal: controller.signal }));
  assert.equal(reserved, 0);
  await assert.rejects(transcribe({ audio: wav(), language: 'en-US' }), error =>
    /budget could not be reserved/.test(error.message) && !error.message.includes('private'));
  assert.equal(sent, 0);
});

test('rejects unmatched endpoints and sanitizes provider errors without retry', async () => {
  assert.throws(() => createAzureSpeechTranscriber({ endpoint: 'https://other.cognitiveservices.azure.com', resourceId, reserve() {} }), /matching/);
  let calls = 0;
  const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId, reserve: async () => {},
    credential: { async getToken() { return { token: 'token' }; } },
    fetchImpl: async () => { calls++; return new Response('private provider error', { status: 403 }); },
  });
  await assert.rejects(transcribe({ audio: wav(), language: 'en-US' }), error =>
    /transcription failed/.test(error.message) && !error.message.includes('private'));
  assert.equal(calls, 1);
});

test('cancellation after reservation never sends audio', async () => {
  const controller = new AbortController();
  let tokenCalls = 0;
  const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId,
    reserve: async () => controller.abort(),
    credential: { async getToken() { tokenCalls++; return { token: 'token' }; } },
  });
  await assert.rejects(transcribe({ audio: wav(), language: 'en-US', signal: controller.signal }));
  assert.equal(tokenCalls, 0);
});

test('reservation cannot change validated audio before transmission', async () => {
  const input = wav();
  const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId,
    reserve: async () => input.write('JUNK', 36),
    credential: { async getToken() { return { token: 'token' }; } },
    fetchImpl: async (_url, options) => {
      assert.equal(options.body.toString('ascii', 36, 40), 'data');
      return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: 'Hello.' }));
    },
  });
  assert.deepEqual(await transcribe({ audio: input, language: 'en-US' }), { transcript: 'Hello.' });
});

test('does not expose malformed, empty or oversized provider responses', async () => {
  for (const body of ['not json', JSON.stringify({ RecognitionStatus: 'NoMatch' }), 'x'.repeat(64001)]) {
    const transcribe = createAzureSpeechTranscriber({ endpoint, resourceId, reserve: async () => {},
      credential: { async getToken() { return { token: 'token' }; } },
      fetchImpl: async () => new Response(body),
    });
    await assert.rejects(transcribe({ audio: wav(), language: 'en-US' }), /transcription failed/);
  }
});
