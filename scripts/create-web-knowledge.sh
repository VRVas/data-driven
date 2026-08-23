#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Keyless creation of the Foundry IQ "web" knowledge source + knowledge base
# on the Azure AI Search service (data-plane), run by azd as a postprovision
# hook. Azure AI Search handles the Grounding-with-Bing egress and LLM
# summarization internally, so no separate Bing resource/connection is needed.
#
# Auth is Entra-only (the service has local/key auth disabled). The deployer
# holds Search Service Contributor (granted in Bicep) to manage these objects.
# The knowledge base's model reference is keyless: the search service's managed
# identity (Cognitive Services User on the Foundry account) calls the LLM.
#
# Docs:
#   https://learn.microsoft.com/azure/search/agentic-knowledge-source-how-to-web
#   https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-create-knowledge-base
# ---------------------------------------------------------------------------
set -euo pipefail

: "${AZURE_SEARCH_ENDPOINT:?missing}"
: "${AZURE_OPENAI_ENDPOINT:?missing}"
: "${AZURE_OPENAI_DEPLOYMENT:?missing}"

KS_NAME="${AZURE_SEARCH_WEB_KS:-web-grounding}"
KB_NAME="${AZURE_SEARCH_KNOWLEDGE_BASE:-web-kb}"
API_VERSION="2026-05-01-preview"
SEARCH_AUD="https://search.azure.com"

# Foundry IQ knowledge sources/bases are data-plane objects; the model provider
# URL is the Foundry (Azure OpenAI) account endpoint, no trailing slash.
AOAI_URI="${AOAI_RESOURCE_URI:-${AZURE_OPENAI_ENDPOINT%/}}"

ENDPOINT="${AZURE_SEARCH_ENDPOINT%/}"

# --- Web knowledge source (kind: web; unrestricted public web) --------------
KS_BODY=$(KS_NAME="$KS_NAME" python3 -c "import json,os;print(json.dumps({
  'name': os.environ['KS_NAME'],
  'kind': 'web',
  'description': 'Real-time public web results via Grounding with Bing, summarized by an LLM.',
  'encryptionKey': None,
  'webParameters': {'domains': None}
}))")

# --- Knowledge base fronting the web source (keyless LLM: omit apiKey) -------
KB_BODY=$(KB_NAME="$KB_NAME" KS_NAME="$KS_NAME" AOAI_URI="$AOAI_URI" DEPLOYMENT="$AZURE_OPENAI_DEPLOYMENT" python3 -c "import json,os;print(json.dumps({
  'name': os.environ['KB_NAME'],
  'description': 'Knowledge base fronting the web knowledge source for grounded, cited answers.',
  'retrievalInstructions': None,
  'answerInstructions': None,
  'outputMode': 'answerSynthesis',
  'knowledgeSources': [{'name': os.environ['KS_NAME']}],
  'models': [{
    'kind': 'azureOpenAI',
    'azureOpenAIParameters': {
      'resourceUri': os.environ['AOAI_URI'],
      'deploymentId': os.environ['DEPLOYMENT'],
      'modelName': os.environ['DEPLOYMENT']
    }
  }],
  'encryptionKey': None,
  'retrievalReasoningEffort': {'kind': 'low'}
}))")

put() { # $1 = object path, $2 = body, $3 = label
  az rest --method put \
    --url "${ENDPOINT}/$1?api-version=${API_VERSION}" \
    --resource "$SEARCH_AUD" \
    --headers "Content-Type=application/json" \
    --body "$2" >/dev/null
}

echo "Creating web knowledge source '$KS_NAME' on $ENDPOINT"
ok=0
for i in $(seq 1 10); do
  if put "knowledgesources/${KS_NAME}" "$KS_BODY" "knowledge source"; then ok=1; break; fi
  echo "Knowledge-source attempt $i failed (waiting for RBAC propagation)…"; sleep 15
done
[ "$ok" = 1 ] || { echo "WARNING: could not create the web knowledge source."; exit 1; }

echo "Creating knowledge base '$KB_NAME' (model: $AZURE_OPENAI_DEPLOYMENT, keyless)"
ok=0
for i in $(seq 1 10); do
  if put "knowledgebases/${KB_NAME}" "$KB_BODY" "knowledge base"; then ok=1; break; fi
  echo "Knowledge-base attempt $i failed (waiting for RBAC propagation)…"; sleep 15
done
[ "$ok" = 1 ] || { echo "WARNING: could not create the knowledge base."; exit 1; }

echo "Web grounding ready: knowledge base '$KB_NAME' fronts web source '$KS_NAME' - manage it in the Foundry portal."
