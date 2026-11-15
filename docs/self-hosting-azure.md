# Self-hosting BrickLab on Azure

This guide describes an isolated, public Azure deployment with an Azure-hosted
planner. **It is not yet a validated end-to-end deployment:** the templates
have provisioned the individual resources. One staging deployment loaded a
private Blob package with managed identity, and a non-paid synthetic stream
completed after 271.6 seconds; an earlier stream closed early. Full
reproducibility, reliable streaming, edge protections and hosted model
generation have not been verified. The simplified preview uses an anonymous
managed-identity Azure wrapper with a mandatory shared call count; deployment
defaults keep paid planning off until the real configuration is verified.
Until these checks and the application integration are complete, this is a
staging guide, not a production recipe.

An independent sample also deployed the base, private-storage and edge
templates, built revision `084cfb4` on a private runner and served its immutable
package through the default Front Door hostname with planners disabled. That
sample did not reproduce custom-domain binding or initialize a second budget.
The sample's ARM deployment reported success while its new Front Door hostname
still returned 404 for several minutes; wait for the real endpoint to work
over verified HTTPS before considering the edge ready.
Two synthetic streams through the sample edge, from separate clients, each
delivered 22 ordered heartbeats over 315 seconds with maximum observed delivery
lag below two seconds. Other attempts ended in client connection resets without
adequate progress telemetry; their cause remains unknown. These results do not
establish reliable transport through the production custom domain.

## Prerequisites and costs

use your own Azure subscription, a dedicated resource group, and a DNS name
you control. You need permission to create resources and role assignments,
Azure CLI with Bicep, Node.js 24 and npm, Python 3, Git, and a Linux build
environment.
An Azure OpenAI model deployment and Linux App Service B1 must be available in
the chosen subscription. These templates currently use Sweden Central for
storage and the model and Italy North for the web app; the preview contract
does not pin a model version or region.
Check quota, regional availability and organizational policies before
provisioning. Do not use another application's identity, storage, model or
developer credentials.

### Dedicated model throughput quota

The base template's `plannerCapacity` parameter defaults to **200** for the
dedicated GPT-5.4 DataZoneStandard deployment: Azure currently reports
200,000 tokens/minute and 200 requests/minute at this allocation. This is
[pay-per-token standard capacity](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/deployment-types),
not fixed-cost provisioned throughput. Check unallocated regional quota
before deployment; do not reduce another application's allocation to fit.
The approved preview allocation on 2026-11-15 used 201 of 333 shared regional
GPT-5.4 DataZoneStandard units, leaving 132 free.

Capacity is separate from the app's 20 simultaneous requests and 50 shared
attempts per UTC day. It does not guarantee 20 simultaneous large completions:
prompt and maximum completion estimates, short rate windows and service
availability can still cause 429 responses. The initial 1,000 TPM allocation
produced a confirmed provider 429; its original subtype and rate-limit
headers were not retained, so the exact historical cause is unknown.

To reproduce the chosen quota allocation on an existing dedicated deployment,
update only its capacity, not the entire infrastructure template:

```bash
MODEL_ID="/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$AI/deployments/bricklab-planner-gpt54"
az resource update --subscription "$SUBSCRIPTION" --ids "$MODEL_ID" \
  --api-version 2024-10-01 --set sku.capacity=200
az cognitiveservices account deployment show --subscription "$SUBSCRIPTION" \
  --resource-group "$RG" --name "$AI" --deployment-name bricklab-planner-gpt54
az cognitiveservices usage list --subscription "$SUBSCRIPTION" --location swedencentral
```

Set `AI` to the dedicated account name and first confirm the existing SKU is
`DataZoneStandard`. Preserve its model, content policy, all other deployments
and application settings. Pass `plannerCapacity=200` on subsequent base-template
deployments; do not restore the former capacity of 1. Wait at least one rate
window after a change before a separately approved bounded inference check.

Costs start when resources are provisioned even if the origin is disabled.
Estimate using your subscription's
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).
For example, at published USD retail rates, one Italy North Linux B1 at
$0.018/hour, Front Door Standard at $35/month, a $0.01/hour private endpoint,
and a $0.50/month private DNS zone total about $55.94 for 730 hours. With
100,000 European requests, 10 GB edge-to-client, 1 GB edge-to-origin and 1 GB
private-link processing, the illustrative subtotal is about $56.89/month,
before storage, DNS queries, cross-region traffic, tax and other charges.
Actual agreement prices, traffic geography, uptime and rates can differ.
See [App Service retail prices](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20App%20Service%27%20and%20skuName%20eq%20%27B1%27%20and%20armRegionName%20eq%20%27italynorth%27),
[Front Door](https://azure.microsoft.com/pricing/details/frontdoor/),
[Private Link](https://azure.microsoft.com/pricing/details/private-link/)
and [DNS](https://azure.microsoft.com/pricing/details/dns/).

The preview requires a shared, count-only limit of 50 Azure calls per UTC day,
backed by private Blob state and conditional writes across app instances.
It also limits hosted planning to 20 in-flight requests. Keep one worker and
one Node process unless a shared in-flight semaphore is added and verified.
Public visitors are anonymous; no per-client fairness or identity is claimed.
No visitor Entra registration or client-hash secret is required.

There is no dollar ledger, per-call pricing verification, or six-minute
pricing blackout. The call limit is not a cap on the Azure bill: hosting,
storage, network, other callers and model charges still apply. Azure Cost
Management budgets alert rather than stop spending; configure alerts separately.
The Front Door WAF rate rule is approximate, not authentication or a global
spend limit.

## Provision isolated resources

Use explicit subscription selection on every command. The following variables
are examples for a Bash shell; replace every placeholder, and run from the
repository root. The uploader must be a Microsoft Entra **user object ID**
with private network access to Blob Storage; the templates grant that user
access to the dedicated package and usage containers. Role assignments
may take time to propagate.

```bash
SUBSCRIPTION='<subscription-id>'
RG='<new-resource-group>'
DOMAIN='<your-fully-qualified-domain>'
UPLOADER='<your-entra-user-object-id>'
az group create --subscription "$SUBSCRIPTION" --name "$RG" --location swedencentral
az deployment group create --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name bricklab-base --template-file infra/azure.bicep \
  --parameters packageUploaderObjectId="$UPLOADER"
```

Save the deployment outputs `webAppName`, `storageAccountName`,
`openAiAccountId`, `openAiEndpoint` and `openAiDeployment`. The base template
creates a dedicated model with key authentication disabled, managed identity
and scoped Blob permissions. App Service **public access is disabled** until
the edge has been verified. Template redeployment also disables it again.

Deploy `infra/private-storage.bicep` with `webAppName` and
`storageAccountName` from those outputs. It creates a VNet, private Blob
endpoint, DNS zone and App Service VNet integration. Its `10.91.0.0/24`
address space is fixed: review for overlap with your networks before
connecting them. You need a policy-approved operator machine with network
connectivity and DNS resolution to the private endpoint to initialize the
usage state and upload releases. Do not enable public Blob access or shared keys
to work around a blocked connection.

```bash
az deployment group create --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name bricklab-private --template-file infra/private-storage.bicep \
  --parameters webAppName="$WEB" storageAccountName="$STORAGE"
```

`WEB` and `STORAGE` must be set to the corresponding outputs first. For a new
deployment, on the connected machine, initialize the count-only usage state
**once**. This conditional create fails if it already exists; do not overwrite
or reset existing state, and do not delete older budget artifacts.

```bash
printf '%s' '{"day":"2000-01-01","count":0}' > usage-initial.json
az storage blob upload --subscription "$SUBSCRIPTION" --auth-mode login \
  --account-name "$STORAGE" --container-name usage --name daily-usage.json \
  --file usage-initial.json --if-none-match '*' --overwrite false
rm usage-initial.json
```

For an existing deployment using `BRICKLAB_AZURE_BUDGET_CONTAINER`, keep its
existing `daily-budget.json` state instead of creating a separate counter.
The usage gate migrates supported existing state in place without resetting
the current call count. Verify the migration before enabling inference.

## Edge, DNS and HTTPS

Create the edge first with the custom-domain association disabled, then
create the Front Door domain:

```bash
az deployment group create --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name bricklab-edge --template-file infra/edge.bicep \
  --parameters webAppName="$WEB" customHost="$DOMAIN" enableCustomDomain=false
az deployment group create --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name bricklab-domain --template-file infra/domain.bicep \
  --parameters customHost="$DOMAIN"
```

Publish the domain deployment's validation token as the DNS TXT record
`_dnsauth.<your-host>` and wait for Front Door domain validation. Publish an
`asuid.<your-host>` TXT containing the App Service custom-domain verification
ID and bind the hostname to the web app. Follow
[App Service domain verification](https://learn.microsoft.com/azure/app-service/app-service-web-tutorial-custom-domain)
and [Front Door domain validation](https://learn.microsoft.com/azure/frontdoor/standard-premium/how-to-add-custom-domain);
do not change your parent domain's nameserver delegation. Point the hostname's
CNAME at the edge deployment's `endpointHost`, then redeploy `infra/edge.bicep`
with `enableCustomDomain=true`. Wait for the managed certificate and confirm
real public DNS and HTTPS certificate validation before accepting traffic.
The Front Door origin certificate is checked against the App Service default
hostname while its HTTP Host is the custom domain.

The base template's `frontDoorId` is the edge deployment's **Front Door ID**,
not the profile resource ID. Its origin restriction allows only the Azure
Front Door backend service tag with that exact ID, followed by an explicit
catch-all deny; SCM has independent deny-all rules. The App Service public
network endpoint is enabled because `edge.bicep` uses a public hostname origin,
not Private Link. With an empty `frontDoorId`, all origin requests are denied.
Verify that direct-origin and wrong-ID
requests are denied, and that WAF is associated with both active domains.
For a fresh deployment, obtain the Front Door ID and pass it to the base
template, or install the same restriction on an existing app as below.
Inspect the returned restrictions and
confirm both origin and SCM defaults are `Deny`:

```bash
FRONTDOOR_ID=$(az deployment group show --subscription "$SUBSCRIPTION" \
  --resource-group "$RG" --name bricklab-edge \
  --query 'properties.outputs.frontDoorId.value' --output tsv)
test -n "$FRONTDOOR_ID" || { echo "Missing Front Door ID" >&2; exit 1; }
az webapp config access-restriction add --subscription "$SUBSCRIPTION" \
  --resource-group "$RG" --name "$WEB" --rule-name frontdoor-only \
  --priority 100 --action Allow --service-tag AzureFrontDoor.Backend \
  --http-headers "x-azure-fdid=$FRONTDOOR_ID"
az webapp config access-restriction show --subscription "$SUBSCRIPTION" \
  --resource-group "$RG" --name "$WEB"
```

For an older app whose public network endpoint is still disabled, only after
confirming the restriction and configuring the private package and hosted
settings below, enable restricted origin access:

```bash
az webapp update --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name "$WEB" --set publicNetworkAccess=Enabled
```

The offline template regression checks compile both Bicep templates and verify
the bound Front Door-only origin rules, SCM deny-all, attached content-policy
setting and paid-off default:
`python -B -m unittest discover -s tests -p test_azure_templates.py`.
They require Azure CLI with Bicep installed, but do not deploy resources.
Do not reapply the entire base template to an existing production environment
as a package rollout; reconcile its resource/settings differences separately.

Verify direct access is denied even when a client supplies the Front Door ID.
The WAF custom rule limits the paid route per client IP and per edge location;
distributed Front Door servers can allow requests above its low threshold.
It is approximate and is not a global spending cap or authentication.
In one synthetic sample burst of 20 sequential requests, 19 reached the origin
and one received 429 despite the configured 10-per-minute threshold.
Do not trust client-supplied forwarded host headers. Configure the exact
`BRICKLAB_HOSTED_ORIGIN` as `https://` plus your DNS hostname, with no trailing
slash, port, path, or credentials.

## Build, deploy and configure

Build the exact reviewed application revision in a clean Linux environment
using `npm ci`, `npm run build`, then `npm prune --omit=dev`.
Transformers, Three.js and MSAL Browser are build-time dependencies: Vite emits
the application, browser voice worker and WebAssembly assets into `dist`.
Keep those built assets, but do not ship unused browser libraries or Node/ONNX
inference dependencies with the server. Azure Identity, Azure Blob Storage
and JOSE remain server runtime dependencies.
Create the release using the repository packager, which verifies the runtime module
closure, production dependency tree, required worker/runtime assets and
Windows helper, and writes a per-file SHA-256 manifest. The archive is
deterministic and refuses to overwrite an existing artifact. It requires the
exact checked-out revision and a clean source tree:

```bash
REVISION=$(git rev-parse HEAD)
npm run package:azure -- --revision "$REVISION" \
  --output "../bricklab-release-$REVISION.zip"
```

Review the emitted archive SHA-256, byte counts and asset breakdown before
upload. Upload a uniquely named ZIP to the private `packages` container from
the connected operator machine, using `az storage blob upload --auth-mode
login`. Never upload your local Copilot or GitHub credential caches.
Configure `WEBSITE_RUN_FROM_PACKAGE`
to the private Blob URL and set
`WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID=SystemAssigned` so the web app
uses its system-assigned identity to read it.
See [run from package with managed identity](https://learn.microsoft.com/azure/app-service/deploy-run-package#access-a-package-in-azure-blob-storage-using-a-managed-identity).
Private package retrieval succeeded in one staging deployment; test it in your
environment without relaxing your network policy.

The hosted app settings are `HOST=0.0.0.0`, `BRICKLAB_HOSTED=1`, and the
exact `BRICKLAB_HOSTED_ORIGIN`. Azure injects `PORT`. For the currently
opt-in paid planner the additional settings are
`BRICKLAB_AZURE_AI=1`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`,
`AZURE_STORAGE_ACCOUNT`,
`BRICKLAB_AZURE_USAGE_CONTAINER=usage` for a new deployment,
`BRICKLAB_AZURE_DAILY_CALLS=50`,
`BRICKLAB_PLANNING_CONCURRENCY=20` and `BRICKLAB_PROVIDER_CONCURRENCY=20`.
The Bicep parameter `azureDailyCalls` wires the global daily allowance
into the web app while leaving `BRICKLAB_AZURE_AI=0`; use 50 for this preview.
Changing a quota does not enable paid planning. No deployment was
performed to validate these settings on the live app. Public visitors do not sign in; the server's managed identity
authenticates to model and storage APIs. No model credential
is sent to the browser. The Entra/MSAL option remains for separately configured
private Azure servers, not the anonymous public lab.

The base Bicep template creates the named policy with
blocking filters for medium/high violence, hate, sexual and self-harm input
and output, direct jailbreak detection, and protected-text/code output
detection. The model deployment explicitly sets `raiPolicyName` to that policy.
Use an approved native Azure content policy and verify it is attached to the
deployment; merely creating an unattached policy is not sufficient. Retain
managed identity and the network protections described above. Azure image
input requires user consent and validation of image type and size before
provider invocation.

These settings are **not authorization to enable the paid route**. Do not
enable Copilot, Codespaces, or local-model modes on the public instance. The
hosted setting defaults to `BRICKLAB_AZURE_AI=0`. The origin/session-token check
is not user authentication: a public visitor can obtain the browser token.
The durable shared count provides the application call boundary;
WAF throttling is only approximate defense in depth. Anonymous visitors may
exhaust the shared allowance, so no per-client fairness guarantee is made.
The static/offline lab remains available without inference.

Before any public paid deployment, verify the managed-identity model/storage
access and actually attached blocking policy. Verify exact Host and Origin
handling, direct-origin denial, WAF association, the durable shared call count
under concurrent requests from separate instances, and the 20 in-flight limit.
Keep the plan at one worker and one Node server process unless a shared
in-flight semaphore is added. Use a
non-paid synthetic heartbeat stream through the actual edge to test beyond
the approximately 240-second platform boundary; separately verify that a
real or simulated planning request stops by its 300-second deadline.
Run a single bounded original-scene generation only after these controls work.
Ensure failures do not expose credentials or raw provider errors. A live
status endpoint alone is not evidence that inference or controls work.

## Operations and teardown

Monitor availability, application errors, WAF blocks, usage counts,
actual Azure costs and model configuration. Restrict permission to
change the deployment, model or storage state. Investigate usage-state failures
without deleting the state, and redeploy immutable reviewed packages rather
than replacing an active ZIP. Backup and incident procedures should preserve
the usage state; never restore an older state while inference can run.

To retire an isolated deployment, remove only its DNS records after confirming
they are no longer in use, then delete the dedicated resource group with
`az group delete --subscription "$SUBSCRIPTION" --name "$RG"`. This deletes
the group's application, model, networking and usage data. Check for any
resources, DNS zones or charges outside that group separately.
