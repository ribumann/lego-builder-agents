# Azure OpenAI planner adapter

`azure-planner.mjs` is an unintegrated adapter, not a deployment. It uses the
hosting resource's managed identity and requires `AZURE_OPENAI_ENDPOINT` (an
HTTPS `*.openai.azure.com` resource endpoint) and `AZURE_OPENAI_DEPLOYMENT`.
Grant that identity the Cognitive Services OpenAI User role on its dedicated
Azure OpenAI resource. No key or developer credentials are used.

## Speech adapter (not enabled)

`azure-speech.mjs` provides a server-side adapter for Azure Speech short-audio
transcription. It accepts canonical 16-bit mono 16 kHz PCM WAV up to 60
seconds and returns a transcript; it does not start planning. The custom
domain must use the same name as its Speech account. It uses managed identity
and the resource-bound Entra bearer required by
[Speech REST](https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short).
No server route or hosted cloud transcription is enabled by this adapter.

The adapter requires a reservation callback before token acquisition or audio
transmission. `createAzureSpeechBudgetGate` reserves $0.016667 for each
request (the full 60 seconds at the verified $1/hour retail ceiling), using
the same ETag-protected `daily-budget.json` ledger as planning. Configure both
gates with the same storage account and container: separate ledgers would not
enforce a combined limit. The speech gate verifies a Sweden Central, S0,
identity-only Speech account and the current S1 speech-to-text retail meter.
One staging request verified these resource checks, managed identity and
transcription against a dedicated private Speech S0 account. It reserved
$0.016667 in the shared ledger and transcribed 1.83 seconds of synthetic audio.
This does not verify actual billing or other environments; contract charges may
differ from retail.

A production caller must also enforce authenticated access, explicit informed
consent, abuse controls, and privacy and retention policies. Verify the
resource, identity, pricing and billing before use; do not enable paid speech
publicly without these controls. Audio and transcripts must not be logged.

`infra/speech-private.bicep` is a staging template that creates a private
Speech account, private endpoint and app network DNS link. It requires the
existing BrickLab private network. It does not grant a runner or the app
identity Speech access, or enable a route. The separate
`infra/speech-test-access.bicep` explicitly grants a specified connected test
runner a scoped Speech role and DNS link. Save its output IDs and remove both
after testing. Incremental redeployments do not remove previously created
access; redeploying the test-access template recreates it. The account, private
endpoint and DNS zone may incur ongoing charges.

When temporarily using the test-access template, capture its
`temporaryRoleId` and `temporaryDnsLinkId` outputs. After the test, remove
those exact resources and verify the runner is no longer authorized:

```bash
az role assignment delete --subscription "$SUBSCRIPTION" --ids "$TEMPORARY_ROLE_ID"
az network private-dns link vnet delete --subscription "$SUBSCRIPTION" \
  --ids "$TEMPORARY_DNS_LINK_ID" --yes
```

## Azure planning

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
