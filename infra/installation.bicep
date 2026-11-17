targetScope = 'resourceGroup'

param location string = resourceGroup().location

@description('One stable public operator/runner IPv4 address with /32 suffix. No broad networks.')
param operatorIpv4Cidr string

@description('Entra object ID, not application/client ID, of the package uploader.')
param packageUploaderObjectId string

@allowed([
  'User'
  'ServicePrincipal'
])
param packageUploaderPrincipalType string = 'User'

var suffix = uniqueString(subscription().id, resourceGroup().id)
var webName = 'bricklab-${suffix}'
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var blobReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'bricklab-plan'
  location: location
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

resource network 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'bricklab-network'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.91.0.0/24'
      ]
    }
    subnets: [
      {
        name: 'app-integration'
        properties: {
          addressPrefix: '10.91.0.0/26'
          delegations: [
            {
              name: 'app-service'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          serviceEndpoints: [
            {
              service: 'Microsoft.Storage'
            }
          ]
        }
      }
    ]
  }
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: network
  name: 'app-integration'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'bricklab${suffix}'
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
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
      ipRules: [
        {
          action: 'Allow'
          value: split(operatorIpv4Cidr, '/')[0]
        }
      ]
      virtualNetworkRules: [
        {
          action: 'Allow'
          id: subnet.id
        }
      ]
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'packages'
  properties: {
    publicAccess: 'None'
  }
}

resource usage 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'usage'
  properties: {
    publicAccess: 'None'
  }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: subnet.id
    vnetRouteAllEnabled: true
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      numberOfWorkers: 1
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
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
          value: '50'
        }
        {
          name: 'BRICKLAB_PLANNING_CONCURRENCY'
          value: '20'
        }
        {
          name: 'BRICKLAB_PROVIDER_CONCURRENCY'
          value: '20'
        }
        {
          name: 'WEBSITE_VNET_ROUTE_ALL'
          value: '1'
        }
      ]
      ipSecurityRestrictionsDefaultAction: 'Deny'
      ipSecurityRestrictions: [
        {
          name: 'operator-only'
          action: 'Allow'
          priority: 100
          ipAddress: operatorIpv4Cidr
        }
      ]
      scmIpSecurityRestrictionsUseMain: false
      scmIpSecurityRestrictionsDefaultAction: 'Deny'
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

resource packageReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(packages.id, web.id, blobReaderRole)
  scope: packages
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobReaderRole
  }
}

resource usageWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(usage.id, web.id, blobContributorRole)
  scope: usage
  properties: {
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

resource packageUploader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(packages.id, packageUploaderObjectId, blobContributorRole)
  scope: packages
  properties: {
    principalId: packageUploaderObjectId
    principalType: packageUploaderPrincipalType
    roleDefinitionId: blobContributorRole
  }
}

resource usageInitializer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(usage.id, packageUploaderObjectId, blobContributorRole)
  scope: usage
  properties: {
    principalId: packageUploaderObjectId
    principalType: packageUploaderPrincipalType
    roleDefinitionId: blobContributorRole
  }
}

output webAppName string = web.name
output storageAccountName string = storage.name
output origin string = 'https://${web.properties.defaultHostName}'
