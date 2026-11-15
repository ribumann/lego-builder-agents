# Azure Foundry planner

The Azure OpenAI adapter makes one managed-identity-authenticated HTTP request
to the configured Foundry model deployment. It needs no Copilot CLI, agent
runtime, client API key or preliminary model call. The five visible game agents
execute and check the returned geometry locally; they are not five model calls.

## Anonymous public deployment

Set `BRICKLAB_HOSTED=1`, production serving, the exact HTTPS
`BRICKLAB_HOSTED_ORIGIN`, and the settings below. Infrastructure defaults to
`BRICKLAB_AZURE_AI=0`: do not enable paid inference until deployment verification
is complete. Code/fixture verification is not a claim of live availability.

| Setting | Contract |
| --- | --- |
| `BRICKLAB_AZURE_AI` | Explicit opt-in `1`; otherwise Azure planning is off |
| `AZURE_OPENAI_ENDPOINT` | HTTPS `*.openai.azure.com` endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Reviewed model deployment name |
| `AZURE_OPENAI_RESOURCE_ID` | Matching Azure OpenAI account ARM ID |
| `AZURE_STORAGE_ACCOUNT` | Private reservation-state storage account |
| `BRICKLAB_AZURE_BUDGET_CONTAINER` | Private container containing `daily-budget.json` |
| `BRICKLAB_AZURE_CONTENT_FILTER_POLICY` | Verified policy actually attached to the model |
| `BRICKLAB_AZURE_DAILY_CALLS` | Shared UTC-day call limit; default **50**, integer 1-100 |
| `BRICKLAB_PLANNING_CONCURRENCY` | Hosted default **20**, integer 1-20 |
| `BRICKLAB_PROVIDER_CONCURRENCY` | Hosted default **20**, integer 1-20, not above total |

No visitor Entra sign-in or client-hash secret is required for the public site.
The host's managed identity authenticates to Azure services. Grant it
Cognitive Services OpenAI User on the dedicated account, sufficient read-only
account/deployment/policy access, and Storage Blob Data Contributor on the
reservation container. Pre-provision `daily-budget.json` with
`{"day":"2000-01-01","reservedMicros":0}`; never delete/reset it to fix a failure.

Every valid admitted request must atomically reserve a call and **$0.55 of
estimated inference spend** before inference. Global calls and the **$50/UTC-day
estimated-spend ceiling** share one Blob ETag conditional update across app
instances. Missing/corrupt/inaccessible state, failed verification or unresolved
CAS contention denies inference. Reservations are never refunded on validation
failure, provider failure, cancellation or disconnect. There are no automatic
model retries or hidden fallback.

The page displays the global remaining allowance from a bounded read-only
status operation. It is a snapshot, not a held reservation; other visitors can
consume it. Unavailable state is reported explicitly, never as unused quota.
Anonymous users have no verified per-client identity; legacy principal-limit
settings do not establish public fairness. WAF throttles, if deployed, are
best-effort abuse mitigation, not the global spend/call accounting mechanism.

Keep **one App Service worker and one Node server process** for a whole-app
20-request in-flight upper bound. Capacity is process-local, not a distributed
semaphore. Provider quotas may permit less throughput. Capacity exhaustion
returns explicit shared-server HTTP 429 without queuing or reserving a call.
Front Door is optional for the model API; an existing edge/WAF must be verified
with the actual NDJSON transport rather than assumed reliable.

## Model, safety and monetary limits

The current monetary verifier pins Sweden Central, OpenAI GPT-5.4 version
`2026-03-05`, DataZoneStandard and identity-only account authentication.
It checks model deployment configuration and requires `properties.raiPolicyName`
to match the configured policy, then reads that policy's blocking filters.
An existing but unattached custom policy is insufficient. A different/default
attached policy is not assumed unfiltered, but is rejected unless it matches
the reviewed configuration; do not silently relabel `Microsoft.DefaultV2`.
The Bicep deployment explicitly attaches `bricklab-public-safe`.

The reviewed policy blocks medium/high prompt/completion violence, hate,
sexual and self-harm content, direct jailbreak prompts and protected text/code
completions. Filtered/incomplete outputs are rejected, not retried. Azure image
requests are rejected before reservation/inference; text-only checks do not
establish image safety.

Retail verification permits up to $2.75 input and $16.50 output per million
tokens for the pinned deployment. The reservation assumes 128,000 input tokens
and 12,000 completion tokens, including reasoning, despite the smaller actual
prompt. Contract pricing, billing timing, later configuration changes and
other callers can differ. This is **not a hard cap on the Azure bill**:
hosting, storage, network, tax and other usage are excluded. Subscription-wide
governance and spend analysis remain the operator's responsibility.

## Lifecycle and output

The adapter caps prompts at 32,000 bytes, provider envelopes at 1 MiB and final
JSON at 128,000 bytes, requesting at most 12,000 completion tokens. Geometry and
selected world are validated locally before a scene can start.

At 300 seconds the request AbortSignal cancels the real upstream transport;
client disconnect cancels only that request. Its slot stays held until the
adapter settles. Late completion cannot create a scene or refund a reservation.
Transport cancellation does not prove that the remote service stops computing
or billing. Calls are denied within six minutes of UTC midnight to avoid
unaccounted cross-day work. Actual proxy delivery/timeouts need live validation.

## Local servers and private Codespaces

There is **no application daily call or client cap** locally or in Codespaces,
including obsolete `BRICKLAB_DAILY_CALLS`. Private Azure retains its separately
configured Entra verifier/MSAL flow and exact Host/Origin/session-token checks.
Configure `BRICKLAB_ENTRA_TENANT_ID`, `BRICKLAB_ENTRA_API_CLIENT_ID`,
`BRICKLAB_ENTRA_SPA_CLIENT_ID`, scope and role for that private option.

Ordinary private Azure does not contact quota storage. Explicit
`BRICKLAB_AZURE_BUDGET=1` retains atomic estimated-spend protection without
daily request/principal caps. Local/Codespace capacity defaults remain 8 total
and 2 per provider. No real tenant, paid inference, live Azure deployment or
parked Ollama/BYO provider was exercised by these fixture tests.
