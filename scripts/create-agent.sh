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
export AGENT_INSTRUCTIONS="${AGENT_INSTRUCTIONS:-You are the OOVIE BD Copilot for OOVIE Studios, a studio that builds AI-native music and video experiences for brands. You help the business-development team reason over their client pipeline: leads, lead scores, deal stages, weighted value, whitespace and opportunities, outreach planning, and brand and market research. Ground every answer in the data and tools available to you — never invent leads, numbers, scores, dates or sources; if you do not have the data, say so. You act as the signed-in user and respect their permissions. You may draft outreach but never send it — an admin approves and sends. Be concise, concrete and decision-oriented: lead with the answer, then the evidence and the sources you used.}"

BODY=$(python3 -c "import json,os;print(json.dumps({'name':os.environ['AZURE_AI_AGENT_NAME'],'definition':{'kind':'prompt','model':os.environ['AZURE_OPENAI_DEPLOYMENT'],'instructions':os.environ['AGENT_INSTRUCTIONS']}}))")

echo "Creating prompt agent '$AZURE_AI_AGENT_NAME' on $AZURE_AI_PROJECT_ENDPOINT"
for i in $(seq 1 10); do
  if az rest --method post \
      --url "${AZURE_AI_PROJECT_ENDPOINT}/agents?api-version=v1" \
      --resource "https://ai.azure.com" \
      --headers "Content-Type=application/json" \
      --body "$BODY"; then
    echo "Prompt agent '$AZURE_AI_AGENT_NAME' is ready and visible in the Foundry portal."
    exit 0
  fi
  echo "Attempt $i failed (waiting for RBAC propagation)…"
  sleep 15
done

echo "WARNING: could not create the prompt agent automatically."
echo "Grant your account 'Foundry Project Manager' on the Foundry account and re-run: azd hooks run postprovision"
exit 1
