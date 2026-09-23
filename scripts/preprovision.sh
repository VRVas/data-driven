#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# azd preprovision hook - makes `azd up` genuinely one command.
#
# AUTH_SECRET is a required Bicep parameter (the Auth.js session key, injected
# as a Container Apps secret). It used to be a documented manual step, which
# meant forgetting it deployed an app with an empty session secret rather than
# failing. Generated here instead, once.
#
# Only ever generated when ABSENT: rotating it would invalidate every existing
# session on the next deploy.
#
# Reads the azd store rather than the ambient environment, because that is what
# main.parameters.json substitutes ${AUTH_SECRET} from - a stray system variable
# of the same name would otherwise make this skip generation and leave the
# parameter empty.
#
# Docs: https://learn.microsoft.com/azure/developer/azure-developer-cli/custom-prompts
# ---------------------------------------------------------------------------
set -eu

for name in AUTH_SECRET DATA_RECOVERY_KEY; do
  if existing=$(azd env get-value "$name" 2>/dev/null) && test -n "$existing"; then
    if test "${#existing}" -lt 32; then
      echo "$name must contain at least 32 characters." >&2
      exit 1
    fi
    echo "$name already set for this environment - leaving it untouched."
    continue
  fi
  if command -v openssl >/dev/null 2>&1; then
    secret=$(openssl rand -base64 32)
  else
    secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
  fi
  azd env set "$name" "$secret"
  echo "$name generated and stored in the azd environment."
done
