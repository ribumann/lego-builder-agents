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
4. `createPlan` converts geometry to build tasks. `Team` runs the deterministic
   coordinator, dependency verifier, two construction roles, and inspector.
   The renderer reflects the team's canonical brick state.
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

The server adapters are deliberately separate:

- Copilot invokes the standalone CLI under the server user's account. It is not
  the Copilot desktop/IDE sign-in. Copilot image requests are a separate
  Windows-only opt-in with process containment and private temporary files.
- Azure uses managed identity and a dedicated reservation gate. Public hosted
  Azure planning remains blocked pending verification. Reservations estimate
  application usage; they are not subscription budgets or bill caps.
- Local AI and OpenAI-compatible adapters exist in code but are backlog, not
  supported MVP choices. They must not be presented as release-ready paths.

Planning is explicit, bounded, and fail-closed: input size and schema are
checked, provider output is validated, and provider errors do not trigger a
template fallback. Capacity changes currently under integration are intended
to bound concurrent work rather than queue it. The final deployed limits and
quota scope must be confirmed before they are described as release behavior.

Cancellation and cleanup are critical correctness properties. A client abort,
disconnect, or 300-second deadline must abort provider work; a slot must not be
released until the associated provider/process cleanup settles. In particular,
unconfirmed process termination must not be described as clean cancellation.
Fake-provider tests cover timeout and cancellation paths, but current real
process cleanup and long-running Azure-edge transport have not been verified.
Do not treat an HTTP timeout alone as proof that backend work stopped.

## User consent and optional inputs

Image selection does not upload an image. Planning requires explicit consent;
the original image, including embedded metadata, may reach the selected
provider. The currently documented hosted and Azure modes do not accept images.

Voice input is an opt-in browser capability, separate from planning. The user
reviews and applies the transcript before it changes the brief; submitting that
brief is another explicit action. Voice quality, device support, and real
microphone behavior are not guaranteed and remain stretch validation.

## Validation and release checks

The focused code checks are `npm test` and `npm run build`; browser journeys use
`npm run test:e2e`. Tests can verify schemas, deterministic execution, and
simulated provider cleanup, but do not establish live provider access, manual
Codespaces UAT, real Azure identity/ledger behavior, successful public paid
inference, or deployment revision. Record those separately as release evidence.
