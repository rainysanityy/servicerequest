#!/usr/bin/env bash
# =============================================================================
# Go-Live-Prüfung: findet Konfigurationen, die im Produktivbetrieb nicht sein dürfen.
#   ./scripts/prod-preflight.sh            # alle Prüfungen
#   ./scripts/prod-preflight.sh --static   # nur Dateien/Konfiguration (vor dem 1. Start)
# Exit-Code 1 bei mindestens einem Fehler (✗). Warnungen (⚠) blockieren nicht.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

STATIC=false; [[ "${1:-}" == "--static" ]] && STATIC=true
errors=0; warnings=0; host=""
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*"; errors=$((errors + 1)); }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; warnings=$((warnings + 1)); }
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ .env
section "Konfiguration (.env)"
if [[ ! -f .env ]]; then
  err ".env fehlt – ./scripts/prod-setup.sh oder ./scripts/init-secrets.sh ausführen"
else
  perm=$(stat -c %a .env)
  [[ "$perm" == 600 ]] && ok ".env Rechte 600" || err ".env hat Rechte $perm (erwartet 600: chmod 600 .env)"
  if grep -q 'CHANGE_ME' .env; then err "Platzhalter CHANGE_ME in .env: $(grep -o '^[A-Z_]*=CHANGE_ME' .env | cut -d= -f1 | tr '\n' ' ')"; else ok "keine CHANGE_ME-Platzhalter"; fi

  host=$(getenv PORTAL_HOSTNAME)
  if [[ -z "$host" || "$host" == localhost || "$host" == *example* ]]; then err "PORTAL_HOSTNAME=$host ist kein produktiver Name"
  else ok "PORTAL_HOSTNAME=$host"; fi

  dom=$(getenv ALLOWED_EMAIL_DOMAINS)
  if [[ -z "$dom" ]]; then warn "ALLOWED_EMAIL_DOMAINS leer – Selbstregistrierung mit beliebiger Domain erhält Zugriff"
  elif [[ "$dom" == *example.* ]]; then err "ALLOWED_EMAIL_DOMAINS=$dom enthält Beispiel-Domain"
  else ok "ALLOWED_EMAIL_DOMAINS=$dom"; fi

  cidr=$(getenv ADMIN_ALLOW_CIDR)
  if [[ ! "$cidr" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then err "ADMIN_ALLOW_CIDR=$cidr ist kein IPv4-CIDR"
  elif [[ "$cidr" == 0.0.0.0/* || "${cidr#*/}" -lt 16 ]]; then err "ADMIN_ALLOW_CIDR=$cidr ist zu weit gefasst (Admin-Netz angeben)"
  else ok "ADMIN_ALLOW_CIDR=$cidr"; fi

  age=$(getenv BACKUP_AGE_RECIPIENT)
  if [[ "$age" =~ ^age1[0-9a-z]{58}$ ]]; then ok "BACKUP_AGE_RECIPIENT gesetzt"; else err "BACKUP_AGE_RECIPIENT ist kein gültiger age-Public-Key"; fi
  command -v age >/dev/null && ok "age installiert" || err "age nicht installiert (sudo dnf install age)"

  [[ -n "$(getenv KEYCLOAK_ADMIN_PASSWORD)" ]] && warn "KEYCLOAK_ADMIN_PASSWORD steht noch in .env – nach Anlage personalisierter Keycloak-Admins Bootstrap-Konto löschen und Zeile entfernen"
  [[ "$(getenv DB_SSLMODE)" == disable ]] && ok "DB_SSLMODE=disable (DB nur im internen Docker-Netz)"
fi

# --------------------------------------------------------------- Secrets
section "Secrets"
for s in postgres_superuser_password portal_migrator_db_password portal_app_db_password; do
  if [[ -s "secrets/$s" ]] && (( $(wc -c < "secrets/$s") >= 24 )); then ok "secrets/$s"; else err "secrets/$s fehlt oder zu kurz"; fi
done
[[ -d secrets && "$(stat -c %a secrets)" == 700 ]] && ok "secrets/ Rechte 700" || err "secrets/ muss Rechte 700 haben"

# ------------------------------------------------------------ Zertifikat
section "TLS-Zertifikat"
crt=proxy/certs/tls.crt; key=proxy/certs/tls.key
if [[ ! -s "$crt" || ! -s "$key" ]]; then
  err "proxy/certs/tls.crt bzw. tls.key fehlen"
else
  subj=$(openssl x509 -in "$crt" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's/^subject=//')
  iss=$(openssl x509 -in "$crt" -noout -issuer -nameopt RFC2253 2>/dev/null | sed 's/^issuer=//')
  if [[ "$subj" == "$iss" || "$subj" == *"(TEST)"* ]]; then err "Zertifikat ist selbstsigniert/Testzertifikat ($subj)"; else ok "ausgestellt von: $iss"; fi
  if [[ -n "${host:-}" ]] && openssl x509 -in "$crt" -noout -checkhost "$host" 2>/dev/null | grep -q 'does match'; then ok "Zertifikat gilt für $host"
  else err "Zertifikat passt nicht zu PORTAL_HOSTNAME=${host:-?}"; fi
  if openssl x509 -in "$crt" -noout -checkend $((30 * 86400)) >/dev/null; then ok "gültig bis $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"
  else err "Zertifikat läuft in weniger als 30 Tagen ab"; fi
  if [[ "$(openssl x509 -in "$crt" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl sha256)" ]]; then ok "privater Schlüssel passt zum Zertifikat"
  else err "privater Schlüssel passt nicht zum Zertifikat"; fi
  bits=$(openssl x509 -in "$crt" -noout -text | grep -oE 'Public-Key: \(([0-9]+) bit' | grep -oE '[0-9]+')
  alg=$(openssl x509 -in "$crt" -noout -text | grep -m1 'Public Key Algorithm' | awk -F': ' '{print $2}')
  if [[ "$alg" == rsaEncryption && "${bits:-0}" -lt 3072 ]]; then warn "RSA-Schlüssel mit $bits bit (BSI TR-02102: ≥ 3072 bit empfohlen)"; else ok "Schlüssel: $alg ${bits:-} bit"; fi
fi

# ----------------------------------------------------------- Demo-Reste
section "Demo-/Testreste"
[[ -e keycloak/import/itportal-users-0.json ]] && err "Demo-Benutzer liegen in keycloak/import/ (rm keycloak/import/itportal-users-0.json)" || ok "keine Demo-Benutzer im Realm-Import"
[[ -f backend/package-lock.json && -f frontend/package-lock.json ]] && ok "package-lock.json vorhanden (reproduzierbare Builds)" || warn "package-lock.json fehlt – Builds nicht reproduzierbar"

# ----------------------------------------------------------- Plattform
section "Plattform"
if command -v getenforce >/dev/null; then
  [[ "$(getenforce)" == Enforcing ]] && ok "SELinux enforcing" || err "SELinux ist $(getenforce) (erwartet Enforcing)"
else warn "getenforce nicht vorhanden – kein Fedora/RHEL?"; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then ok "firewalld aktiv"; else warn "firewalld nicht aktiv/prüfbar"; fi
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then ok "Docker läuft rootless"
else warn "Docker läuft nicht rootless (Härtung: fedora-hardening/scripts/harden.sh)"; fi
if systemctl is-enabled srp-backup.timer >/dev/null 2>&1; then ok "Backup-Timer aktiviert"; else warn "srp-backup.timer nicht aktiviert"; fi

# --------------------------------------------------------------- Laufzeit
if ! $STATIC; then
  section "Laufender Betrieb"
  if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q .; then
    bad=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' | awk '$1!="migrate" && ($2!="running" || ($3!="" && $3!="healthy"))')
    [[ -z "$bad" ]] && ok "alle Dienste laufen und sind healthy" || err "Dienste nicht gesund: $(echo "$bad" | tr '\n' ';')"
    pw="$(cat secrets/postgres_superuser_password 2>/dev/null)"; dbn="$(getenv PORTAL_DB_NAME)"
    demo=$(docker compose exec -T -e PGPASSWORD="$pw" db psql -U postgres -d "${dbn:-portal}" -tAc \
      "SELECT count(*) FROM portal.user_profiles WHERE sub LIKE 'demo-%'" 2>/dev/null | tr -d '[:space:]')
    if [[ "$demo" == 0 ]]; then ok "keine Demo-Daten in der Datenbank"
    elif [[ -n "$demo" ]]; then err "$demo Demo-Profile in der Datenbank (Demo-Daten geladen – Datenbank neu aufsetzen)"
    else warn "Datenbank nicht abfragbar"; fi
    realm=$(getenv KEYCLOAK_REALM); realm=${realm:-itportal}
    issuer="https://${host}/auth/realms/${realm}"
    port=$(getenv PROXY_HTTPS_PORT); port=${port:-8443}
    if curl -sk --resolve "${host}:${port}:127.0.0.1" "https://${host}:${port}/auth/realms/${realm}/.well-known/openid-configuration" | grep -q "\"issuer\":\"${issuer}\""; then
      ok "Keycloak-Issuer $issuer"
    else err "Keycloak-Issuer stimmt nicht (erwartet $issuer)"; fi
  else
    warn "Stack läuft nicht – Laufzeitprüfungen übersprungen"
  fi
fi

printf '\n'
if (( errors > 0 )); then
  printf '\033[31m%d Fehler\033[0m, %d Warnungen – NICHT produktiv setzen.\n' "$errors" "$warnings"; exit 1
fi
printf '\033[32mKeine Fehler\033[0m, %d Warnungen.\n' "$warnings"
