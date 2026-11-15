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
| Azure-hosted app | The current live app is anonymous and serves static/offline use; its public Azure planner is off. The next hosted planner candidate is not live or release-verified. | The custom-domain/Front Door endpoint returned HTTPS 200 and a direct App Service request returned 403 under the existing Front Door-only origin rules. The last recorded package is `release-084cfb4b5ec7bed93c362ce8a50f29ae2ab76142.zip`; the exact live source revision and next package/rollback path are unverified. |

Read-only Azure inventory for the existing deployment: Front Door Standard
with WAF Prevention and a 240-second profile origin-response timeout; Linux
App Service B1 in Italy North; private Blob storage and an approved private
endpoint in Sweden Central; and Azure OpenAI deployments for `gpt-4.1-mini`
and GPT-5.4 in Sweden Central, both attached to `Microsoft.DefaultV2`. The
current app settings report `BRICKLAB_HOSTED=1` and
`BRICKLAB_AZURE_AI=0`; its package uses the system-assigned identity. A private
VM runner is deallocated. These observations describe the existing site, not
the next package.

### Provisional hosted-planning contract

The following is the backend owner's contract proposal, received before its
immutable commit SHA and full final verification. It is not a statement of
current deployed behavior or availability:

- The hosted lab remains anonymous. The backend app uses managed identity for
  Azure services; visitor Entra sign-in and a client-hash key are not part of
  the design.
- Hosted concurrency is proposed at 20 total planning slots and 20 per
  provider, each configurable from 1 to 20 with the provider limit no higher
  than the total. The 20-slot deployment figure requires one worker and one
  Node process; it is not an upstream capacity guarantee. Private mode remains
  8 total and 2 per provider. The final environment variable names for these
  capacity limits are not confirmed here.
- Hosted Azure calls use `BRICKLAB_AZURE_DAILY_CALLS` (default 50, range
  1-100) and a shared private Blob compare-and-swap ledger for global calls and
  an estimated $50 daily spend limit. Each request reserves an estimated $0.55
  and is not refunded. A read-only remaining allowance is shown; unavailable
  ledger state must fail explicitly. Local and Codespaces modes have no
  application daily-call cap. These are app controls and estimates, not
  invoice caps or subscription-level governance.
- Azure access remains off in the current live app. Before enabling the
  candidate, its `properties.raiPolicyName` must match the verified blocking
  content-filter policy; merely finding a custom policy is insufficient.
- The candidate contract specifies a 300-second HTTP abort and waiting for
  cleanup. That cannot prove remote model computation or billing stopped.
  Windows Copilot text/image jobs use Job containment; if cleanup is unknown,
  the shared slot remains held and all planning is quarantined.
- The backend owner reports focused overlap/quota/unavailable-state tests and
  an anonymous adapter socket-close test at 300 seconds passing on the
  provisional candidate. The full final run and immutable SHA are pending.

The backend's 300-second deadline is distinct from Azure Front Door's
documented origin response timeout, which is profile-wide and configurable
from 16 to 240 seconds
([Microsoft Learn](https://learn.microsoft.com/en-us/azure/frontdoor/how-to-configure-origin#origin-response-timeout)).
That setting does not establish a hard limit for an already-streaming response.
Live long-stream reliability remains unverified. No 2x speed or throughput
increase has been measured.

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
- The current public hosted app serves static/offline content only. The
  proposed paid route remains disabled pending the immutable backend candidate
  and live verification. The design is anonymous at the visitor boundary;
  Azure managed identity is the backend's service identity. Host and Origin
  checks alone are not authentication, and forwarded client headers do not
  establish a trusted identity.
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
