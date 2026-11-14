targetScope = 'resourceGroup'

@description('Existing dedicated Speech account name.')
param speechName string

@description('Object ID of the temporary, private test runner identity.')
param testPrincipalId string

@description('Resource ID of the temporary, private test runner virtual network.')
param testVnetId string

var speechUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f2dc8367-1007-4938-bd23-fe263f013447')

resource speech 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: speechName
}

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' existing = {
  name: 'privatelink.cognitiveservices.azure.com'
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

output temporaryRoleId string = testRole.id
output temporaryDnsLinkId string = runnerDnsLink.id
