# Voice input backlog

BrickLab does not currently offer voice input in local, Codespaces, or Azure
modes. The microphone and transcript controls, local transcription worker, and
audio API are not part of the application. Typed briefs, image input, planning,
and browser saves remain available.

GitHub Copilot CLI has an interactive `/voice` feature that transcribes locally
after downloading its own runtime and models. That is a CLI product feature,
not a supported reusable voice API for BrickLab. See the
[official Copilot CLI voice documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input).
BrickLab does not capture CLI credentials, call undocumented endpoints, or
send recordings to GitHub.

Azure Speech provides a supported fast-transcription API, but BrickLab does not
currently configure or call it. No Azure Speech resource, managed-identity
authorization, shared voice quota, or accepted real-microphone reliability
evidence is established for this application. No audio is sent to Azure or any
other transcription provider.

Voice remains backlogged across all modes until a supported integration can
provide a consistent, reliable experience and passes explicit real-microphone
acceptance. Synthetic tests alone would not satisfy that acceptance.
