targetScope = 'resourceGroup'

@description('Region for the isolated BrickLab resources.')
param location string = resourceGroup().location

@description('Region for the App Service plan and web app.')
param webLocation string = 'italynorth'

@description('Front Door profile ID; leave empty to deny all origin traffic.')
param frontDoorId string = ''

@description('Object ID of the operator allowed to upload release packages.')
param packageUploaderObjectId string

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
    publicNetworkAccess: 'Disabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appCommandLine: 'npm start'
      ipSecurityRestrictionsDefaultAction: 'Deny'
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: empty(frontDoorId) ? [] : [
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

resource model 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: ai
  name: 'bricklab-planner-gpt54'
  sku: {
    name: 'DataZoneStandard'
    capacity: 1
  }
  properties: {
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
output openAiDeployment string = model.name
