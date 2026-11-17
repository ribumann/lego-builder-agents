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
Codespaces setup and real-microphone voice acceptance are also unverified.
The owner also confirms hosted Azure is enabled with managed identity, HTTPS
only, Front Door-only app ingress using the exact Front Door ID and default
deny, and independent SCM deny-all. These are deployment-owner checks, not a
new end-to-end security test in this guide. Live status reports Azure
configured for anonymous use, with the shared 50/day allowance and 20/20
capacity settings.

## PowerShell and manual GitHub Actions (no custom domain)

For a new isolated installation, use `scripts/deploy-azure.ps1` and
`infra/installation.bicep`. The manually dispatched
`.github/workflows/azure-deploy.yml` calls that **same script**, rather than a
second deployment implementation. This path uses the default
`https://<app>.azurewebsites.net` hostname and its Azure-managed certificate.
It creates **no DNS records, Front Door, OpenAI account or model deployment**.
It serves the static/offline lab with paid planning **off**. A public paid
deployment is a separate architecture and authorization decision; the
edge/private-endpoint recipe later in this guide is not silently replaced.

The new installation includes one Linux B1 worker, a dedicated system identity,
private `packages` and `usage` Blob containers, a VNet and an App Service
integration subnet. App ingress allows **one explicitly supplied IPv4 /32**;
all other clients and all SCM traffic are denied. Storage has shared keys and
anonymous blobs disabled, HTTPS required, and a default-deny firewall allowing
only that operator/runner IP and the app's integrated subnet via a Storage
service endpoint. This is **selected-network storage**, not a private endpoint:
its public endpoint exists but is firewall restricted and requires Entra
authentication. It does not relax an existing deployment's private-storage
policy. Do not select this profile where policy requires Private Link.
`10.91.0.0/24` must not overlap a connected network. Provisioning never
grants model access or enables any provider.

### Prerequisites, permission boundaries and cost

Use PowerShell **7.4+**, Azure CLI with Bicep, Node.js **24**, npm, Python 3.12+
and Git. Build on a clean trusted Linux checkout (the workflow does this).
The uploader must have a stable public IPv4 address that matches the `/32`,
and the browser used for acceptance must use that same egress. A VPN, proxy,
IPv6 preference or another network may produce an intentional 403. No script
discovers, broadens or changes the allowlist automatically.
Check the source IP **as seen by Azure**, not only a generic IP-check service:
corporate proxies can use different egress addresses for different destinations.
App Service's `x-ms-forbidden-ip` response header can identify such a mismatch.
Treat it as diagnostic evidence, not permission to change the allowlist.

Subscription/management-group policy can rewrite a requested Storage
`publicNetworkAccess=Enabled` to `Disabled`. Provision detects that condition
after ARM completes and fails with an explicit **resources still exist and
incur charges** message. The selected-network recipe is not deployable in that
environment. Use **`-PrivateStorage`** for the approved private-endpoint profile
and an approved network-connected uploader/runner instead;
do not request an exemption, enable shared keys or relax policy as a workaround.
The separate `infra/installation-private-storage.bicep` stage creates a Blob
private endpoint in `10.91.0.64/26` and internal DNS linked only to the isolated
app VNet. It can be added to a completed bootstrap without reapplying the base
app template. For a brand-new private installation, pass `-PrivateStorage` on
the initial Provision command; Storage public networking is requested disabled.
For a completed selected-network bootstrap that policy already locked down,
repeat the same Provision target with `-PrivateStorage`; the existing app is
not redeployed and only the missing private-network stage is added.
The existing older private-storage template assumes its original VNet layout; do not
blindly apply it over this installation's integrated service-endpoint subnet.

Use a new, dedicated resource group and explicit subscription and tenant IDs.
The selected Azure account must match both; sovereign-cloud targets are
rejected. Provision can create a new group when the operator is authorized for
subscription-level group creation. Prefer an administrator precreating the
dedicated group with tag `bricklab-installation=deploy-azure-v1` and granting
the provisioning identity **Contributor** and narrowly scoped **Role Based
Access Control Administrator** there, not Owner across the subscription.
Role assignments should be constrained to the Blob Reader/Contributor roles
and intended uploader/app principals by your organization's RBAC conditions.
Provision refuses an existing unmarked group. A marker is a safety guard, not
an authorization boundary: review that the group really is empty and dedicated.

Updates need app/config read and app-settings write/restart permission,
storage account/network configuration read, and **Storage Blob Data
Contributor** on `packages`. Initial setup also needs deployment/group reads
and Blob Data Contributor on `usage` to create the count-only ledger.
Provision assigns the uploader these **container-scoped** roles and the app
package-reader/usage-writer roles; it does not grant the uploader subscription
access. For ongoing updates, separate the deployment identity from the
provisioner and remove its usage-container write role through a separately
authorized RBAC change. RBAC propagation can delay an upload; the script
fails clearly and does not retry writes or open a firewall.

**Costs begin at provisioning and continue after testing.** The B1 App Service
plan is billed while it exists, even with no traffic or a stopped web app.
Storage capacity, operations and network egress also incur charges.
There is no model, Front Door or private-endpoint charge from this template;
the daily application limit is not a spending cap. Check your region and
agreement in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)
and set independent cost alerts before running. There is no automatic teardown.

### Local PowerShell: provision, then deploy

Review the templates and choose the subscription/tenant, a new group and an
approved region with Linux B1 capacity. Sign in explicitly with
`az login --tenant <tenant-id>`; do not paste credentials into this script.
Replace every placeholder below, including the example documentation-only IP:

```powershell
$Subscription = '<subscription-guid>'
$Tenant = '<tenant-guid>'
$Group = '<new-dedicated-resource-group>'
$OperatorCidr = '203.0.113.7/32' # Replace with the approved stable egress IPv4.
$Uploader = '<signed-in-entra-user-object-guid>'
$Target = @{
  SubscriptionId = $Subscription
  TenantId = $Tenant
  ResourceGroup = $Group
  OperatorIpv4Cidr = $OperatorCidr
}
.\scripts\deploy-azure.ps1 @Target -Operation Provision `
  -Location italynorth -UploaderObjectId $Uploader -UploaderPrincipalType User
```

Save the emitted app, storage and default HTTPS origin. Provision records
`bricklab-installation` in ARM. A repeat with a completed deployment does not
reapply the template or reset app settings. This is a **resume-only bootstrap,
not ongoing infrastructure reconciliation**; changing parameters on a repeat
is not a way to update a running installation. A partial failed deployment can
be resumed only while any app has no package pointer and paid planning is off.
Do not delete the deployment record or reapply the Bicep template to roll out
application updates.

Build the exact reviewed commit from a clean checkout. Archive output must be
outside the checkout and not already exist. Build-time browser dependencies
are pruned only **after** Vite emits the browser bundle, voice worker and WASM:

```powershell
$Revision = (git rev-parse HEAD).Trim()
npm ci
if ($LASTEXITCODE) { throw 'npm ci failed' }
npm run check
if ($LASTEXITCODE) { throw 'Checks/build failed' }
npm prune --omit=dev
if ($LASTEXITCODE) { throw 'Production pruning failed' }
$Package = Join-Path ([IO.Path]::GetTempPath()) "bricklab-$Revision.zip"
python scripts\package_azure_release.py --revision $Revision --output $Package
if ($LASTEXITCODE) { throw 'Packaging failed' }
$Web = '<emitted-web-app-name>'
$Storage = '<emitted-storage-account-name>'
.\scripts\deploy-azure.ps1 @Target -Operation Deploy `
  -WebAppName $Web -StorageAccountName $Storage `
  -PackagePath $Package -Revision $Revision `
  -InitializeNewInstallation -MaintenanceConfirmed
```

`-MaintenanceConfirmed` attests that you prevented new submissions, drained
active requests and hold the exclusive operator deployment lock. Do not treat
an idle status snapshot as a lock. For this paid-off isolated installation,
keep other browsers/operators out during rollout. For an existing paid
installation, use your approved maintenance procedure without resetting its
ledger or enabling another provider.

Initial deploy is limited to this automation's uninitialized app, paid off
and with no existing ledger alias or package. It creates `daily-usage.json`
**conditionally, only if absent**, never overwriting existing state, sets the
exact default hosted origin and storage settings, and selects the package
using managed identity. If initialization stopped after creating the ledger,
rerunning cannot reset it. If it stopped after selecting the package, inspect
the saved configuration and rerun as an ordinary update, without `-InitializeNewInstallation`.

For subsequent releases, repeat the clean build/package steps with the new
reviewed commit, then invoke **Deploy without `-InitializeNewInstallation`**.
Updates verify hosted/idle/non-quarantined status, single-worker runtime,
system identity, origin and SCM restrictions, and storage protections before
writing. They preserve the selected model (including an existing Terra
selection), paid opt-in, allowance/concurrency settings, legacy budget aliases,
and every unrelated app setting. They never deploy infrastructure, switch
models, create/reset usage state or call inference. An existing edge-based
installation can omit `OperatorIpv4Cidr` only when it already has exact
Front Door-only ingress and private-endpoint storage; its operator/runner must
reach both the existing app status endpoint and private Blob endpoint.

The script validates every archive manifest hash, exact revision and required
server/dependency/browser/worker/WASM entries before Azure writes. Blobs are
named `<revision>-<archive-sha256>.zip` and uploaded using Entra login with
`If-None-Match: *`, never SAS, account keys, publishing profiles or SCM.
An existing blob must match metadata, length and downloaded SHA-256.
Repeating an already selected package does not change settings or restart.
Only the package URL and `SystemAssigned` reader setting are changed for a
normal update; the previous package is retained for a separately authorized
rollback using the same script and its original artifact/revision.
Treat retained release artifacts as trusted deployable code.

A selected package and requested restart are **not runtime acceptance**.
From the allowed network, verify HTTPS `/`, referenced JavaScript/worker/WASM
assets and `/api/status` (`hosted: true`, Azure planner off for a new install),
confirm SCM and disallowed ingress remain denied, and inspect Azure
configuration for the expected immutable package. Verify representative
browser interaction before accepting the release. No model invocation is
necessary or authorized by these steps. A failed operation may have created
resources, uploaded a blob or selected settings before stopping; inspect the
reported stage securely rather than assuming rollback or retrying blindly.
Azure CLI failure output and app settings are deliberately not printed, as
they may contain secrets; use authorized Azure diagnostics privately.

### Manual GitHub Actions with Azure OIDC

Repository configuration below is an **administrator prerequisite**, not
something the workflow creates. No credential is stored in this repository.

1. Create a dedicated Entra application/service principal or user-assigned
   identity with a GitHub federated credential: issuer
   `https://token.actions.githubusercontent.com`, audience
   `api://AzureADTokenExchange`, subject
   `repo:<owner>/<repo>:environment:azure-deployment`. Apply the resource-scoped
   permissions above; client/application ID and Entra **object** ID differ.
2. Create the GitHub environment **azure-deployment**, require human approval,
   restrict deployment branches to protected `main`, and restrict who can
   dispatch workflows. Configure environment variables `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`,
   `AZURE_LOCATION`, `AZURE_UPLOADER_OBJECT_ID` and
   `AZURE_OPERATOR_IPV4_CIDR`. Set `AZURE_PRIVATE_STORAGE=true` when provisioning
   the private-endpoint profile. These are identifiers, not client secrets.
   Never add a stored Azure password, secret, token or publishing profile.
3. Register a **dedicated trusted Linux self-hosted runner** with labels
   `self-hosted`, `linux`, `bricklab-azure`, fixed egress matching the `/32`,
   PowerShell 7.4+, Azure CLI/Bicep and Git. Allow its management-plane/Entra
   outbound connections and app/Blob data access. For the older private-storage
   architecture it instead needs private DNS/network reachability. Never run
   untrusted PR code on this runner. Do not broaden storage or SCM to make a
   GitHub-hosted runner work.
4. On reviewed `main`, dispatch **Azure installation or update**, selecting
   **Provision**. Approve the environment deployment. Save its emitted names
   as environment variables `AZURE_WEB_APP_NAME` and
   `AZURE_STORAGE_ACCOUNT_NAME`.
5. Dispatch **Deploy**, selecting **initialize** for the first package only,
   and confirm maintenance after doing the maintenance work. Subsequent
   releases use Deploy with initialize unchecked. The workflow builds/tests
   and prunes on an unprivileged GitHub-hosted Linux runner, then transfers
   that run's artifact to the environment-gated deployment job.
6. Perform the runtime acceptance checks above from the allowed network.
   A workflow result does not establish browser acceptance or authorize
   enabling inference.

There are no push/PR/scheduled deployment triggers. Only `main` can deploy;
checkout credentials are not persisted. Only the environment-gated job gets
`id-token: write`; repository content permission is read-only. Workflow input
strings go through environment variables/typed PowerShell arguments, not shell
interpolation. All workflow runs share one non-cancelling concurrency group;
local operators must separately coordinate to avoid concurrent deployment.
The workflow cannot be exercised until an administrator configures the
identity, environment, runner and variables. Offline mocks are not evidence of
OIDC or runner connectivity.

### Changing the allowed operator address

A different egress receives 403 by design. An authorized administrator must
first verify the new single IPv4 address and explicitly update **both** the
web app's `operator-only` access rule and Storage's selected-network IP rule,
removing the old IP, without changing either default-deny action, SCM deny,
subnet rule, private-container setting or shared-key policy. Use the Azure
portal's scoped Networking panes or reviewed resource-scoped CLI operations;
never use `0.0.0.0/0`, public-all-networks or a public container as a workaround.
Then update the script argument and environment variable. Do not rerun
Provision or the full template to rotate an IP on an initialized app.

Deploy accepts an explicit array of at most **three independently verified `/32`
addresses**, for example a trusted private runner and the intended browser's
destination-specific proxy egress. Its safety check requires the actual app
allowlist to match that set exactly; it does not add rules. In the workflow,
`AZURE_OPERATOR_IPV4_CIDR` can be a comma-separated list (Provision still
requires one initial address). Never infer a normal user's address from a
tool's proxy address. After temporary-runner testing, remove its app allow rule.

### Separately approved temporary private uploader

Where no existing trusted runner has a route to the new VNet, the optional
`infra/temporary-uploader.bicep` is a **separate, explicit infrastructure
operation**, not something Deploy or the workflow creates automatically.
It creates a tagged temporary VM with managed identity, scoped package/usage
Blob roles, Reader on the isolated group and Website Contributor on just the
isolated app. It has password authentication off and an NSG denying **all
inbound traffic**, including SSH/RDP; use authorized Azure VM Run Command.
Its Standard public IP is for explicit outbound tool/package downloads only,
not public management access. Generate an ephemeral SSH public key for the VM
schema and dispose of the unused private key; never put credentials in scripts.

The helper defaults to a dedicated Sweden Central VNet (`10.93.0.0/24`) because
VM SKU availability can differ from the app's region. Check current availability
and approved cost before choosing its size/region. It adds a **temporary second
Blob private endpoint** in that VNet, with no peering or production-network
changes. Do not attach this second endpoint to the app's private DNS zone:
multiple unreachable private A records can break the app's package fetch.
On the disposable VM only, map the exact Blob hostname to that temporary
endpoint's verified private IP (for example via `/etc/hosts`), retain normal
HTTPS certificate validation, and verify resolution and managed-identity
data access before deployment. The app keeps its own persistent endpoint/DNS.

Build the exact clean reviewed Git revision on that VM, then run the same
PowerShell Deploy implementation with its managed identity. A public repository
can be cloned without credentials; local unpushed commits can be transferred as
a verified Git bundle through authorized Run Command. Do not expose a private
repository or package publicly to make this work, or copy developer credentials.
The packager emits a hash-covered `dist/release.json`; verify `/release.json`
and actual asset hashes through HTTPS after both initial deployment and update.

This helper adds VM, managed-disk, public-IP and Private Link charges. Once
testing finishes, verify the helper's exact ownership tag, VM-to-disk/NIC links,
endpoint/NIC association and scoped principal before removing **only** its
role assignments, VM, detached OS disk, NIC, public IP, NSG, temporary endpoint
and temporary VNet. Do not remove the application's persistent private endpoint,
private DNS, integrated VNet, app, package blobs or usage state. The helper is
not a persistent GitHub Actions runner; actual OIDC dispatch still needs the
separately configured trusted runner/environment described above.

### Offline checks

```powershell
pwsh -NoProfile -File tests\deploy-azure.tests.ps1
python -B -m unittest discover -s tests -p test_package_azure_release.py
python -B -m unittest discover -s tests -p test_azure_templates.py
```

The PowerShell tests mock all Azure and HTTP operations and reject wrong
targets, unsafe restrictions, active planning and initialization of an existing
deployment. They cover setting/ledger preservation and conditional immutable
uploads. Python tests check package closure/assets/manifests and compile the
templates with Bicep without deploying resources. CI runs the package and
orchestration and Bicep checks. None of these offline checks uses a model.

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
and scoped Blob permissions. App Service's public endpoint exists, but
**all origin traffic is denied** while `frontDoorId` is empty. A base-template
redeployment without that parameter denies origin traffic again and may reset
runtime settings; it is not an application-update operation.

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

For the no-domain installation, there are no DNS records to remove. Before
cleanup, inspect the exact dedicated group's inventory with
`az resource list --subscription $Subscription --resource-group $Group --output table`
and verify it contains only the installation you intend to retire. Only after
separate deletion approval, run
`az group delete --subscription $Subscription --name $Group` and answer its
confirmation. Stopping the web app does **not** stop B1 plan charges; deleting
the dedicated plan/group is necessary to retire those resources. Retain the
release and usage state first if recovery is needed. The deploy script and
workflow never perform teardown.

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
