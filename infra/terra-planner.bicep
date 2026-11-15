targetScope = 'resourceGroup'

@description('Existing dedicated BrickLab Azure OpenAI account in a region offering this model and SKU.')
param accountName string

@description('Global Standard token-billed quota units, not provisioned throughput. Check available quota first.')
@minValue(1)
param capacity int = 40

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
}

resource planner 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'bricklab-planner-terra'
  sku: {
    name: 'GlobalStandard'
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-6.1-terra'
      version: '2026-10-26'
    }
    raiPolicyName: 'bricklab-public-safe'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

output deploymentName string = planner.name
output deploymentId string = planner.id
