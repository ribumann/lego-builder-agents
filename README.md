# BrickLab

A local-first, LEGO-style game that makes **agentic teamwork tangible for ages 11-15**. Give a brief and watch five agents coordinate: BuildBot delegates, PlanBot checks the blueprint, FrameBot and DetailBot build, and CheckBot inspects the result.

Inspired by the user-supplied National Future Day post: three agents build a Minecraft castle from children's ideas. This original implementation translates its lesson into two brick-building worlds, not a reproduction of Minecraft or official LEGO software.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The server binds to loopback by default. No Azure account, model download, API key, or external service is required for local mode.

For a production build:

```sh
npm run build
npm start
```

## Run in a private GitHub Codespace

[Create a Codespace for BrickLab](https://codespaces.new/ribumann/lego-builder-agents).
GitHub will show the creation options and applicable usage limits or charges before you create it.
The Codespace installs dependencies during creation. Once that finishes, run in its terminal:

```sh
npm run build
npm start
```

In the **Ports** tab, open port **4173 (BrickLab)** in a browser. Forwarded ports are private by default; keep this port private. Use the production server above rather than `npm run dev`, which can reject the forwarded hostname. Stop the Codespace when finished to avoid unnecessary usage.

The rule-based builder runs in the browser. By default the planning API is localhost-only, so this URL can report that server status is unavailable. For optional real Copilot planning through the private browser URL, use the explicit setup below. A Codespace is not itself a Copilot subscription or a Copilot CLI login.

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

**Verification limitation:** automated tests use explicit CLI fixtures for private-port checks and model responses. A real Codespace, its GitHub/browser authentication and forwarding behavior have not been exercised. After fixing wrapped terminal output with JSONL, a bounded local Windows ARM64 API request through the real Copilot CLI successfully produced a valid 11-brick custom design with eight different rectangular dimensions. This verifies that local planning path, not Codespaces forwarding, large multi-object model generation, or visual quality. No infrastructure is provisioned or provider success assumed. CLI/organization policies, network access, your subscription, Codespaces charges and Copilot quotas still apply; stop the app and Codespace when finished.

## The game

- **Jurassic valley:** stegosaurus or brachiosaurus, in a studded landscape with palms.
- **Space dock:** explorer or cargo spacecraft, with stars, a ringed planet, engines and landing gear.
- **Player-directed builds:** choose a body color, species/ship type, long tail or wide wings, and optional brick budget.
- **Multi-object examples:** choose **Load local Jurassic herd** (three named objects, 400 bricks, 494 occupied cells) or **Load local space fleet** (three named objects, 359 bricks, 536 occupied cells), then start the crew. These are original deterministic examples, not live model results.
- **A visible team of five:** BuildBot decomposes the goal; PlanBot checks dependencies and connectivity; FrameBot and DetailBot independently choose ready construction tasks; CheckBot inspects the result and identifies missing bricks for repair.
- **Real-time controls:** start, pause, single-step, and cycle **1x / 4x / 16x fast-forward**. Guided demo uses 4x.
- **Explainable actions:** task ownership, dependency waits, turn numbers, observations and completion messages. Messages describe application decisions, not hidden model chain-of-thought.
- **Special experiments:** blueprint overlay, exploded view, tap-to-inspect bricks, timeline replay, and a missing-brick challenge that agents detect and repair.
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

The **local rule-based templates** support body colors green, orange, blue, purple, red and white. Their plates, eyes, cockpit, engine and accent colors are fixed. Unsupported local requests do not create arbitrary geometry; the plan explains this limitation. T. rex and triceratops are excluded from the local Jurassic mission because they lived in the Cretaceous. Copilot's custom-design path below is not restricted to these four figures.

## What is actually agentic?

**Local mode is explicitly a rule-based agent simulation, not generative AI.** All five agents have observable roles: BuildBot compiles the interpreted brief into tasks with prerequisites; PlanBot checks dependency and blueprint connectivity before construction; FrameBot and DetailBot observe the shared world, select eligible tasks, place bounded numbers of bricks and report completion; CheckBot inspects the finished grid and identifies missing bricks for repair. The repair loop reopens the owning construction specialist's task. These are deterministic application decisions, not five hidden model conversations.

This teaches goal decomposition, delegation, shared memory, dependencies, parallel work, observation, tool actions, verification and repair. It deliberately separates those concepts from a claim that every agent must be a language model.

**Optional Copilot mode is hybrid:** a real Copilot model interprets the child's brief into a template specification or a new arrangement of differently sized rectangular bricks; the same two local construction specialists execute it, with PlanBot and CheckBot performing local checks. Subjects are not limited to dinosaurs and spacecraft, but the result is still a bounded stylized brick design, not unrestricted text-to-3D or a guarantee of artistic fidelity. It is not three independent LLM calls. Crew Q&A remains a clearly labeled local teaching guide in either mode.

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

In the app, select **Change mode -> Use Copilot planning**. This explicitly consents to sending subsequent briefs to your authenticated Copilot model service.

Server status detects a missing or unusable CLI with a non-model `copilot --version` check; it sends no brief and verifies no account entitlement. Authentication errors from an attempted plan provide login instructions without displaying raw CLI output or automatically retrying. An installed CLI is not proof of a working login or subscription.

On Windows, a VS Code `copilot.exe` shim may win command resolution while the standalone CLI is missing. Check `Get-Command copilot -All` and `copilot --version`; the app also recognizes a shim reporting that the CLI is not installed. If needed, set `BRICKLAB_COPILOT_BIN` to the **absolute path of the actual standalone native executable** (`.exe` on Windows), then restart. This override is used for both status and planning without a shell, including paths with spaces. `.cmd`/`.bat` wrappers are intentionally unsupported rather than enabling shell execution of a child's brief. The private Codespace setup avoids relying on the computer's Windows executable or login. Native Windows ARM64 CLI version reporting and a bounded real local API planning request were verified. The two subprocess tests that create POSIX shebang executables are explicitly skipped on Windows, not represented as native Windows coverage.

The server invokes `copilot -p` without shell interpolation, with an empty available-tool list, built-in MCPs disabled, and repository custom instructions disabled. No model tools are exposed. JSON validation accepts the existing templates or bounded custom brick arrangements; invalid responses fail visibly, without silently substituting a template or pretending local planning was AI.

The bridge uses the CLI's scripting mode, `--output-format=json`, not terminal-rendered `--silent` text. It reads the final completed `assistant.message` content only, requires a successful terminal `result`, and rejects malformed, failed or incomplete streams. Metadata, user echoes and partial message deltas are not treated as designs or logged. The final assistant content must still be valid JSON and pass the geometry schema; the app never joins wrapped strings, strips arbitrary control characters, repairs malformed model output, or automatically launches another planning invocation. JSONL support requires a recent standalone CLI. An isolated local fake-provider run with the actual Linux CLI verified the event handling without external model calls; a later bounded real Windows ARM64 API request verified the small custom-planning path. Neither establishes Codespaces integration or successful large-scene model generation.

### Original dinosaur and spacecraft worlds

Dinosaurs and spacecraft remain the focus. With Copilot planning selected, try a new dinosaur anatomy, a herd with habitat objects, an original multi-deck spacecraft, or a fleet with station structures. The model can return `model: "custom"` with named objects and explicit brick geometry, including each brick's lower-corner coordinates, width, height, depth, color and structural/detail role. Objects can share a world without being one connected model; each object's own connectivity still matters. FrameBot and DetailBot execute a visible task graph, with PlanBot and CheckBot reviewing and inspecting it. Missing-brick repair, replay and saves use the generated geometry.

This removes the four-template subject restriction **for optional Copilot designs**, not consent, authentication or resource limits. Dinosaur and spacecraft showcases are not an allowlist: original buildings, castle-like structures and other subjects can also use custom geometry. Local rule-based interpretation and the separate three-model Actions workflow still use their documented templates.

The shared custom contract supports legacy `design.bricks` or named groups in `design.objects`, with **1-256 compact brick records in total**, optional `repeat: {count, dx, dy, dz}`, up to **32 objects**, **8,192 expanded bricks** and **262,144 occupied cells**. Each brick has integer dimensions **1-8** per axis; every occupied cell must stay within **x/z -64..63 and y 0..63**. Colors are allowlisted and overlaps are rejected, including between objects. Separate objects may be apart; PlanBot and CheckBot check face connectivity within each object. Missing-brick repair cannot fix a fundamentally disconnected blueprint. Invalid output fails explicitly, without automatic paid retries. Old template and single-object custom saves remain supported; new saves retain validated object geometry. A novel design's semantic quality and large-scene live model reliability remain unverified.

Each plan starts **one CLI planning invocation**, maximum 90 seconds, **128 KB of final response content** and **1 MiB of CLI event data**, with one concurrent invocation allowed. The CLI may make internal provider retries, so one invocation is not a guaranteed single model request or billing unit. Default limit is **12 planning invocations per UTC day per server process**, configurable with `BRICKLAB_DAILY_CALLS` (1-100). Restarting resets the counter; this is a demo guardrail, **not a durable FinOps or monetary budget**. Copilot service costs/quotas depend on your subscription; the app cannot determine dollars. The post's reported $0.022 castle cost is not claimed here. Local mode uses zero model calls. No gated SLM is used.

### Multi-object scale, not a reference-parity claim

The standard target is **up to 1,000 bricks and 32,768 occupied cells**; the local herd and fleet stay comfortably below it. The advanced ceiling is **8,192 bricks and 262,144 occupied cells**, not 262,144 individual bricks. A brick occupies width × height × depth cells. These are explicit software guardrails, not automatic hardware detection or the maximum possible on every device. Compact repetition avoids requiring the model to emit every brick separately; expanded counts, occupied volume, bounds and overlap checks still apply.

Brick bodies and studs use instanced rendering. Above **8,192 decorative studs per model or blueprint**, studs are sampled; **no brick bodies are omitted**, and bodies remain selectable. **How to play** explains both scale targets and this detail policy. Large worlds still consume CPU/GPU memory, may load or animate slowly, and can exceed a device's practical graphics capacity. No device-independent frame rate, memory budget or hardware maximum is promised.

One Linux x64 / Node 26.12.1 CPU sample validated an exact **262,144-cell scene (one object, 512 large bricks)** in about **79 ms** and executed it in about **308 ms**. These are environment-specific CPU timings that vary with load, not browser FPS. A Chromium journey imports a completed scene at this cell limit and verifies **512 rendered body instances, 8,192 displayed studs, nonzero render calls/triangles and no WebGL error**, plus the named object, inspection, mobile width and detail-limit disclosure. It avoids animating thousands of placement turns. Advanced-scale body picking is not browser-verified; selection mapping has smaller unit coverage. Separate coverage executes and restores **8,192 bricks**; these two boundary fixtures are not a claim that every possible scene at every simultaneous limit has been performance-tested. Desktop herd and mobile fleet inspection confirmed completed, visible multi-object examples. Live Copilot generation at these limits and real-device memory/FPS remain unverified.

The [source reference](https://www.linkedin.com/feed/update/urn:li:activity:7526700957087252480/) depicts a much larger castle with perimeter walls, a courtyard, a central building and towers. Its video labels 26 levels and approximately 17,000 blocks per level and shows a 100-castles shot; those are reference claims, not BrickLab measurements. BrickLab retains its dinosaur and spacecraft themes. Its occupied cells are not a benchmark-equivalent Minecraft block count, and it does **not** claim the video's scale, visual parity or unrestricted generation. The author's reported dollar budget and per-castle cost are not this app's budget or measured costs.

Only brief and fixed schema text are intentionally included in the model prompt. Automatic plugin discovery and client telemetry are disabled for the spawned CLI. The CLI's account/service configuration and its own session persistence still belong to the host user; review that configuration before using it with children's input. Do not enter identifying or sensitive information. Use an adult-supervised subscription.

The planning API is localhost-only by default, validates Origin and a per-process request token, and does not enable CORS. The explicit private Codespaces mode above replaces the local host allowlist with a single verified forwarded host plus temporary app authentication; it does not globally bypass host checks. This is an educational demo, not a hardened public multi-user service. Do not expose it on a public interface. `HOST` and `PORT` configure the listener; changing HOST alone does not remove the API's loopback host restrictions.

## A 5-minute workshop

1. **Predict:** ask what a coordinator does. Start with “Build a dinosaur” and inspect its explicit assumptions.
2. **Direct:** try “purple brachiosaurus with a tall neck.” Ask what changed and what stayed fixed.
3. **Observe:** open Task board, start at 1x, pause, then fast-forward. Notice DetailBot finishing feet while FrameBot is still building the body.
4. **Investigate:** hide a brick, read the failed inspection, ask for a repair and identify the observe-act-check loop.
5. **Reflect:** answer the Team Scientist question. Explain why a rule-based agent and a language model are not the same thing.

## Development

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI checks the engine, type safety, production build and browser journeys on both worlds. No paid model calls run in CI.

Latest Linux verification: **40 unit/integration tests**, TypeScript and the locked **Vite 7.3.8** production build, and **eight Chromium journeys** passed. The existing large-bundle advisory remains. The reported Windows ARM64 check covered earlier commit `61b02fd`: **26 tests passed, two POSIX executable-fixture tests skipped**, and a build used Vite 8.2.2 because that host's feed lacked the locked version. That is not verification of the latest five-agent/world changes on Windows or lockfile-equivalent Windows build parity.

Architecture: `src/engine.ts` (typed specs, task graph, five-agent loop, inspection and saves), `src/scene.ts` (Three.js original brick geometry and habitats), `src/main.ts` (workshop UI), `server.mjs` (local serving and optional bounded CLI bridge), `copilot-output.mjs` (strict CLI event decoding).

## Limits and privacy

Models use stylized solid bricks, not official LEGO part geometry. Face connectivity is not a clutch, collision, stability, flight or physical safety simulation. No physical construction instructions or product compatibility are promised. Browser storage stays on the device; downloads include the brief. Clearing site data clears saves. The local rule-based application works without network access after it loads; Copilot planning requires network access. No analytics, accounts, telemetry code or public sharing is included by the app.

Independent educational demo, not affiliated with or endorsed by the LEGO Group, Microsoft, or the author of the reference post. LEGO is a trademark of the LEGO Group.
