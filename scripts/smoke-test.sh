#!/usr/bin/env bash
# Schneller Funktions- und Sicherheits-Check nach Deployment/Update.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
HOST="$(grep -E '^PORTAL_HOSTNAME=' .env | cut -d= -f2)"
PORT="${PROXY_HTTPS_PORT:-8443}"
BASE="https://${HOST}:${PORT}"
CURL=(curl -sk --resolve "${HOST}:${PORT}:127.0.0.1" -o /dev/null -w '%{http_code}')
fail=0
check() { local name="$1" expect="$2" got="$3"; if [[ "$got" == "$expect" ]]; then echo "✓ $name ($got)"; else echo "✗ $name: erwartet $expect, erhalten $got"; fail=1; fi; }

check "Container-Status" "0" "$(docker compose ps --format json | grep -c '"Health":"unhealthy"' || true)"
check "SPA erreichbar"            200 "$("${CURL[@]}" "$BASE/")"
check "API ohne Token -> 401"     401 "$("${CURL[@]}" "$BASE/api/me")"
check "API Health"                200 "$("${CURL[@]}" "$BASE/api/health/ready")"
check "OIDC Discovery"            200 "$("${CURL[@]}" "$BASE/auth/realms/itportal/.well-known/openid-configuration")"
check "Keycloak-Metriken gesperrt" 404 "$("${CURL[@]}" "$BASE/auth/metrics")"
check "Unbekannter Host -> 421"   421 "$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:${PORT}/")"
hdr="$(curl -skI --resolve "${HOST}:${PORT}:127.0.0.1" "$BASE/")"
for h in strict-transport-security content-security-policy x-content-type-options x-frame-options referrer-policy; do
  if grep -qi "^$h:" <<<"$hdr"; then echo "✓ Header $h"; else echo "✗ Header $h fehlt"; fail=1; fi
done
if curl -sk --tls-max 1.1 --resolve "${HOST}:${PORT}:127.0.0.1" "$BASE/" -o /dev/null 2>/dev/null; then
  echo "✗ TLS ≤ 1.1 wird akzeptiert"; fail=1; else echo "✓ TLS ≤ 1.1 abgelehnt"; fi
exit $fail
