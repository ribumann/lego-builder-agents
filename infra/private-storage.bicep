targetScope = 'resourceGroup'

param webAppName string
param storageAccountName string
param location string = 'italynorth'

resource web 'Microsoft.Web/sites@2023-12-01' existing = {
  name: webAppName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
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
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.91.0.64/26'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'app-integration'
}

resource endpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' existing = {
  parent: vnet
  name: 'private-endpoints'
}

resource integration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: web
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: appSubnet.id
    swiftSupported: true
  }
}

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
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

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'bricklab-storage-private'
  location: location
  properties: {
    subnet: {
      id: endpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'blob'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: zone.id
        }
      }
    ]
  }
}

output networkId string = vnet.id
output endpointId string = privateEndpoint.id
