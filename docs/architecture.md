# BrickLab architecture and MVP boundaries

This describes the release target and the evidence available for this candidate.
It is not a claim that every deployment path has passed end-to-end acceptance.
The [README](../README.md) is the practical setup and capability guide;
[software design](software-design.md) describes the core behavior.

## System shape

```mermaid
flowchart LR
  subgraph Device["User device and browser"]
    UI["Workshop UI"]
    Engine["Deterministic team engine"]
    Scene["Three.js scene"]
    Save["Browser localStorage / JSON download"]
    Voice["Opt-in local voice transcription"]
    UI --> Engine --> Scene
    Engine --> Save
    Voice --> UI
  end

  subgraph Host["BrickLab Node server"]
    Static["Static app and status"]
    API["Validated planning API"]
    Slots["Provider capacity and request lifecycle"]
    API --> Slots
  end

  CLI["GitHub Copilot CLI"]
  Local["Backlog: local model service"]
  Compat["Backlog: compatible API"]
  Azure["Azure OpenAI + managed identity"]

  UI -->|"Explicit plan request"| API
  API -->|"Private/local opt-in"| CLI
  API -->|"Private/local opt-in"| Local
  API -->|"Private/local opt-in"| Compat
  API -->|"Azure opt-in and reservation"| Azure
  Slots -->|"Validated custom spec"| UI
  Static --> UI
```

The browser owns the interactive simulation, rendering, replay, and local saves.
The Node server serves the application and, only when configured, brokers an
explicit planning request to a provider. The provider proposes a custom geometry
specification; BrickLab validates it before constructing a deterministic local
plan. The five visible roles are application logic, not five model calls.

## Deployment and release evidence

| Target | MVP boundary | Current evidence and limitation |
| --- | --- | --- |
| Local server | Run the application on loopback; offline templates work without a provider. Copilot planning is an explicit, separately configured action. | One prior Windows ARM64 candidate completed a real text request and a consented synthetic-image request. The current integrated source and reliable process cleanup are not yet confirmed; these samples are not a reliability claim. |
| Private Codespaces | Keep the forwarded port private; configure the production server, Copilot CLI login, and BrickLab's separate temporary app password as described in the README. | Setup guidance and automated fixtures exist, but real Codespaces setup and manual UAT have not been reported. Do not make the port public to troubleshoot. |
| Azure-hosted app | Public service is limited to anonymous static/offline use until hosted planning controls are verified. Azure planning must remain blocked by its startup guard. | The HTTPS custom-domain/Front Door endpoint returned 200. The live revision was not freshly established; the last recorded deployment was offline-only. Real tenant identity, storage contention, public inference, and long-stream behavior remain unverified. |

Planning-capacity work is being integrated to reject overload instead of
queuing or silently retrying provider requests. Its final integrated revision
and limits still require owner confirmation. No 2x speed or throughput increase
has been measured. A 300-second timeout is a release invariant: it must abort
backend work and keep capacity held until provider/process cleanup settles.
Fixture-based timeout tests do not establish end-to-end cleanup or a 300-second
connection through Azure Front Door.

The target quota scope is daily application quotas for hosted Azure only;
local and Codespaces use should not have an application daily-call cap. The
scope change and environment-configurable hosted limits are still being
integrated, so do not claim that local/Codespaces are cap-free or quote final
hosted limits until that revision is merged and verified. Any Azure reservation
is an application estimate, not actual billing.

## Trust and data boundaries

- On a local run, the server listens on loopback by default. Exact Host/Origin,
  a per-process request token, bounded input, and provider opt-ins protect its
  planning routes; this is not a hardened public multi-user service.
- Codespaces adds exact forwarded-host/origin checks, a separate app login, and
  a fresh GitHub CLI check that the port is private. GitHub/Copilot sign-in and
  BrickLab's app password are distinct credentials. Never publish the port or
  paste GitHub credentials or tokens into BrickLab or chat. For the private
  app's HTTPS Basic Authentication prompt only, enter username `bricklab` and
  the temporary app password printed in the Codespace terminal; never use a
  GitHub password or token there.
- Public hosted mode serves static/offline content only. Host and Origin checks
  are not authentication; forwarded client headers do not establish a trusted
  identity. The app must not enable public paid planning until the edge, caller
  identity, quota, cancellation, and transport controls are verified.
- A submitted brief is sent only after the user explicitly starts planning.
  Depending on the selected provider, it goes to GitHub, a configured local or
  compatible service, or Azure. Azure image planning is unsupported. Image
  planning requires explicit consent; original image metadata is not stripped.
- Voice transcription runs in the browser after explicit microphone consent.
  First use downloads the model from its publisher; audio and transcript are
  not sent by the voice module. A later plan submission follows the selected
  planner's separate disclosure.
- Browser saves and playground memory are local to the browser. Downloads are
  files, not a sharing service. The Azure app's reservation ledger is an
  application control and is not an invoice cap.

The MVP controls in this repository apply to BrickLab and its dedicated Azure
resources. Subscription-wide governance and cross-solution spend analysis are
operator responsibilities, not product deliverables or release blockers.

## Scope decisions

- **MVP:** offline templates, the deterministic team and inspector, custom
  planning subject to validation, scene append, replay, local persistence, and
  the documented local/Codespaces/Azure deployment boundaries.
- **Stretch:** improve and validate voice input; automatic onset/silence handling
  is not implemented and real-microphone usability is not accepted. Refactor
  existing code only where required to meet MVP behavior and reliability.
- **Backlog:** OpenAI-compatible custom endpoints and Ollama/local-model
  planning. Code and older setup notes may exist, but these paths are not MVP
  support commitments.
- **Not a physical simulator:** face connectivity and occupied-cell checks do
  not prove clutch strength, collision safety, stability, or buildability.

See [Azure planner notes](azure-planner.md) and
[Azure hosting notes](self-hosting-azure.md) for deployment-specific controls
and their verification status.
