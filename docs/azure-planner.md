# Azure OpenAI planner adapter

`azure-planner.mjs` is an unintegrated adapter, not a deployment. It uses the
hosting resource's managed identity and requires `AZURE_OPENAI_ENDPOINT` (an
HTTPS `*.openai.azure.com` resource endpoint) and `AZURE_OPENAI_DEPLOYMENT`.
Grant that identity the Cognitive Services OpenAI User role on its dedicated
Azure OpenAI resource. No key or developer credentials are used.

The caller supplies the shared planning prompt and an AbortSignal to
`planAzure({ prompt, signal })`, then validates the returned custom design and
selected world. The adapter sends one request, caps output tokens and response
size, rejects incomplete responses, and does not retry or fall back.

Do not enable it on a public service until authenticated access, exact host and
origin checks, a durable bounded usage limit, concurrency control, transport
timeouts and cancellation are implemented and verified. Configuration alone
does not establish model access or successful generation.
