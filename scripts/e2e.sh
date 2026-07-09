#!/usr/bin/env bash
# End-to-end smoke test: auth flow, route protection, security headers and the
# live data stores. Starts its own dev server (file-backed stores) and cleans up.
#
#   ./scripts/e2e.sh
#
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="http://localhost:3000"
JAR="$(mktemp)"
PASS=0; FAIL=0
pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check() { [[ "$2" == "$3" ]] && pass "$1 ($2)" || fail "$1 (want $3, got $2)"; }
contains() { [[ "$2" == *"$3"* ]] && pass "$1" || fail "$1 (‘$2’ lacks ‘$3’)"; }

echo "→ preparing test user"
rm -rf .data && mkdir -p .data
HASH=$(node -e "console.log(require('bcryptjs').hashSync('Password123!',12))")
node -e "require('fs').writeFileSync('.data/users.json',JSON.stringify([{id:'t1',email:'test@oovie.dev',name:'Tester',passwordHash:process.argv[1],createdAt:new Date().toISOString()}]))" "$HASH"

echo "→ starting dev server"
npm run dev >/tmp/e2e-dev.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null; pkill -f "next-server" 2>/dev/null; rm -rf .data "$JAR"' EXIT
for i in $(seq 1 30); do curl -sf "$BASE/login" -o /dev/null && break; sleep 1; done

echo "→ public + auth routing"
check "GET /login"       "$(curl -s -o /dev/null -w '%{http_code}' $BASE/login)" "200"
check "GET / (landing)"  "$(curl -s -o /dev/null -w '%{http_code}' $BASE/)" "200"
check "GET /dashboard unauth redirects" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/dashboard)" "307"

echo "→ security headers"
HDRS=$(curl -s -D - -o /dev/null $BASE/)
contains "X-Frame-Options DENY" "$HDRS" "X-Frame-Options: DENY"
contains "nosniff" "$HDRS" "X-Content-Type-Options: nosniff"
contains "HSTS" "$HDRS" "Strict-Transport-Security"
[[ "$HDRS" != *"X-Powered-By"* ]] && pass "no X-Powered-By" || fail "X-Powered-By leaked"

echo "→ credentials auth"
CSRF=$(curl -s -c "$JAR" $BASE/api/auth/csrf | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).csrfToken)}catch{}})")
[[ -n "$CSRF" ]] && pass "got csrf token" || fail "no csrf token"

BADRD=$(curl -s -b "$JAR" -c "$JAR" -X POST $BASE/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=test@oovie.dev" \
  --data-urlencode "password=WRONG" --data-urlencode "callbackUrl=$BASE/dashboard" \
  -o /dev/null -w '%{redirect_url}')
contains "wrong password rejected" "$BADRD" "error"

OKRD=$(curl -s -b "$JAR" -c "$JAR" -X POST $BASE/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=test@oovie.dev" \
  --data-urlencode "password=Password123!" --data-urlencode "callbackUrl=$BASE/dashboard" \
  -o /dev/null -w '%{redirect_url}')
contains "correct password -> /dashboard" "$OKRD" "/dashboard"
grep -qi "session-token" "$JAR" && pass "session cookie set" || fail "no session cookie"

echo "→ authenticated pages"
check "GET /dashboard"          "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard)" "200"
check "GET /dashboard/pipeline" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/pipeline)" "200"
check "GET /dashboard/agents"   "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/agents)" "200"
check "GET /dashboard/scoring"  "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/scoring)" "200"
check "GET /dashboard/whitespace" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/whitespace)" "200"
check "GET lead detail (alibaba)" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/pipeline/alibaba)" "200"
check "GET unknown lead -> 404" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' $BASE/dashboard/pipeline/nope-xyz)" "404"

echo "→ stores seeded from the ETL snapshot"
check "brand store rows"  "$(node -e "console.log(require('./.data/brands.json').length)")" "64"
check "agent store rows"  "$(node -e "console.log(require('./.data/agents.json').length)")" "13"

echo ""
echo "E2E: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
