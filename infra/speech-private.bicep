targetScope = 'resourceGroup'

@description('Speech account name and its matching custom subdomain.')
param speechName string

@description('Speech model and pricing region.')
param speechLocation string = 'swedencentral'

@description('Location of the existing private endpoint subnet.')
param networkLocation string = 'italynorth'

@description('Object ID of the temporary, private test runner identity.')
param testPrincipalId string

@description('Resource ID of the temporary, private test runner virtual network.')
param testVnetId string

var speechUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f2dc8367-1007-4938-bd23-fe263f013447')

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: 'bricklab-network'
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'private-endpoints'
}

resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: speechName
  location: speechLocation
  kind: 'SpeechServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: speechName
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
  }
}

resource testRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, testPrincipalId, speechUserRole)
  scope: speech
  properties: {
    principalId: testPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: speechUserRole
  }
}

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.cognitiveservices.azure.com'
  location: 'global'
}

resource appDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'bricklab'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource runnerDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'temporary-runner'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: testVnetId
    }
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'bricklab-speech-private'
  location: networkLocation
  properties: {
    subnet: {
      id: subnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'speech'
        properties: {
          privateLinkServiceId: speech.id
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'speech'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'speech'
        properties: {
          privateDnsZoneId: zone.id
        }
      }
    ]
  }
}

output speechAccountId string = speech.id
output speechEndpoint string = 'https://${speechName}.cognitiveservices.azure.com'
output privateEndpointId string = privateEndpoint.id
output temporaryRoleId string = testRole.id
