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

Supported body colors: green, orange, blue, purple, red and white. Plates, eyes, cockpit, engine and accent colors are fixed. Unsupported requests do not create arbitrary geometry; the plan explains this limitation. T. rex and triceratops are intentionally excluded from the Jurassic mission because they lived in the Cretaceous.

## What is actually agentic?

**Local mode is explicitly a rule-based agent simulation, not generative AI.** BuildBot compiles the interpreted brief into tasks with prerequisites. On each simulation turn, both specialists independently observe the shared world, select an eligible task, place a bounded number of bricks and report completion. The coordinator compares the world with the planned grid, checks face connectivity, mirror positions and brick budget. The repair loop identifies missing bricks and reopens the owning specialist's task.

This teaches goal decomposition, delegation, shared memory, dependencies, parallel work, observation, tool actions, verification and repair. It deliberately separates those concepts from a claim that every agent must be a language model.

**Optional Copilot mode is hybrid:** a real Copilot model interprets the child's brief into a constrained design specification; the same two local specialist agents execute it. It is not three independent LLM calls and not open-ended text-to-3D generation. Crew Q&A remains a clearly labeled local teaching guide in either mode.

**Optional GitHub Models workflow uses three model calls:** BuildBot interprets the brief and delegates; FrameBot and DetailBot are then called concurrently to choose their actual task priority orders and explain their coordination. Every proposed order is schema-validated against the specialist's owned tasks. The local runtime enforces prerequisites regardless of priority, runs the whole mission and checks the result before producing an artifact. Loading this artifact starts an observable real-time execution, not a video.

## Three AI agents through GitHub Actions

After publishing this repository, enable GitHub Models for your account/repository if required, then run **Three AI agents build a mission** in the Actions tab. Its `models: read` permission uses the built-in `GITHUB_TOKEN` without an additional model key.

Or use your authenticated GitHub CLI:

```sh
gh workflow run ai-mission.yml --repo ribumann/bricklab \
  -f world=jurassic \
  -f brief="Build a purple brachiosaurus with a tall neck."
gh run list --repo ribumann/bricklab --workflow ai-mission.yml
gh run download RUN_ID --repo ribumann/bricklab --name ai-mission --dir ./ai-mission
```

In the game choose **Load build / AI mission**, select `ai-mission/ai-mission.json`, review the three agents' decisions in Team talk, and press **Start building**. Fast-forward, inspection and repair still work. You can also load an ordinary exported save file.

The workflow makes exactly three bounded JSON requests to GitHub Models (`openai/gpt-4.1-mini` by default, up to 1,000 output tokens per request, no retries). GitHub Models model availability, account access, quotas and Actions minutes apply. There is no claimed dollar cost. Set `BRICKLAB_MODEL` for the script only to a supported GitHub Models model with the same JSON chat API.

**Verification limitation in the implementation environment:** repository creation returned GitHub integration HTTP 403, and `models.github.ai` and the enterprise Copilot endpoint did not resolve. Therefore the three-model workflow and live Copilot provider could not be exercised against their real services here. Model responses, schema failures, task priority effects and full execution are tested with explicit fixtures; no mock result is shipped as a live model result. Imported mission attribution is not cryptographic proof of a model run. Publish to a repository with sufficient permissions and run the workflow to verify account-specific access.

## Optional real GitHub Copilot planner

Install the [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) and authenticate in your terminal:

```sh
copilot login
BRICKLAB_COPILOT=1 npm run dev
```

PowerShell:

```powershell
$env:BRICKLAB_COPILOT="1"
npm run dev
```

In the app, select **Change mode -> Use Copilot planning**. This explicitly consents to sending subsequent briefs to your authenticated Copilot model service.

The server invokes `copilot -p` without shell interpolation, with an empty available-tool list, built-in MCPs disabled, and repository custom instructions disabled. No model tools are exposed. A strict JSON schema limits the output to the supported build controls; invalid responses fail visibly, without silently pretending local planning was AI.

Each plan uses **one model request**, maximum 90 seconds and 32 KB of output, with one concurrent request allowed. Default limit is **12 calls per UTC day per server process**, configurable with `BRICKLAB_DAILY_CALLS` (1-100). Restarting resets the counter; this is a demo guardrail, **not a durable FinOps or monetary budget**. Copilot service costs/quotas depend on your subscription; the app cannot determine dollars. The post's reported $0.022 castle cost is not claimed here. Local mode uses zero model calls. No gated SLM is used.

Only brief and fixed schema text are intentionally included in the model prompt. Automatic plugin discovery and client telemetry are disabled for the spawned CLI. The CLI's account/service configuration and its own session persistence still belong to the host user; review that configuration before using it with children's input. Do not enter identifying or sensitive information. Use an adult-supervised subscription.

The planning API is localhost-only, validates Origin and a per-process request token, and does not enable CORS. This is a local educational demo, not a hardened public multi-user service. Do not expose it on a public interface. `HOST` and `PORT` configure the listener; changing HOST does not remove the API's loopback host restrictions.

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
