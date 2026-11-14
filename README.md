# BrickLab

A local-first, LEGO-style game that makes **agentic teamwork tangible for ages 11-15**. Give a brief, watch BuildBot delegate to FrameBot and DetailBot, and see a brick dinosaur or spaceship come together in real time.

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

**Verification limitation:** automated tests use explicit CLI fixtures for private-port checks and model responses. A real Codespace, its GitHub/browser authentication, forwarding behavior, and live Copilot model have not been exercised. No infrastructure is provisioned or provider success assumed. CLI/organization policies, network access, your subscription, Codespaces charges and Copilot quotas still apply; stop the app and Codespace when finished.

## The game

- **Jurassic valley:** stegosaurus or brachiosaurus, in a studded landscape with palms.
- **Space dock:** explorer or cargo spacecraft, with stars, a ringed planet, engines and landing gear.
- **Player-directed builds:** choose a body color, species/ship type, long tail or wide wings, and optional brick budget.
- **A visible team:** BuildBot decomposes the goal; FrameBot and DetailBot independently observe a shared dependency board and choose ready tasks.
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

**Local mode is explicitly a rule-based agent simulation, not generative AI.** BuildBot compiles the interpreted brief into tasks with prerequisites. On each simulation turn, both specialists independently observe the shared world, select an eligible task, place a bounded number of bricks and report completion. The coordinator compares the world with the planned grid, checks face connectivity, mirror positions and brick budget. The repair loop identifies missing bricks and reopens the owning specialist's task.

This teaches goal decomposition, delegation, shared memory, dependencies, parallel work, observation, tool actions, verification and repair. It deliberately separates those concepts from a claim that every agent must be a language model.

**Optional Copilot mode is hybrid:** a real Copilot model interprets the child's brief into a template specification or a new arrangement of differently sized rectangular bricks; the same two local specialist agents execute it. Subjects are not limited to dinosaurs and spacecraft, but the result is still a bounded stylized brick design, not unrestricted text-to-3D or a guarantee of artistic fidelity. It is not three independent LLM calls. Crew Q&A remains a clearly labeled local teaching guide in either mode.

**Optional GitHub Models workflow uses three model calls:** BuildBot interprets the brief and delegates; FrameBot and DetailBot are then called concurrently to choose their actual task priority orders and explain their coordination. Every proposed order is schema-validated against the specialist's owned tasks. The local runtime enforces prerequisites regardless of priority, runs the whole mission and checks the result before producing an artifact. Loading this artifact starts an observable real-time execution, not a video.

## Three AI agents through GitHub Actions

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

The workflow makes exactly three bounded JSON requests to GitHub Models (`openai/gpt-4.1-mini` by default, up to 1,000 output tokens per request, no retries). GitHub Models model availability, account access, quotas and Actions minutes apply. There is no claimed dollar cost. Set `BRICKLAB_MODEL` for the script only to a supported GitHub Models model with the same JSON chat API.

**Verification limitation:** the three-model workflow and live Copilot provider have not been verified against their real services. Model responses, schema failures, task priority effects and full execution are tested with explicit fixtures; no mock result is shipped as a live model result. Imported mission attribution is not cryptographic proof of a model run. Run the workflow to verify account-specific access.

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

On Windows, a VS Code `copilot.exe` shim may win command resolution while the standalone CLI is missing. Check `Get-Command copilot -All` and `copilot --version`; the app also recognizes a shim reporting that the CLI is not installed. If needed, set `BRICKLAB_COPILOT_BIN` to the **absolute path of the actual standalone native executable** (`.exe` on Windows), then restart. This override is used for both status and planning without a shell, including paths with spaces. `.cmd`/`.bat` wrappers are intentionally unsupported rather than enabling shell execution of a child's brief. The private Codespace setup avoids relying on the computer's Windows executable or login. Windows executable resolution has fixture coverage only, not a live Windows run.

The server invokes `copilot -p` without shell interpolation, with an empty available-tool list, built-in MCPs disabled, and repository custom instructions disabled. No model tools are exposed. JSON validation accepts the existing templates or bounded custom brick arrangements; invalid responses fail visibly, without silently substituting a template or pretending local planning was AI.

### New subjects and mixed brick sizes

With Copilot planning selected, try a lighthouse, garden bench, castle, bridge, vehicle, animal, or your own invention. The selected world supplies the backdrop, not a subject allowlist. The model can return `model: "custom"` with a named design and an explicit brick list, including each brick's lower-corner coordinates, width, height, depth, color and structural/detail role. The app renders those dimensions and studs rather than expanding everything into identical visible cubes. FrameBot and DetailBot still execute a visible task graph; inspection, missing-brick repair, replay and saved builds use the generated design.

This removes the four-template subject restriction **for optional Copilot designs**, not consent, authentication or resource limits. Local rule-based interpretation and the separate three-model Actions workflow still use their documented templates. Custom geometry allows **1-256 bricks**, integer dimensions **1-8** per axis, occupied cells within **x/z -24..24 and y 0..32**, and at most **4,096 occupied cells**, with allowed colors and no overlaps. Connectivity is checked during inspection; missing-brick repair cannot fix a fundamentally disconnected blueprint. Invalid output fails explicitly, without automatic paid retries. Old template saves remain supported; custom saves carry their validated geometry. A novel design's semantic quality and live model reliability remain unverified.

Each plan uses **one model request**, maximum 90 seconds and 128 KB of output, with one concurrent request allowed. Default limit is **12 calls per UTC day per server process**, configurable with `BRICKLAB_DAILY_CALLS` (1-100). Restarting resets the counter; this is a demo guardrail, **not a durable FinOps or monetary budget**. Copilot service costs/quotas depend on your subscription; the app cannot determine dollars. The post's reported $0.022 castle cost is not claimed here. Local mode uses zero model calls. No gated SLM is used.

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

Architecture: `src/engine.ts` (typed specs, task graph, team loop, inspection and saves), `src/scene.ts` (Three.js original brick geometry and habitats), `src/main.ts` (workshop UI), `server.mjs` (local serving and optional bounded CLI bridge).

## Limits and privacy

Models use stylized solid bricks, not official LEGO part geometry. Face connectivity is not a clutch, collision, stability, flight or physical safety simulation. No physical construction instructions or product compatibility are promised. Browser storage stays on the device; downloads include the brief. Clearing site data clears saves. The local rule-based application works without network access after it loads; Copilot planning requires network access. No analytics, accounts, telemetry code or public sharing is included by the app.

Independent educational demo, not affiliated with or endorsed by the LEGO Group, Microsoft, or the author of the reference post. LEGO is a trademark of the LEGO Group.
