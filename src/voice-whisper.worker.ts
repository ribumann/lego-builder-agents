/// <reference types="vite/client" />
import { env, pipeline } from '@huggingface/transformers';
import type { VoiceProgress } from './voice-input';
import wasmUrl from '../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import mjsUrl from '../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url';

env.allowLocalModels = false;
if (!env.backends.onnx.wasm) throw new Error('WebAssembly backend unavailable');
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };

self.onmessage = async (event: MessageEvent<{ audio: Float32Array; language: string }>) => {
  const report = (progress: VoiceProgress) => self.postMessage({ progress });
  let stage: 'model' | 'inference' = 'model';
  try {
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
      dtype: 'q8',
      device: 'wasm',
      progress_callback: progress => {
        if (progress.status === 'download') report({ stage: 'downloading' });
        else if (progress.status === 'progress') report({
          stage: 'downloading', loaded: progress.loaded, total: progress.total,
        });
        else if (progress.status === 'initiate' || progress.status === 'done' || progress.status === 'ready')
          report({ stage: 'loading' });
      },
    });
    stage = 'inference';
    report({ stage: 'transcribing' });
    const result = await transcriber(event.data.audio, { task: 'transcribe', language: event.data.language });
    if (Array.isArray(result)) throw new Error('Unexpected transcription result');
    self.postMessage({ text: result.text });
  } catch {
    self.postMessage({ error: 'Local transcription failed', stage });
  }
};
