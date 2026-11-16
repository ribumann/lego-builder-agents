import type { Language } from './i18n';

export type VoiceState = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';
export type VoiceError = 'unsupported' | 'permission' | 'recording' | 'empty' | 'too-large' | 'processing';
export type VoiceProgress = { stage: 'preparing' | 'loading' | 'downloading' | 'transcribing'; loaded?: number; total?: number };
export type VoiceUpdate = { state: VoiceState; error?: VoiceError; progress?: VoiceProgress };

const MAX_DURATION_MS = 30_000;
const MAX_BYTES = 4 * 1024 * 1024;
const SAMPLE_RATE = 16_000;

type Transcription = { promise: Promise<string>; cancel: () => void };
type Dependencies = {
  getStream: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => MediaRecorder;
  decode: (audio: Blob) => Promise<Float32Array>;
  transcribe: (audio: Float32Array, language: Language, onProgress: (progress: VoiceProgress) => void) => Transcription;
};

async function decodeAudio(audio: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    if (!decoded.length || decoded.duration > 31) throw new Error('Invalid audio duration');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    await context.close();
  }
}

function transcribeLocally(audio: Float32Array, language: Language, onProgress: (progress: VoiceProgress) => void): Transcription {
  const worker = new Worker(new URL('./voice-whisper.worker.ts', import.meta.url), { type: 'module' });
  let rejectPending: (error: Error) => void = () => {};
  const promise = new Promise<string>((resolve, reject) => {
    rejectPending = reject;
    worker.onmessage = (event: MessageEvent<{ text?: string; error?: string; progress?: VoiceProgress }>) => {
      if (event.data.progress) { onProgress(event.data.progress); return; }
      worker.terminate();
      if (typeof event.data.text === 'string') resolve(event.data.text);
      else reject(new Error(event.data.error || 'Transcription failed'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Transcription worker failed'));
    };
    worker.postMessage({ audio, language }, [audio.buffer]);
  });
  return { promise, cancel: () => { worker.terminate(); rejectPending(new Error('Cancelled')); } };
}

const browserDependencies: Dependencies = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: stream => new MediaRecorder(stream),
  decode: decodeAudio,
  transcribe: transcribeLocally,
};

export function createVoiceInput(
  onUpdate: (update: VoiceUpdate) => void,
  onTranscript: (text: string) => void,
  dependencies: Dependencies = browserDependencies,
) {
  let state: VoiceState = 'idle';
  let generation = 0;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let transcription: Transcription | undefined;
  let chunks: Blob[] = [];
  let bytes = 0;

  const update = (next: VoiceState, error?: VoiceError, progress?: VoiceProgress) => {
    state = next;
    onUpdate({ state, ...(error ? { error } : {}), ...(progress ? { progress } : {}) });
  };
  const release = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
  };
  const cancel = () => {
    generation++;
    transcription?.cancel();
    transcription = undefined;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = undefined;
    release();
    chunks = [];
    update('idle');
  };
  const fail = (error: VoiceError) => {
    generation++;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = undefined;
    release();
    chunks = [];
    update('error', error);
  };
  const stop = () => {
    if (state !== 'recording' || !recorder) return;
    update('processing', undefined, { stage: 'preparing' });
    if (timer) clearTimeout(timer);
    timer = undefined;
    recorder.stop();
    release();
  };
  const start = async (consent: boolean, language: Language) => {
    if (!consent) throw new Error('Explicit local voice consent is required');
    if (!['en', 'de', 'fr', 'it', 'es', 'pt'].includes(language)) throw new Error('Unsupported voice language');
    if (state !== 'idle' && state !== 'error') throw new Error('Voice input is already active');
    if (dependencies === browserDependencies &&
      (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder ||
       !globalThis.AudioContext || !globalThis.OfflineAudioContext || !globalThis.Worker)) {
      update('error', 'unsupported');
      return;
    }
    const current = ++generation;
    chunks = [];
    bytes = 0;
    update('requesting');
    try {
      const acquired = await dependencies.getStream();
      if (current !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      recorder = dependencies.createRecorder(acquired);
      recorder.ondataavailable = event => {
        if (current !== generation || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_BYTES) { fail('too-large'); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (current === generation) fail('recording'); };
      recorder.onstop = async () => {
        if (current !== generation) return;
        if (state === 'recording') update('processing', undefined, { stage: 'preparing' });
        recorder = undefined;
        release();
        const audio = new Blob(chunks);
        chunks = [];
        if (!audio.size) { fail('empty'); return; }
        try {
          const samples = await dependencies.decode(audio);
          if (current !== generation) return;
          if (!samples.length || samples.length > SAMPLE_RATE * 31) { fail('processing'); return; }
          if (samples.every(sample => sample === 0)) { fail('empty'); return; }
          update('processing', undefined, { stage: 'loading' });
          transcription = dependencies.transcribe(samples, language, progress => {
            if (current === generation && state === 'processing') update('processing', undefined, progress);
          });
          const text = (await transcription.promise).trim();
          if (current !== generation) return;
          transcription = undefined;
          if (!text) { fail('empty'); return; }
          update('idle');
          onTranscript(text);
        } catch {
          if (current === generation) fail('processing');
        }
      };
      recorder.start(250);
      update('recording');
      timer = setTimeout(stop, MAX_DURATION_MS);
    } catch (error) {
      if (current !== generation) return;
      fail(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'permission' : 'recording');
    }
  };
  return { start, stop, cancel, getState: () => state };
}
