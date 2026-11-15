# Voice input

The app offers opt-in browser-local voice input with manual start/stop. Recording is capped at 30 seconds or 4 MiB; automatic speech-onset or silence detection is not implemented. The integrated UI is exercised with mocked microphone and worker behavior. A production-browser test also ran MediaRecorder and the real model with a simulated oscillator as the microphone; a separate synthetic German worker test returned text. Neither establishes speech accuracy or accepted real-microphone usability.

The UI uses `createVoiceInput` and `voiceLabels` with the selected app language. The disclosure precedes explicit microphone permission; opening the page does not request access or download a model. Stop and cancel are separate, and status is announced. Transcripts are untrusted suggestions, kept separate from the brief until explicitly applied. Existing edits are not replaced without an explicit action, and text over 1,000 characters is never silently truncated.

Microphone permission requires a secure context; WebAssembly, workers, MediaRecorder, AudioContext, decoding, memory, browser cache and network access may be unavailable or limited. Performance and model accuracy vary considerably by device and language; users can always type. Cancellation terminates the worker and releases tracks, although a browser permission prompt itself may remain open until dismissed. Model files may persist in browser cache and can be removed with the browser's site-data controls. The model download contacts Hugging Face and its CDN, exposing ordinary network metadata such as IP address; no recordings or transcripts are sent there by this module. The app's other planning choices may separately transmit the edited brief, according to their own disclosures.

The local model is multilingual `Xenova/whisper-tiny`, pinned to Hugging Face revision `5332fcc35e32a33b86612b9a57a89be7906102b1`; its [revision-specific ONNX model card](https://huggingface.co/Xenova/whisper-tiny/blob/5332fcc35e32a33b86612b9a57a89be7906102b1/README.md) explicitly declares Apache-2.0. This declaration applies to the selected derivative, rather than assuming rights from the upstream model. The previous `onnx-community/whisper-tiny` revision lacked an explicit license declaration and is no longer used. `@huggingface/transformers` is pinned in the lockfile. Quantized encoder and merged decoder total 40,852,675 bytes (about 41 MB), plus tokenizer/configuration; the first-use disclosure allows about 45 MB for model files. The bundled WebAssembly runtime is about 22 MB uncompressed; assets must be served from the app build, not a third-party CDN. The model download requires network access on first use and may be evicted from cache; local inference is not guaranteed to be fast or accurate and can produce text even for silence. Model weights are fetched from the publisher, not redistributed in this repository; any future bundled/self-hosted distribution must retain the Apache-2.0 license and applicable notices.

The browser worker requires Transformers; its Node-oriented image dependency `sharp` is not used by the app's voice path. The lockfile overrides that transitive dependency to `0.35.5` to address upstream native-library advisories, outside Transformers 3.8.1's declared `^0.34.1` range. The override does not establish compatibility for server-side image processing, which this app does not use; reassess it when upgrading Transformers.

Exact all-zero decoded audio is rejected before inference as empty audio, without a volume threshold that would reject quiet nonzero speech. This is only a digital zero-signal check: microphone noise and other silent-sounding audio can still reach the model and produce hallucinations. Mandatory review/editing remains necessary.

## Browser-local transcription only

There is no Azure Speech route, paid audio backend or cloud transcription
fallback. No Azure Speech managed-identity role or private endpoint is needed.
Only reviewed text explicitly applied to the brief can be submitted to the
selected planner by a later explicit Plan action; recording and transcription
do not submit a planning request. First-use model downloads are browser-side
from Hugging Face/CDN, not audio uploads.
