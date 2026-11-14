# Azure OpenAI planner adapter

`azure-planner.mjs` is an unintegrated adapter, not a deployment. It uses the
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

For the deployed GPT-5.4 Data Zone model, `azure-budget.mjs` reserves estimated
inference cost atomically before each call. Pre-provision `daily-budget.json`
in a private Blob container with `{"day":"2000-01-01","reservedMicros":0}`
and grant the host identity Storage Blob Data Contributor on that container.
Create `createAzureBudgetGate({ account, container, endpoint, deployment,
resourceId })` with the Azure OpenAI account's ARM resource ID;
after validating the request and acquiring the shared in-flight slot, call
`reserve({ signal })` immediately before inference. Exhaustion, a UTC day
boundary, and unavailable state or pricing have distinct error codes.

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
