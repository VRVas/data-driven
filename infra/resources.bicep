// =====================================================================
//  Resource module (resource-group scope)
//  Provisions the full platform footprint for data-driven.
// =====================================================================
metadata description = 'Core resources: Container Apps, Cosmos DB, ACR, Key Vault, AI Foundry, monitoring.'

@description('Primary location for all resources.')
param location string

@description('Deterministic token to make resource names unique.')
param resourceToken string

@description('Tags applied to every resource.')
param tags object

@description('Container image for the web app. azd overrides this after the first build.')
param webImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Chat model to deploy in Azure AI Foundry.')
param chatModelName string = 'gpt-5.4-mini'

@description('Chat model version.')
param chatModelVersion string = '2026-03-17'

@description('Deployment SKU capacity (thousands of tokens/min) for the chat model.')
param chatModelCapacity int = 30

@description('Foundry project name (new Foundry project, child of the account).')
param aiProjectName string = 'data-driven'

@description('Name of the Foundry prompt agent created at deploy time (visible in the Foundry portal).')
param agentName string = 'data-driven-copilot'

@description('System instructions that define the prompt agent behavior.')
param agentInstructions string = 'You are the data-driven business-development copilot. You help the team reason over the client pipeline, lead scores, industry strategy and whitespace. Be concise, cite the data you use, and never invent numbers.'

@description('Auth.js session secret (openssl rand -base64 32). Injected as a Container Apps secret.')
@secure()
param authSecret string

@description('Object id of the deploying principal (azd AZURE_PRINCIPAL_ID); granted rights to create the agent.')
param deployerPrincipalId string = ''

@description('Deploy Azure Communication Services email (one-click outreach). Off by default.')
param deployEmail bool = false

// ---- naming ---------------------------------------------------------
var prefix = 'datadriven'
var law = '${prefix}-log-${resourceToken}'
var appiName = '${prefix}-appi-${resourceToken}'
var acrName = replace('${prefix}acr${resourceToken}', '-', '')
var kvName = take(replace('${prefix}kv${resourceToken}', '-', ''), 24)
var uamiName = '${prefix}-id-${resourceToken}'
var cosmosName = '${prefix}-cosmos-${resourceToken}'
var caeName = '${prefix}-cae-${resourceToken}'
var appName = '${prefix}-web-${resourceToken}'
var aiName = '${prefix}-ai-${resourceToken}'
var acsName = '${prefix}-acs-${resourceToken}'
var vnetName = '${prefix}-vnet-${resourceToken}'
var cosmosPeName = '${prefix}-pe-cosmos-${resourceToken}'

var cosmosDatabase = 'bd'

// built-in role definition IDs
var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
var roleKvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
var roleOpenAIUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User (inference)
var roleCogSvcUser = 'a97b65f3-24c7-4388-baec-2e87135dc908' // Cognitive Services User (read account/deployments)
var roleFoundryUser = '53ca6127-db72-4b80-b1b0-d745d6d5456d' // Foundry User (create/edit + consume agents, data plane)
var roleFoundryProjectManager = 'eadc314b-1a2d-4efa-be10-5d325db5065e' // Foundry Project Manager (deployer creates agent)
var roleCosmosDataContributor = '00000000-0000-0000-0000-000000000002' // Cosmos DB Built-in Data Contributor

// =====================================================================
//  Identity
// =====================================================================
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: uamiName
  location: location
  tags: tags
}

// =====================================================================
//  Observability
// =====================================================================
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: law
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    sku: { name: 'PerGB2018' }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appiName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: true
  }
}

// =====================================================================
//  Container Registry
// =====================================================================
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, roleAcrPull)
  scope: acr
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
  }
}

// =====================================================================
//  Key Vault (RBAC)
// =====================================================================
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uami.id, roleKvSecretsUser)
  scope: kv
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvSecretsUser)
  }
}

// =====================================================================
//  Virtual network (private networking for Cosmos DB)
// =====================================================================
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ '10.20.0.0/22' ] }
    subnets: [
      {
        name: 'aca'
        properties: {
          addressPrefix: '10.20.0.0/27'
          delegations: [
            { name: 'aca', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        name: 'pe'
        properties: {
          addressPrefix: '10.20.1.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// =====================================================================
//  Cosmos DB (NoSQL, serverless) — PRIVATE (no public access)
// =====================================================================
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: false
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
    locations: [ { locationName: location, failoverPriority: 0 } ]
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: cosmosDatabase
  properties: {
    resource: { id: cosmosDatabase }
  }
}

var containers = [
  { name: 'brands', pk: '/id' }
  { name: 'agents', pk: '/id' }
  { name: 'industries', pk: '/name' }
  { name: 'users', pk: '/email' }
]

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for c in containers: {
    parent: cosmosDb
    name: c.name
    properties: {
      resource: {
        id: c.name
        partitionKey: { paths: [ c.pk ], kind: 'Hash' }
      }
    }
  }
]

// data-plane access for the app identity
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, uami.id, roleCosmosDataContributor)
  properties: {
    principalId: uami.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${roleCosmosDataContributor}'
    scope: cosmos.id
  }
}

// private endpoint + private DNS for Cosmos (reachable only from the VNet)
resource cosmosPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: cosmosPeName
  location: location
  tags: tags
  properties: {
    subnet: { id: '${vnet.id}/subnets/pe' }
    privateLinkServiceConnections: [
      {
        name: 'cosmos'
        properties: {
          privateLinkServiceId: cosmos.id
          groupIds: [ 'Sql' ]
        }
      }
    ]
  }
}

resource cosmosDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
  tags: tags
}

resource cosmosDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: cosmosDnsZone
  name: '${vnetName}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

resource cosmosPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: cosmosPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'documents', properties: { privateDnsZoneId: cosmosDnsZone.id } }
    ]
  }
}

// =====================================================================
//  Azure AI Foundry — NEW Foundry (V2): account + project + model
//  Grounded in MS Learn:
//   - Bicep sample: https://learn.microsoft.com/azure/templates/microsoft.cognitiveservices/accounts/projects
//   - Create a project: https://learn.microsoft.com/azure/foundry/how-to/create-projects
//  `allowProjectManagement: true` is what makes this a new Foundry account
//  (enables `projects` child resources). This is basic agent setup — agent
//  thread state lives in Microsoft-managed storage, so our serverless app
//  Cosmos DB stays independent. (Standard setup w/ capabilityHosts needs
//  provisioned-throughput Cosmos: 3-5 containers @ >=1000 RU/s per project.)
// =====================================================================
resource ai 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: aiName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    allowProjectManagement: true
    customSubDomainName: aiName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

// Foundry project (new Foundry child resource) — container for agents/access/data isolation
resource aiProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: ai
  name: aiProjectName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: 'data-driven'
    description: 'Business-development copilot: chat-with-your-data and reasoning over the pipeline.'
  }
}

// gpt-5.4-mini model deployment on the Foundry account
resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: ai
  name: chatModelName
  sku: { name: 'GlobalStandard', capacity: chatModelCapacity }
  properties: {
    model: { format: 'OpenAI', name: chatModelName, version: chatModelVersion }
  }
}

// app identity -> inference. Documented role: "Web app -> Azure OpenAI -> Inference".
resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, uami.id, roleOpenAIUser)
  scope: ai
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleOpenAIUser)
  }
}

// app identity -> read the AI Services account & resolve model deployments
resource cogSvcUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, uami.id, roleCogSvcUser)
  scope: ai
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCogSvcUser)
  }
}

// app identity -> create/edit + consume Foundry agents (data plane)
resource foundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ai.id, uami.id, roleFoundryUser)
  scope: ai
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleFoundryUser)
  }
}

// -------------------------------------------------------------------
//  Foundry PROMPT AGENT (data-plane, keyless)
//  Prompt agents are created via the Foundry Projects API, not ARM. A Bicep
//  `deploymentScripts` would require storage-account KEYS, which the no-key
//  policy forbids — so the agent is created by the keyless azd `postprovision`
//  hook (scripts/create-agent.sh) with the deployer's Entra token. The deployer
//  is granted Foundry Project Manager here so it can create the agent.
//  Docs: https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-agent
// -------------------------------------------------------------------
resource deployerAgentCreator 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(ai.id, deployerPrincipalId, roleFoundryProjectManager)
  scope: ai
  properties: {
    principalId: deployerPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleFoundryProjectManager)
  }
}

// =====================================================================
//  Communication Services (optional — one-click email outreach)
// =====================================================================
resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = if (deployEmail) {
  name: acsName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'Europe'
  }
}

// =====================================================================
//  Container Apps
// =====================================================================
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caeName
  location: location
  tags: tags
  properties: {
    // Keyless logging: route to Azure Monitor, then a diagnostic setting to Log Analytics.
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    // VNet-integrated so the app can reach the private Cosmos endpoint.
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/aca'
      internal: false
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// Container Apps env logs -> Log Analytics via diagnostic settings (Entra, no shared key)
resource caeDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: cae
  name: 'to-law'
  properties: {
    workspaceId: logs.id
    logs: [ { categoryGroup: 'allLogs', enabled: true } ]
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  // azd matches services to this tag
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    managedEnvironmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        { server: acr.properties.loginServer, identity: uami.id }
      ]
      secrets: [
        { name: 'auth-secret', value: authSecret }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'PORT', value: '3000' }
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'AUTH_TRUST_HOST', value: 'true' }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'COSMOS_DATABASE', value: cosmosDatabase }
            { name: 'AZURE_OPENAI_ENDPOINT', value: ai.properties.endpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: chatModelName }
            { name: 'AZURE_AI_PROJECT_ENDPOINT', value: 'https://${aiName}.services.ai.azure.com/api/projects/${aiProjectName}' }
            { name: 'AZURE_AI_PROJECT_NAME', value: aiProjectName }
            { name: 'AZURE_AI_AGENT_NAME', value: agentName }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
      scale: { minReplicas: 0, maxReplicas: 3 }
    }
  }
}

// =====================================================================
//  Outputs (consumed by azd / the app)
// =====================================================================
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.properties.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = acr.name
output WEB_URI string = 'https://${app.properties.configuration.ingress.fqdn}'
output COSMOS_ENDPOINT string = cosmos.properties.documentEndpoint
output COSMOS_DATABASE string = cosmosDatabase
output AZURE_OPENAI_ENDPOINT string = ai.properties.endpoint
output AZURE_OPENAI_DEPLOYMENT string = chatModelName
output AZURE_AI_FOUNDRY_NAME string = ai.name
output AZURE_AI_PROJECT_NAME string = aiProject.name
output AZURE_AI_PROJECT_ENDPOINT string = 'https://${aiName}.services.ai.azure.com/api/projects/${aiProjectName}'
output AZURE_AI_AGENT_NAME string = agentName
output AGENT_INSTRUCTIONS string = agentInstructions
output KEY_VAULT_NAME string = kv.name
output MANAGED_IDENTITY_CLIENT_ID string = uami.properties.clientId
