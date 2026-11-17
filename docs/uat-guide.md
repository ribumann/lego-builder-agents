# BrickLab user acceptance guide

Use this manual to **perform and record** acceptance, not as evidence that UAT
already passed. Allow 30-45 minutes for the offline lab; schedule optional
provider and infrastructure checks separately.

[Baseline and evidence](#baseline-and-evidence) |
[Local startup](#local-startup) |
[Offline workshop](#offline-workshop) |
[Private Codespaces](#private-codespaces) |
[Compatible AI](#compatible-ai) |
[Azure scrap](#azure-scrap) |
[Deployment automation](#deployment-automation) |
[Results record](#results-record)

## Baseline and evidence

**Snapshot: 2026-11-17.** The combined application baseline is
`15ea622b2414b0e499af2724d73cf1a77ba7924c`, local branch
`ribumann-bring-your-own-llm` only, with no PR. Main is
`1acde76be89a5055761d8d26b309e2ef6b3faf09`. This guide is a later,
documentation-only commit. Do not treat a fresh clone of main as the combined
build, or assume this local branch can already be selected in Codespaces.

| Target | Current evidence, not acceptance |
| --- | --- |
| Combined local baseline | Automated checks/build and fake-provider tests; an isolated production-pruned ZIP was built on Windows/Node 26 and smoke-tested with all providers off. This is not the documented Linux/Node 24 release environment or human UAT. |
| Private Codespaces and BYO | Source and fake-provider/proxy coverage; real combined-build forwarding, authorization and inference remain unverified. |
| Existing no-domain Azure scrap | Coordinator reports automation revision `8857074f50742dda259e8877977f0b65da8c332d`, providers off, IP-restricted ingress and private-network storage. It is **not** the combined baseline. Confirm its current URL/configuration with its operator. |
| Historical hosted Azure | Separate older AI-enabled release. [Gallery provenance](screenshots.md#hosted-azure-image-plan) includes a real 2,083-brick image-guided station, not proof that the combined revision or scrap has that capability deployed. |
| Actions deployment | Workflow exists locally; identity, environment, runner and dispatch have not been verified. No Actions run is implied. |

Roles: **operator** owns processes, accounts, configuration and costs;
**tester** uses the browser; **Azure/GitHub administrator** authorizes and
configures infrastructure/identity. One person may fill multiple roles.
For **every numbered ID below**, record **Pass**, **Fail** (actual behavior
differs) or **Blocked** (prerequisite/permission unavailable). Capture the
observable result, not just a tick. All tests start **Not run**.
For provider tests, a clear error can pass an error-reporting check but does
**not** pass inference/build acceptance. Record missing access as Blocked and
an approved, configured path returning incorrect behavior as Fail.

Use synthetic briefs and a PNG/JPEG you may share, without people or private
metadata. Evidence must exclude passwords, bearer/request tokens, device codes,
keys, raw app settings, raw status JSON (it includes a session token), HAR files
and private logs. Save only IDs, revision, safe counts, timings, fixed error
categories and redacted screenshots. Downloads include the brief.

## Local startup

Prerequisites: operator access to the existing worktree, Git, PowerShell,
Node.js 22.12+ and npm, a browser with WebGL, and a free loopback port. Choose English under **Language**
to match these control names. Do not assume an old tab or canvas is live:
the previously used port 52179 refused a connection when last checked.

**L1 - Operator: identify the build and an unused port.** In a new PowerShell
terminal on the current Windows machine:

```powershell
Set-Location 'C:\Users\ribumann\OneDrive - Microsoft\Code Projects\copilot-worktrees\lego-builder-agents\ribumann-glowing-umbrella'
git rev-parse HEAD
git status --short
git merge-base --is-ancestor 15ea622b2414b0e499af2724d73cf1a77ba7924c HEAD
if ($LASTEXITCODE) { throw 'Combined baseline is not included' }
node --version
npm --version
$Port = 4173
if (Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $Port) {
  throw 'Port occupied: identify its owner or choose another unused port'
}
```

Expected: exact baseline or its approved documentation-only descendant, known
worktree changes, suitable Node, no listener. Record actual HEAD; do not checkout,
reset, clean, kill a listener or replace someone else's preview. If dependencies
are absent, run `npm ci` in an **isolated clean local clone**, not over another
person's installation; obtain the source from this local repository until
publication is authorized.

**L2 - Operator: start offline production serving.** In that same new terminal:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = "$Port"
$env:BRICKLAB_HOSTED = '0'
$env:BRICKLAB_CODESPACES = '0'
$env:BRICKLAB_COPILOT = '0'
$env:BRICKLAB_COPILOT_IMAGES = '0'
$env:BRICKLAB_AZURE_AI = '0'
$env:BRICKLAB_COMPATIBLE_AI = '0'
$env:BRICKLAB_COMPATIBLE_VISION = '0'
npm run build
if ($LASTEXITCODE) { throw 'Build failed; do not start' }
npm start
```

Expected: foreground listener on the selected loopback port. In a second
terminal verify only nonsecret fields (use the same selected port):

```powershell
$Base = 'http://127.0.0.1:4173'
(Invoke-WebRequest "$Base/").StatusCode
$Status = Invoke-RestMethod "$Base/api/status"
$Status | Select-Object hosted, copilot, calls
$Status.planner.state
$Status.azurePlanner.enabled
$Status.compatiblePlanner.enabled
```

Expected: page 200, hosted/Copilot/Azure/Compatible false, planner `off`, calls
zero. Do not print all of `$Status`. Open `$Base` in the browser. Connection
refused means no ready server: check your terminal/address, not an old canvas.
An ordinary local build need not contain `/release.json`; packaged releases do.
Only stop **this foreground server you started**, using Ctrl+C when finished.

**L3 - Operator: later published copies.** This step is **Blocked** until the
owner publishes an approved ref containing the baseline. Obtain its exact
remote ref/commit from the owner, clone that ref into a new directory, run
`git rev-parse HEAD` and the ancestor check from L1, and record both. For the
exact baseline, checkout `15ea622b2414b0e499af2724d73cf1a77ba7924c` detached
**only in that new clone**, if available. A descendant can differ: review its
diff before calling results equivalent. For Codespaces select the verified
published ref; do not invent a remote branch or expose private source to enable it.

## Offline workshop

Prerequisite: L2 or another verified target is reachable. These tests are also
the browser acceptance set for Codespaces/Azure; record the target each time.
Do not erase existing browser saves. Export wanted work first, or use a
dedicated browser profile on the same origin.

| ID / who | Step-by-step action | Observable acceptance |
| --- | --- | --- |
| W1 / Tester | Open **Change mode -> Use offline templates**. Choose **Jurassic valley**. Select **Run an offline demo**. | A deterministic build progresses and completes without provider submission; inspection passes. Initial translucent bricks alone are not completion. |
| W2 / Tester | Enter `Build a purple brachiosaurus with a tall neck.`; **Make a plan**. Open **Task board**. Name a prerequisite, use **Build one step**, then **Start building**, pause, resume and cycle speed through 1x/4x/16x. | Task state and placed-brick count advance consistently; pause stops automatic placement; completion reaches planned count and template inspection passes. No five-model-call claim. |
| W3 / Tester | Open **Extended agent insights** and click a crew member or **Why wait?**. Compare next eligible work, shared memory and recorded actions with the board. | Explanations reflect actual deterministic tasks; insights do not change the build or send a model request. Bounded history is not hidden reasoning. |
| W4 / Tester | Finish; choose **Hide bricks**, read the failed inspection, then **Ask team to repair** and run to completion. | About a third disappear; original builder tasks reopen; planned identities/count return and inspection passes. Repair does not invent a new blueprint. |
| W5 / Tester | **Add to scene**, request a green stegosaurus with a long tail, plan and finish. Then test **Replace scene** with a supported template after saving. | Addition retains the original with a disclosed placement offset; replacement replaces it. Invalid/no-room additions must leave existing scene intact, not silently lose work. |
| W6 / Tester | Save via **Save build file**. Reload this origin, check the scene, switch world to **Space dock**, build a white cargo ship, and switch back. Load the exported JSON using **Load build / AI mission**. | Per-world save restores geometry/progress; export/import reproduces the saved build. Browser storage errors are visible; private/cleared storage may block persistence. Downloaded JSON is not a sharing URL or proof of provider use. |
| W7 / Tester | Load **Load local Jurassic herd**, then **Load local space fleet**, preserving wanted work first. Complete/inspect each; use replay slider and **Live**. Toggle blueprint, exploded view, camera flip/reset and cutaway. | Named multi-object examples build offline; replay returns to live; view controls do not damage geometry. Cutaway reveals sections, not a newly created cavity. |
| W8 / Tester | Capture a browser/OS screenshot of the completed build and a separate **Task board** view. Compare with the [gallery](screenshots.md), not pixel-for-pixel. | Counts, visible rows and captions describe the actual state. There is no in-app screenshot/export-PNG button. Do not label an offline image AI-generated or imply Azure deployment. |
| W9 / Tester | **Choose image**: try a synthetic PNG/JPEG of at most 1,000,000 bytes, then remove it via **Remove image**. Try a larger file or unsupported format. Read **Media & privacy**. | Selection alone sends nothing. Offline templates cannot use the image; invalid files show an error; removal clears selection/consent. Voice is unavailable, with typed input supported. |
| W10 / Tester | Open **The agent playground**; use **One step** or **Build a new robot**. Select an agent and a recorded tool call, then **Return to live build**. | Six-role simulation pauses for inspection; actual misplaced eye is found, moved and reinspected; historical tool selection shows that action's state. Workshop scene/save/provider remain unchanged. |
| W11 / Tester | In playground try **Missing brick** and **Impossible plan**. Use **Build other parts first**, **Supply the missing brick**, or **Remove the circular dependency** when offered, then step again. After a successful robot repair, **Remember this repair**, start a new robot, then **Forget saved lesson** if it is your test lesson. | Stock blocks its task, not independent work; a cycle prevents placement until reverified. Opt-in remembered rule avoids the later eye repair; forgetting affects future builds only. Do not delete another tester's lesson. |

## Private Codespaces

Prerequisites: Codespace owner, trusted **published** combined revision (L3),
GitHub access/allowance and private-port access. **Currently blocked for a fresh
combined-build Codespace until publication.** Do not substitute main and mark
the combined build accepted. Usage can incur charges.

| ID / who | Step-by-step action | Observable acceptance |
| --- | --- | --- |
| C1 / Owner | Create/resume your own Codespace on the verified ref. Trust automatic tasks only after reviewing the repository. Wait for **BrickLab Codespace** startup; run `git rev-parse HEAD`, `npm run codespace:status`, then `npm run codespace:connect` if needed. | Helper installs/builds/starts production serving; connect reuses a running session. Skip device login for offline UAT. No second `npm run dev` or manual server beside it. Reconnect does not update code; changed devcontainer configuration needs an owner-controlled rebuild after preserving work. |
| C2 / Owner + Tester | In **Ports**, keep 4173 **Private**. Open its exact HTTPS URL from connect. Authenticate to GitHub's private port, then use username `bricklab` and the terminal's temporary **app password**. | Page loads only through the intended private path; use neither GitHub password nor shared class credentials in BrickLab. Server restart rotates app password. Complete W1-W11 here. |
| C3 / Owner | If denied, run `npm run codespace:status`; if startup failed, explicitly retry `npm run codespace:start`, then connect. Optionally run `node scripts/diagnose-codespaces.mjs` while the server runs. | Record only fixed phase/error classifications/status codes. An occupied port is not replaced. Port verification/gh access failure stays blocked; never switch to public or organization visibility. |
| C4 / Owner + Tester, separately approved AI | In connect, authorize the CLI device flow in your own browser only after budget/account approval. Use **Change mode -> Retry status -> Use Copilot planning**. Choose Space dock, size 100, type `A small blue satellite with two solar wings.`, then **Send brief to Copilot** once. | No inference on load/login/mode choice. Explicit submission discloses GitHub destination and quota use, returns custom geometry or a clear error without silent templates. Complete build/inspection; record elapsed time, task/brick counts and appearance separately. Installed CLI/green readiness alone is not model access. |
| C5 / Owner + Tester, separately approved images | Owner must supply `BRICKLAB_COPILOT_IMAGES=1` to the server startup environment (helper already enables `BRICKLAB_COPILOT=1`). If no helper is running, use the commands below. If already running without it, mark blocked until an owner-controlled restart; reconnect cannot apply new environment. Choose a permitted image, read disclosure, try planning without consent, then consent and explicitly submit once. | Status advertises image support; unconsented request is stopped before sending. Consented image and original metadata go to GitHub; output may be valid but visually inaccurate. Consent clears after use and mode change. Verify successful build and save/reload; do not claim a particular model's vision compatibility. |

For C5, **only before the startup worker exists**, in the Codespace terminal:

```bash
export BRICKLAB_COPILOT_IMAGES=1
npm run codespace:start
npm run codespace:connect
```

**C6 - Owner: cleanup acceptance.** On an approved synthetic request, try
**Abort planning** while it is still running; the current scene must not be
replaced by a late result. Do not submit a second request to force cancellation.
Normal completion/cancellation attempts cleanup of owner-only, request-owned
temporary attachments after managed process exit. Ask the operator to inspect
only that request's files/processes privately; do not claim UI success proves
deletion. If cleanup is unconfirmed, planning locks/quarantines: stop submitting
and require operator verification before restart. Do not deliberately crash the
helper as routine UAT. Crashes/escaped descendants can leave files; CLI sessions
may persist locally or sync to GitHub. Preserve wanted files, then separately
authorize deletion of disposable Codespaces; stopping/closing does not delete
storage or synced data. See [image boundaries](lab-organizer.md#optional-private-copilot-images).

## Compatible AI

Prerequisites: operator-approved endpoint/model/budget/data handling, a private
loopback server and operator-managed token if required. No participant enters
provider credentials. **Real provider compatibility is unverified**; mark these
tests blocked until the operator supplies/approves a destination.

Supported contract is the full OpenAI-compatible **chat-completions** URL:
non-streaming chat, `max_tokens: 12000`, `response_format: {"type":"json_object"}`,
one completed assistant message containing JSON geometry. HTTPS is required
except literal `127.0.0.1` or `[::1]` HTTP. It is not generic Responses/Anthropic
support, a base URL, Ollama mode or a promise that any named model works.

**B1 - Operator: configure your own private test server.** Use L1/L2's free
loopback port, build and providers-off settings. Stop only your own L2
foreground server before relaunching it. Replace the nonsecret placeholders:

```powershell
$env:BRICKLAB_COMPATIBLE_AI = '1'
$env:BRICKLAB_COMPATIBLE_ENDPOINT = 'https://provider.example/v1/chat/completions'
$env:BRICKLAB_COMPATIBLE_MODEL = 'operator-verified-model-id'
$env:BRICKLAB_COMPATIBLE_VISION = '0'
# Prefer a private launcher/secret store that injects the token.
# If an interactive token is required, do not type it into shell history:
$Token = Read-Host 'Operator provider token (not a participant credential)' -AsSecureString
try {
  $env:BRICKLAB_COMPATIBLE_API_KEY = [Net.NetworkCredential]::new('', $Token).Password
  npm start
} finally {
  Remove-Item Env:\BRICKLAB_COMPATIBLE_API_KEY -ErrorAction SilentlyContinue
  $Token.Dispose()
}
```

Omit the key prompt/assignment only for an endpoint that does not require a bearer
token; ensure no old key is inherited. The running process holds the plaintext
key in memory/environment; secure input is not a secret vault. Never use an
endpoint URL containing credentials, put keys in tracked files/browser settings,
or print the environment. Expected: configuration succeeds, public hosted mode
remains off, binding remains loopback. Missing/invalid configuration fails
explicitly. Do not loosen binding to `0.0.0.0`.

| ID / who | Step-by-step action | Observable acceptance |
| --- | --- | --- |
| B2 / Tester | **Change mode -> Retry status**; verify **Provider destination** is the operator-approved service origin; **Use Compatible AI**. Wait without submitting. | Origin is disclosed (path/token are not), no key entry in browser, no provider call on selection/status. Configuration is not proof of working authentication/model. |
| B3 / Tester, approved AI | Space dock, size 100; type `A small blue satellite with two solar wings.`; **Plan with Compatible AI** once. Build, inspect, export/reload. Optionally request **Try a hollow interior** with a small open room, then inspect cutaway. | Custom geometry with compatible-source attribution or a clear error; previous scene survives failure. Image/interior/size preferences are not guarantees. At most one geometry correction after the initial model call, within one 300-second deadline; no transport retry or silent template fallback. |
| B4 / Operator + Tester, approved images | Only for a verified image-capable endpoint/model, restart your own server with `BRICKLAB_COMPATIBLE_VISION=1`. Choose a permitted PNG/JPEG; test consent gate, then consent and submit once. Switch mode and verify consent resets. | Original image/metadata go only on explicit consent/submission to disclosed compatible destination. Flag is an operator assertion, not a capability probe. Without vision opt-in image planning is unavailable; text remains testable after removing image. |
| B5 / Tester + Operator | On an approved running request use **Abort planning**. On a safe planned server restart, leave a browser tab open, then **Retry status** before another separately approved submission. | Cancel leaves scene intact; stale tab refreshes server status/request token before submission. A rejected request surfaces an error, not automatic replay. Changed compatible destination requires review/resubmission; renew image consent. If timing is not reproducible, mark cancellation blocked, not passed. |

BYO in Codespaces uses the same server environment plus the private proxy/app
authentication in C1-C3. Set configuration **before** helper startup; a running
helper is not reconfigured by export/connect. Do not enter credentials on the
participant browser, publish a port, or assume the fake-provider proxy tests
prove live forwarding. Operator responsibility includes charges, provider
retention and private host access. Choose templates explicitly if AI is blocked.

## Azure scrap

Prerequisites: Azure operator supplies the **existing** exact standard hostname,
approved browser egress and expected revision. Do not provision to take this
test. The current scrap is reported as automation-only `8857074...`, not
`15ea622...`; tests here establish only the served release you record.

| ID / who | Step-by-step action | Observable acceptance |
| --- | --- | --- |
| A1 / Operator | Confirm the exact `https://<app>.azurewebsites.net` origin, selected package/revision, allowed IPv4 /32 address(es), SCM deny-all, providers off and storage profile using authorized private configuration review. Do not export app settings as evidence. | Standard HTTPS certificate, no custom domain/Front Door required; app default deny, no public containers/shared keys. Record only nonsecret results. Existing scrap uses private-network storage; do not substitute a public endpoint to make access work. |
| A2 / Tester on allowed network | Open `/`, then `/release.json` and confirm `revision` equals the operator's expected package revision; inspect only sanitized fields from `/api/status`. Check referenced JS/CSS loads in browser developer tools. | HTTPS/page/assets 200, exact revision, `hosted: true`, Azure/compatible/Copilot off. The UI can initially offer Azure while server says it is off: explicitly select templates. A page response alone is not release acceptance. |
| A3 / Tester + Operator | If page returns 403, record URL host, UTC time and status; give privately to operator. Operator checks the destination-specific egress (`x-ms-forbidden-ip` if present), VPN/proxy/IPv6 behavior and approved rule. If authorized, verify a disallowed network and SCM remain denied. | Wrong egress is intentional deny; **Blocked** for offline browser UAT until the right network is available. Do not disable restrictions, change storage, make SCM public or use `0.0.0.0/0`. Any allowlist update is a separate authorized operation, not a UAT workaround. |
| A4 / Tester | Use W1-W11 on the accepted scrap origin; record screenshot captions with actual revision and offline source. Identify absent/different controls against that older release, marking those checks Blocked for combined-build acceptance. | Deterministic workshop/playground/persistence works without AI. Never label this as a test of the combined BYO/voice/gallery release or the historical AI host; older UI differences do not prove combined-code regressions. |
| A5 / Operator | At close, record the retained resource owner, expiry and separately authorized cleanup decision. | B1 plan bills while it exists, even if stopped; storage, Private Link/internal DNS and possibly a temporary uploader also cost money. No automatic teardown or daily-limit spending cap. Resource-group deletion requires separate authorization and preservation of wanted data. |

Read-only PowerShell example for A2; replace placeholders and keep status private:

```powershell
$Origin = 'https://<operator-supplied-app>.azurewebsites.net'
$ExpectedRevision = '<operator-confirmed-full-40-character-sha>'
(Invoke-WebRequest "$Origin/").StatusCode
$Release = Invoke-RestMethod "$Origin/release.json"
if ($Release.revision -ne $ExpectedRevision) { throw 'Wrong served revision' }
$Status = Invoke-RestMethod "$Origin/api/status"
$Status | Select-Object hosted, copilot, calls
$Status.azurePlanner.enabled
$Status.compatiblePlanner.enabled
```

**A6 - Separately approved historical Azure AI test.** Only on the distinct
AI-enabled host the operator identifies, with current budget/allowance and
permission: read disclosure, run one small synthetic text brief, then one
separately consented synthetic image brief if approved. Use **Plan with Azure
Foundry** (the disclosure may shorten this to Plan), build and inspect; record
each result/revision/latency. Anonymous hosted planning uses backend identity,
not the visitor's Copilot credentials. Allowance is shared (default 50 daily
submissions, up to two model calls each), not a cost cap. 429 is a stop signal,
not permission to retry repeatedly. Historical station screenshots do not prove
new acceptance, latest deployment, cleanup or broad model/image reliability.
If the current host/revision/permission cannot be confirmed, **Blocked**.

## Deployment automation

This section is a manual for a **future separately authorized deployment UAT**,
not permission to deploy now. Currently **Blocked** for Actions: the combined
workflow is local only, main is older, and administrator prerequisites are
unverified. Do not dispatch another branch or bypass the main-only checks.
Use the [full runbook](self-hosting-azure.md#powershell-and-manual-github-actions-no-custom-domain)
for exact target parameters and deployment commands; do not improvise cloud setup.

| ID / who | Step-by-step action | Observable acceptance |
| --- | --- | --- |
| D1 / Administrator | Verify an approved reviewed release on protected main, explicit tenant/subscription/group, scoped Azure permissions, stable egress and app/Blob reachability. Verify PowerShell 7.4+, Azure CLI/Bicep, Node 24, Python 3.12+, npm/Git on a trusted Linux build path. | Missing publication, authorization, network, tools or budget means **Blocked**, not configure-and-proceed implicitly. No real provider needed. |
| D2 / Administrator | For Actions, verify the `azure-deployment` environment requires human approval and protected main; OIDC federated subject is `repo:<owner>/<repo>:environment:azure-deployment`, audience `api://AzureADTokenExchange`. Confirm the runbook's environment variables and a dedicated trusted runner labeled `self-hosted`, `linux`, `bricklab-azure`. | No Azure client secret/publishing profile; only deploy job has `id-token: write`. Fixed allowed egress/private DNS and data-plane reachability exist. Never run untrusted PRs on that runner. No assumption that these are configured today. |
| D3 / Operator | Rehearse offline with `pwsh -NoProfile -File tests\deploy-azure.tests.ps1` and `python -B -m unittest discover -s tests -p test_package_azure_release.py`. In an isolated clean checkout: `npm ci`, `npm run check`, `npm prune --omit=dev`; run `python scripts\package_azure_release.py --revision <full-HEAD-sha> --output <new-absolute-ZIP-outside-checkout>`. | Tests are mocks/local only. Real ZIP has the exact revision, per-file hashes, browser assets and production dependency closure. Existing artifact cannot be overwritten. MSAL Browser can remain transitively required by Azure Identity; do not delete dependencies by name. Archive is trusted deployable code, not acceptance evidence by itself. |
| D4 / Provisioning operator, new target only | After separate cost/infrastructure approval, follow runbook **Provision** for a new dedicated group. Use `-PrivateStorage` where policy requires it; verify outputs before any Deploy. For Actions later, choose **Azure installation or update -> Provision** on reviewed main and obtain environment approval. | Creates isolated app/storage/network/identity, **no model**, paid planning off; selected-network versus private-endpoint profile matches approval. Provision is resume-only bootstrap, not ongoing reconciliation. A failure can leave billable resources; inspect stage instead of rerunning blindly. |
| D5 / Release operator, first package only | Prevent submissions, drain active requests and hold exclusive deployment ownership. Follow runbook Deploy with `-InitializeNewInstallation -MaintenanceConfirmed`; later Actions uses **Deploy**, initialize checked, maintenance confirmed. | Conditional ledger initialization only if absent; immutable blob named by revision/hash, managed-identity package read, exact origin. A selected package/restart is not browser acceptance: perform A1-A4. |
| D6 / Release operator, update only | Use existing installation outputs and a new reviewed artifact. Run Deploy **without** `-InitializeNewInstallation`; Actions initialize unchecked. Maintain the same exclusive maintenance discipline. | Updates preserve provider/model opt-ins, allowances, ledger aliases and unrelated settings; no reprovision, inference or ledger reset. Repeating an already selected identical artifact does not restart. Validate served revision/assets/status and offline app again; record previous immutable package for separately authorized rollback. |

Only manual `workflow_dispatch` exists, not push/PR/scheduled deployment.
Package tests run on the unprivileged GitHub-hosted runner; deploy runs behind
the environment on the private runner. Workflow concurrency does not lock out
local operators. No GitHub setting change or workflow dispatch was performed
while writing this guide. A reported live test of automation revision `8857074`
does not validate the combined package or future Actions OIDC connectivity.

## Results record

Copy this for each target; add one row for **every** test ID attempted or blocked.
Do not mark optional provider/infrastructure tests passed because offline works.

```text
Date/time UTC:
Tester / operator role:
Target: local | Codespaces | Azure scrap | historical Azure | automation
Actual source HEAD / served revision:
Expected baseline and any differences:
Browser / OS / Node (if applicable):
Origin (no credentials/query tokens):
Approved provider/image scope and spending owner (or providers OFF):

ID | Not run / Pass / Fail / Blocked | Steps reached / actual result
   | Safe evidence filename, counts, timing or fixed error category

Remaining blockers and responsible role:
Acceptance decision and scope (offline only / optional paths explicitly listed):
Saved work location (private); owned process stopped / retained intentionally:
Cloud resource owner, expiry and separately authorized cleanup status:
```

Source references for operators: [setup and provider controls](lab-organizer.md),
[student exercises](student-guide.md), [playground](agent-playground.md),
[Azure runbook](self-hosting-azure.md), [release evidence](architecture.md#deployment-and-release-evidence).
