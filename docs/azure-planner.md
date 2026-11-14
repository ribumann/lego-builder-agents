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

Do not enable it on a public service until authenticated access, exact host and
origin checks, a durable bounded usage limit, concurrency control, transport
timeouts and cancellation are implemented and verified. Configuration alone
does not establish model access or successful generation.

The optional `BRICKLAB_AZURE_AI=1` integration is restricted to the existing
local or private-Codespace API boundaries and requires production serving plus
the usage gate below. `BRICKLAB_HOSTED=1` serves the anonymous lab separately:
it disables every planner, including Azure, pending verified public edge
protections. Never copy a personal Copilot credential into a public host.

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
