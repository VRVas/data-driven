# Infrastructure (Azure - Bicep + azd)

> **Governing rule - READ FIRST.**
> **Everything pertaining to cloud deployment MUST adhere to official Microsoft Learn
> documentation.** Every resource type, API version, property, RBAC role and setup
> pattern in this folder is grounded in MS Learn (verified via the Microsoft Learn MCP
> server). When changing infra, re-check the docs first and update the citations below.
> Do not hand-wave API versions or role GUIDs - cite the page.

## Deploy

Prerequisites: Node.js 22+, npm, Azure CLI, Azure Developer CLI (`azd`), Docker
with its daemon running, Bash and Python 3. Use Linux, macOS or WSL. The deploying
principal needs subscription-level resource deployment and role-assignment
permissions. Confirm model availability and quota in Sweden Central before a
new deployment; quota, tenant policies and regional capacity cannot be created
by this template.

```bash
npm ci
az login --tenant YOUR_TENANT_ID
npm run deploy -- --environment YOUR_ENVIRONMENT --subscription YOUR_SUBSCRIPTION_ID
```

After that first setup, the `npm run deploy` command is the deployment entry
point for local runs and CI. It selects or creates an azd environment, shares
Azure CLI authentication with azd, explicitly executes preprovision, runs
`azd up`, executes postprovision, and checks `/api/health` and `/recovery`.
Hook failures fail the deployment. This also covers the measured hook omission
in azd 1.27.1 and 1.31.0. Versions that execute hooks automatically may publish
an additional prompt-agent version; Search configuration is applied with PUT.

The runner preserves the live container image before provisioning, so an
infrastructure update does not replace it with the placeholder image. It rejects
subscription and region changes to an existing environment. Keep its original
environment name and regions: resource names derive from those values. Use a
new environment for a separate deployment.

`AUTH_SECRET` and `DATA_RECOVERY_KEY` are generated once by
[scripts/preprovision.sh](../scripts/preprovision.sh), stored in the local azd
environment and injected as Container Apps secrets. Keep both stable. CI requires
both as secrets of at least 32 characters and refuses to generate replacements.
On a new deployment, open the reported `/recovery` URL, unlock it with the recovery
key, and initialize or upload a backup. Retrieve the key privately with
`azd env get-value DATA_RECOVERY_KEY`; never paste it into logs or chat.

Default app region: North Europe. Default AI region: Sweden Central. For a new
environment, use `--location REGION` for the app tier. Optional settings can be
set with `azd env set` before redeployment or supplied as environment variables:

```bash
azd env set CHAT_MODEL_SKU DataZoneStandard
azd env set CHAT_MODEL_CAPACITY 200
azd env set EMBEDDING_MODEL_CAPACITY 50
azd env set DEPLOY_EMAIL true
azd env set BUDGET_CONTACT_EMAIL you@example.com
```

All bindings and defaults are in [main.parameters.json](main.parameters.json).
They include model name/version/SKU/capacity, reasoning effort, agent name, email and
OTP flags, recovery, external integrations, budget amount and log-ingestion cap.
The tests check that each operator-controlled binding also exists in CI.

Chat defaults to `DataZoneStandard` with capacity 200. `GlobalStandard` remains an
explicit `CHAT_MODEL_SKU` override. Data Zone Standard processes inference within
the Microsoft-defined data zone; for an AI resource in Sweden Central this is the
EU zone, not necessarily Sweden alone. Model/SKU availability and quota still
depend on the subscription and AI region.

Store deployment-specific values in the azd environment instead of editing Bicep
locally. An existing environment or GitHub variable overrides the template default,
so explicitly replace any old SKU/capacity setting before reprovisioning:

```bash
azd env set CHAT_MODEL_SKU DataZoneStandard --environment YOUR_EXISTING_ENVIRONMENT
azd env set CHAT_MODEL_CAPACITY 200 --environment YOUR_EXISTING_ENVIRONMENT
```

CI uses the corresponding `CHAT_MODEL_SKU` and `CHAT_MODEL_CAPACITY` repository
variables. App-only deployment does not update the model resource; apply these
settings through provisioning or the full deployment runner.

External credentials, Entra app registrations/consent, Telegram bot creation and
webhook registration require operator setup. Key Vault references must already
exist, and an external vault must grant the app identity secret-read access.
The default email domain is Azure-managed and has a low subscription send limit;
leave OTP disabled for production sign-in until a verified custom domain and
appropriate send quota are configured. This template does not configure custom
mail DNS, a custom application hostname or certificates for that hostname.

- azd hooks: <https://learn.microsoft.com/azure/developer/azure-developer-cli/azd-extensibility>
- Shared CLI authentication: <https://learn.microsoft.com/azure/developer/azure-developer-cli/use-terraform-for-azd#authenticate-to-azure>
- Container image deployment behavior: <https://learn.microsoft.com/azure/developer/azure-developer-cli/container-apps-workflows>
- Model deployment SKU and data-zone behavior: <https://learn.microsoft.com/azure/ai-foundry/openai/how-to/deployment-types#data-zone-standard>

## What gets deployed

| Resource | Type / API version | Purpose |
| --- | --- | --- |
| AI Foundry account | `Microsoft.CognitiveServices/accounts@2025-06-01` (`kind: AIServices`, `allowProjectManagement: true`) | **New Foundry (V2)** account |
| AI Foundry project | `Microsoft.CognitiveServices/accounts/projects@2025-06-01` | Foundry project (agents / data isolation) |
| Model deployment | `Microsoft.CognitiveServices/accounts/deployments@2025-06-01` (`gpt-5.4-mini` 2026-03-17, DataZoneStandard, capacity 200) | Chat model for the copilot |
| Prompt agent | Projects API via **azd postprovision hook** (keyless) | Foundry **prompt agent** (data-plane), visible in the portal |
| App data store | `Microsoft.DocumentDB/databaseAccounts@2024-11-15` (NoSQL, **serverless**, `disableLocalAuth: true`, **`publicNetworkAccess: Disabled`**) | 17 baseline containers, including conversations, documents, reminders, notifications, notes, auth challenges and integration tasks |
| Recovery control | Separate Cosmos database/container, management identity and restricted custom role | Durable jobs, routing and staged database creation; active restored datasets stay independent of template updates |
| Search + embeddings | Azure AI Search Basic, private endpoint/DNS, Entra-only connections and `text-embedding-3-large` | Foundry IQ web knowledge source/base, published by the postprovision hook |
| Virtual network | `Microsoft.Network/virtualNetworks@2023-11-01` (`aca` /27 + `pe` /24 subnets) | Private networking |
| Cosmos private endpoint + DNS | `privateEndpoints@2023-11-01` (groupId `Sql`) + `privatelink.documents.azure.com` | Private Cosmos access |
| Web app | `Microsoft.App/containerApps@2024-03-01` (Consumption workload profile) | Next.js SSR + API (min 1 replica, always warm) |
| Environment | `Microsoft.App/managedEnvironments@2024-03-01` (VNet-integrated, logs → Azure Monitor) | Container Apps env |
| Registry | `Microsoft.ContainerRegistry/registries@2023-07-01` (Basic, admin disabled) | Image storage (MI pull) |
| Identity | `Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31` | App identity (Entra-only auth) |
| Key Vault | `Microsoft.KeyVault/vaults@2023-07-01` (RBAC) | Secrets |
| Monitoring | Log Analytics (`workspaceCapping.dailyQuotaGb` cap) + Application Insights (`DisableLocalAuth: true`) + an Azure Monitor **workbook** | Container diagnostics; application request/dependency telemetry requires SDK instrumentation |
| Cost budget (opt-in) | `Microsoft.Consumption/budgets@2023-11-01` | Monthly spend alert (set `BUDGET_CONTACT_EMAIL`) |
| Email (optional) | `Microsoft.Communication/communicationServices` + `emailServices` + `emailServices/domains` (`AzureManaged`) | Real outbound outreach (`DEPLOY_EMAIL=true`) |

## Azure AI Foundry - new Foundry (V2)

This uses the **new Foundry resource model**, not the legacy Hub/Project
(`Microsoft.MachineLearningServices/workspaces`). The distinguishing element is the
`allowProjectManagement: true` flag on the `Microsoft.CognitiveServices/accounts`
resource, which turns it into a Foundry account and enables `accounts/projects`
children.

### Prompt agent (data-plane, keyless)

A Foundry **prompt agent** is a *declaratively defined* agent (model + instructions +
tools). Per MS Learn it is created through the **Projects API**, not as an ARM
resource. A Bicep `deploymentScripts` would need **storage-account keys**, which the
no-key policy forbids - so the agent is created by an **azd `postprovision` hook**
([scripts/create-agent.sh](../scripts/create-agent.sh)) that runs the documented REST
call (`POST {projectEndpoint}/agents?api-version=v1`, `"kind": "prompt"`) with the
deployer's Entra token. The deployer is granted **Foundry Project Manager** in Bicep so
it can create the agent, which is then visible in the Foundry portal. Tune it with the
`agentName` / `agentInstructions` parameters.

This portal prompt agent is separate from the in-app tool loop. The hook publishes
its model and instructions; it does not attach authenticated application tools.
Use the external integration guide to connect an agent to the platform. Creating
the portal agent alone does not grant access to CRM records.

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
Cosmos DB with **provisioned throughput** - 3-5 containers at **≥1000 RU/s each per
project**. Only adopt it when agent-thread data residency is required; it is not
serverless-compatible.

- Standard agent setup: <https://learn.microsoft.com/azure/foundry/agents/concepts/standard-agent-setup>
- Use your own resources: <https://learn.microsoft.com/azure/foundry/agents/how-to/use-your-own-resources>

## RBAC (managed identity → services)

All service-to-service auth is Microsoft Entra ID via the user-assigned managed
identity - no keys. Grounded role IDs:

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
> docs) - added in the agent phase, since some agent-identity assignments can only be
> created after the agent exists.

## Copilot (P6a) - enabling the Foundry-backed chat

The in-app **Copilot** runs a grounded **local preview** with no cloud (deterministic
tool routing). It upgrades to the Foundry model automatically when configured - no code
change, same pattern as ACS email. The template injects the model, endpoint,
reasoning effort and app URL. Local fallback and unimplemented settings are
identified below; an arbitrary `azd env set` does not inject a runtime variable.

| Variable | Purpose |
| --- | --- |
| `COPILOT_CHAT_ENDPOINT` | OpenAI-compatible chat-completions URL of the deployed model (function-calling + structured-output loop). Unset → local preview. |
| `COPILOT_MODEL` | One chat deployment for all requests. Defaults to `gpt-5.4-mini`; configured with `CHAT_MODEL_NAME` and its matching version. |
| `COPILOT_REASONING_EFFORT` | `reasoning_effort` sent when the user turns on **Think deeply** (default `high`, override with `REASONING_EFFORT`). Ordinary asks always send `low`. Never `minimal`: that disables parallel tool calls, and the copilot is a tool-calling loop. If a deployment rejects the parameter outright, the provider drops it and retries once rather than failing the request. |
| `FOUNDRY_MEMORY_STORE_ID` | The preview adapter is a stub. Long-term Foundry memory is not implemented or provisioned; setting this variable does not enable it. |
| `APP_URL` | Public app URL - the `servers` entry in the OpenAPI doc. Set from the Container Apps environment domain. |
| `COPILOT_API_KEY` | Legacy local fallback, deliberately not injected in Azure. Use the documented Entra-authenticated integration instead. |

- The copilot composes answers as **generative-UI blocks** (charts, tables, lead cards,
  callouts, actions) rendered natively - no HTML/Plotly/iframes. The Foundry path emits
  them via **structured outputs** (`response_format: json_schema`); `parseBlocks` (zod) is
  the authoritative validator.
- **Streaming** is Server-Sent Events (`POST /api/copilot/stream`, events `block`/`tools`/`done`).
- **Memory**: conversation threads persist in Cosmos. The separate long-term
  Foundry memory adapter remains unimplemented.
- The app identity already holds **Cognitive Services OpenAI User**, so model calls are
  **keyless** (managed identity) - no key needed for the chat path.
- Tool surface for a Foundry agent: register `GET {APP_URL}/api/copilot/openapi`
  (OpenAPI 3.0) as an **OpenAPI tool**. Write tools (`advance_lead_stage`, `draft_outreach`)
  are rejected on the key channel and only run under a signed-in user; `draft_outreach`
  never sends - it queues for admin approval.


## Data recovery

Data & Recovery uses a separate `bd-recovery` control database and a dedicated
managed identity for creating staged databases/containers and listing stored
procedures, triggers and UDFs through Azure Resource Manager. Its account-scoped
custom role includes only read access for those script inventories, not script
writes or execution. This avoids Cosmos 403/substatus 5300 from unsupported
Entra-authenticated script-management calls on the data plane. Existing document
access remains keyless and private. The app selects the active dataset through
the independent control record; imported data is verified before activation.

Existing deployments need both provisioning and app deployment for this update;
use `npm run deploy -- --environment YOUR_EXISTING_ENVIRONMENT` with the original
environment settings and secrets. App-only `azd deploy` leaves the old role in place.
Role actions: <https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/databases#microsoftdocumentdb>.

The preprovision hook generates `DATA_RECOVERY_KEY` once alongside `AUTH_SECRET`.
Both values must remain stable across CI deployments. Empty recovery-enabled
environments open `/recovery` instead of automatically seeding the bundled data.
See [../docs/DATA_RECOVERY_GUIDE.md](../docs/DATA_RECOVERY_GUIDE.md) for setup,
permissions, backup encryption, import transformations, and rollback limits.

## External copilot integrations

REST v1, A2A 1.0, and Telegram are opt-in. The deployment declares the
`copilotIntegrations` Cosmos container with `/partitionKey` and `defaultTtl: -1`,
plus conditional Key Vault-backed client and Telegram settings. The complete
variable table, activation procedure, verification gates, and recovery rules are in
[../docs/COPILOT_INTEGRATION_GUIDE.md](../docs/COPILOT_INTEGRATION_GUIDE.md).

Production application clients should use the Entra path under the policy below.
The opaque client-token option is for development or environments where policy
explicitly allows it. Telegram's native bot credential and CRM data transfer need
separate policy approval before that channel is enabled. Azure data-plane account
keys remain disabled. Keep at least one app replica running for the durable task
and Telegram workers. Webhook registration is a separate operator action.

## Compliance: no key-based auth, private Cosmos

Per the target subscription policy (MCAPS): **no key-based auth anywhere** and **no
public access to Cosmos DB**.

- **All auth is Microsoft Entra ID / managed identity** - no account keys, shared keys or
  connection-string keys:
  - Cosmos DB & Foundry account: `disableLocalAuth: true`.
  - ACR: admin user disabled (managed-identity pull).
  - Key Vault: RBAC only.
  - Application Insights: `DisableLocalAuth: true`.
  - Container Apps logs: `destination: azure-monitor` + a diagnostic setting - **no Log
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

- Foundry account `disableLocalAuth: true` - Entra-ID/managed-identity only, no API keys
  (per <https://learn.microsoft.com/azure/ai-foundry/openai/how-to/managed-identity>).
- Cosmos DB `disableLocalAuth: true` - Entra-only; data-plane RBAC via managed identity.
- `AUTH_SECRET` is stored as a Container Apps **secret** (`auth-secret`) and surfaced to the
  app via `secretRef`; `AUTH_TRUST_HOST=true` is set for the HTTPS ingress proxy.
- Chat capacity defaults to 200; embeddings default to 50. Both are configurable
  and subject to model-specific regional quota. Low chat capacity can throttle a
  multi-call tool loop even when a single request fits.
- Explicit TCP startup, liveness and readiness probes check port 3000. TCP keeps
  provisioning compatible with the bootstrap image and previous app versions;
  it does not test database availability. The deployment runner separately checks
  the read-only `/api/health` endpoint, which verifies Cosmos access with a five-second
  abort signal and caches successful results for ten seconds. Recovery setup and
  maintenance do not make a reachable control store unhealthy.
  Ref: <https://learn.microsoft.com/azure/container-apps/health-probes>

## Observability dashboard + cost controls

Container environment diagnostics are enabled. The Application Insights component
and workbook are provisioned, but the current Node runtime has no Azure Monitor
SDK instrumentation. Request, dependency and exception charts therefore must not
be treated as proof of application telemetry. Connection-string injection alone
does not emit traces, and local authentication is disabled.

- **App-health workbook** (`Microsoft.Insights/workbooks@2023-06-01`, `kind: shared`,
  pinned to the App Insights component via `sourceId`). Tiles: request volume, failed
  requests, average server response time, top operations, dependency failures
  (Cosmos / AI / Search), and exceptions over time. Open it from **Application Insights →
  Workbooks → data-driven - application health**, or edit the KQL in
  [resources.bicep](resources.bicep) (`workbookContent`).
  Ref: <https://learn.microsoft.com/azure/templates/microsoft.insights/2023-06-01/workbooks>
- **Log Analytics daily cap** - `workspaceCapping.dailyQuotaGb` (param
  `logAnalyticsDailyQuotaGb`, default **1 GB/day**) bounds ingestion cost; raise it if
  legitimate telemetry is being clipped.
  Ref: <https://learn.microsoft.com/azure/azure-monitor/logs/daily-cap>
- **Monthly cost budget** (opt-in) - set `azd env set BUDGET_CONTACT_EMAIL you@org.com`
  (or the GitHub `BUDGET_CONTACT_EMAIL` variable) to create a
  `Microsoft.Consumption/budgets` alert on the resource group: e-mail at **80 % forecast**
  and **100 % actual** of `budgetAmount` (default 100). No email → the budget is skipped.
  Ref: <https://learn.microsoft.com/azure/templates/microsoft.consumption/2023-11-01/budgets>
- **Always-warm app** - the Container App runs `minReplicas: 1` (no scale-to-zero cold
  starts). This is a deliberate, cost-accepted trade-off; drop it to `0` in
  [resources.bicep](resources.bicep) to scale to zero when idle.

## CI/CD pipeline (GitHub Actions)

Two workflows live in [`.github/workflows`](../.github/workflows):

- **`ci.yml`** - quality gate on pushes to `main` and PRs: `npm ci`, `npm run typecheck`,
  `npm test` (Vitest), `npm run build`, plus the Playwright end-to-end suite. No Azure
  access required.
- **`azure-dev.yml`** - manual dispatch, with a commented-out push trigger. Runs
  unit/type checks, logs Azure CLI in through `azure/login@v2`, then invokes the
  same deployment runner. OIDC is the default; a client-credentials fallback is
  available when no client ID variable is configured. Concurrent deployments to
  the same environment are serialized.

Wire it up once with `azd pipeline config` (creates the service principal + federated
credential and populates most variables/secrets), then add the app-specific values:

| GitHub | Name | Purpose |
| --- | --- | --- |
| variable | `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` | federated login target (set by `azd pipeline config`) |
| variable | `AZURE_ENV_NAME` / `AZURE_LOCATION` | azd environment + app-tier region (set by `azd pipeline config`) |
| variable | `AI_LOCATION` | *optional* - AI Foundry region (default `swedencentral`) |
| variable | `BUDGET_CONTACT_EMAIL` | *optional* - enables the monthly cost alert |
| secret | `AUTH_SECRET` | Auth.js session secret. Locally the preprovision hook generates one; **set it here anyway** - a CI runner starts from a clean checkout, so a generated secret is not carried between runs and every deploy would sign all users out. |
| secret | `DATA_RECOVERY_KEY` | Stable independent recovery key, at least 32 characters; required in CI. |
| variables | Optional deployment inputs | Match [main.parameters.json](main.parameters.json); preserve the values of the existing environment, including email flags and model capacity. |

- azd GitHub Actions pipeline: <https://learn.microsoft.com/azure/developer/azure-developer-cli/pipeline-github-actions>
- OIDC / federated login: <https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect>
