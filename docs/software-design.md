# BrickLab software design

BrickLab separates provider planning from deterministic execution. The planner
proposes geometry; the browser application validates, schedules, builds,
inspects, saves, and renders it. See [architecture and MVP boundaries](architecture.md)
for deployment and release evidence.

## Core flow

1. The user chooses a world, writes a brief, and explicitly starts planning.
   Offline template mode interprets a limited vocabulary locally. A configured
   provider receives the brief only after that action.
2. The planning endpoint validates the request and provider configuration. AI
   providers must return `model: "custom"` geometry; a template, malformed
   response, or unsupported shape fails visibly rather than falling back.
3. `validateCustomSpec` canonicalizes the spec and checks object/record counts,
   expanded brick and occupied-cell limits, bounds, colors, budget, repeats,
   and overlap. The browser validates the returned spec again before execution.
4. `createCustomPlan` validates provider input and constructs build tasks in
   one browser pass. Direct `createPlan` calls still validate custom specs.
   `Team` runs the deterministic coordinator, dependency verifier, two
   construction roles, and inspector. The renderer reflects the team's
   canonical brick state.
5. The user can damage and repair a completed build, scrub placement replay,
   append another plan, save locally, restore it, or download JSON.

## Domain behavior

`src/engine.ts` owns specs, task graphs, construction, inspection, and versioned
snapshots. BuildBot delegates ready tasks; PlanBot checks dependencies; FrameBot
and DetailBot place their assigned bricks; CheckBot compares planned identities
and face connectivity with the result. Events describe application actions,
not model reasoning. The event history is bounded; it is not an unlimited
conversation transcript.

`src/custom-design.mjs` is shared by the browser and server. Custom geometry
supports named objects and compact repeats. The hard limits are 32 objects,
256 compact records, 8,192 expanded bricks, and 262,144 occupied cells, with
bounded coordinates and dimensions. Each named object's bricks must be
face-connected at inspection. Separate objects may be apart. These checks do
not simulate physical stability or collisions.

Scene append preserves the original scene and translates only the new
contribution into a collision-free, in-bounds position. Contribution sources
and offsets are retained in the extended save. The source label is application
metadata, not cryptographic proof of a model run or attribution.

The UI stores per-world versioned snapshots in browser `localStorage` and
supports JSON export/import. Restore reconstructs canonical geometry instead
of trusting arbitrary imported brick content. Browser storage can be cleared
or unavailable; the user can download a save as a fallback. The playground's
opt-in lesson uses a separate local-storage key and does not alter workshop
saves or provider settings.

## Provider and request boundaries

There is one browser workshop and one Node server, not a separate application
core for each provider. `src/main.ts` selects an explicit planning route;
`server.mjs` wires those routes to provider-specific code. Accepted AI results
pass through `createCustomPlan` and `Team` in the browser; offline templates
use `createPlan` and the same engine without calling a model. The shared
`planning-prompt.mjs` prompt and `src/custom-design.mjs` geometry contract keep
provider output aligned with that core.

The adapters are explicit modules/routes, not a dynamic plugin system. There is
no runtime discovery or drop-in registration API: adding a provider requires
deliberate server configuration, status handling, route/UI selection, shared
spec validation, and tests. The current boundaries are:

- The implemented Copilot text route invokes the standalone CLI under the
  server user's account. It is not the Copilot desktop/IDE sign-in. Copilot
  image requests require a separate private Windows/Linux opt-in. Windows uses
  process containment and private temporary files; Linux uses private temporary
  files and best-effort process-group cleanup, with residual risk after crashes
  or from remaining processes.
- Azure uses backend managed identity; hosted visitors remain anonymous.
  Azure owner confirms merged package
  `c0060c7af8bd5a1c748a76b10e7710e35cf051e6` live with the selected Terra
  planner, and verified the package/settings and public HTTPS response. Two
  sequential guarded text-only baseline plans ran against the deployed
  Terra UI: a 99-brick spaceship in 22.332 seconds and a 97-brick hollow
  observatory/rover in 27.123 seconds, each with one adapter attempt and 3/3
  local checks. An earlier synthetic 100-brick airplane also planned in
  29.619 seconds, then built 100/100 bricks with 4/4 tasks and 3/3 checks.
  These examples verify baseline live text inference, not broad reliability,
  correction/vision behavior or user acceptance. Exact UTC windows and
  limitations are in the [architecture evidence](architecture.md#deployment-and-release-evidence).
  The adapter counts valid public submissions against a shared UTC-day limit
  of 50 by default (`BRICKLAB_AZURE_DAILY_CALLS`, integer 1-100); its Blob
  counter uses ETag conditional writes. Up to 100 provider requests may result
  from 50 submissions when each requires its one allowed invalid-design
  correction. This is a call-count control, not a billing cap. Private/local
  servers and Codespaces have no application daily quota. Azure accepts
  validated images only with explicit consent. The baseline requests do not
  validate live correction or vision behavior. The simplified design removes
  the estimated-dollar ledger, live price verification, model/version/region/
  price pins, and six-minute day-boundary blackout while retaining the
  approved native Azure
  content policy and network protections. The application call limit is not
  an invoice cap.
- Local AI and OpenAI-compatible adapters exist in code but are backlog, not
  supported MVP choices. They must not be presented as release-ready paths.
- The GitHub Models Actions workflow is a separate artifact-generation path,
  not another runtime-pluggable provider for the workshop.

Planning is explicit, bounded, and fail-closed: input size and schema are
checked, provider output is validated, and provider errors do not trigger a
template fallback. The merged release defaults to 20 total/20 per provider in
hosted mode and 8 total/2 per provider in private mode. It configures
`BRICKLAB_PLANNING_CONCURRENCY` and `BRICKLAB_PROVIDER_CONCURRENCY` from 1 to
20, keeping the provider limit no higher than total. A 20-slot hosted
deployment requires one worker and one Node process; this is not an upstream
capacity guarantee. The public deployment owner confirmed the selected
20/20 settings. These are process-local in-flight limits, not a distributed
semaphore. Slots cover request-body reading, provider work, and cleanup; full
shared capacity returns HTTP 429 rather than queuing work, with no
application-level retry or provider fallback.

Cancellation and cleanup are critical correctness properties. The backend
applies a 300-second HTTP deadline to Copilot, Azure, and compatible
planning; Local AI has a separate 90-second limit. Capacity remains held until
provider and process cleanup settle; this cannot prove remote model computation
or billing stopped. Native Windows Copilot text/image jobs use Job containment;
unconfirmed cleanup retains capacity and quarantines planning until an operator
verifies before restart. The merged PR #21 tree-equivalent test head
`0ad0b55740c99f9e59fff3511390ee0b26daf828` passed workflow run `43812538493`
(286 passed, 10 skipped). That Linux run skipped the native Windows text
timeout-isolation and host-loss quarantine tests. The deployed
package and public endpoint were verified; package/status checks are distinct
from the two live baseline requests above, which provide small text-inference
evidence only. Local Copilot authentication, manual UAT,
real Codespaces forwarding, real-microphone voice acceptance and real Ollama
inference remain unverified. The separate prompt/output latency experiment is
not shipped; its paired measurements did not demonstrate end-to-end speedup.
The reported CI covers implemented abort, cleanup-wait and quarantine paths;
a live HTTP abort cannot prove remote compute termination or billing.
The backend deadline is distinct from Azure Front Door's profile-wide origin
response timeout setting
of 16-240 seconds
([Microsoft Learn](https://learn.microsoft.com/en-us/azure/frontdoor/how-to-configure-origin#origin-response-timeout)).
That setting does not prove a hard limit on an already-streaming response;
live long-stream behavior remains unverified. No 2x planning speed or
throughput improvement has been measured.

## User consent and optional inputs

Image selection does not upload an image. Planning requires explicit consent;
the original image, including embedded metadata, may reach the selected
provider. Consented, validated Azure image support is implemented in source; live
Azure vision behavior is not verified.

Voice input is an opt-in browser capability, separate from planning. Recording
starts and stops through explicit user actions, has a 30-second bound, and the
user reviews and applies the transcript before it changes the brief; submitting
that brief is another explicit action. Automatic onset/silence handling is not
implemented. Real-microphone usability has not been accepted; voice quality
and device support remain stretch validation.

## Validation and release checks

The focused code checks are `npm test` and `npm run build`; browser journeys use
`npm run test:e2e`. Tests can verify schemas, deterministic execution, and
simulated provider cleanup, but do not establish live provider access, manual
Codespaces UAT, real Azure identity/shared-quota behavior, successful public paid
inference, or deployment revision. Record those separately as release evidence.
