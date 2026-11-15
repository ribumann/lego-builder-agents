targetScope = 'resourceGroup'

@description('Region for the isolated BrickLab resources.')
param location string = resourceGroup().location

@description('Region for the App Service plan and web app.')
param webLocation string = 'italynorth'

@description('Front Door profile ID; leave empty to deny all origin traffic.')
param frontDoorId string = ''

@description('Object ID of the operator allowed to upload release packages.')
param packageUploaderObjectId string

@description('Public Azure planning requests per UTC day across all app instances; does not enable paid planning.')
@minValue(1)
@maxValue(100)
param azureDailyCalls int = 50

@description('Dedicated GPT-5.4 DataZoneStandard quota units (1,000 TPM per unit); token-billed, not provisioned throughput.')
@minValue(1)
param plannerCapacity int = 200

@description('Selected startup deployment output; does not create that deployment or enable paid planning. Provision Terra separately with terra-planner.bicep before selecting it.')
@allowed([
  'bricklab-planner-terra'
  'bricklab-planner-gpt54'
])
param plannerDeploymentName string = 'bricklab-planner-terra'

var suffix = uniqueString(subscription().id, resourceGroup().id)
var webName = 'bricklab-${suffix}'
var storageName = 'bricklab${suffix}'
var aiName = 'bricklab-ai-${suffix}'
var usageContainer = 'usage'
var openAiUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var blobReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'bricklab-plan'
  location: webLocation
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webName
  location: webLocation
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appCommandLine: 'npm start'
      appSettings: [
        {
          name: 'BRICKLAB_HOSTED'
          value: '1'
        }
        {
          name: 'BRICKLAB_AZURE_AI'
          value: '0'
        }
        {
          name: 'BRICKLAB_AZURE_DAILY_CALLS'
          value: string(azureDailyCalls)
        }
        {
          name: 'BRICKLAB_PLANNING_CONCURRENCY'
          value: '20'
        }
        {
          name: 'BRICKLAB_PROVIDER_CONCURRENCY'
          value: '20'
        }
      ]
      ipSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: concat(empty(frontDoorId) ? [] : [
        {
          name: 'frontdoor-only'
          action: 'Allow'
          priority: 100
          tag: 'ServiceTag'
          ipAddress: 'AzureFrontDoor.Backend'
          headers: {
            'x-azure-fdid': [
              frontDoorId
            ]
          }
        }
      ], [
        {
          name: 'deny-all'
          action: 'Deny'
          priority: 2147483647
          ipAddress: 'Any'
        }
      ])
      scmIpSecurityRestrictionsUseMain: false
      scmIpSecurityRestrictions: [
        {
          name: 'deny-all'
          action: 'Deny'
          priority: 2147483647
          ipAddress: 'Any'
        }
      ]
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: usageContainer
  properties: {
    publicAccess: 'None'
  }
}

resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'packages'
  properties: {
    publicAccess: 'None'
  }
}

resource ai 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: aiName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: aiName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource contentFilter 'Microsoft.CognitiveServices/accounts/raiPolicies@2024-10-01' = {
  parent: ai
  name: 'bricklab-public-safe'
  properties: {
    basePolicyName: 'Microsoft.Default'
    mode: 'Blocking'
    contentFilters: [
      {
        name: 'Hate'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Prompt'
      }
      {
        name: 'Hate'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Completion'
      }
      {
        name: 'Sexual'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Prompt'
      }
      {
        name: 'Sexual'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Completion'
      }
      {
        name: 'Selfharm'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Prompt'
      }
      {
        name: 'Selfharm'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Completion'
      }
      {
        name: 'Violence'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Prompt'
      }
      {
        name: 'Violence'
        blocking: true
        enabled: true
        severityThreshold: 'Medium'
        source: 'Completion'
      }
      {
        name: 'Jailbreak'
        blocking: true
        enabled: true
        source: 'Prompt'
      }
      {
        name: 'Protected Material Text'
        blocking: true
        enabled: true
        source: 'Completion'
      }
      {
        name: 'Protected Material Code'
        blocking: true
        enabled: true
        source: 'Completion'
      }
    ]
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: 'bricklab-planner-gpt54'
  sku: {
    name: 'DataZoneStandard'
    capacity: plannerCapacity
  }
  properties: {
    raiPolicyName: contentFilter.name
    model: {
      format: 'OpenAI'
      name: 'gpt-5.4'
      version: '2026-03-05'
    }
  }
}

resource aiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, web.id, openAiUserRole)
  scope: ai
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: openAiUserRole
  }
}

resource usageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(container.id, web.id, blobContributorRole)
  scope: container
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

resource usageOperator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(container.id, packageUploaderObjectId, blobContributorRole)
  scope: container
  properties: {
    principalId: packageUploaderObjectId
    principalType: 'User'
    roleDefinitionId: blobContributorRole
  }
}

resource packageReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(packages.id, web.id, blobReaderRole)
  scope: packages
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobReaderRole
  }
}

resource packageUploader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(packages.id, packageUploaderObjectId, blobContributorRole)
  scope: packages
  properties: {
    principalId: packageUploaderObjectId
    principalType: 'User'
    roleDefinitionId: blobContributorRole
  }
}

output webAppName string = web.name
output webAppId string = web.id
output storageAccountName string = storage.name
output storageContainerName string = container.name
output packageContainerName string = packages.name
output openAiAccountId string = ai.id
output openAiEndpoint string = ai.properties.endpoint
output openAiDeployment string = plannerDeploymentName
output openAiContentFilterPolicy string = contentFilter.name
