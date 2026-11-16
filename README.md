# BrickLab

A LEGO-style game with **cloud-first, open-ended planning** and visible **agentic teamwork for ages 11-15**. Give a brief and watch five deterministic application agents coordinate: BuildBot delegates, PlanBot checks the blueprint, FrameBot and DetailBot build, and CheckBot inspects the result. Custom planning is an explicit opt-in; offline templates need no model.

## MVP scope and release status

This is the release target, not a claim that every provider or deployment has
passed manual acceptance.

| Area | MVP disposition | Current boundary |
| --- | --- | --- |
| Local server | In scope | Offline templates need no provider. Copilot planning requires an explicit submission and separate server-side CLI setup. Earlier local candidates completed bounded text and consented synthetic-image requests; Copilot authentication, inference and manual acceptance on the merged release remain unverified. |
| Private Codespaces | In scope | Keep the forwarded port private and use the production server. Setup guidance and automated fixtures exist, but real Codespaces setup and manual UAT have not been reported. |
| Azure deployment | In scope, constrained | Azure owner confirms merged revision `c0060c7af8bd5a1c748a76b10e7710e35cf051e6` live with GPT-6.1 Terra selected. The owner verified the package/settings and two guarded live baseline UI plans (22.332s, 27.123s); this is not broad reliability, correction/vision validation or user acceptance. |
| Current product | In scope | Deterministic agent simulation, geometry validation, scene append, repair, replay, local saves, downloadable builds, and the playground are application features. The five agents are not five model calls. |
| Parallel planning controls | In scope, merged | The merged release has bounded shared capacity and Azure-only daily submission counting. This enables bounded concurrency; it is not evidence of faster individual plans. |
| Planning latency experiment | Not shipped | Separate prompt/output experiments are not part of this release. A small isolated paired sample showed no end-to-end gain; no 2x improvement is claimed. |
| Voice | Backlog | Not available in local, Codespaces, or Azure modes. Typed briefs remain available; see [voice integration backlog](docs/voice-integration.md) and #15. |
| Refactoring | Stretch | Refactor only where needed for MVP correctness or reliability. |
| Operator-configured LLM | Private workshop | OpenAI-compatible chat-completions provider configured on the server. |

See [architecture and deployment boundaries](docs/architecture.md) and
[software design](docs/software-design.md) for the trust model, data flow, and
release verification gaps. Subscription-wide governance and cross-solution
spend analysis remain operator responsibilities; application call limits are
not billing caps.

The interface offers English, German, French, Italian, Spanish and Portuguese,
with the selection saved on this device. Offline templates recognize the
translated guide examples and a limited English vocabulary; the rule-based crew
offers translated question buttons, while free-form questions recognize English
keywords only. Briefs, model-generated content and external error details remain
in their original language. Names generated for local examples retain the
language selected when the example was created.

Inspired by the user-supplied National Future Day post: three agents build a Minecraft castle from children's ideas. This original implementation translates its lesson into two brick-building worlds, not a reproduction of Minecraft or official LEGO software.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The server binds to loopback by default. New visitors see Copilot cloud planning, but no model request happens on load or mode selection. **Send brief to Copilot** explicitly sends that brief to GitHub and may consume quota. The server still requires the separate model opt-in below; missing setup is shown, never silently replaced by templates.

For no-model use, choose **Change mode -> Use offline templates**, **Run an offline demo**, or a clearly labeled local herd/fleet example. These use no model calls. No Azure account, model download, API key or external service is required for offline templates. Mode selection applies to the next plan in this tab; restored builds are not automatically sent to a provider.

For a production build:

```sh
npm run build
npm start
```

### Shared planning capacity

Each private server process admits **8 planning requests total and 2 per provider**.
Public hosted Azure defaults to **20 total and 20 Azure requests** per process
(Copilot text and images share one provider allowance). Compatible and
Azure requests have separate provider slots: a busy Copilot provider does not
serialize them. Set `BRICKLAB_PLANNING_CONCURRENCY` (integer 1-20) and
`BRICKLAB_PROVIDER_CONCURRENCY` (integer 1-20, no greater than total) to lower or
raise these bounded limits. Invalid configuration prevents startup.

Capacity is shared across clients/tabs, not a browser-local lock or a
cross-instance semaphore. Excess requests receive HTTP 429, without queuing,
retrying or submitting a model call. `/api/status` reports `planningCapacity`
with active total, configured limits, per-provider counts and quarantine state.
Slots cover body reading, provider work and cleanup; aborts/deadlines end the
client response but do not release capacity until transport/process cleanup
is confirmed. Ambiguous Copilot jobs remain charged while globally quarantined.
Daily request quotas apply only to public hosted Azure, independently
of capacity: `BRICKLAB_AZURE_DAILY_CALLS` defaults to **50** (integer 1-100).
This counts explicit user submissions, each with at most one initial model
request and one invalid-design correction: up to 100 Azure model requests/day.
It is a deployment environment setting; invalid public settings fail startup.
The anonymous public page displays a read-only remaining-allowance snapshot;
other visitors may consume it before a request is admitted. No visitor sign-in
or reliable per-client identity is claimed. One App Service worker/process is
required for the deployment-wide 20-request in-flight bound; the daily
Blob CAS allowance is shared across instances. These are upper bounds, not
guarantees of model throughput.
Local servers and Codespaces have no daily request quota, even if those settings
or the obsolete `BRICKLAB_DAILY_CALLS` are supplied. Copilot `calls` is informational
and `limit` is null. Provider subscription quotas and compute costs still apply.
There is no application monetary ledger, price lookup, per-client allowance
or midnight blackout. Valid admitted public calls remain counted on failure or
cancellation; invalid input and capacity rejection do not count. Existing
legacy call counts migrate in the same Blob without resetting usage. The
approved native Azure content filter and network protections remain.
Managed identity authenticates the server; no model credential reaches the browser.
The infrastructure default remains `BRICKLAB_AZURE_AI=0`; code readiness
does not establish live deployment readiness or authorize paid activation.

Unconfirmed Copilot image cleanup permanently quarantines **all planning** in
that process, aborts active requests and prevents late completions from
unlocking it. Unconfirmed Copilot text process-tree termination likewise
quarantines planning with an explicit operator-facing error, even if the
parent process has exited. An operator must verify cleanup before restarting; ordinary
capacity exhaustion needs only an active request to finish. These changes do
not automatically enable any provider, paid hosted planning, or update an already-running
server.

If planning is quarantined, inspect the server's process tree and any private
attachment/cancellation artifacts with the operator before authorizing
recovery. A missing parent process is not proof that descendants exited.
There is no API unlock or automatic quarantine expiry. Restarting also resets
the informational process-local Copilot counter, but cannot reset public Azure's
durable daily call count.

### Operator-configured OpenAI-compatible provider

Set `BRICKLAB_COMPATIBLE_AI=1`, `BRICKLAB_COMPATIBLE_ENDPOINT` to the full
chat-completions URL, and `BRICKLAB_COMPATIBLE_MODEL` to its model identifier.
Set `BRICKLAB_COMPATIBLE_API_KEY` on the server if the service requires a bearer
token; do not put credentials in the browser or a shared deployment. Restart
the server, choose **Change mode -> Use Compatible AI**, then explicitly submit
a brief. This sends the brief to the configured provider and may incur charges.
The browser displays the configured service origin before submission; it does not
display the endpoint path, model identifier or credential. The operator should
explain who operates the service and its data retention policy to participants.
No request is made on load or mode selection. Availability and authentication
are not checked until submission. An invalid design may receive one correction;
transport failures are not retried and no provider or template fallback is used.

The endpoint must use HTTPS, except HTTP is allowed for literal `127.0.0.1`
or `[::1]`. Credentials, queries, and fragments in URLs are rejected. The
service must support chat completions with `max_tokens` and JSON-object
`response_format`, a single assistant choice with a `stop` finish reason and
JSON object content; providers requiring only `max_completion_tokens` or
unsupported parameters are not supported. JSON must satisfy BrickLab's custom
geometry contract. Compatibility and quality of any specific model are not
verified. A request can be cancelled and is bounded to 300 seconds. This
option is prohibited in anonymous hosted mode, requires a loopback-bound server,
and has no built-in spending budget. Host/Origin checks and loopback binding do
not authenticate a reverse proxy: keep any forwarded port private and use only
a trusted private server and provider. Abort cannot guarantee remote processing
or billing has stopped.

## Facilitate a BrickLab lab

Allow 30–45 minutes for pairs. Start with offline templates, so the first activity
needs no model account or model calls. Ask learners not to include names or other
personal information in briefs. Copilot planning sends the submitted brief to
GitHub; an operator-configured compatible provider sends it to the displayed service origin.

1. **Imagine and plan:** choose a world and offline templates. Try “a purple
   brachiosaurus with a tall neck.” Open **Task board** and predict which jobs
   must wait for another.
2. **Observe:** step the build, then run it. Follow the actual handoffs and
   compare the coordinator, plan verifier, two builders and inspector. These
   are five deterministic local agents, not five model requests.
3. **Grow:** choose **Add to scene**, describe another object and plan it.
   The existing build stays in place; the addition is positioned separately.
   Compare this with **Replace scene**, which starts a new build.
4. **Investigate:** when complete, hide roughly one-third of the bricks. Record
   what the inspector finds, ask for repair and watch the owners replace the
   missing parts. A disconnected blueprint is not fixed by replacing bricks.
5. **Reflect and share:** replay the build, download its JSON, reload it and
   explain one dependency and one handoff. Saves are local to the browser;
   the download is a file, not a public sharing service.

For a separate exercise, open **The agent playground** below the extended
insights. Step through its six deterministic roles, replay an actual repair,
try missing stock or a circular dependency, and optionally remember the repair
for the next robot. Its browser-local lesson is separate from workshop saves;
it makes no model requests. See [playground instructions](docs/agent-playground.md).

More missions: a green stegosaurus with a long tail, a white cargo ship with
engines, or the local herd/fleet examples. With an explicitly configured AI
planner, try an original lighthouse, a dinosaur habitat, or a space station
with a visiting ship. AI geometry is bounded and may fail validation or fail
to resemble the brief; it is static, not a physical building instruction.

Adding sends only the new brief and selected world to the chosen planner, not
the existing scene. BrickLab positions the result locally and displays its grid
offset. If no collision-free position fits, or the combined design exceeds the
object, record, brick, cell or coordinate limits, the existing scene is unchanged.
Scene saves retain contribution sources and offsets; they do not prove that an
imported model attribution is genuine.

The separate **Azure Foundry** adapter uses backend managed identity, not a
personal Copilot credential. The Azure owner confirms merged revision
`c0060c7af8bd5a1c748a76b10e7710e35cf051e6` is live with
`bricklab-planner-terra` (`gpt-6.1-terra`) selected. The owner verified the
package and settings; public HTTPS returned 200 with release asset
`index-B5T0Pdlt.js` on 2026-11-16. Two sequential guarded baseline UI plans
also ran against that release: a visually recognizable 99-brick spaceship
(22.332 seconds) and a hollow observatory with a separate rover, 97 bricks
(27.123 seconds); each passed 3/3 local checks. The browser request windows
and adapter-attempt details are in the [architecture evidence](docs/architecture.md#deployment-and-release-evidence).
They were text-only, one-attempt calls, not a matched performance experiment;
the first view did not independently verify every requested spaceship feature.
An earlier synthetic 100-brick airplane planned in 29.619 seconds, then built
100/100 bricks with 4/4 tasks and 3/3 inspection checks. These are bounded
examples, not broad reliability or user acceptance, and do not test correction,
vision, cancellation, or deployed timeout/cleanup behavior. The merged
revision also does not include the separate planning-latency experiment or
demonstrate faster plans. Azure usage can incur charges. See
[Azure planner setup](docs/azure-planner.md).

## Run in a private GitHub Codespace

[Create a Codespace for BrickLab](https://codespaces.new/ribumann/lego-builder-agents).
GitHub will show the creation options and applicable usage limits or charges before you create it.
The Codespace installs dependencies during creation. Once that finishes, run in its terminal:

```sh
npm run build
npm start
```

In the **Ports** tab, open port **4173 (BrickLab)** in a browser. Forwarded ports are private by default; keep this port private. Use the production server above rather than `npm run dev`, which can reject the forwarded hostname. Stop the Codespace when finished to avoid unnecessary usage.

The rule-based builder runs in the browser after explicitly choosing offline templates. The default cloud choice shows setup instructions until configured. By default the planning API is localhost-only, so this URL can report that server status is unavailable. For real Copilot planning through the private browser URL, use the explicit setup below. A Codespace is not itself a Copilot subscription or a Copilot CLI login.

### Opt in to Copilot planning in the Codespace

Run these commands **inside your own Codespace terminal**, not on the computer displaying the browser:

```sh
npm install -g @github/copilot
copilot login
"${BRICKLAB_GH_BIN:-gh}" --version
"${BRICKLAB_GH_BIN:-gh}" auth status
"${BRICKLAB_GH_BIN:-gh}" codespace ports --codespace "$CODESPACE_NAME" --json sourcePort,visibility,browseUrl
npm run build
BRICKLAB_CODESPACES=1 BRICKLAB_COPILOT=1 npm start
```

Follow Copilot's browser/device sign-in flow using your own Copilot-enabled account. Do not send tokens, device codes, or credentials to anyone. GitHub CLI (`gh`) must also be installed and able to inspect this Codespace's ports. The devcontainer configuration requests the latest GitHub CLI and sets `BRICKLAB_GH_BIN=/usr/bin/gh` so BrickLab and its diagnostic use the feature-installed executable even if another `gh` precedes it on `PATH`. This takes effect only after creating or rebuilding the container; preserve any uncommitted work before rebuilding. For an existing container, update the CLI separately and set `BRICKLAB_GH_BIN` to its absolute executable path in both terminals, or leave it unset to use `gh` from `PATH`. Check the actual binary and version with the commands above; the version selected on a future rebuild may differ from 2.104.0. The automatically supplied Codespace token may suffice for `gh`; that does not prove Copilot entitlement. If either CLI is unavailable or authentication fails, resolve that in the Codespace terminal before continuing; [Copilot authentication troubleshooting](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/troubleshoot-copilot-cli-auth) describes account and token precedence. Explicitly exported `GH_TOKEN`, `GITHUB_TOKEN` or `COPILOT_GITHUB_TOKEN` can override a Copilot login.

Keep port **4173** forwarded with **Private** visibility in the Ports tab (not Public or Private to Organization). Open its exact `https://CODESPACENAME-4173.app.github.dev` URL while signed in to GitHub. A second browser sign-in prompt belongs to BrickLab: use username **bricklab** and the **temporary app password printed in the server terminal**. Never use your GitHub password there. Do not share that generated app password or server logs. Restarting rotates it; a cached browser password may need to be replaced. Then choose **Change mode -> Use Copilot planning** in the app.

This mode supports only the production server, loopback listener, and standard `app.github.dev` HTTPS host for the current `CODESPACE_NAME` and `PORT`. It accepts either that exact Host or a loopback Host with exactly the expected `X-Forwarded-Host` and `X-Forwarded-Proto: https` for the observed proxy request shape. [Dev Tunnels can also rewrite Origin](https://github.com/microsoft/dev-tunnels/blob/main/go/tunnels/tunnel_options.go): only with that full proxy shape, the exact `http://localhost:PORT`, `https://localhost:PORT` and corresponding `127.0.0.1` origins are accepted alongside the public origin. Arbitrary origins, `null`, wrong ports and multi-value headers remain rejected. Those client-supplied headers are forgeable: they do not prove proxy identity, HTTPS, GitHub authentication, or port privacy. Neither form bypasses the independent random app password, bounded Origin and planning request-token checks, or the private-port check; no CORS is enabled. Each authenticated request checks the actual port's visibility and exact URL through `gh codespace ports` (15-second timeout; no visibility cache). Missing, public, organization-visible, unrecognized or unverifiable ports fail closed with an explanatory error. The app password prevents an unauthenticated caller from obtaining the planner token or spending calls even if visibility changes immediately after a check. Keep the password secret and use only the exact HTTPS URL; local processes that can read or use it are not isolated by the forwarding headers. Both opt-in variables are separate: `BRICKLAB_CODESPACES=1` alone does not enable model calls.

For a private-port verification failure, check the selected CLI's version and run `GH_PROMPT_DISABLED=1 timeout 20s "${BRICKLAB_GH_BIN:-gh}" auth status` and `GH_PROMPT_DISABLED=1 timeout 20s "${BRICKLAB_GH_BIN:-gh}" codespace ports --codespace "$CODESPACE_NAME" --json sourcePort,visibility,browseUrl` in the Codespace terminal. In one reported Codespace, gh 2.23.0 timed out after 45 seconds while a checksum-verified gh 2.104.0 enumerated the private port using the same authentication. The [older CLI](https://github.com/cli/cli/blob/v2.23.0/pkg/cmd/codespace/ports.go) uses Live Share and constructs `preview.app.github.dev` URLs; the newer CLI uses Dev Tunnels and the standard URL. The exact stall was not traced, and other timeouts can have other causes: check authentication, access/scope and connectivity without sharing credentials. The Codespaces metadata API's `allowed_port_privacy_settings` describes allowed settings, not this port's actual visibility; it is not an equivalent substitute. No independent reliable visibility lookup has been established, so a timeout continues to deny access.

For a shareable diagnostic, leave the app running and execute **`node scripts/diagnose-codespaces.mjs` in a second Codespace terminal** (set the same `PORT` there if customized). It prints only fixed classifications and HTTP status codes. Each CLI step is limited to 15 seconds and each HTTP probe to 2 seconds. It never prompts for sign-in, changes visibility, sends app credentials or makes a planning request. GitHub API authentication, access to this Codespace's metadata, and port enumeration are tested separately: metadata success followed by a ports timeout isolates the failing command, not the exact stalled operation or its network root cause. The [GitHub CLI implementation](https://github.com/cli/cli/blob/v2.83.1/pkg/cmd/codespace/ports.go) opens a Codespace connection and tunnel to enumerate ports and also waits for a concurrent devcontainer repository lookup; the command is not just a REST visibility lookup. An API scope denial is a different result from that timeout. `private-app-guard-observed` means only that local unauthenticated probes saw the expected 401/403 boundary; it is **not live browser/proxy verification**. `unexpected-guard-check-startup-mode` means check the running server's production/Codespaces settings before investigating forwarding; bare `npm start` without `BRICKLAB_CODESPACES=1` deliberately leaves the API local-only.

To investigate a browser 403 without changing the trust policy, restart with `BRICKLAB_CODESPACES_DIAGNOSTICS=1` in addition to the normal settings. The first 20 requests log only whether Host, Origin and forwarded host/protocol match the expected values, are absent, or differ (Host and Origin may also be classified as loopback); the `Forwarded` header is recorded only as present or absent. Each entry identifies navigation/API/asset and the host/origin rejection, app-auth requirement, or next private-port check, not successful authorization. No header values, URLs, credentials or cookies are logged by this diagnostic. Disable it after collecting the classifications. Share only the diagnostic JSON/lines, not the server startup log containing its temporary password. These classifications are not proof that forwarded headers are trustworthy or that a request is authenticated. The preflight includes `proxyRewrittenOrigin` (expected 401 without app credentials) and `proxyNullOrigin` (expected 403), so a server with only the earlier Host fix no longer reports all local guards passing.

Do not make the port public to troubleshoot. If the private URL or visibility verification cannot work in your environment, use the browser's rule-based builder with the default startup above, or forward the remote server to **localhost** using VS Code desktop or `gh codespace ports forward 4173:4173 --codespace NAME` on your own computer, keep the remote port private, and run `BRICKLAB_COPILOT=1 npm start` in the Codespace **without** `BRICKLAB_CODESPACES`. Open `http://127.0.0.1:4173` locally. The separate GitHub Models Actions workflow below is another cloud option; it is not Copilot.

**Verification limitation:** automated tests use explicit CLI fixtures for private-port checks and model responses. A real Codespace, its GitHub/browser authentication and forwarding behavior have not been exercised. A reported bounded local Windows ARM64 API request at `0c0bc63` returned `source=copilot`, `model=custom` and one named lighthouse object through the real Copilot CLI. This verifies that local planning path and the named-object contract, not its geometry size/quality, Codespaces forwarding or large multi-object model generation. No infrastructure is provisioned or provider success assumed beyond the reported request. CLI/organization policies, network access, your subscription, Codespaces charges and Copilot quotas still apply; stop the app and Codespace when finished.

## The game

- **Jurassic valley:** stegosaurus or brachiosaurus, in a studded landscape with palms.
- **Space dock:** explorer or cargo spacecraft, with stars, a ringed planet, engines and landing gear.
- **Player-directed builds:** choose a body color, species/ship type, long tail or wide wings, and optional brick budget.
- **Multi-object examples:** choose **Load local Jurassic herd** (three named objects, 400 bricks, 494 occupied cells) or **Load local space fleet** (three named objects, 359 bricks, 536 occupied cells), then start the crew. These are original deterministic examples, not live model results.
- **A visible team of five:** BuildBot decomposes the goal; PlanBot checks dependencies and connectivity; FrameBot and DetailBot independently choose ready construction tasks; CheckBot inspects the result and identifies missing bricks for repair. Larger custom objects divide each builder's work into ordered, dependency-linked stages; small objects remain small jobs.
- **Real-time controls:** start, pause, single-step, and cycle **1x / 4x / 16x fast-forward**. Guided demo uses 4x.
- **Explainable actions:** task ownership, dependency waits, turn numbers, observations and completion messages. Messages describe application decisions, not hidden model chain-of-thought.
- **Special experiments:** blueprint overlay, exploded view, cutaway view, tap-to-inspect bricks, timeline replay, and a missing-brick challenge that agents detect and repair.
- **Hollow interiors:** select **Try a hollow interior** before a Copilot custom-planning request. Try “A small blue room with an open doorway and an orange chair.” The preference asks for a real empty cavity, not a solid block; it does not guarantee model compliance. **Cutaway view** clips the right half of the scene to reveal its cross-section without changing bricks, inspection, saves or repair. It works on existing scenes too, but cannot create a cavity in a solid design. Offline templates ignore this preference and disable its checkbox. FrameBot and DetailBot retain their actual assigned structure/support/detail tasks; labels do not imply that every scene has interior work. Connectivity is not physical stability.
- **Learning loop:** ask the crew about roles, plans, cost or repair, then answer a short reflection question.
- **Local saves:** independent saved builds per world, automatic resume after refresh, downloadable versioned JSON.
- **Accessible alternatives:** keyboard controls, reduced motion and a text task board/inspection when WebGL is unavailable.

Examples:

```text
Build a green stegosaurus with orange plates and a long tail.
Build a purple brachiosaurus with a tall neck.
Build a blue explorer spaceship with wide wings and two engines.
Build a white cargo spaceship. Budget 300 bricks.
```

The **local rule-based templates** support body colors green, orange, blue, purple, red, white, black, yellow, gray, brown and pink. Their plates, eyes, cockpit, engine and accent colors are fixed. Unsupported local requests do not create arbitrary geometry; the plan explains this limitation. T. rex and triceratops are excluded from the local Jurassic mission because they lived in the Cretaceous. Copilot's custom-design path below is not restricted to these four figures.

## What is actually agentic?

**Offline template mode is explicitly a rule-based agent simulation, not generative AI.** All five agents have observable roles: BuildBot compiles the interpreted brief into tasks with prerequisites; PlanBot checks dependency and blueprint connectivity before construction; FrameBot and DetailBot observe the shared world, select eligible tasks, place bounded numbers of bricks and report completion; CheckBot inspects the finished grid and identifies missing bricks for repair. The repair loop reopens the owning construction specialist's task. These are deterministic application decisions, not five hidden model conversations.

This teaches goal decomposition, delegation, shared memory, dependencies, parallel work, observation, tool actions, verification and repair. It deliberately separates those concepts from a claim that every agent must be a language model.

### Extended agent insights

Open **Extended agent insights** beneath the experiments for an optional,
read-only view. The ordinary building flow works with it closed. Make an offline
plan, predict which builder has a dependency-ready task, then take one step and
compare the actual retained action. After completion, hide bricks and compare
the identity count before and after repair.

The panel separates shared program memory (plan, placed identities and task
board), task context (assignments and prerequisites), available bounded
functions (`step`, `inspect`, `damage`, `repair`) and the retained action log.
It shows the same data the local engine uses; it neither runs another model nor
reveals hidden model reasoning. Its source identifier is saved attribution,
not independently verified provenance. The log retains at most 120 actions,
not an unlimited conversation, and counts are bricks/tasks rather than tokens.
Opening or closing the panel does not alter saves or send data. All six
interface languages are supported; user briefs and custom object names remain
unchanged.

**Cloud planning is hybrid:** a real Copilot model must propose custom geometry for the child's brief, including familiar subjects; selecting a pre-built template is rejected. The same two local construction specialists execute it, with PlanBot and CheckBot performing local checks. The configured compatible provider uses this same custom-only contract and five-agent execution. Subjects are not limited to dinosaurs and spacecraft, but the result is still a bounded stylized brick design, not unrestricted text-to-3D or a guarantee of artistic fidelity or semantic originality. It is not five independent LLM calls. Crew Q&A remains a clearly labeled local teaching guide in every mode.

**Optional GitHub Models workflow uses three model calls:** BuildBot interprets the brief and delegates; FrameBot and DetailBot are then called concurrently to choose their actual task priority orders and explain their coordination. Every proposed order is schema-validated against the specialist's owned tasks. The local runtime enforces prerequisites regardless of priority, runs the whole mission and checks the result before producing an artifact. Loading this artifact starts an observable real-time execution, not a video.

## Three model decisions through GitHub Actions

Enable GitHub Models for your account/repository if required, then run **Three AI agents build a mission** in the Actions tab. Its `models: read` permission uses the built-in `GITHUB_TOKEN` without an additional model key.

Or use your authenticated GitHub CLI:

```sh
gh workflow run ai-mission.yml --repo ribumann/lego-builder-agents \
  -f world=jurassic \
  -f brief="Build a purple brachiosaurus with a tall neck."
gh run list --repo ribumann/lego-builder-agents --workflow ai-mission.yml
gh run download RUN_ID --repo ribumann/lego-builder-agents --name ai-mission --dir ./ai-mission
```

In the game choose **Load build / AI mission**, select `ai-mission/ai-mission.json`, review the three agents' decisions in Team talk, and press **Start building**. Fast-forward, inspection and repair still work. You can also load an ordinary exported save file.

The workflow makes exactly three bounded JSON requests to GitHub Models (`openai/gpt-4.1-mini` by default, up to 1,000 output tokens per request, no retries). PlanBot and CheckBot remain rule-based in the five-agent crew; they add no model calls. GitHub Models model availability, account access, quotas and Actions minutes apply. There is no claimed dollar cost. Set `BRICKLAB_MODEL` for the script only to a supported GitHub Models model with the same JSON chat API.

**Verification limitation:** the three-model workflow has not been verified against its real service. A bounded local Copilot API planning request has passed, but that does not verify the separate Actions workflow or large-scene model output. Model responses, schema failures, task priority effects and full execution are tested with explicit fixtures; no mock result is shipped as a live model result. Imported mission attribution is not cryptographic proof of a model run. Run the workflow to verify account-specific access.

## Optional real GitHub Copilot planner

Install the **standalone** [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) and authenticate in the same environment as the server. Signing into VS Code, its Copilot extension, or the Copilot desktop app does not by itself install or authenticate this CLI:

```sh
npm install -g @github/copilot
copilot login
BRICKLAB_COPILOT=1 npm run dev
```

PowerShell:

```powershell
$env:BRICKLAB_COPILOT="1"
$env:BRICKLAB_COPILOT_BIN='C:\path\to\standalone\copilot.exe'
npm run dev
```

Copilot planning is the default choice, or select **Change mode -> Use Copilot planning**. Review the disclosure, then press **Send brief to Copilot** to consent to sending that brief to your authenticated model service. Merely loading the app or choosing a mode sends no brief. Guided demos and explicit local examples never implicitly invoke a model.

Server status detects a missing or unusable CLI with a non-model `copilot --version` check; it sends no brief and verifies no account entitlement. Authentication errors from an attempted plan provide login instructions without displaying raw CLI output or automatically retrying. An installed CLI is not proof of a working login or subscription.

For an explicitly available Copilot CLI model, an operator may optionally set `BRICKLAB_COPILOT_MODEL` in the server process environment before startup. The server passes it as a separate `--model` argument for every Copilot attempt, including any correction; it does not change account or global CLI settings. Omit the variable to retain the CLI's existing default. The identifier must begin with a letter or digit and use at most 128 letters, digits, `.`, `_`, `:`, `/` or `-`. Invalid configuration prevents startup when Copilot is enabled. This option does not verify availability or the provider's actual model; CLI errors use the normal planner error path.

On Windows, a VS Code `copilot.exe` shim may win command resolution while the standalone CLI is missing. Check `Get-Command copilot -All` and `copilot --version`; the app also recognizes a shim reporting that the CLI is not installed. **Set `BRICKLAB_COPILOT_BIN` to the absolute path of the actual standalone native `.exe`** and install the Microsoft Store PowerShell 7 package. Both text and image planning require verified Windows Job Object containment: the child is created suspended, assigned before resume, cannot break away, and cleanup waits for zero active processes. Paths with spaces are supported without a shell; no `.cmd`/`.bat`, shim or raw-spawn fallback is enabled. Missing containment fails closed without sending a brief. The private Linux Codespace setup uses its own CLI/login and detached POSIX process groups, not the Windows executable. Native synthetic Windows text/image jobs verify detached descendant cleanup, timeout, cancellation and host-loss failure; POSIX subprocess fixtures are explicitly skipped on Windows. Historical real local planning observations do not establish live provider verification for a new release.

The server invokes `copilot -p` without shell interpolation, with an empty available-tool list, built-in MCPs disabled, and repository custom instructions disabled. No model tools are exposed. Both server and browser require validated custom brick arrangements. A completed parsed invalid design gets at most one same-provider correction, using the rejected JSON and validation feedback transiently; both attempts share one deadline, cancellation signal and held capacity slot. Transport/authentication/rate-limit/timeout failures are never replayed. A second invalid design fails visibly without substitution or pretending offline planning was AI. Legacy saves and imported Actions missions may still contain templates; they are not new cloud planning results.

The bridge uses the CLI's scripting mode, `--output-format=json`, not terminal-rendered `--silent` text. It reads the final completed `assistant.message` content only, requires a successful terminal `result`, and rejects malformed, failed or incomplete streams. Metadata, user echoes and partial message deltas are not treated as designs or logged. The final assistant content must still be valid JSON and pass the geometry schema; the app never joins wrapped strings, strips arbitrary control characters or locally fabricates valid geometry. Malformed JSON and incomplete streams fail without correction; only parsed design-validation failures permit the single bounded correction. Copilot CLI may independently retry internally. JSONL support requires a recent standalone CLI. An isolated local fake-provider run with the actual Linux CLI verified the event handling without external model calls; a later bounded real Windows ARM64 API request verified the small custom-planning path. Neither establishes Codespaces integration or successful large-scene model generation.

### Original dinosaur and spacecraft worlds

Dinosaurs and spacecraft remain the focus. With Copilot, Azure or Compatible AI selected, try a new dinosaur anatomy, a herd with habitat objects, an original multi-deck spacecraft, or a fleet with station structures. AI planners must return `model: "custom"` with named objects and explicit brick geometry, including each brick's lower-corner coordinates, width, height, depth, color and structural/detail role. Objects can share a world without being one connected model; each object's own connectivity still matters. FrameBot and DetailBot execute a visible task graph, with PlanBot and CheckBot reviewing and inspecting it. Missing-brick repair, replay and saves use the generated geometry.

This removes the four-template subject restriction **for AI-planned designs**, not consent, authentication or resource limits. Dinosaur and spacecraft showcases are not an allowlist: original buildings, castle-like structures and other subjects can also use custom geometry. Offline rule-based interpretation and the separate three-model Actions workflow still use their documented templates.

The shared custom contract supports legacy `design.bricks` or named groups in `design.objects`, with **1-256 compact brick records in total**, optional `repeat: {count, dx, dy, dz}`, up to **32 objects**, **8,192 expanded bricks** and **262,144 occupied cells**. Each brick has integer dimensions **1-8** per axis; every occupied cell must stay within **x/z -64..63 and y 0..63**. Colors are allowlisted and overlaps are rejected, including between objects. Separate objects may be apart; PlanBot and CheckBot check face connectivity within each object. Missing-brick repair cannot fix a fundamentally disconnected blueprint. Invalid output fails explicitly, without automatic paid retries. Old template and single-object custom saves remain supported; new saves retain validated object geometry. A novel design's semantic quality and large-scene live model reliability remain unverified.

Future custom-planning prompts ask distinct fronts to face +X unless the brief
requests otherwise; existing builds are not reoriented. **Flip camera 180
degrees** reversibly views the other side at the current elevation and distance,
without changing geometry, saves or sending a planning request. Drag still
orbits freely; **Reset camera** restores the default front-side view. This is
manual view control, not automatic detection of an arbitrary model's front.

Each **Copilot plan** starts **one CLI planning invocation**, maximum 300 seconds, **128 KB of final response content** and **1 MiB of CLI event data**, with two concurrent invocations allowed by default. The planning dialog shows actual elapsed time and a rough, sample-based estimate, not model progress; at 100 and 200 seconds it offers abort or continued waiting for the same invocation. The deadline still applies without a response. The CLI may make internal provider retries, so one invocation is not a guaranteed single model request or billing unit.

Private local servers and Codespaces default to **8 total planning slots and 2 per provider**. `BRICKLAB_PLANNING_CONCURRENCY` and `BRICKLAB_PROVIDER_CONCURRENCY` can set each limit from 1 to 20, with the provider limit no higher than total. A 20-slot hosted deployment requires one worker and one Node process; none of these bounds guarantees upstream throughput. Slots cover request-body reading, provider work, and cleanup. Full shared capacity returns HTTP 429 rather than queuing work, and application requests are not retried or sent to a fallback provider. Cancellation and timeout do not release a slot until cleanup is confirmed; ambiguous Copilot process cleanup locks all planning until an operator verifies before restarting.

Local servers and Codespaces have **no application daily request quota**, even if the obsolete `BRICKLAB_DAILY_CALLS` setting is supplied. Copilot `calls` is informational and `limit` is null. The public Azure preview uses a shared atomic limit of **50 explicit submissions per UTC day, up to 100 model requests** with one invalid-design correction per submission. Failed/cancelled admitted submissions stay counted; correction does not count again or reset/refund usage. This is an application call-count limit, not a billing cap. The current preview package is identified in the [release and architecture notes](docs/architecture.md); deployment confirmation does not establish broad model reliability or user acceptance. Copilot service costs and quotas depend on your subscription; the app cannot determine dollars. The post's reported $0.022 castle cost is not claimed here. Offline templates use zero model calls. Any separately enabled local-model use consumes server/Codespace compute rather than Copilot quota; local-model adapters remain backlog, not an MVP support commitment. No gated SLM is required.

The estimate compares an unambiguous numeric brick target in the brief with a small study of 20 sequential Windows Copilot CLI requests on November 14, 2026, using the then-default model. Four synthetic lighthouse, dinosaur, spacecraft and garden briefs per target took: 20 bricks, 21.67–25.56 s; 100, 32.88–46.95 s; 500, 57.08–172.20 s; 2,000, 79.63–123.88 s; and 8,000, 119.91–182.94 s. Ranges shown are rounded outward; sizes between targets use the wider bracket of adjacent observations. Without a clear supported target, the estimate is unknown and displays the broad observed 20–183 s range. This is not a deadline or guarantee: conditions, prompts, models and actual generated brick counts vary, and the sample only checked schema, bounds and overlap—not connectivity, artistic quality or physical stability. No extra inference call is made for an estimate. Azure Foundry and Compatible AI are not calibrated by this Copilot study.

### Multi-object scale, not a reference-parity claim

The standard target is **up to 1,000 bricks and 32,768 occupied cells**; the local herd and fleet stay comfortably below it. The advanced ceiling is **8,192 bricks and 262,144 occupied cells**, not 262,144 individual bricks. A brick occupies width × height × depth cells. These are explicit software guardrails, not automatic hardware detection or the maximum possible on every device. Compact repetition avoids requiring the model to emit every brick separately; expanded counts, occupied volume, bounds and overlap checks still apply.

For AI planning, choose an approximate size for the new build or addition: 100, 500, 1,000 (default), 2,000, 3,000, 5,000, or Max (8,192). The target is not an exact output guarantee. A single unambiguous numeric brick count in the brief takes precedence and is shown alongside the selection; ambiguous numbers are not interpreted. Clear counts outside 1–8,192 are rejected. Offline templates do not use this control, and additions remain subject to combined scene limits.

The selected and effective rough targets are retained in plan assumptions when saved, exported, or restored; the selector describes the next new build, not the size of an existing scene. A separate numeric stud dimension does not obscure a single brick total, but multiple brick counts or per-object counts remain ambiguous.

The brick budget covers the expanded total across all objects: an unrepeated record counts as one brick, and a repeated record counts as `repeat.count` bricks, including the first. For example, repeats of 6 and 4 plus one unrepeated brick require a budget of at least 11. The planner is instructed to check this arithmetic, but model compliance is not guaranteed; invalid output is rejected rather than silently altered or retried.

Brick bodies and studs use instanced rendering. Above **8,192 decorative studs per model or blueprint**, studs are sampled; **no brick bodies are omitted**, and bodies remain selectable. **How to play** explains both scale targets and this detail policy. Large worlds still consume CPU/GPU memory, may load or animate slowly, and can exceed a device's practical graphics capacity. No device-independent frame rate, memory budget or hardware maximum is promised.

One Linux x64 / Node 26.12.1 CPU sample validated an exact **262,144-cell scene (one object, 512 large bricks)** in about **79 ms** and executed it in about **308 ms**. These are environment-specific CPU timings that vary with load, not browser FPS. A Chromium journey imports a completed scene at this cell limit and verifies **512 rendered body instances, 8,192 displayed studs, nonzero render calls/triangles and no WebGL error**, plus the named object, inspection, mobile width and detail-limit disclosure. It avoids animating thousands of placement turns. Advanced-scale body picking is not browser-verified; selection mapping has smaller unit coverage. Separate coverage executes and restores **8,192 bricks**; these two boundary fixtures are not a claim that every possible scene at every simultaneous limit has been performance-tested. Desktop herd and mobile fleet inspection confirmed completed, visible multi-object examples. Live Copilot generation at these limits and real-device memory/FPS remain unverified.

The [source reference](https://www.linkedin.com/feed/update/urn:li:activity:7526700957087252480/) depicts a much larger castle with perimeter walls, a courtyard, a central building and towers. Its video labels 26 levels and approximately 17,000 blocks per level and shows a 100-castles shot; those are reference claims, not BrickLab measurements. BrickLab retains its dinosaur and spacecraft themes. Its occupied cells are not a benchmark-equivalent Minecraft block count, and it does **not** claim the video's scale, visual parity or unrestricted generation. The author's reported dollar budget and per-castle cost are not this app's budget or measured costs.

Only brief and fixed schema text are intentionally included in the model prompt. Automatic plugin discovery and client telemetry are disabled for the spawned CLI. The CLI's account/service configuration and its own session persistence still belong to the host user; review that configuration before using it with children's input. Do not enter identifying or sensitive information. Use an adult-supervised subscription.

The planning API is localhost-only by default, validates Origin and a per-process request token, and does not enable CORS. The explicit private Codespaces mode above replaces the local host allowlist with a single verified forwarded host plus temporary app authentication; it does not globally bypass host checks. This is an educational demo, not a hardened public multi-user service. Do not expose it on a public interface. `HOST` and `PORT` configure the listener; changing HOST alone does not remove the API's loopback host restrictions.

## A 5-minute workshop

1. **Predict:** ask what a coordinator does. Start with “Build a dinosaur” and inspect its explicit assumptions.
2. **Direct:** try “purple brachiosaurus with a tall neck.” Ask what changed and what stayed fixed.
3. **Observe:** open Task board, start at 1x, pause, then fast-forward. Notice DetailBot finishing feet while FrameBot is still building the body.
4. **Investigate:** hide roughly one-third of the bricks, read the failed inspection, ask for a repair and identify the observe-act-check loop.
5. **Reflect:** answer the Team Scientist question. Explain why a rule-based agent and a language model are not the same thing.

## Development

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI checks the engine, type safety, production build and browser journeys on both worlds. No paid model calls run in CI.
CI uses one Playwright worker, following [Playwright's CI guidance](https://playwright.dev/docs/ci#workers),
so concurrent SwiftShader scenes do not compete with motion screenshot capture.
Local runs retain Playwright's default worker count; use `--workers=1` to reproduce CI scheduling.

Coverage includes scene growth and provenance, deterministic damage and repair,
planner consent and failure handling, fake-clock 300-second limits, subprocess
cancellation and browser journeys. The merged PR #21 tree-equivalent test head
`0ad0b55740c99f9e59fff3511390ee0b26daf828` passed workflow run `43812538493`
(286 passed, 10 skipped, including native Windows process tests); the merged
release is `c0060c7af8bd5a1c748a76b10e7710e35cf051e6`. Windows text/image
tests cover contained descendant cleanup, timeout, cancellation and host-loss
failure, but the Linux workflow run did not exercise the native Windows paths.
Automated checks do not replace user acceptance: final local
Copilot authentication/inference and manual UAT, and real Codespaces forwarding,
remain unverified. Voice input is excluded and backlogged across modes.
The separate latency experiment is not shipped and has no demonstrated
end-to-end speedup. Proxy buffering or hosting request limits may prevent a hosted
connection from remaining open for 300 seconds; local tests do not establish
hosted behavior.

Architecture: `src/engine.ts` (typed specs, task graph, five-agent loop, inspection and saves), `src/scene.ts` (Three.js original brick geometry and habitats), `src/main.ts` (workshop UI), `server.mjs` (local serving and optional bounded CLI bridge), `copilot-output.mjs` (strict CLI event decoding).

## Limits and privacy

Models use stylized solid bricks, not official LEGO part geometry. Face connectivity is not a clutch, collision, stability, flight or physical safety simulation. No physical construction instructions or product compatibility are promised. Browser storage stays on the device; downloads include the brief. Clearing site data clears saves. The local rule-based application works without network access after it loads; Copilot planning requires network access. No analytics, accounts, telemetry code or public sharing is included by the app.

Reference images are optional. The image controls identify the destination and require consent before a planning request sends the original PNG or JPEG. Embedded metadata, including possible location or camera information, is **not removed**. The server limits images to 1 MB, 4,096 pixels per dimension and 8 million pixels. Offline templates do not accept images. The Azure backend accepts consented, validated multimodal requests in source; current live vision behavior remains unverified. A compatible service requires the separate `BRICKLAB_COMPATIBLE_VISION=1` operator opt-in, which is an assertion rather than a verified capability. Model or provider vision accuracy has not been established by mock tests.

### Brief and images

The brief composer keeps **Choose image (+)** beside the typed brief. Choosing an
image reveals its removable filename chip, destination and unchecked consent
box; it does not upload anything. **Media & privacy** contains image metadata and
recovery disclosures. Voice input is unavailable in every BrickLab mode; type
your brief instead. The interactive GitHub Copilot CLI has its own local
`/voice` feature, but BrickLab does not integrate it as an app API.

### Optional Windows Copilot images (private server only)

Copilot images are **off by default** and unavailable on POSIX or public hosted
deployments. The Windows path requires the Microsoft Store PowerShell 7 package,
an absolute native Copilot `.exe` path, and both server opt-ins. For example, in
PowerShell after installing and authenticating the standalone CLI:

```powershell
$env:BRICKLAB_COPILOT = '1'
$env:BRICKLAB_COPILOT_IMAGES = '1'
$env:BRICKLAB_COPILOT_BIN = 'C:\path\to\copilot.exe'
npm start
```

Build first with `npm run build`, or use `npm run dev` for local development.
The image destination disclosure appears only when the server is configured for
this path. Configuration does not prove runtime availability or model vision
support. Select **Copilot**, choose an image, review the GitHub destination and
metadata disclosure, consent, and explicitly submit. This sends the brief and
original image to GitHub and may consume Copilot quota; selecting a file or mode
does not submit it.

Before any image bytes are written, the helper exclusively creates a directory
with an owner-only ACL, verifies its actual owner/ACL and the new file's ACL, and
rejects existing paths or reparse points without modifying them. The CLI starts
suspended inside a kill-on-close Windows Job Object, with tools and inherited
agent instructions disabled. Cancellation and the shared 300-second deadline
terminate the job, not just its leader. Combined output is capped at 1 MiB,
final content at 128 KB, and normal JSONL/custom-geometry validation still
applies. Attachments are deleted only after the job is confirmed empty.

The helper has independent Windows ARM64 verification, not a guarantee for every
Windows configuration or model. Unsupported runtimes, unverifiable ACLs,
containment and cleanup fail closed. Unconfirmed cleanup locks all planning:
the operator must verify process termination and any remaining private temporary
files before restarting. Abrupt server/host termination may leave owner-only
attachment files; automatic deletion after a crash is not guaranteed. Local
administrators and processes running as the same user are outside this isolation
boundary. No personal Copilot credentials belong in a public deployment.

The planning lock is in memory: restarting clears the lock, not the residue.
Before restarting, the operator must confirm the affected processes have exited,
review the exact request-owned `bricklab-copilot-<UUID>` directory in the Windows
temporary folder, and remove any verified leftover attachment. Do not remove
unrelated or pre-existing directories.

Independent educational demo, not affiliated with or endorsed by the LEGO Group, Microsoft, or the author of the reference post. LEGO is a trademark of the LEGO Group.
