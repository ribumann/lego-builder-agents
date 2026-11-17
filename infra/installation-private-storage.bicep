targetScope = 'resourceGroup'

param location string = resourceGroup().location
param storageAccountName string

resource network 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: 'bricklab-network'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: network
  name: 'private-services'
  properties: {
    addressPrefix: '10.91.0.64/26'
    privateEndpointNetworkPolicies: 'Disabled'
  }
}

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
}

resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'bricklab-isolated'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource endpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'bricklab-package-private'
  location: location
  properties: {
    subnet: {
      id: subnet.id
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

resource dns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: endpoint
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

output endpointId string = endpoint.id
