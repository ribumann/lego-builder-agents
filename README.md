# BrickLab

A LEGO-style game with **cloud-first, open-ended planning** and visible **agentic teamwork for ages 11-15**. Give a brief and watch five agents coordinate: BuildBot delegates, PlanBot checks the blueprint, FrameBot and DetailBot build, and CheckBot inspects the result. Optional Local AI and explicit offline presets are separate choices.

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

Each server process admits **8 planning requests total and 2 per provider**
(Copilot text and images share one provider allowance). Local, compatible and
Azure requests have separate provider slots: a busy Copilot provider does not
serialize them. Set `BRICKLAB_PLANNING_CONCURRENCY` (integer 1-32) and
`BRICKLAB_PROVIDER_CONCURRENCY` (integer 1-8, no greater than total) to lower or
raise these bounded limits. Invalid configuration prevents startup. The local
adapter also defaults to 2 simultaneous requests when used independently.

Capacity is shared across clients/tabs, not a browser-local lock or a
cross-instance semaphore. Excess requests receive HTTP 429, without queuing,
retrying or submitting a model call. `/api/status` reports `planningCapacity`
with active total, configured limits, per-provider counts and quarantine state.
Slots cover body reading, provider work and cleanup; aborts/deadlines end the
client response but do not release capacity until transport/process cleanup
settles. Daily Copilot calls and Azure quota/spend reservations are independent
of capacity and are not refunded on cancellation or failure.

Unconfirmed Copilot image cleanup permanently quarantines **all planning** in
that process, aborts active requests and prevents late completions from
unlocking it. Unconfirmed Copilot text process-tree termination likewise
quarantines planning with an explicit operator-facing error, even if the
parent process has exited. An operator must verify cleanup before restarting; ordinary
capacity exhaustion needs only an active request to finish. These changes do
not enable any provider, paid hosted planning, or update an already-running
server.

If planning is quarantined, inspect the server's process tree and any private
attachment/cancellation artifacts with the operator before authorizing
recovery. A missing parent process is not proof that descendants exited.
There is no API unlock or automatic quarantine expiry. Restarting also resets
the process-local Copilot daily counter; it does not carry remaining quota
forward or reset Azure's durable reservations.

### Optional OpenAI-compatible provider (private server only)

Set `BRICKLAB_COMPATIBLE_AI=1`, `BRICKLAB_COMPATIBLE_ENDPOINT` to the full
chat-completions URL, and `BRICKLAB_COMPATIBLE_MODEL` to its model identifier.
Set `BRICKLAB_COMPATIBLE_API_KEY` on the server if the service requires a bearer
token; do not put credentials in the browser or a shared deployment. Restart
the server, choose **Change mode -> Use Compatible AI**, then explicitly submit
a brief. This sends the brief to the configured provider and may incur charges.
No request is made on load or mode selection. Availability and authentication
are not checked until submission; no fallback or retry is performed.

The endpoint must use HTTPS, except HTTP is allowed for literal `127.0.0.1`
or `[::1]`. Credentials, queries, and fragments in URLs are rejected. The
service must support chat completions with `max_tokens` and JSON-object
`response_format`; providers requiring only `max_completion_tokens` are not
supported. A request can be cancelled and is bounded to 300 seconds. This
option is prohibited in anonymous hosted mode and has no built-in spending
budget. Use only a trusted private server and provider.

## Facilitate a BrickLab lab

Allow 30–45 minutes for pairs. Start with offline templates, so the first activity
needs no model account or model calls. Ask learners not to include names or other
personal information in briefs. Cloud planning sends the submitted brief to
GitHub; Local AI sends it to the configured model service on the server host.

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

The separate **Azure Foundry** adapter uses a managed identity, not a personal
Copilot credential. Public hosted mode currently serves the anonymous lab and
offline templates only; paid hosted planning is deliberately disabled until
edge abuse controls and the long-request transport have been verified.
Azure service usage can incur charges. See [Azure planner setup](docs/azure-planner.md).

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
gh auth status
gh codespace ports --codespace "$CODESPACE_NAME" --json sourcePort,visibility,browseUrl
npm run build
BRICKLAB_CODESPACES=1 BRICKLAB_COPILOT=1 npm start
```

Follow Copilot's browser/device sign-in flow using your own Copilot-enabled account. Do not send tokens, device codes, or credentials to anyone. GitHub CLI (`gh`) must also be installed and able to inspect this Codespace's ports. The automatically supplied Codespace token may suffice for `gh`; that does not prove Copilot entitlement. If either CLI is unavailable or authentication fails, resolve that in the Codespace terminal before continuing; [Copilot authentication troubleshooting](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/troubleshoot-copilot-cli-auth) describes account and token precedence. Explicitly exported `GH_TOKEN`, `GITHUB_TOKEN` or `COPILOT_GITHUB_TOKEN` can override a Copilot login.

Keep port **4173** forwarded with **Private** visibility in the Ports tab (not Public or Private to Organization). Open its exact `https://CODESPACENAME-4173.app.github.dev` URL while signed in to GitHub. A second browser sign-in prompt belongs to BrickLab: use username **bricklab** and the **temporary app password printed in the server terminal**. Never use your GitHub password there. Do not share that generated app password or server logs. Restarting rotates it; a cached browser password may need to be replaced. Then choose **Change mode -> Use Copilot planning** in the app.

This mode supports only the production server, loopback listener, and standard `app.github.dev` HTTPS host for the current `CODESPACE_NAME` and `PORT`. It does not trust `X-Forwarded-Host`, wildcard domains, or a hostname alone as proof of privacy. Each authenticated request checks the actual port's visibility and exact URL through `gh codespace ports` (15-second timeout; no visibility cache). Missing, public, organization-visible, unrecognized or unverifiable ports fail closed with an explanatory error. The independent random app password prevents an unauthenticated caller from obtaining the planner token or spending calls even if visibility changes immediately after a check. Exact Origin and per-process request-token checks still apply to planning; no CORS is enabled. Both opt-in variables are separate: `BRICKLAB_CODESPACES=1` alone does not enable model calls.

Do not make the port public to troubleshoot. If the private URL or visibility verification cannot work in your environment, use the browser's rule-based builder with the default startup above, or forward the remote server to **localhost** using VS Code desktop or `gh codespace ports forward 4173:4173 --codespace NAME` on your own computer, keep the remote port private, and run `BRICKLAB_COPILOT=1 npm start` in the Codespace **without** `BRICKLAB_CODESPACES`. Open `http://127.0.0.1:4173` locally. The separate GitHub Models Actions workflow below is another cloud option; it is not Copilot.

**Verification limitation:** automated tests use explicit CLI fixtures for private-port checks and model responses. A real Codespace, its GitHub/browser authentication and forwarding behavior have not been exercised. A reported bounded local Windows ARM64 API request at `0c0bc63` returned `source=copilot`, `model=custom` and one named lighthouse object through the real Copilot CLI. This verifies that local planning path and the named-object contract, not its geometry size/quality, Codespaces forwarding or large multi-object model generation. No infrastructure is provisioned or provider success assumed beyond the reported request. CLI/organization policies, network access, your subscription, Codespaces charges and Copilot quotas still apply; stop the app and Codespace when finished.

## The game

- **Jurassic valley:** stegosaurus or brachiosaurus, in a studded landscape with palms.
- **Space dock:** explorer or cargo spacecraft, with stars, a ringed planet, engines and landing gear.
- **Player-directed builds:** choose a body color, species/ship type, long tail or wide wings, and optional brick budget.
- **Multi-object examples:** choose **Load local Jurassic herd** (three named objects, 400 bricks, 494 occupied cells) or **Load local space fleet** (three named objects, 359 bricks, 536 occupied cells), then start the crew. These are original deterministic examples, not live model results.
- **A visible team of five:** BuildBot decomposes the goal; PlanBot checks dependencies and connectivity; FrameBot and DetailBot independently choose ready construction tasks; CheckBot inspects the result and identifies missing bricks for repair.
- **Real-time controls:** start, pause, single-step, and cycle **1x / 4x / 16x fast-forward**. Guided demo uses 4x.
- **Explainable actions:** task ownership, dependency waits, turn numbers, observations and completion messages. Messages describe application decisions, not hidden model chain-of-thought.
- **Special experiments:** blueprint overlay, exploded view, cutaway view, tap-to-inspect bricks, timeline replay, and a missing-brick challenge that agents detect and repair.
- **Hollow interiors:** select **Try a hollow interior** before a custom planning request (Copilot, Local AI, compatible AI or Azure when available). Try “A small blue room with an open doorway and an orange chair.” The preference asks for a real empty cavity, not a solid block; it does not guarantee model compliance. **Cutaway view** clips the right half of the scene to reveal its cross-section without changing bricks, inspection, saves or repair. It works on existing scenes too, but cannot create a cavity in a solid design. Offline templates ignore this preference and disable its checkbox. FrameBot and DetailBot retain their actual assigned structure/support/detail tasks; labels do not imply that every scene has interior work. Connectivity is not physical stability.
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

**Cloud planning is hybrid:** a real Copilot model must propose custom geometry for the child's brief, including familiar subjects; selecting a pre-built template is rejected. The same two local construction specialists execute it, with PlanBot and CheckBot performing local checks. Optional Local AI uses this same custom-only contract and five-agent execution. Subjects are not limited to dinosaurs and spacecraft, but the result is still a bounded stylized brick design, not unrestricted text-to-3D or a guarantee of artistic fidelity or semantic originality. It is not five independent LLM calls. Crew Q&A remains a clearly labeled local teaching guide in every mode.

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
npm run dev
```

Copilot planning is the default choice, or select **Change mode -> Use Copilot planning**. Review the disclosure, then press **Send brief to Copilot** to consent to sending that brief to your authenticated model service. Merely loading the app or choosing a mode sends no brief. Guided demos and explicit local examples never implicitly invoke a model.

Server status detects a missing or unusable CLI with a non-model `copilot --version` check; it sends no brief and verifies no account entitlement. Authentication errors from an attempted plan provide login instructions without displaying raw CLI output or automatically retrying. An installed CLI is not proof of a working login or subscription.

On Windows, a VS Code `copilot.exe` shim may win command resolution while the standalone CLI is missing. Check `Get-Command copilot -All` and `copilot --version`; the app also recognizes a shim reporting that the CLI is not installed. If needed, set `BRICKLAB_COPILOT_BIN` to the **absolute path of the actual standalone native executable** (`.exe` on Windows), then restart. This override is used for both status and planning without a shell, including paths with spaces. `.cmd`/`.bat` wrappers are intentionally unsupported rather than enabling shell execution of a child's brief. The private Codespace setup avoids relying on the computer's Windows executable or login. Native Windows ARM64 CLI version reporting and a bounded real local API planning request were verified. The two subprocess tests that create POSIX shebang executables are explicitly skipped on Windows, not represented as native Windows coverage.

The server invokes `copilot -p` without shell interpolation, with an empty available-tool list, built-in MCPs disabled, and repository custom instructions disabled. No model tools are exposed. Both server and browser require validated custom brick arrangements: template-only and invalid responses fail visibly, without automatic retries, substitution or pretending offline planning was AI. Legacy saves and imported Actions missions may still contain templates; they are not new cloud planning results.

The bridge uses the CLI's scripting mode, `--output-format=json`, not terminal-rendered `--silent` text. It reads the final completed `assistant.message` content only, requires a successful terminal `result`, and rejects malformed, failed or incomplete streams. Metadata, user echoes and partial message deltas are not treated as designs or logged. The final assistant content must still be valid JSON and pass the geometry schema; the app never joins wrapped strings, strips arbitrary control characters, repairs malformed model output, or automatically launches another planning invocation. JSONL support requires a recent standalone CLI. An isolated local fake-provider run with the actual Linux CLI verified the event handling without external model calls; a later bounded real Windows ARM64 API request verified the small custom-planning path. Neither establishes Codespaces integration or successful large-scene model generation.

### Optional open-ended Local AI (Ollama)

Local AI is a separate, explicitly selected planner, not the offline template engine. It runs on the **BrickLab Node server's host**. In a Codespace, that means the remote Codespace, not the browser's Windows/Mac/mobile device. No runtime, model or infrastructure is installed or downloaded by BrickLab.

Install [Ollama](https://ollama.com/) yourself if wanted, choose a local model that fits the host, and **disable Ollama cloud features before starting its service**. For a manually started service:

```sh
OLLAMA_NO_CLOUD=1 ollama serve
```

If Ollama already runs as a service/application, configure `OLLAMA_NO_CLOUD=1` for that service and restart it yourself; setting it only in BrickLab's terminal does not change an already-running Ollama process. In another terminal, explicitly download a model and opt in:

```sh
ollama pull qwen2.5:3b
npm run build
BRICKLAB_LOCAL_AI=1 BRICKLAB_LOCAL_MODEL=qwen2.5:3b npm start
```

The model name above is an example, not a hardware or design-quality guarantee. Downloading requires network access and storage; inference needs device-dependent RAM/compute and may exceed the deadline. On PowerShell, set `$env:BRICKLAB_LOCAL_AI="1"` and `$env:BRICKLAB_LOCAL_MODEL="qwen2.5:3b"` before `npm start`; configure Ollama's own service environment separately.

Choose **Change mode -> Use Local AI**, then **Plan with Local AI**. Status and mode selection do not contact Ollama. Only that explicit planning action checks `/api/tags`, then sends the brief and fixed schema to `/api/generate`. Missing runtime/model and invalid/template output fail visibly; no downloads, retries, cloud or template fallback occur.

The default endpoint is `http://127.0.0.1:11434`; optional `BRICKLAB_LOCAL_URL` accepts only an HTTP numeric loopback address (`127.0.0.1` or `[::1]`), without userinfo, paths, query or fragment. Hostnames (including `localhost`), external addresses and redirects are rejected. Transport does not use environment proxies. Model metadata identifying a remote/cloud model is rejected **before transmitting the brief**. **Loopback alone does not prove offline operation:** use `OLLAMA_NO_CLOUD=1`, a genuinely local downloaded model and a trusted service. Metadata cannot prove what a modified or misconfigured service does internally.

Local AI shares Host/Origin/authentication checks, the per-process request token, custom geometry validation and a single active planning slot with Copilot. It has a 90-second deadline, 1 MiB provider-envelope limit and 128,000-byte final-content limit, with bounded output tokens. Its cancellable dialog shows elapsed time and the separate 90-second maximum, not Copilot's measured estimates or 300-second deadline. It uses no Copilot quota, but server/Codespace compute charges may apply. Keep children's identifying/sensitive information out of briefs.

Fake local-provider and browser tests cover success, failures, explicit mode separation and remote-model rejection. No Ollama executable/listener was observed on the checked Linux server or Windows ARM64 host, so **real local-model inference remains unverified**. No model was installed/downloaded or live local-model success inferred from fixtures.

### Original dinosaur and spacecraft worlds

Dinosaurs and spacecraft remain the focus. With Copilot or Local AI selected, try a new dinosaur anatomy, a herd with habitat objects, an original multi-deck spacecraft, or a fleet with station structures. Both AI planners must return `model: "custom"` with named objects and explicit brick geometry, including each brick's lower-corner coordinates, width, height, depth, color and structural/detail role. Objects can share a world without being one connected model; each object's own connectivity still matters. FrameBot and DetailBot execute a visible task graph, with PlanBot and CheckBot reviewing and inspecting it. Missing-brick repair, replay and saves use the generated geometry.

This removes the four-template subject restriction **for AI-planned designs**, not consent, authentication or resource limits. Dinosaur and spacecraft showcases are not an allowlist: original buildings, castle-like structures and other subjects can also use custom geometry. Offline rule-based interpretation and the separate three-model Actions workflow still use their documented templates.

The shared custom contract supports legacy `design.bricks` or named groups in `design.objects`, with **1-256 compact brick records in total**, optional `repeat: {count, dx, dy, dz}`, up to **32 objects**, **8,192 expanded bricks** and **262,144 occupied cells**. Each brick has integer dimensions **1-8** per axis; every occupied cell must stay within **x/z -64..63 and y 0..63**. Colors are allowlisted and overlaps are rejected, including between objects. Separate objects may be apart; PlanBot and CheckBot check face connectivity within each object. Missing-brick repair cannot fix a fundamentally disconnected blueprint. Invalid output fails explicitly, without automatic paid retries. Old template and single-object custom saves remain supported; new saves retain validated object geometry. A novel design's semantic quality and large-scene live model reliability remain unverified.

Each **Copilot plan** starts **one CLI planning invocation**, maximum 300 seconds, **128 KB of final response content** and **1 MiB of CLI event data**, with one concurrent invocation allowed. The planning dialog shows actual elapsed time and a rough, sample-based estimate, not model progress; at 100 and 200 seconds it offers abort or continued waiting for the same invocation. The deadline still applies without a response. The CLI may make internal provider retries, so one invocation is not a guaranteed single model request or billing unit. Default limit is **12 Copilot planning invocations per UTC day per server process**, configurable with `BRICKLAB_DAILY_CALLS` (1-100). Restarting resets the counter; this is a demo guardrail, **not a durable FinOps or monetary budget**. Copilot service costs/quotas depend on your subscription; the app cannot determine dollars. The post's reported $0.022 castle cost is not claimed here. Offline templates use zero model calls. Local AI uses host compute, not Copilot quota. No gated SLM is required.

The estimate compares an unambiguous numeric brick target in the brief with a small study of 20 sequential Windows Copilot CLI requests on November 14, 2026, using the then-default model. Four synthetic lighthouse, dinosaur, spacecraft and garden briefs per target took: 20 bricks, 21.67–25.56 s; 100, 32.88–46.95 s; 500, 57.08–172.20 s; 2,000, 79.63–123.88 s; and 8,000, 119.91–182.94 s. Ranges shown are rounded outward; sizes between targets use the wider bracket of adjacent observations. Without a clear supported target, the estimate is unknown and displays the broad observed 20–183 s range. This is not a deadline or guarantee: conditions, prompts, models and actual generated brick counts vary, and the sample only checked schema, bounds and overlap—not connectivity, artistic quality or physical stability. No extra inference call is made for an estimate. Azure Foundry and Local AI are not calibrated by this Copilot study.

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
cancellation and browser journeys. The IPv6 loopback test may be skipped on
hosts without IPv6 loopback support. The production build reports a large-bundle
advisory. Windows tree termination uses simulated tests; the current changes,
real Codespaces forwarding and real Ollama inference remain unverified there.
Proxy buffering or hosting request limits may prevent a hosted connection from
remaining open for 300 seconds; local tests do not establish hosted behavior.

Architecture: `src/engine.ts` (typed specs, task graph, five-agent loop, inspection and saves), `src/scene.ts` (Three.js original brick geometry and habitats), `src/main.ts` (workshop UI), `server.mjs` (local serving and optional bounded CLI bridge), `copilot-output.mjs` (strict CLI event decoding).

## Limits and privacy

Models use stylized solid bricks, not official LEGO part geometry. Face connectivity is not a clutch, collision, stability, flight or physical safety simulation. No physical construction instructions or product compatibility are promised. Browser storage stays on the device; downloads include the brief. Clearing site data clears saves. The local rule-based application works without network access after it loads; Copilot planning requires network access. No analytics, accounts, telemetry code or public sharing is included by the app.

Reference images are optional. The image controls identify the destination and require consent before a planning request sends the original PNG or JPEG. Embedded metadata, including possible location or camera information, is **not removed**. The server limits images to 1 MB, 4,096 pixels per dimension and 8 million pixels. Offline templates and hosted/Azure planning do not accept images. Local Ollama must report vision support; a compatible service requires the separate `BRICKLAB_COMPATIBLE_VISION=1` operator opt-in, which is an assertion rather than a verified capability. Model or provider vision accuracy has not been established by mock tests.

### Brief, images and voice

The rounded brief composer keeps **Choose image (+)** on the left and **Voice input**
on the right. Choosing an image reveals its removable filename chip, destination
and unchecked consent box; it does not upload anything. **Media & privacy**
contains the full metadata, model-download and recovery disclosures.

The microphone button first opens a permission explanation, not a recording.
Choose **Allow and record**, then stop or cancel; active recording remains visible
and stops after 30 seconds. Transcription runs on this device. First use downloads
about 45 MB from Hugging Face/CDN, exposing ordinary network metadata including
your IP address, not audio or transcripts. The bundled WebAssembly runtime is
about 22 MB uncompressed; model files can remain in browser cache. Review and edit
the result, then explicitly replace the brief; this does not submit a plan.
Typing remains available if recording or transcription is unsupported, slow or
inaccurate. The selected planner may subsequently receive the brief when you
submit it.

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
