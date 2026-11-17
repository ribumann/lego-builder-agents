targetScope = 'resourceGroup'

@description('Explicitly temporary, separately authorized private-network builder/uploader. No SSH or RDP ingress.')
param ownerTag string
param sshPublicKey string
param webAppName string
param storageAccountName string
param location string = 'swedencentral'
param vmSize string = 'Standard_D2as_v5'

var name = 'bricklab-temp-uploader'
var tags = {
  'bricklab-temporary-uploader': ownerTag
}
var reader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
var websiteContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772')
var blobContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource network 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${name}-network'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.93.0.0/24'
      ]
    }
  }
}
resource web 'Microsoft.Web/sites@2023-12-01' existing = {
  name: webAppName
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}
resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobs
  name: 'packages'
}
resource usage 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobs
  name: 'usage'
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${name}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'deny-all-inbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: network
  name: 'temporary-uploader'
  properties: {
    addressPrefix: '10.93.0.0/26'
    defaultOutboundAccess: false
    networkSecurityGroup: {
      id: nsg.id
    }
  }
}

resource privateSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: network
  name: 'private-services'
  dependsOn: [
    subnet
  ]
  properties: {
    addressPrefix: '10.93.0.64/26'
    privateEndpointNetworkPolicies: 'Disabled'
  }
}
resource endpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${name}-private'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateSubnet.id
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
resource publicIp 'Microsoft.Network/publicIPAddresses@2023-11-01' = {
  name: '${name}-egress'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: '${name}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'primary'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: subnet.id
          }
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        name: '${name}-os'
        createOption: 'FromImage'
        deleteOption: 'Detach'
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
      }
    }
    osProfile: {
      computerName: name
      adminUsername: 'bricklab'
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/bricklab/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
          properties: {
            deleteOption: 'Detach'
          }
        }
      ]
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
  }
}

resource metadataReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, name, reader)
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: reader
  }
}
resource appUpdater 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(web.id, name, websiteContributor)
  scope: web
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: websiteContributor
  }
}
resource packageUploader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(packages.id, name, blobContributor)
  scope: packages
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributor
  }
}
resource usageInitializer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(usage.id, name, blobContributor)
  scope: usage
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributor
  }
}

output vmId string = vm.id
output principalId string = vm.identity.principalId
output egressIp string = publicIp.properties.ipAddress
output roleAssignmentIds array = [
  metadataReader.id
  appUpdater.id
  packageUploader.id
  usageInitializer.id
]
output temporaryResourceIds array = [
  vm.id
  nic.id
  publicIp.id
  nsg.id
  endpoint.id
  network.id
]
output privateEndpointId string = endpoint.id
output osDiskName string = '${name}-os'
