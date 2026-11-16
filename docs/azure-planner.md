# Azure Foundry planner

Each Azure planning attempt sends one managed-identity-authenticated HTTP
request to the configured Azure OpenAI deployment. A completed invalid design
may cause one correction request; transport and provider failures are not
retried. It needs no Copilot CLI, client API key, retail-price lookup or
preliminary model call. The five visible game agents execute and check the
returned geometry locally, not as five model calls. This describes the source
contract; deployment evidence is separate.
For the current preview revision, verified settings, and evidence limits, see
[architecture and release status](architecture.md#deployment-and-release-evidence).
The owner recorded two text-only one-attempt baseline plans through the live
UI; neither exercised correction or vision.

## Anonymous hosted preview

Set `BRICKLAB_HOSTED=1`, production serving, the exact HTTPS
`BRICKLAB_HOSTED_ORIGIN`, and the settings below. Infrastructure defaults to
`BRICKLAB_AZURE_AI=0`; enabling the paid provider remains an explicit operation.

| Setting | Contract |
| --- | --- |
| `BRICKLAB_AZURE_AI` | Explicit opt-in `1`; otherwise Azure planning is off |
| `AZURE_OPENAI_ENDPOINT` | HTTPS `*.openai.azure.com` endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Selected hosted default `bricklab-planner-terra`; deployment must support strict JSON-schema structured output and, for images, vision |
| `AZURE_STORAGE_ACCOUNT` | Storage account holding the existing shared counter |
| `BRICKLAB_AZURE_BUDGET_CONTAINER` | Migration alias: continue the existing `daily-budget.json` blob |
| `BRICKLAB_AZURE_USAGE_CONTAINER` | Fresh-install container for `daily-usage.json`, when no migration alias is set |
| `BRICKLAB_AZURE_DAILY_CALLS` | Shared UTC-day submission limit; default **50**, integer 1-100 (legacy setting name) |
| `BRICKLAB_PLANNING_CONCURRENCY` | Hosted default **20**, integer 1-20 |
| `BRICKLAB_PROVIDER_CONCURRENCY` | Hosted default **20**, integer 1-20, not above total |

No visitor sign-in or client-hash secret is required. The server managed
identity needs Cognitive Services OpenAI User and Storage Blob Data Contributor
on the counter container. Runtime admission needs no ARM policy/model/region
verification or pricing-reader permission.

The user-selected hosted default is `gpt-6.1-terra` version `2026-10-26`,
GlobalStandard capacity 40, with the existing native content policy and
automatic upgrades disabled. Preserve its startup app setting across package
updates; the retained GPT-5.4 capacity 200 is not an automatic fallback.
The isolated deployment template and operational boundaries are documented in
[the Azure runbook](self-hosting-azure.md#selected-default-gpt-61-terra).
This is deployment configuration, not a hardcoded model requirement in the
adapter or permission to enable paid planning.

Every valid admitted user planning submission increments a shared count once using a Blob ETag
conditional write. There is no monetary ledger, estimated-cost reservation,
per-visitor limit or midnight blackout. Failed/cancelled admitted submissions remain
counted so cancellation cannot bypass the 50-submission allowance. Invalid input,
missing consent and capacity rejection do not count. Missing/corrupt state or
unresolved bounded CAS contention returns an explicit unavailable error before
inference. There are no transport retries or hidden fallback.

A completed, parsed but invalid model design gets at most **one correction**
from the same provider. The rejected JSON and precise validation feedback are
sent transiently with the original instructions; they are never logged. Both
attempts use the same held capacity slot, cancellation signal and overall
300-second deadline (90 seconds for local AI). There is no correction after
network/authentication/429/timeout failure or client cancellation. JSON parsing,
incomplete responses and content filtering also fail without replay.
The correction prompt remains capped at 32,000 bytes; a larger rejected design
fails explicitly, without truncating or fabricating geometry.

Thus **50 submissions can make up to 100 Azure model requests per UTC day**,
not 50 provider calls. A correction does not increment the count again or
refund usage, and does not reset the daily counter.
This is the maximum attributable to submissions admitted that day, not a
provider billing-window limit: in-flight work can cross UTC midnight.
The old ledger and environment names are unchanged. Each attempt retains the
existing response/token bounds and full geometry validation; no clipping,
deduplication, moved bricks or template substitution is performed.
Streaming clients receive `{"type":"correcting"}` before the second attempt.
Azure terminal results include `designCorrection` with `providerAttempts`
(0-2 adapter attempts, not proof that an upstream service received them),
`attempted` and `outcome` (`not-attempted`, `succeeded` or `failed`). Only these
fixed categories/counts are exposed, never the rejected JSON.

Keep one App Service worker and one Node server process for a whole-app
20-request upper bound: in-flight capacity is process-local, not distributed.
HTTP 429 explains that capacity is shared by all clients, not necessarily
occupied in the current tab. Provider-side limits can independently return 429.
Existing Host/Origin/session-token checks, identity, network restrictions and
WAF abuse protection remain in place.

## Preserve the existing daily count

Do not delete, reset or switch away from the existing usage blob. With the
legacy container setting, read `daily-budget.json` in place and CAS-write
`{"day":"YYYY-MM-DD","count":N}`. Existing `calls` is retained; dollar and
principal fields are omitted on the next successful count update.

A valid prior-day ledger rolls over normally. A current-day legacy ledger with
nonzero `reservedMicros` but no call count cannot reveal its actual usage and is
reported unavailable, never silently zeroed. Wait for normal UTC rollover
instead of resetting it. Fresh installs may pre-provision an old-day
`{"day":"2000-01-01","count":0}` at the chosen new counter location.

`/api/status` exposes `publicAllowance: {available,day,used,limit,remaining}`.
Unavailable state omits `day`/`used` and returns `remaining:null`. This read-only
snapshot is not a held call; another visitor may consume it.

## Images, safety and request contract

The approved native Azure content filter remains attached by Bicep to the
deployment. It blocks medium/high prompt/completion violence, hate, sexual and
self-harm content, direct jailbreak prompts and protected text/code completions.
The adapter rejects blocked prompt/completion annotations and incomplete
outputs. A custom HTTP policy header does not select this native policy.

Hosted clients use the exact Origin, `X-Bricklab-Key` from status and
`Content-Type: application/json`, optionally `Accept: application/x-ndjson`;
no visitor bearer token. POST `/api/azure-plan` accepts
`{world,brief,hollowInterior?,sceneSize?,image?,imageConsent?}` with the same
world/brief validation as text planning. `azureImages` in status reports the
enabled Azure image capability.

Images require explicit `imageConsent:true`, with
`image:{mimeType,data}` containing PNG or JPEG base64. Validation checks actual
type, at most 1,000,000 decoded bytes, dimensions at most 4096 each and at most
8 million pixels before counting or inference. The adapter sends one user
message containing text plus an `image_url` data URL. There are no Azure image
temporary files. Voice is browser-local Whisper with explicit review/apply,
not Azure Speech or a server audio upload.

## Lifecycle and output

Prompts are capped at 32,000 bytes, provider envelopes at 1 MiB and final JSON at
128,000 bytes; the request allows 12,000 completion tokens including reasoning.
Geometry and selected world are validated locally before scene execution.
Azure requests strict JSON-schema output for the selected world, supported colors,
custom model, false template flags and integer metadata, using the existing
single-design or named-object geometry shapes. Local geometry, overlap, volume
and budget checks remain authoritative; schema output is not treated as trusted.
Malformed metadata reports only failed field names, never raw model values.
Supported integer enums in shared schema definitions constrain brick dimensions
to 1-8, x/z lower corners to -64..63, y to 0..63 and straight repeat counts to
2..128. These are not unsupported JSON-schema minimum/maximum keywords.
A nonzero integer straight stride cannot fit more than 128 positions in this
world; larger scenes use multiple records, not oversized bricks.
The model must tile large bases/walls and check complete first/last extents.
Enums cannot express cross-field occupied extents, overlap or repeat endpoints;
local rejection remains mandatory. Errors identify one-based object/record
indexes and allowlisted property/reason pairs, without coordinates, colors,
names or other raw model values. No geometry is clamped, resized or invented.
Before each explicit external Plan, the browser refreshes uncached server status
and captures the current process token. A failed refresh sends no brief, and
neither a token rejection nor invalid output automatically retries inference.
Provider HTTP errors include an optional `providerDiagnostic` in the existing
JSON or NDJSON error payload: status, fixed allowlisted category/code, and
bounded numeric retry/rate-limit counts only. No raw provider message/body,
request IDs, prompts, output, credentials or arbitrary headers are returned.
Diagnostic decoding is limited to 16 KiB, 128 chunks and one second; its
`details` classification identifies missing, malformed or unavailable evidence.
These hints distinguish provider failures from the shared application counter;
they never trigger retries, capacity changes or fallback. Non-streamed provider
429 is HTTP 429; an already-started NDJSON stream carries a terminal error.
At 300 seconds, the request AbortSignal cancels the upstream transport;
disconnect cancels only that request. Capacity stays held until the adapter
settles, and a late count admission cannot start cancelled inference. Transport
cancellation does not prove that the remote service stops computing or billing.

Private local/Codespaces Azure keeps its Entra verifier and exact request
protections, without a daily counter or obsolete spend-budget opt-in. Local
capacity remains 8 total / 2 per provider. The owner verified the current
public preview package/settings and two baseline text plans through its UI;
the earlier synthetic planning/build case is also described in the architecture
notes. These examples do not establish correction/vision behavior, broad
provider reliability, or user acceptance.
