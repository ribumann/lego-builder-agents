# Organize a BrickLab lab

**Goal:** pairs can explain a dependency, a handoff, and an inspect-repair loop
after a 30-45 minute session. You need technical confidence, not coding experience.
Give participants the [student guide](student-guide.md).

## Choose a setup

| Path | Who prepares it? | What learners need |
| --- | --- | --- |
| [Local computer](#local-computer) | You or each pair | Node.js, npm, repository download and a browser; no model account for templates |
| [Private Codespaces](#private-codespaces) | Each Codespace owner, with your help | GitHub access and Codespaces allowance; separate CLI authorization only for AI |
| [Azure self-hosting](#azure-self-hosting-advanced) | An experienced Azure operator | The operator's HTTPS URL; no visitor sign-in in anonymous hosted mode |

**First lab:** prefer local offline templates on prepared computers. Choose
Codespaces when local installation is impractical and account access has been
rehearsed; choose Azure only with an operator already responsible for the host.
Plan one workspace per pair, not one shared private credential for the class.

Do not expose a local server publicly or share a Codespace's temporary app
password with the room. One learner's account is not a class-wide model license.
Check your organization's account, age, privacy and spending policies first.

## Local computer

Install **Node.js 22.12+ and npm**. Download and extract this repository, or clone
it with Git. Open a terminal in the folder containing `package.json`:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173** on that computer. Choose **Change mode ->
Use offline templates**. The initial Copilot selection does not mean AI is ready.
Use **Run an offline demo** to check the room's baseline.

For a built, non-development server, stop your own development server first:

```sh
npm run build
npm start
```

Stop your own foreground server with **Ctrl+C** after the session. Keep its
listener on loopback; this is not a recipe for classroom LAN hosting.

### Optional Copilot planning

Do this before the lab, not during the first exercise. Install the standalone
[Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli), then
authenticate **in the environment running the server**:

```sh
npm install -g @github/copilot
copilot login
```

Restart your own server with the opt-in. Bash:

```bash
BRICKLAB_COPILOT=1 npm run dev
```

Windows PowerShell additionally requires the actual standalone native executable
and a trusted Microsoft Store PowerShell 7 runtime for process containment:

```powershell
$env:BRICKLAB_COPILOT = '1'
$env:BRICKLAB_COPILOT_BIN = 'C:\path\to\standalone\copilot.exe'
npm run dev
```

Replace the example executable path. Use `Get-Command copilot -All` and
`copilot --version` to detect an IDE shim. Desktop/IDE sign-in, `gh auth`, or
an installed CLI alone does not establish CLI entitlement or model access.
An explicit **Send brief to Copilot** submission checks that path and may use
quota. No silent template fallback is made on failure.

## Private Codespaces

1. [Create a Codespace](https://codespaces.new/ribumann/lego-builder-agents).
   Review GitHub's usage terms. Startup installs dependencies, installs Copilot
   CLI 1.0.112 only if missing, builds, and starts the production server in the
   background. Existing CLI installations are checked, not replaced.
2. Allow automatic workspace tasks **only if you trust this repository**.
   The **BrickLab Codespace** terminal shows startup progress and the temporary
   app password. If that terminal is absent or tasks are disabled, open a private
   terminal and run `npm run codespace:connect`.
3. The helper offers CLI device login; default is to skip. Authorize in your
   own browser only if you want AI planning. Never paste device codes or tokens
   into chat. Login and startup send no model request.
4. In **Ports**, keep **4173 (BrickLab)** **Private**, not organization-visible.
   Open its exact HTTPS URL. GitHub authenticates the private port; BrickLab's
   additional browser prompt needs username **bricklab** and the temporary
   **app password** from your terminal, never your GitHub password.
5. Select offline templates for the first exercise. Stop the Codespace afterward
   to avoid unnecessary usage.

Reconnect preserves a running server and its password; a server restart rotates
the password. Do not start `npm run dev` or a second manual server beside the
startup worker. Existing Codespaces need a container **rebuild** to apply changed
devcontainer configuration; preserve work first. Reconnecting is not updating.

If startup fails, use:

```sh
npm run codespace:status
npm run codespace:start
npm run codespace:connect
```

`status` reports the phase and a private log location; `start` explicitly retries
startup without replacing an occupied port. Inspect logs privately. For a
shareable, bounded diagnostic, keep the server running and use a second terminal:

```sh
node scripts/diagnose-codespaces.mjs
```

Share only its fixed classifications and HTTP codes, not passwords or raw logs.
Port verification can fail even when GitHub API authentication works. Check the
selected GitHub CLI, account access and connectivity; **never make the port
public as a workaround**. Token overrides can supersede saved Copilot login:
review them privately using
[GitHub's authentication guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/troubleshoot-copilot-cli-auth).
Do not clear or switch accounts on someone else's behalf.

## Azure self-hosting (advanced)

Ask an operator to follow the [Azure self-hosting runbook](self-hosting-azure.md)
and [planner configuration](azure-planner.md). This creates billable resources
and requires identity, private storage, DNS, edge protection and deployment work.
It is not a one-click student setup. Paid planning is **off in the base template**.

Before distributing your own HTTPS URL, the operator should verify the intended
package, HTTPS and origin restrictions, allowance status, offline build, and a
separately authorized synthetic planning/build request if AI is enabled.
Anonymous visitors use the backend identity, not personal Copilot credentials.
Default public allowance is shared across everyone: 50 submissions per UTC day,
with at most two model requests per submission. It is not a billing cap.

## Rehearse before people arrive

| When | Prepare |
| --- | --- |
| A few days before | Choose the path; check device/software installation rights, GitHub/Codespaces allowances, organization policy and any authorized AI budget |
| An hour before | Rehearse on the actual path, verify the host, download an offline fallback build and prepare the student-guide link |
| On arrival | Pair learners, connect everyone, choose templates and confirm a first build before optional AI |

On the actual learner device/path, complete an offline plan, one step, a full
build, damage, repair, download and reload. Check the projector, browser graphics
and network. Keep a downloaded offline build as a fallback. If AI is part of the
session, test one synthetic brief with the account/operator's permission; a green
status alone is not proof of inference.

Count planned AI submissions across the room, not per device: for example,
15 pairs making four submissions need 60, above the default public Azure
allowance of 50 (other visitors may also consume it). Reserve optional AI for
one small comparison; keep templates as the reliable core activity.

Use diagrams and the task board when graphics are unavailable. Do not depend on
voice, image generation, large scenes or a live provider for the core lesson.
See [current evidence and gaps](architecture.md#deployment-and-release-evidence).

## Facilitate 40 minutes

| Time | Activity and prompt | Look for |
| --- | --- | --- |
| 0-5 min | Connect, select templates, run a demo. "Which decisions do you expect a team to share?" | Everyone reaches a build without AI |
| 5-12 min | Plan a purple brachiosaurus. Open **Task board** before starting. "Which job must wait?" | A named prerequisite, not just an agent name |
| 12-20 min | Single-step, run, pause, fast-forward. "Can both builders make progress?" | Actual handoffs in the board and team messages |
| 20-28 min | Finish, **Hide bricks**, **Ask team to repair**. "How did it know what was missing?" | Comparison with planned identities, then reinspection |
| 28-35 min | **Add to scene**, or try the separate playground. "What stayed unchanged?" | Existing scene preserved, or a recorded repair |
| 35-40 min | Save, exchange explanations, reflect. "Where was a model needed?" | Templates/team are deterministic; optional AI only proposes geometry |

For a five-minute demo: plan, predict one dependency, build fast, hide/repair,
then ask the last question. Skip setup and optional AI live on stage.

## Scenarios and unblocking

| Try | Teaching point or recovery |
| --- | --- |
| `Build a green stegosaurus with a long tail.` | Templates: change body color/tail; arbitrary geometry is not supported |
| `Build a white cargo spaceship with two engines.` | Switch to **Space dock** first; compare structure and finishing tasks |
| **Load local Jurassic herd** / **Load local space fleet** | Multi-object examples without model calls |
| AI only: `A small blue room with an open doorway and an orange chair.` | Select **Try a hollow interior**; cutaway reveals, but does not create, a cavity |
| Planner unavailable or slow | Cancel if appropriate; deliberately switch to offline templates or load a local example |
| HTTP 429 / allowance exhausted | Shared capacity or daily allowance is not a broken learner account; avoid repeated submissions |
| Inspection stays red after repair | Missing-brick repair cannot fix a disconnected blueprint; replace/simplify the design |
| Browser blank/slow | Use task-board text, reduce scene size, reload only after saving; no FPS guarantee |
| Server says planning is quarantined | Stop submitting; operator must verify process/attachment cleanup before restart |

Keep briefs fictional. Image consent sends the original image, including possible
metadata, to the disclosed provider. Voice is optional browser-local transcription
with a first-use model download, not a prerequisite; [voice limits](voice-integration.md)
include unverified real-microphone usability.
