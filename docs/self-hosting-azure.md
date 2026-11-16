# Self-hosting BrickLab on Azure

This guide is a self-hosting recipe; running it creates resources in your
subscription and requires your own configuration and acceptance checks. The
current public preview is a separate deployment: its owner confirms merged
revision `c0060c7af8bd5a1c748a76b10e7710e35cf051e6` live with the Terra planner
selected, and verified the package/settings and public HTTPS response with
asset `index-B5T0Pdlt.js` on 2026-11-16. One earlier synthetic 100-brick
airplane completed planning in 29.619 seconds with valid geometry and then
built 100/100 bricks with 4/4 tasks and 3/3 inspection checks. Separately, two
guarded text-only baseline plans ran through the deployed
UI: a 99-brick spaceship (22.332s) and a hollow observatory with separate
rover (97 bricks, 27.123s), each one adapter attempt and 3/3 local checks.
Their exact UTC request windows are in the
[architecture evidence](architecture.md#deployment-and-release-evidence).
These examples do not establish broad reliability, correction or vision
behavior, end-to-end timeout/cleanup, or user acceptance. Private
Codespaces setup is also unverified; voice is excluded and backlogged across
modes.
The owner also confirms hosted Azure is enabled with managed identity, HTTPS
only, Front Door-only app ingress using the exact Front Door ID and default
deny, and independent SCM deny-all. These are deployment-owner checks, not a
new end-to-end security test in this guide. Live status reports Azure
configured for anonymous use, with the shared 50/day allowance and 20/20
capacity settings.

## Prerequisites and costs

Use your own Azure subscription, a dedicated resource group, and a DNS name
you control. You need permission to create resources and role assignments,
Azure CLI with Bicep, Node.js 24 and npm, Python 3, Git, and a Linux build
environment.
An Azure OpenAI deployment and Linux App Service B1 must be available in the
chosen subscription. The base template places the web app in Italy North by
default; storage/model resource locations are parameters or belong to the
existing Azure OpenAI account. The application adapter accepts the configured
Azure endpoint and deployment; it does not require the preview's model,
version, or region. Check current availability, quota, cost and organizational
policies for your own deployment before provisioning. Do not use another
application's identity, storage, model or developer credentials.

### Current public-preview planner (not a general model requirement)

The Azure owner confirms the current public preview uses:
`bricklab-planner-terra`: `gpt-6.1-terra` version `2026-10-26`,
`GlobalStandard`, capacity **40**, with `bricklab-public-safe` and automatic
version upgrades disabled. Azure accepted this deployment in the dedicated
Sweden Central account and reports 40 requests/minute and 40,000 tokens/minute.
This is the deployment configuration for that preview, not a model/version/
region constraint in the application adapter. Global Standard does not promise
EU-only processing. The app does not automatically fall back to another model.

`infra/terra-planner.bicep` can create this deployment under an existing
dedicated account and content policy. It does not change the app, other
deployments, identities, or the usage counter. To reproduce this specific
preview deployment, first check current model/SKU availability and quota in
your own account:

```powershell
az deployment group create --subscription $Subscription --resource-group $Group `
  --template-file infra\terra-planner.bicep --parameters accountName=$AI capacity=40
```

The current preview's live app setting is
`AZURE_OPENAI_DEPLOYMENT=bricklab-planner-terra`; ordinary package updates must
preserve it. No model switch or additional probe is needed to retain it.
For any separately authorized configuration change, first verify
`/api/status` reports no active planning request, then set only that app setting
on the existing app and restart. Preserve every other setting, the private package pointer,
the shared 50-submission daily ledger and 20/20 concurrency controls. The base
template's `plannerDeploymentName` parameter defaults to
`bricklab-planner-terra` and sets `AZURE_OPENAI_DEPLOYMENT`; this is a setting,
not proof that the deployment exists. The template creates its separate
GPT-5.4 DataZoneStandard resource with `plannerCapacity` defaulting to 200
quota units, but the app does not automatically use it as a fallback. This
template-specific resource and quota are not required by the application.
The base template keeps `BRICKLAB_AZURE_AI=0`. It does not enable paid planning.
For a different model, use a deployment supported by the selected Azure
service and set its endpoint/deployment explicitly; do not assume the preview's
model choice is required. The base Bicep parameter currently allows only its
declared Terra and GPT-5.4 deployment names; extend that allowlist or configure
the app setting directly when using another deployment name.
After an authorized restart verify the intended package,
an available allowance snapshot and one separately authorized guarded
submission. A configured status or successful ARM deployment is not proof of
inference, valid geometry, or a completed local build. One submission may
make at most two model requests under the bounded correction flow; never
retry transport, authentication or 429 failures automatically.

For an existing app, a full base-template deployment is unnecessary and may
overwrite other runtime settings. After the separately authorized idle check,
the exact selection-only operation is:

```powershell
az webapp config appsettings set --subscription $Subscription `
  --resource-group $Group --name $Web `
  --settings AZURE_OPENAI_DEPLOYMENT=bricklab-planner-terra --output none
```

`$Web` is the existing app name. This merges just the named setting; it does
not reset the package pointer, existing ledger aliases, allowance or security
settings. The current live app already has this value: **do not run it again
merely to retain the working default**.

For a new installation using the preview's Terra deployment, provision it and finish
the managed-identity, endpoint, existing/new usage-container, origin and
network setup below before a separately authorized paid opt-in. The explicit
opt-in is a different operation and is not part of a routine package update:

```powershell
az webapp config appsettings set --subscription $Subscription `
  --resource-group $Group --name $Web `
  --settings BRICKLAB_AZURE_AI=1 --output none
az webapp config appsettings list --subscription $Subscription `
  --resource-group $Group --name $Web `
  --query "[?name=='AZURE_OPENAI_DEPLOYMENT' || name=='BRICKLAB_AZURE_AI'].{name:name,value:value}" `
  --output table
```

Verify the two selected values are `bricklab-planner-terra` and `1`;
`/api/status` must then report Azure configured. This is configuration
verification only, not authorization for an inference probe. Never use a
fresh-container setting to replace an existing usage ledger.

Do not delete the selected default deployment. Only after a separately
authorized replacement has been selected and active requests have finished,
the following removes just the former Terra deployment:

```powershell
az cognitiveservices account deployment delete --subscription $Subscription `
  --resource-group $Group --name $AI --deployment-name bricklab-planner-terra
```

Costs start when resources are provisioned, even if the origin is disabled.
Estimate your subscription's App Service, Front Door, storage, private
networking, model usage and other costs with the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).
Actual rates and charges vary by agreement, region and traffic. Neither the
daily request limit nor the concurrency bound is a billing cap.
See [App Service retail prices](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20App%20Service%27%20and%20skuName%20eq%20%27B1%27%20and%20armRegionName%20eq%20%27italynorth%27),
[Front Door](https://azure.microsoft.com/pricing/details/frontdoor/),
[Private Link](https://azure.microsoft.com/pricing/details/private-link/)
and [DNS](https://azure.microsoft.com/pricing/details/dns/).

The public Azure preview is configured with a shared application limit of 50
explicit planning submissions per UTC day, backed by private Blob state and
conditional writes across app instances. The limit is configurable from 1 to
100 with `BRICKLAB_AZURE_DAILY_CALLS`.
Each submission may make one initial Azure model request and at most one
correction of a completed invalid design: up to 100 model requests per day.
The initial and possible correction request share one submission count,
deadline and capacity slot. Network/authentication/
429/timeout failures are not replayed; correction does not refund usage or
increment the count again. Daily usage follows the UTC day boundary.
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
Three.js and MSAL Browser are build-time dependencies: Vite emits the
application and its assets into `dist`. Keep those built assets, but do not
ship unused browser libraries with the server. Azure Identity, Azure Blob
Storage and JOSE remain server runtime dependencies.
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
`BRICKLAB_AZURE_AI=1`, `AZURE_OPENAI_ENDPOINT`,
`AZURE_OPENAI_DEPLOYMENT=bricklab-planner-terra`,
`AZURE_STORAGE_ACCOUNT`,
`BRICKLAB_AZURE_USAGE_CONTAINER=usage` for a new deployment,
`BRICKLAB_AZURE_DAILY_CALLS=50`,
`BRICKLAB_PLANNING_CONCURRENCY=20` and `BRICKLAB_PROVIDER_CONCURRENCY=20`.
The Bicep parameter `azureDailyCalls` wires the global daily allowance
into the web app while leaving `BRICKLAB_AZURE_AI=0`; use 50 for this preview.
Changing a quota does not enable paid planning. The representative Terra
result above validates one live application path, not reproduction of this
entire infrastructure guide. Public visitors do not sign in; the server's managed identity
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
