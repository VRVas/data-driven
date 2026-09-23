#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Keyless creation of the Foundry prompt agent (data-plane), run by azd as a
# postprovision hook. A Bicep deploymentScript is avoided because it needs
# storage-account keys, which the no-key policy forbids. This uses the
# deployer's Entra token (Foundry Project Manager, granted in Bicep).
# Docs: https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-agent
# ---------------------------------------------------------------------------
set -euo pipefail

: "${AZURE_AI_PROJECT_ENDPOINT:?missing}"
: "${AZURE_AI_AGENT_NAME:?missing}"
: "${AZURE_OPENAI_DEPLOYMENT:?missing}"

# NOTE: these instructions are for the HOSTED Foundry agent, which reaches the
# platform over the OpenAPI tool surface (GET /api/copilot/openapi). They are a
# deliberately short brief, not a copy of the in-app prompt: the canonical one
# is SYSTEM_PROMPT in src/lib/copilot/provider.ts and it is far too long to
# inline here. Keep this accurate about the MODEL and the RULES; leave the tool
# catalogue to the OpenAPI document, which is generated from the registry and
# so cannot drift.
export AGENT_INSTRUCTIONS="${AGENT_INSTRUCTIONS:-You are the OOVIE BD Copilot for OOVIE Studios, a studio that builds AI-native music and video experiences for brands. You help the business-development team reason over their client pipeline. Your tools are described in the OpenAPI document you were given - read it and route deliberately; never invent a capability it does not list. Leads are ranked by a two-axis priority model: an Opportunity index (budget, weighted by how confident that number is, plus strategic value) and a Winnability index (stage probability, recency, access, receptivity), combined with a geometric mean so a lead must be decent on BOTH to rank - ease of delivery is reported but never blended in. Rankings cover open deals only. Ground every answer in tool results - never invent leads, numbers, scores, dates or sources; if you do not have the data, say so. Access is granular: 49 permissions, each either on/off or scoped to none/own/team/all, so every tool runs as the signed-in user and may legitimately refuse. If one does, say which permission is missing and who to ask - never try another route to the same data. You may draft outreach freely. Sending is a separate permission-gated step over a draft that already exists, so offer it and let a person confirm; it cannot be recalled. You cannot delete anything. Be concise, concrete and decision-oriented: lead with the answer, then the evidence and the sources you used.}"

BODY=$(python3 -c "import json,os;print(json.dumps({'name':os.environ['AZURE_AI_AGENT_NAME'],'definition':{'kind':'prompt','model':os.environ['AZURE_OPENAI_DEPLOYMENT'],'instructions':os.environ['AGENT_INSTRUCTIONS']}}))")
# Updating an existing agent means adding a version, not re-creating it.
VERSION_BODY=$(python3 -c "import json,os;print(json.dumps({'definition':{'kind':'prompt','model':os.environ['AZURE_OPENAI_DEPLOYMENT'],'instructions':os.environ['AGENT_INSTRUCTIONS']}}))")

# Creates on the first deploy and updates on every one after. Previously this
# only ever POSTed to /agents, so a second deploy got "already exists", retried
# it ten times as if it were RBAC propagation, and left the agent running the
# instructions it was born with - silently, because the hook continues on error.
publish() {
  err=$(az rest --method post \
    --url "${AZURE_AI_PROJECT_ENDPOINT}/agents?api-version=v1" \
    --resource "https://ai.azure.com" \
    --headers "Content-Type=application/json" \
    --body "$BODY" 2>&1) && { echo "Prompt agent '$AZURE_AI_AGENT_NAME' created."; return 0; }

  case "$err" in
    *conflict*|*already\ exists*)
      az rest --method post \
        --url "${AZURE_AI_PROJECT_ENDPOINT}/agents/${AZURE_AI_AGENT_NAME}/versions?api-version=v1" \
        --resource "https://ai.azure.com" \
        --headers "Content-Type=application/json" \
        --body "$VERSION_BODY" >/dev/null && {
          echo "Prompt agent '$AZURE_AI_AGENT_NAME' updated (new version)."
          return 0
        }
      return 1
      ;;
    *)
      printf '%s\n' "$err" >&2
      return 1
      ;;
  esac
}

echo "Publishing prompt agent '$AZURE_AI_AGENT_NAME' on $AZURE_AI_PROJECT_ENDPOINT"
for i in $(seq 1 10); do
  if publish; then exit 0; fi
  echo "Attempt $i failed (waiting for RBAC propagation)…"
  sleep 15
done

echo "WARNING: could not publish the prompt agent automatically."
echo "Grant your account 'Foundry Project Manager' on the Foundry account and re-run: azd hooks run postprovision"
exit 1
