# Self-hosting BrickLab on Azure

This guide describes an isolated, public Azure deployment with an Azure-hosted
planner. **It is not yet a validated end-to-end deployment:** the templates
have provisioned the individual resources, but private package delivery,
end-to-end edge and streaming checks, and hosted model generation have not
been verified. The current server deliberately refuses to enable the hosted
Azure planner. Do not remove that safeguard to make the site appear ready.
Until these checks and the application integration are complete, this is a
staging guide, not a production recipe.

## Prerequisites and costs

Use your own Azure subscription, a dedicated resource group, and a DNS name
you control. You need permission to create resources and role assignments,
Azure CLI with Bicep, Node.js 24 and npm, Git, and a Linux build environment.
Azure OpenAI GPT-5.4 version `2026-03-05`, DataZoneStandard capacity, and
Linux App Service B1 must be available in the chosen subscription. These
templates use Sweden Central for storage and the model and Italy North for
the web app; other regions may be chosen for the web app, but the budget
verifier currently accepts only the specified model and Sweden Central.
Check quota, regional availability and organizational policies before
provisioning. Do not use another application's identity, storage, model or
developer credentials.

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

For inference, the current gate verifies the
[Sweden Central GPT-5.4 Data Zone retail meters](https://prices.azure.com/api/retail/prices?%24filter=productName%20eq%20%27Azure%20OpenAI%20GPT5%27%20and%20armRegionName%20eq%20%27swedencentral%27%20and%20%28skuName%20eq%20%275.4%20inp%20Dz%27%20or%20skuName%20eq%20%275.4%20opt%20Dz%27%29)
before every call and reserves $0.55 against a $50 UTC-day budget. At most 90
reservations ($49.50) fit per day; 30 such days reserve $1,485. Actual billed
tokens may be lower. **This is not a hard cap on your Azure bill**, or a
guarantee of actual inference charges: contract prices, subsequent price or
deployment changes, billing timing and tokenization can differ. Other callers,
hosting, storage, network and tax are outside the gate. Azure Cost Management
budgets alert rather than stop spending; create alerts separately and monitor
actual charges. See [budget limitations](azure-planner.md).

## Provision isolated resources

Use explicit subscription selection on every command. The following variables
are examples for a Bash shell; replace every placeholder, and run from the
repository root. The uploader must be a Microsoft Entra **user object ID**
with private network access to Blob Storage; the templates grant that user
access to the dedicated package and budget containers. Role assignments
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
budget and upload releases. Do not enable public Blob access or shared keys
to work around a blocked connection.

```bash
az deployment group create --subscription "$SUBSCRIPTION" --resource-group "$RG" \
  --name bricklab-private --template-file infra/private-storage.bicep \
  --parameters webAppName="$WEB" storageAccountName="$STORAGE"
```

`WEB` and `STORAGE` must be set to the corresponding outputs first. On the
connected machine, initialize the budget **once**. This conditional create
fails if it already exists; do not overwrite or reset existing state.

```bash
printf '%s' '{"day":"2000-01-01","reservedMicros":0}' > budget-initial.json
az storage blob upload --subscription "$SUBSCRIPTION" --auth-mode login \
  --account-name "$STORAGE" --container-name usage --name daily-budget.json \
  --file budget-initial.json --if-none-match '*' --overwrite false
rm budget-initial.json
```

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
Front Door backend service tag with that exact ID; SCM is deny-by-default.
Apply it before opening the origin and verify that direct-origin and wrong-ID
requests are denied, and that WAF is associated with both active domains.
The WAF custom rule limits the paid route per client IP and per edge location;
it is approximate and is not a global spending cap or authentication.
Do not trust client-supplied forwarded host headers. Configure the exact
`BRICKLAB_HOSTED_ORIGIN` as `https://` plus your DNS hostname, with no trailing
slash, port, path, or credentials.

## Build, deploy and configure

Build the exact reviewed application revision in a clean Linux environment
using `npm ci`, `npm run build`, then `npm prune --omit=dev`. Create a ZIP
with the application files, `dist` and production dependencies at its root,
excluding `.git` and development-only material. Upload a uniquely named ZIP
to the private `packages` container from the connected operator machine,
using `az storage blob upload --auth-mode login`. Never upload your local
Copilot or GitHub credential caches. Configure `WEBSITE_RUN_FROM_PACKAGE`
to the private Blob URL and the web app's system-assigned identity to read it.
See [run from package with managed identity](https://learn.microsoft.com/azure/app-service/deploy-run-package#access-a-package-in-azure-blob-storage-using-a-managed-identity).
Private package retrieval and routing have **not** yet been validated here;
test them in your environment without relaxing your network policy.

The hosted app settings are `HOST=0.0.0.0`, `BRICKLAB_HOSTED=1`, and the
exact `BRICKLAB_HOSTED_ORIGIN`. Azure injects `PORT`. For the currently
blocked paid planner the intended additional settings are
`BRICKLAB_AZURE_AI=1`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`,
`AZURE_OPENAI_RESOURCE_ID`, `AZURE_STORAGE_ACCOUNT`, and
`BRICKLAB_AZURE_BUDGET_CONTAINER=usage`. These values are resource identifiers,
not secrets. Do not enable Copilot, Codespaces, or local-model modes on the
public instance. The server will refuse hosted Azure mode until the
application's safety gate is legitimately completed.

Before any public paid deployment, verify exact Host and Origin handling,
direct-origin denial, WAF association and throttling, durable fail-closed
budget reservations under concurrent requests and cancellation. Use a
non-paid synthetic heartbeat stream through the actual edge to test beyond
the approximately 240-second platform boundary; separately verify that a
real or simulated planning request stops by its 300-second deadline.
Run a single bounded original-scene generation only after these controls work.
Ensure failures do not expose credentials or raw provider errors. A live
status endpoint alone is not evidence that inference or controls work.

## Operations and teardown

Monitor availability, application errors, WAF blocks, usage reservations,
actual Azure costs, pricing and model configuration. Restrict permission to
change the deployment, model or storage state. Investigate budget failures
without deleting the state, and redeploy immutable reviewed packages rather
than replacing an active ZIP. Backup and incident procedures should preserve
the reservation state; never restore an older state while inference can run.

To retire an isolated deployment, remove only its DNS records after confirming
they are no longer in use, then delete the dedicated resource group with
`az group delete --subscription "$SUBSCRIPTION" --name "$RG"`. This deletes
the group's application, model, networking and budget data. Check for any
resources, DNS zones or charges outside that group separately.
