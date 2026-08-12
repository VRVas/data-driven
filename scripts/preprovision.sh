#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# azd preprovision hook — makes `azd up` genuinely one command.
#
# AUTH_SECRET is a required Bicep parameter (the Auth.js session key, injected
# as a Container Apps secret). It used to be a documented manual step, which
# meant forgetting it deployed an app with an empty session secret rather than
# failing. Generated here instead, once.
#
# Only ever generated when ABSENT: rotating it would invalidate every existing
# session on the next deploy.
# ---------------------------------------------------------------------------
set -eu

if [ -n "${AUTH_SECRET:-}" ]; then
  echo "AUTH_SECRET already set for this environment — leaving it untouched."
  exit 0
fi

if command -v openssl >/dev/null 2>&1; then
  secret=$(openssl rand -base64 32)
else
  # Fallback for images without openssl; same 256 bits from the kernel CSPRNG.
  secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
fi

azd env set AUTH_SECRET "$secret"
echo "AUTH_SECRET generated and stored in the azd environment."
