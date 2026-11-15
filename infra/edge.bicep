targetScope = 'resourceGroup'

param webAppName string
param customHost string
param enableCustomDomain bool = false

var suffix = uniqueString(subscription().id, resourceGroup().id)

resource web 'Microsoft.Web/sites@2023-12-01' existing = {
  name: webAppName
}

resource profile 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: 'bricklab-edge'
  location: 'global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  properties: {
    originResponseTimeoutSeconds: 240
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: profile
  name: 'bricklab-${suffix}'
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource domain 'Microsoft.Cdn/profiles/customDomains@2023-05-01' existing = {
  parent: profile
  name: 'bricklab-custom'
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: profile
  name: 'bricklab-origin'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: originGroup
  name: 'bricklab-app'
  properties: {
    hostName: web.properties.defaultHostName
    originHostHeader: customHost
    httpPort: 80
    httpsPort: 443
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
    priority: 1
    weight: 1000
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: endpoint
  name: 'bricklab'
  dependsOn: [
    origin
  ]
  properties: {
    originGroup: {
      id: originGroup.id
    }
    customDomains: enableCustomDomain ? [
      {
        id: domain.id
      }
    ] : []
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
}

resource waf 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: 'bricklabwaf${suffix}'
  location: 'global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Prevention'
    }
    customRules: {
      rules: [
        {
          name: 'PlannerRateLimit'
          priority: 1
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: 10
          action: 'Block'
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              matchValue: [
                '/api/azure-plan'
              ]
            }
          ]
        }
      ]
    }
  }
}

resource securityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2023-05-01' = {
  parent: profile
  name: 'bricklab-waf'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: waf.id
      }
      associations: [
        {
          domains: concat([
            {
              id: endpoint.id
            }
          ], enableCustomDomain ? [
            {
              id: domain.id
            }
          ] : [])
          patternsToMatch: [
            '/*'
          ]
        }
      ]
    }
  }
}

output frontDoorId string = profile.properties.frontDoorId
output endpointHost string = endpoint.properties.hostName
output wafPolicyId string = waf.id
