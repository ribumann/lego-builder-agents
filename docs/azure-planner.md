# Azure OpenAI planner adapter

`azure-planner.mjs` is a separately configured adapter, not a deployment. It uses the
hosting resource's managed identity and requires `AZURE_OPENAI_ENDPOINT` (an
HTTPS `*.openai.azure.com` resource endpoint) and `AZURE_OPENAI_DEPLOYMENT`.
Grant that identity the Cognitive Services OpenAI User role on its dedicated
Azure OpenAI resource. No key or developer credentials are used.

The caller supplies the shared planning prompt and an AbortSignal to
`planAzure({ prompt, signal })`, then validates the returned custom design and
selected world. The adapter sends one request, caps output tokens and response
size, rejects incomplete responses, and invokes inference only once without a
fallback. The identity SDK may retry its own token acquisition requests.

Do not enable it on a public service until real user authentication, exact host
and origin checks, shared abuse/spend limits, safe content filtering, transport
timeouts and cancellation are configured and verified. The Entra route/client
code is implemented in the release worktree but has not been validated against
a real tenant. Configuration alone does not establish model access or
successful generation.

The optional `BRICKLAB_AZURE_AI=1` integration is restricted to the existing
local or private-Codespace API boundaries and requires production serving plus
the usage gate below. `BRICKLAB_HOSTED=1` serves the anonymous lab separately:
it disables every planner, including Azure, pending verified public edge
protections. Never copy a personal Copilot credential into a public host.
For a separately hosted lab, set `BRICKLAB_HOSTED_ORIGIN` to its exact HTTPS
DNS origin (for example `https://lab.example.org`), with no port, path or
trailing slash. The default is `https://bricklab.liberatetheinnerchild.net`.
This configures host/origin checks only; it does not verify a trusted edge.

The private Azure route now has a fail-closed Entra access-token verifier and
the browser obtains a delegated token with MSAL only after the user explicitly
starts Azure planning. The API checks the signature and v2 issuer, exact API
audience, tenant, SPA client (`azp`), delegated scope and app role. Configure
the API and SPA registrations and assign a user/group before enabling Azure.
The anonymous static/offline app remains separate. These code paths have not
been validated against a real tenant or enabled on the hosted app; the hosted
paid-provider startup block remains in place.

The local gate below counts requests; it does **not** enforce an inference
spending cap. Public planning must remain disabled until the hosted monetary
budget and real user authentication are configured and verified. Neither the
inference reservation nor Azure budget alerts are a hard cap on the Azure bill.

`azure-usage.mjs` provides an independent daily request reservation gate. Set up
a private Blob container and **pre-provision** `daily-usage.json` with
`{"day":"2000-01-01","count":0}`; give the host identity Storage Blob Data
Contributor on that container. Construct `createAzureUsageGate({ account,
container, limit })`, then call `reserve({ signal })` after authenticating and
validating the request but before starting inference. The default cap is 12
calls per UTC day; operators may choose 1–100. It is a request limit, not a
monetary guarantee. Each successful reservation remains charged to the limit
even if generation fails or is cancelled. Missing, invalid or inaccessible
state denies calls. Never delete or reset the state to troubleshoot.
For the GPT-5.4 Data Zone model, `azure-budget.mjs` provides an atomic
estimated-inference-cost, request-count and per-client reservation gate.
Hosted planning remains blocked; the gate can be exercised on the private
server by setting
`BRICKLAB_AZURE_BUDGET=1` and `BRICKLAB_AZURE_BUDGET_CONTAINER` alongside the
Azure adapter settings. This selects the monetary gate instead of the request
count gate, with no fallback. Pre-provision `daily-budget.json`
in a private Blob container with `{"day":"2000-01-01","reservedMicros":0}`
and grant the host identity Storage Blob Data Contributor on that container.
Set `AZURE_OPENAI_RESOURCE_ID` to the Azure OpenAI account's ARM resource ID.
The host identity also needs read access to that account, deployment and
content-filter policy. The server validates the request and acquires its
per-process in-flight slot before reserving budget and starting inference.
Exhaustion, a UTC day boundary, request/client limits, and unavailable state,
configuration or pricing fail closed.

The gate checks the account, identity-only authentication, region, deployed
model version, SKU and content-filter policy against the reviewed configuration
via Azure Resource Manager on every call. It reserves $0.55 per request against
$50 per UTC day, using a conservative 128,000 input-token allowance and 12,000
completion tokens including reasoning. The default global cap is 12 calls per
UTC day and the per-client cap is three; these counters share the budget blob
and are conditionally updated across app instances. A stable 32-byte
`BRICKLAB_AZURE_CLIENT_HASH_KEY` is required for monetary-budget per-principal
accounting. The server HMACs the `tid` and `oid` claims only after token
verification; raw identity claims are not persisted. IP limits and forwarded
headers are not identity. The per-process in-flight lock is not a distributed
semaphore: keep the App Service at one worker.
It checks the current Sweden Central GPT-5.4 Data Zone retail meters before
every reservation and denies calls if they exceed $2.75 input or $16.50 output
per million tokens. The pinned policy must block medium/high severity for
prompt and completion violence, hate, sexual and self-harm; direct jailbreak
prompts and protected text/code completions are also blocked. It is sent via
`x-policy-id` for every request and policy contents are read back before
reservation. Filtered responses are rejected and never retried. Reservations
are never refunded. Calls cannot start within six minutes of UTC midnight.
Azure image input is explicitly rejected before reservation or provider
invocation; this text-only policy has not been verified for image safety.
Missing, corrupt or inaccessible state fails closed; never delete or reset it
to troubleshoot.

This is an inference estimate, not a guarantee of the entire Azure bill: retail
pricing may differ from the subscription's actual contract, prices may change
after verification, billing timing and tokenization may differ, and hosting,
network, storage, tax and other usage are excluded. It only covers calls through
this gate to the pinned deployment, not other clients or model deployments.
The older `azure-usage.mjs` request-count gate is separate and is not the $50
budget. Platform WAF rate limits are approximate per-IP/per-edge controls, not
authentication or a global spend limit. The current public hosted startup guard remains active. Its origin/session
token check is not user authentication. The Entra route and MSAL client
integration exist in the release worktree, but no real app registration,
role assignment, tenant token validation, or public paid request has been
verified. Do not remove the hosted guard before those checks and operator
setup are complete.

For Entra setup, use one single-tenant API app registration and one SPA app
registration. Configure the API to issue v2 access tokens, expose the
delegated `BrickLab.Plan` scope, and define the `BrickLab.Planner` user/group
app role. Assign only the approved user/group to that role, require assignment
on the API enterprise application, and grant the SPA only the delegated API
scope. Register the exact HTTPS site origin as the SPA redirect URI. Configure:

- `BRICKLAB_ENTRA_TENANT_ID`: the directory tenant GUID.
- `BRICKLAB_ENTRA_API_CLIENT_ID`: the API app ID GUID (the expected v2 `aud`).
- `BRICKLAB_ENTRA_SPA_CLIENT_ID`: the SPA app ID GUID (the expected `azp`).
- `BRICKLAB_ENTRA_REQUIRED_SCOPE=BrickLab.Plan`.
- `BRICKLAB_ENTRA_REQUIRED_ROLE=BrickLab.Planner`.

The browser-facing `/api/azure-auth-config` exposes only these non-secret
registration identifiers and the API scope URI. MSAL uses session storage,
tries silent token acquisition first, and prompts only from the user's Azure
planning action. No client secret or provider token is stored by BrickLab.
Missing or invalid server settings prevent Azure startup; missing, invalid,
wrong-tenant, wrong-audience, wrong-client, expired, wrong-scope, or
unassigned-role tokens are rejected before request parsing, reservation or
inference.
