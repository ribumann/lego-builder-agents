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

Do not enable it on a public service until edge abuse controls, exact host and
origin checks, a durable budget, concurrency control, transport timeouts and
cancellation are implemented and verified. Configuration alone does not
establish model access or successful generation.

The optional `BRICKLAB_AZURE_AI=1` integration is restricted to the existing
local or private-Codespace API boundaries and requires production serving plus
the usage gate below. `BRICKLAB_HOSTED=1` serves the anonymous lab separately:
it disables every planner, including Azure, pending verified public edge
protections. Never copy a personal Copilot credential into a public host.
For a separately hosted lab, set `BRICKLAB_HOSTED_ORIGIN` to its exact HTTPS
DNS origin (for example `https://lab.example.org`), with no port, path or
trailing slash. The default is `https://bricklab.liberatetheinnerchild.net`.
This configures host/origin checks only; it does not verify a trusted edge.

The local gate below counts requests; it does **not** enforce the requested
$50-per-day inference spending cap. Public planning must remain disabled until
the hosted monetary budget is enforced durably using verified pricing and
conservative atomic reservations. That inference cap does not cover other Azure
costs such as hosting and networking.

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
estimated-inference-cost reservation gate. Hosted planning remains blocked;
the gate can be exercised on the private server by setting
`BRICKLAB_AZURE_BUDGET=1` and `BRICKLAB_AZURE_BUDGET_CONTAINER` alongside the
Azure adapter settings. This selects the monetary gate instead of the request
count gate, with no fallback. Pre-provision `daily-budget.json`
in a private Blob container with `{"day":"2000-01-01","reservedMicros":0}`
and grant the host identity Storage Blob Data Contributor on that container.
Set `AZURE_OPENAI_RESOURCE_ID` to the Azure OpenAI account's ARM resource ID.
The host identity also needs read access to that account and deployment. The
server validates the request and acquires the shared in-flight slot before
reserving budget and starting inference. Exhaustion, a UTC day boundary, and
unavailable state or pricing produce distinct errors.

The gate checks the account, identity-only authentication, region, deployed
model version and SKU against the priced configuration via Azure Resource
Manager on every call. It reserves $0.55 per request against $50 per UTC day, using a conservative
128,000 input-token allowance and 12,000 completion tokens including reasoning.
It checks the current Sweden Central GPT-5.4 Data Zone retail meters before
every reservation and denies calls if they exceed $2.75 input or $16.50 output
per million tokens. Reservations are never refunded. Calls cannot start within
six minutes of UTC midnight. Missing, corrupt or inaccessible state fails closed;
never delete or reset it to troubleshoot.

This is an inference estimate, not a guarantee of the entire Azure bill: retail
pricing may differ from the subscription's actual contract, prices may change
after verification, billing timing and tokenization may differ, and hosting,
network, storage, tax and other usage are excluded. It only covers calls through
this gate to the pinned deployment, not other clients or model deployments.
The older `azure-usage.mjs` request-count gate is separate and is not the $50
budget. Platform WAF rate limits are per IP and per edge location, not a global
spend limit.
