import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput, type VoiceProgress, type VoiceUpdate } from '../src/voice-input';

function fixture(samples = new Float32Array([0.1])) {
  let stopped = 0;
  const updates: VoiceUpdate[] = [];
  const transcripts: string[] = [];
  const track = { stop: () => { stopped++; } };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  let recorder: FakeRecorder;
  let finish: (value: string) => void = () => {};
  let progress: (value: VoiceProgress) => void = () => {};
  let cancelled = false;
  let languageUsed = '';
  class FakeRecorder {
    state: RecordingState = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); });
    }
    data(data: Blob) { this.ondataavailable?.({ data }); }
  }
  const input = createVoiceInput(update => updates.push(update), text => transcripts.push(text), {
    getStream: async () => stream,
    createRecorder: () => { recorder = new FakeRecorder(); return recorder as unknown as MediaRecorder; },
    decode: async () => samples,
    transcribe: (_audio, language, onProgress) => {
      languageUsed = language;
      progress = onProgress;
      return {
        promise: new Promise<string>(resolve => { finish = resolve; }),
        cancel: () => { cancelled = true; },
      };
    },
  });
  return { input, updates, transcripts, recorder: () => recorder, finish: (text: string) => finish(text), progress: (value: VoiceProgress) => progress(value), stopped: () => stopped, cancelled: () => cancelled, language: () => languageUsed };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('requires explicit consent and returns editable text only after recording stops', async () => {
  const f = fixture();
  await assert.rejects(f.input.start(false, 'en'), /consent/);
  await f.input.start(true, 'de');
  assert.equal(f.input.getState(), 'recording');
  f.input.stop();
  assert.equal(f.stopped(), 1);
  await tick();
  assert.equal(f.language(), 'de');
  f.finish('  A blue dinosaur  ');
  await tick();
  assert.deepEqual(f.transcripts, ['A blue dinosaur']);
  assert.deepEqual(f.updates.map(update => update.state), ['requesting', 'recording', 'processing', 'processing', 'idle']);
});

test('reports preparation, model download and inference without completing early or updating after cancel', async () => {
  const f = fixture();
  await f.input.start(true, 'en');
  f.input.stop();
  assert.deepEqual(f.updates.at(-1), { state: 'processing', progress: { stage: 'preparing' } });
  await tick();
  assert.deepEqual(f.updates.at(-1), { state: 'processing', progress: { stage: 'loading' } });
  f.progress({ stage: 'downloading', loaded: 25, total: 100 });
  assert.deepEqual(f.updates.at(-1), { state: 'processing', progress: { stage: 'downloading', loaded: 25, total: 100 } });
  assert.deepEqual(f.transcripts, []);
  f.progress({ stage: 'transcribing' });
  assert.deepEqual(f.updates.at(-1), { state: 'processing', progress: { stage: 'transcribing' } });
  f.input.cancel();
  const count = f.updates.length;
  f.progress({ stage: 'downloading', loaded: 100, total: 100 });
  f.finish('late text');
  await tick();
  assert.equal(f.updates.length, count);
  assert.deepEqual(f.updates.at(-1), { state: 'idle' });
  assert.deepEqual(f.transcripts, []);
});

test('cancellation stops the microphone and discards late results', async () => {
  const f = fixture();
  await f.input.start(true, 'de');
  f.input.stop();
  await tick();
  f.input.cancel();
  assert.equal(f.cancelled(), true);
  f.finish('discard me');
  await tick();
  assert.equal(f.input.getState(), 'idle');
  assert.deepEqual(f.transcripts, []);
});

test('oversized audio stops recording without transcription', async () => {
  const f = fixture();
  await f.input.start(true, 'fr');
  f.recorder().data(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]));
  await tick();
  assert.deepEqual(f.updates.at(-1), { state: 'error', error: 'too-large' });
  assert.equal(f.stopped(), 1);
  assert.deepEqual(f.transcripts, []);
});

test('cancel while permission is pending releases a late microphone stream', async () => {
  let provide: (stream: MediaStream) => void = () => {};
  let stopped = false;
  const input = createVoiceInput(() => {}, () => assert.fail('Unexpected transcript'), {
    getStream: () => new Promise(resolve => { provide = resolve; }),
    createRecorder: () => { throw new Error('Must not record'); },
    decode: async () => new Float32Array(),
    transcribe: () => { throw new Error('Must not transcribe'); },
  });
  const starting = input.start(true, 'en');
  input.cancel();
  provide({ getTracks: () => [{ stop: () => { stopped = true; } }] } as unknown as MediaStream);
  await starting;
  assert.equal(stopped, true);
  assert.equal(input.getState(), 'idle');
});

test('permission denial is reported without recording or transcription', async () => {
  const updates: VoiceUpdate[] = [];
  const input = createVoiceInput(update => updates.push(update), () => assert.fail('Unexpected transcript'), {
    getStream: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    createRecorder: () => { throw new Error('Must not record'); },
    decode: async () => { throw new Error('Must not decode'); },
    transcribe: () => { throw new Error('Must not transcribe'); },
  });
  await input.start(true, 'pt');
  assert.deepEqual(updates.at(-1), { state: 'error', error: 'permission' });
});

test('exact digital silence is empty audio without starting inference', async () => {
  const f = fixture(new Float32Array([0, -0, 0]));
  await f.input.start(true, 'de');
  f.input.stop();
  await tick();
  assert.deepEqual(f.updates.at(-1), { state: 'error', error: 'empty' });
  assert.equal(f.language(), '');
  assert.deepEqual(f.transcripts, []);
});

test('a very quiet nonzero signal is not discarded as silence', async () => {
  const f = fixture(new Float32Array([0, 1e-12, 0]));
  await f.input.start(true, 'de');
  f.input.stop();
  await tick();
  assert.equal(f.language(), 'de');
  f.finish('Quiet speech');
  await tick();
  assert.deepEqual(f.transcripts, ['Quiet speech']);
});
