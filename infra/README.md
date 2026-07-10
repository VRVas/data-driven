# Infrastructure (Azure · Bicep + azd)

> **Governing rule — READ FIRST.**
> **Everything pertaining to cloud deployment MUST adhere to official Microsoft Learn
> documentation.** Every resource type, API version, property, RBAC role and setup
> pattern in this folder is grounded in MS Learn (verified via the Microsoft Learn MCP
> server). When changing infra, re-check the docs first and update the citations below.
> Do not hand-wave API versions or role GUIDs — cite the page.

One-command deploy:

```bash
# Region defaults to Sweden Central; override with: azd env set AZURE_LOCATION <region>
azd env set AZURE_LOCATION swedencentral
# AUTH_SECRET is required (Auth.js session secret) and injected as a Container Apps secret.
azd env set AUTH_SECRET "$(openssl rand -base64 32)"
azd up      # provisions infra/main.bicep, builds the image, deploys the Container App
```

## What gets deployed

| Resource | Type / API version | Purpose |
| --- | --- | --- |
| AI Foundry account | `Microsoft.CognitiveServices/accounts@2025-06-01` (`kind: AIServices`, `allowProjectManagement: true`) | **New Foundry (V2)** account |
| AI Foundry project | `Microsoft.CognitiveServices/accounts/projects@2025-06-01` | Foundry project (agents / data isolation) |
| Model deployment | `Microsoft.CognitiveServices/accounts/deployments@2025-06-01` (`gpt-5.4-mini` 2026-03-17, GlobalStandard) | Chat model for the copilot |
| Prompt agent | Projects API via **azd postprovision hook** (keyless) | Foundry **prompt agent** (data-plane), visible in the portal |
| App data store | `Microsoft.DocumentDB/databaseAccounts@2024-11-15` (NoSQL, **serverless**, `disableLocalAuth: true`, **`publicNetworkAccess: Disabled`**) | Brands / agents / industries / users |
| Virtual network | `Microsoft.Network/virtualNetworks@2023-11-01` (`aca` /27 + `pe` /24 subnets) | Private networking |
| Cosmos private endpoint + DNS | `privateEndpoints@2023-11-01` (groupId `Sql`) + `privatelink.documents.azure.com` | Private Cosmos access |
| Web app | `Microsoft.App/containerApps@2024-03-01` (Consumption workload profile) | Next.js SSR + API (scale-to-zero) |
| Environment | `Microsoft.App/managedEnvironments@2024-03-01` (VNet-integrated, logs → Azure Monitor) | Container Apps env |
| Registry | `Microsoft.ContainerRegistry/registries@2023-07-01` (Basic, admin disabled) | Image storage (MI pull) |
| Identity | `Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31` | App identity (Entra-only auth) |
| Key Vault | `Microsoft.KeyVault/vaults@2023-07-01` (RBAC) | Secrets |
| Monitoring | Log Analytics + Application Insights (`DisableLocalAuth: true`) | Observability |
| Email (optional) | `Microsoft.Communication/communicationServices` | One-click outreach (`deployEmail=true`) |

## Azure AI Foundry — new Foundry (V2)

This uses the **new Foundry resource model**, not the legacy Hub/Project
(`Microsoft.MachineLearningServices/workspaces`). The distinguishing element is the
`allowProjectManagement: true` flag on the `Microsoft.CognitiveServices/accounts`
resource, which turns it into a Foundry account and enables `accounts/projects`
children.

### Prompt agent (data-plane, keyless)

A Foundry **prompt agent** is a *declaratively defined* agent (model + instructions +
tools). Per MS Learn it is created through the **Projects API**, not as an ARM
resource. A Bicep `deploymentScripts` would need **storage-account keys**, which the
no-key policy forbids — so the agent is created by an **azd `postprovision` hook**
([scripts/create-agent.sh](../scripts/create-agent.sh)) that runs the documented REST
call (`POST {projectEndpoint}/agents?api-version=v1`, `"kind": "prompt"`) with the
deployer's Entra token. The deployer is granted **Foundry Project Manager** in Bicep so
it can create the agent, which is then visible in the Foundry portal. Tune it with the
`agentName` / `agentInstructions` parameters.

- Prompt agent quickstart: <https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-agent>

- Account + project Bicep sample (exact pattern we follow):
  <https://learn.microsoft.com/azure/templates/microsoft.cognitiveservices/accounts/projects>
- Create a project for Microsoft Foundry:
  <https://learn.microsoft.com/azure/foundry/how-to/create-projects>
- `allowProjectManagement` property reference:
  <https://learn.microsoft.com/azure/templates/microsoft.cognitiveservices/accounts>
- Project endpoint format `https://<resource>.services.ai.azure.com/api/projects/<project>`:
  <https://learn.microsoft.com/azure/foundry/quickstarts/get-started-code>
- Reference pattern module (AVM): `br/public:avm/ptn/ai-ml/ai-foundry`

### Basic vs Standard agent setup (important)

We deploy **basic agent setup**: agent thread state lives in Microsoft-managed
storage, so our **serverless** app Cosmos DB stays independent and cheap.

**Standard agent setup** (bring-your-own Cosmos/Search/Storage via
`accounts/projects/capabilityHosts`, GA `@2025-09-01` / `@2025-12-01`) requires
Cosmos DB with **provisioned throughput** — 3–5 containers at **≥1000 RU/s each per
project**. Only adopt it when agent-thread data residency is required; it is not
serverless-compatible.

- Standard agent setup: <https://learn.microsoft.com/azure/foundry/agents/concepts/standard-agent-setup>
- Use your own resources: <https://learn.microsoft.com/azure/foundry/agents/how-to/use-your-own-resources>

## RBAC (managed identity → services)

All service-to-service auth is Microsoft Entra ID via the user-assigned managed
identity — no keys. Grounded role IDs:

| Role | ID | Scope | Source |
| --- | --- | --- | --- |
| Cognitive Services OpenAI User | `5e0bd9bd-7b93-4f28-af87-19fc36ad61bd` | Foundry account | inference ("Web app → Azure OpenAI") |
| Cognitive Services User | `a97b65f3-24c7-4388-baec-2e87135dc908` | Foundry account | read account / resolve deployments |
| AcrPull | `7f951dda-4ed3-4680-a7ca-43fe172d538d` | ACR | image pull |
| Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` | Key Vault | read secrets |
| Cosmos DB Built-in Data Contributor | `00000000-0000-0000-0000-000000000002` | Cosmos (data plane) | read/write data |
| Foundry User | `53ca6127-db72-4b80-b1b0-d745d6d5456d` | Foundry account | app creates/consumes agents |
| Foundry Project Manager | `eadc314b-1a2d-4efa-be10-5d325db5065e` | Foundry account | deployer creates the prompt agent |

- Built-in role IDs: <https://learn.microsoft.com/azure/role-based-access-control/built-in-roles#ai-+-machine-learning>
- Container Apps image pull with managed identity (Bicep): <https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull>
- Cosmos DB RBAC + disable local auth: <https://learn.microsoft.com/azure/cosmos-db/how-to-connect-role-based-access-control>

> When we add the Foundry **Agent Service** client (project endpoint), grant the app
> identity the **Foundry User** role at project scope (per hosted-agent-permissions
> docs) — added in the agent phase, since some agent-identity assignments can only be
> created after the agent exists.

## Compliance: no key-based auth, private Cosmos

Per the target subscription policy (MCAPS): **no key-based auth anywhere** and **no
public access to Cosmos DB**.

- **All auth is Microsoft Entra ID / managed identity** — no account keys, shared keys or
  connection-string keys:
  - Cosmos DB & Foundry account: `disableLocalAuth: true`.
  - ACR: admin user disabled (managed-identity pull).
  - Key Vault: RBAC only.
  - Application Insights: `DisableLocalAuth: true`.
  - Container Apps logs: `destination: azure-monitor` + a diagnostic setting — **no Log
    Analytics shared key**.
  - **No `deploymentScripts`** (they require storage keys); the agent uses the keyless hook.
- **Cosmos DB is private:** `publicNetworkAccess: Disabled` + a **private endpoint**
  (`groupId: Sql`) in the VNet, resolved via the private DNS zone
  `privatelink.documents.azure.com`. The Container Apps environment is **VNet-integrated**
  (`infrastructureSubnetId`, `/27` subnet delegated to `Microsoft.App/environments`) so the
  app reaches Cosmos over the private endpoint.

- Cosmos private endpoint: <https://learn.microsoft.com/azure/cosmos-db/how-to-configure-private-endpoints>
- Container Apps VNet integration: <https://learn.microsoft.com/azure/container-apps/custom-virtual-networks>
- Container Apps logs to Azure Monitor: <https://learn.microsoft.com/azure/container-apps/log-options>

## Production hardening notes

- Foundry account `disableLocalAuth: true` — Entra-ID/managed-identity only, no API keys
  (per <https://learn.microsoft.com/azure/ai-foundry/openai/how-to/managed-identity>).
- Cosmos DB `disableLocalAuth: true` — Entra-only; data-plane RBAC via managed identity.
- `AUTH_SECRET` is stored as a Container Apps **secret** (`auth-secret`) and surfaced to the
  app via `secretRef`; `AUTH_TRUST_HOST=true` is set for the HTTPS ingress proxy.
- `gpt-5.4-mini` deployment `capacity` (`chatModelCapacity`, default 30) is subject to
  regional quota; lower it if a deploy fails on quota.
