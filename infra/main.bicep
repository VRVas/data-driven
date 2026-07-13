// =====================================================================
//  main.bicep  (subscription scope)
//  Entry point for `azd up`. Creates the resource group and deploys
//  all platform resources into it.
// =====================================================================
targetScope = 'subscription'

metadata description = 'data-driven — one-command Azure deployment.'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment (drives resource naming).')
param environmentName string

@minLength(1)
@description('Primary region for the app tier: Container Apps, Cosmos, ACR, Key Vault, monitoring.')
param location string = 'westeurope'

@description('Region for AI Foundry + all AI/model deployments. Sweden Central is required for feature availability.')
param aiLocation string = 'swedencentral'

@description('Deploy Azure Communication Services email (one-click outreach).')
param deployEmail bool = false

@description('Email address for the monthly cost-budget alert on the resource group. Empty disables it.')
param budgetContactEmail string = ''

@description('Auth.js session secret (openssl rand -base64 32).')
@secure()
param authSecret string

@description('Object id of the deploying user/service principal (azd sets AZURE_PRINCIPAL_ID).')
param principalId string = ''

@description('Chat model to deploy in Azure AI Foundry.')
param chatModelName string = 'gpt-5.4-mini'

@description('Name of the Foundry prompt agent created at deploy time.')
param agentName string = 'data-driven-copilot'

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  application: 'data-driven'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    aiLocation: aiLocation
    resourceToken: resourceToken
    tags: tags
    deployEmail: deployEmail
    chatModelName: chatModelName
    agentName: agentName
    authSecret: authSecret
    deployerPrincipalId: principalId
    budgetContactEmail: budgetContactEmail
  }
}

// azd-consumed outputs
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_CONTAINER_REGISTRY_NAME string = resources.outputs.AZURE_CONTAINER_REGISTRY_NAME
output WEB_URI string = resources.outputs.WEB_URI
output COSMOS_ENDPOINT string = resources.outputs.COSMOS_ENDPOINT
output COSMOS_DATABASE string = resources.outputs.COSMOS_DATABASE
output AZURE_OPENAI_ENDPOINT string = resources.outputs.AZURE_OPENAI_ENDPOINT
output AZURE_OPENAI_DEPLOYMENT string = resources.outputs.AZURE_OPENAI_DEPLOYMENT
output AZURE_AI_PROJECT_ENDPOINT string = resources.outputs.AZURE_AI_PROJECT_ENDPOINT
output AZURE_AI_PROJECT_NAME string = resources.outputs.AZURE_AI_PROJECT_NAME
output AZURE_AI_AGENT_NAME string = resources.outputs.AZURE_AI_AGENT_NAME
output AGENT_INSTRUCTIONS string = resources.outputs.AGENT_INSTRUCTIONS
output KEY_VAULT_NAME string = resources.outputs.KEY_VAULT_NAME
output MANAGED_IDENTITY_CLIENT_ID string = resources.outputs.MANAGED_IDENTITY_CLIENT_ID
output AZURE_SEARCH_ENDPOINT string = resources.outputs.AZURE_SEARCH_ENDPOINT
output AZURE_SEARCH_NAME string = resources.outputs.AZURE_SEARCH_NAME
output AZURE_SEARCH_CONNECTION_NAME string = resources.outputs.AZURE_SEARCH_CONNECTION_NAME
output AZURE_SEARCH_WEB_KS string = resources.outputs.AZURE_SEARCH_WEB_KS
output AZURE_SEARCH_KNOWLEDGE_BASE string = resources.outputs.AZURE_SEARCH_KNOWLEDGE_BASE
output AZURE_EMBEDDING_DEPLOYMENT string = resources.outputs.AZURE_EMBEDDING_DEPLOYMENT
