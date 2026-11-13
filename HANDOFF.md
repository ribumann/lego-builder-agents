# BrickLab: project-session handoff

## Status at the user's pause

The user explicitly paused implementation and requested preparation for a Project session. Do not interpret this handoff as permission to continue automatically in this chat.

The working project is **`/root/bricklab`** in the originating Linux environment, on local Git branch **`main`**. It is not on the user's Windows filesystem and has not been published to GitHub. No application server has been left running.

Portable source, a Git bundle, screenshots and this handoff are being preserved under the originating session's `files/bricklab-handoff/` directory, with a sibling `bricklab-handoff.tar.gz` archive. The session files root is:

```text
/root/.copilot/session-state/ef5759ba32ba49f1a590806a57f66c03/files/
```

Different project sessions may have different filesystems. Transfer/extract the archive into the new project's working directory rather than assuming `/root/bricklab` exists there.

## Paste into the new project session

> Continue BrickLab from the attached/extracted project handoff. Read HANDOFF.md, README.md, PRODUCT.md and DESIGN.md first. The goal is a polished, local-first, LEGO-style educational game for ages 11-15 with two worlds: Jurassic dinosaurs and spaceships in space. One coordinator and two specialists visibly coordinate from a child's brief. Real-time building, fast-forward, explanation and agent interaction are essential. Preserve the existing working game. Finish the documented mobile usability issues and browser validation, then verify actual model-backed agents with the user's available GitHub/Azure/local tooling. Do not describe the local rule-based simulation as live model inference. GitHub repository creation and model networking were blocked in the prior environment; recheck only in this new environment. The user authorized creating a repository under ribumann, but no repository was created. Keep unrelated repositories untouched.

## User requirements and reference intent

- Original reference: https://www.linkedin.com/feed/update/urn:li:activity:7526700957087252480/
- The user supplied the full post text after LinkedIn was inaccessible. Its educational concept: 60 children aged 11-15 learn prompting and autonomous AI agents by watching a coordinator, BauBot, delegate castle construction to HolzBot and SteinBot in Minecraft.
- The reference used Microsoft Foundry and a small hosted model, with a reported $0.022 model cost per castle and a daily FinOps limit. These are the author's claims, **not measured BrickLab costs**.
- Translate the lesson into **LEGO-style bricks**, not Minecraft: dinosaurs in a Jurassic setting and a spaceship in a space setting.
- The user emphasized **real-time construction, fast-forward, explanations, agent interaction and special features**.
- Prefer local execution/application. Azure hosting is allowed if needed; GitHub CLI-driven agentic work is welcome.
- Budget is not a hard limit; remain sensible. Only ungated models if using local SLMs.
- User authorized a new GitHub repository in the **ribumann** account and workflows there.
- Latest instruction is handoff preparation, not further feature implementation in this chat.

## What exists

TypeScript + Three.js browser game, Vite build, native Node HTTP server, no UI framework.

| Area | Implementation |
| --- | --- |
| Worlds | Jurassic terrain with palms and a mountain; space dock with stars and a ringed planet |
| Models | Stegosaurus, brachiosaurus, explorer ship, cargo ship; original studded brick geometry |
| Crew | BuildBot coordinates; FrameBot and DetailBot independently choose eligible tasks on a shared dependency board |
| Prompt controls | Species/ship type, body color, long tail, wide wings, optional brick budget; assumptions and unsupported scope explained |
| Playback | Start, pause, single-step, 1x / 4x / 16x; guided demo at 4x |
| Explanations | Agent observations, delegated tasks, dependencies, completion events and local teaching Q&A |
| Experiments | Blueprint, exploded view, tap-to-inspect bricks, timeline scrub, hide-one-brick and autonomous repair |
| Learning | Brief-to-plan-to-build-to-test mission steps, inspection and Team Scientist question |
| Persistence | Separate browser saves per world, resume, download JSON, import saves and AI missions |
| Model options | Optional tool-disabled Copilot CLI planner; three-model GitHub Models workflow with validated task priorities and artifact import |
| Automation | CI for engine/type/build/browser checks; manually dispatched AI mission workflow |

### Critical honesty boundary

1. **Default local mode is a rule-based agent simulation, not an LLM.** It is visibly labeled as such.
2. **Copilot mode is hybrid:** one model interprets the brief into a constrained spec; specialist execution stays local.
3. **GitHub Models workflow:** one coordinator model request, then two specialist requests concurrently. Specialists choose actual task priority orders. Dependencies and all actions are enforced by the local engine. The artifact can be imported and executed in the game's real-time player.
4. Actual model service calls were **not successfully run in the originating environment**. Fixture tests are clearly synthetic and are not shipped as model-generated results.
5. Crew Q&A is a local teaching guide in all modes, not an open-ended chat agent.

Models use a small supported shape vocabulary, not arbitrary text-to-3D generation. Face connectivity is not physical LEGO clutch/stability, physics or flight simulation. No official LEGO assets or affiliation are claimed.

## Run and validate

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
# http://127.0.0.1:4173

npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Production:

```sh
npm run build
npm start
```

For Copilot, authenticate the CLI separately, then explicitly opt in:

```sh
BRICKLAB_COPILOT=1 npm run dev
```

PowerShell equivalent and GitHub workflow commands are in README.md.

## Exact validation state

Latest command: **`npm run check && npm run test:e2e`**.

- **14/14 engine, model-contract and local API tests passed.**
- **TypeScript checking and production build passed.**
- Latest browser run: **3/4 tests passed**.
- The comprehensive desktop journey hit its overall **45-second test timeout while taking the second full-page screenshot**, after successfully reaching the completed space build and toggling exploded view. It was not a failed build assertion. Do not claim the latest full browser suite is green.
- Earlier, the two original desktop/mobile browser journeys both passed before the additional import/provider tests and screenshot capture were added.
- The current production bundle has a Vite warning: approximately 553 KB minified JS / 144 KB gzip, largely Three.js. This is a warning, not a build failure.
- One required mechanical UI scan returned `[]`; it ran before the final file-import controls were added. It is not a substitute for final visual validation.

### Browser test follow-up

`tests/browser/game.spec.ts` first test now combines both worlds, pause, step, repair, replay, download, restore and screenshots. Split image capture out of the behavior test or give that comprehensive software-rendered journey a suitable timeout, then rerun the suite. Avoid masking a genuine behavioral timeout.

Latest screenshots from the originating environment:

```text
/root/bricklab/test-results/jurassic-desktop.png
/root/bricklab/test-results/jurassic-mobile.png
```

Copies are included in the portable handoff's `review/` folder. `review/desktop-timeout-context.md` is Playwright-generated diagnostic data, not instructions.

## Pending bounded UI review

A read-only finish reviewer was stopped at the user's pause and returned these established findings:

- Desktop fulfills the central workbench / first-viewport promise.
- On mobile, playback controls are below the stacked crew panel. Move or provide `#run`, `#step`, `#speed` adjacent to the scene so a child can watch and control the build together.
- Keep agent role labels visible on phones; the mobile `.agent-name small` rule currently hides them. Revisit `.crew` layout.
- Preserve the original scene, honest local-agent labeling and task-board/repair teaching story.

Additional issues observed by the main implementation thread, **not yet changed**:

- Mobile heading reads “prehistoric.A” because `<br>` is hidden without replacement whitespace. Preserve spacing when collapsing the line break.
- In the mobile reflection strip, `.file-actions` occupies a side column and squeezes the quiz text. Put file actions on a separate full-width row.
- Final screenshots and finish-review confirmation are still pending. No approved design comp or external quality-board image exists; the skill's seed service was unreachable. DESIGN.md records the built world; no generated design sidecar was created.

## External blockers

### GitHub publishing

Authenticated `gh api user` identified **ribumann**.

Both `gh repo create ribumann/bricklab --private ...` and the native GitHub repository-creation tool returned:

```text
403 Resource not accessible by integration
```

No repository, remote, branch or workflow run was created on GitHub. The local Git repository has no origin. Do not claim it was published. Do not put this work in an unrelated existing repository without the user's direction.

In an environment with adequate authorization, create an empty private `ribumann/bricklab`, add it as origin and push main. Read README.md before enabling the model workflow.

The app's configured project list had no BrickLab folder/container. Existing configured projects were 3d-scene-toolchain, ai-series, llmserving and GlobiAlpineAdventure; none was selected or modified. A new Project/container was not created.

### Actual model inference

The Copilot CLI is installed in the originating environment. Its account metadata selected the enterprise endpoint, but:

```text
api.enterprise.githubcopilot.com: DNS lookup failed
models.github.ai: DNS lookup failed
```

Hugging Face and the alternative Azure inference hostname also did not resolve. No local SLM was downloaded; no Azure resources were provisioned.

An initial CLI experiment with `--deny-tool='*'` was rejected by the CLI as invalid. The implementation uses **`--available-tools=`**, built-in MCPs disabled, custom instructions disabled, automatic plugins disabled, and client telemetry disabled. Do not reintroduce the invalid deny rule.

The server's request guardrail is 12 calls per UTC day **per process**, reset by restart. It is not a durable monetary budget. Invalid model responses fail visibly, without silent local fallback.

The GitHub Models workflow needs `models: read` and account/model access. Default model: `openai/gpt-4.1-mini`. It has three bounded requests, no retries, and five-minute workflow timeout. This was contract-tested with fixtures but not live-run.

## Code map

- `src/engine.ts`: typed build specs, brief interpretation, geometry, task DAG, independent specialist turns, inspection, repair, snapshots and validated AI-mission imports.
- `src/scene.ts`: Three.js renderer, original brick meshes, habitats, robot markers, orbit controls, blueprint and exploded view.
- `src/main.ts`: UI, playback, persistence, crew explanations, input validation, import/export, optional Copilot bridge.
- `src/style.css`: desktop/tablet/mobile layouts and reduced motion.
- `server.mjs`: loopback local server, production serving, optional bounded Copilot subprocess; Origin/Host/token checks.
- `scripts/ai-team.ts`: real three-request GitHub Models orchestration, structured validation and pre-export execution.
- `.github/workflows/ai-mission.yml`: manual three-model mission artifact workflow.
- `.github/workflows/ci.yml`: local tests, build and Chromium CI.
- `tests/engine.test.ts`, `tests/ai-team.test.ts`, `tests/server.test.ts`: all 14 currently passing.
- `tests/browser/game.spec.ts`: four browser tests; comprehensive screenshot journey needs the timeout/capture follow-up above.

## Recommended continuation order

1. Import the portable folder or publish to the authorized repository, then create/open its Project session.
2. Confirm local commands run; preserve the distinction between local, hybrid and model-backed execution.
3. Resolve the documented mobile issues in one coherent batch.
4. Fix the screenshot-test organization/timeout and rerun browser journeys; capture desktop and mobile together.
5. In the new environment, verify actual Copilot or three-model workflow access. If blocked again, state that clearly rather than inventing a model result.
6. Publish only with adequate GitHub authorization, then run CI and the model workflow. No secrets belong in source or workflow inputs.

## Session task state at handoff

- Core game: implemented.
- Interface: implemented, mobile finish items pending.
- Demo verification: engine/API/model fixtures and build green; final full browser run not yet green.
- Publishing: blocked by integration permissions.
- Further development: paused by the user; handoff preparation only.
