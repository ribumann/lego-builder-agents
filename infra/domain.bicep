targetScope = 'resourceGroup'

param customHost string

resource profile 'Microsoft.Cdn/profiles@2023-05-01' existing = {
  name: 'bricklab-edge'
}

resource domain 'Microsoft.Cdn/profiles/customDomains@2023-05-01' = {
  parent: profile
  name: 'bricklab-custom'
  properties: {
    hostName: customHost
    tlsSettings: {
      certificateType: 'ManagedCertificate'
      minimumTlsVersion: 'TLS12'
    }
  }
}

output validationToken string = domain.properties.validationProperties.validationToken
output domainId string = domain.id
