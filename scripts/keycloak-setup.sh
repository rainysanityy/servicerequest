#!/usr/bin/env bash
# =============================================================================
# Keycloak-Nacharbeiten für den Produktivbetrieb (idempotent):
#   - Zwei-Faktor-Pflicht (TOTP) für UHD und Administration (Flow "browser-mfa")
#   - optional erstes Portal-Admin-Konto anlegen
#
#   ./scripts/keycloak-setup.sh                         # nur MFA-Pflicht
#   ./scripts/keycloak-setup.sh max.admin max.admin@firma.de "Max" "Admin"
#
# Läuft im Backend-Image (Node) im internen Docker-Netz – kein Zugriff aus dem
# Admin-Netz nötig. Anmeldung mit KEYCLOAK_ADMIN_USER/-PASSWORD aus .env oder,
# nach Löschung des Bootstrap-Kontos, mit KC_ADMIN_USER/KC_ADMIN_PASSWORD aus der Umgebung.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${DEMO_DC:-}" ]]; then read -r -a dc <<<"$DEMO_DC"; else dc=(docker compose); fi
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

KC_ADMIN_USER="${KC_ADMIN_USER:-$(getenv KEYCLOAK_ADMIN_USER)}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-$(getenv KEYCLOAK_ADMIN_PASSWORD)}"
if [[ -z "$KC_ADMIN_PASSWORD" ]]; then
  read -r -p "Keycloak-Master-Admin: " KC_ADMIN_USER
  read -r -s -p "Passwort: " KC_ADMIN_PASSWORD; echo
fi
export KC_ADMIN_USER KC_ADMIN_PASSWORD
export KC_REALM="$(getenv KEYCLOAK_REALM)"; KC_REALM="${KC_REALM:-itportal}"
export FIRST_ADMIN_USERNAME="${1:-}" FIRST_ADMIN_EMAIL="${2:-}" FIRST_ADMIN_FIRSTNAME="${3:-Portal}" FIRST_ADMIN_LASTNAME="${4:-Admin}"

"${dc[@]}" run --rm --no-deps -T \
  -e KC_URL=http://keycloak:8080/auth -e KC_REALM -e KC_ADMIN_USER -e KC_ADMIN_PASSWORD \
  -e FIRST_ADMIN_USERNAME -e FIRST_ADMIN_EMAIL -e FIRST_ADMIN_FIRSTNAME -e FIRST_ADMIN_LASTNAME \
  backend --input-type=module - < scripts/keycloak-setup.mjs
