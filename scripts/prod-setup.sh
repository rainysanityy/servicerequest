#!/usr/bin/env bash
# =============================================================================
# Produktiv-Einrichtung des IT-Service-Portals (geführt, wiederholbar).
#
# Voraussetzung: Server mit fedora-hardening/scripts/harden.sh gehärtet,
# Projekt unter /srv/srp/app, Aufruf als Dienstkonto srp:
#
#   sudo -u srp -i
#   export XDG_RUNTIME_DIR=/run/user/$(id -u) DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
#   cd /srv/srp/app && ./scripts/prod-setup.sh
#
# Ohne Rückfragen (z. B. Ansible): Werte als Umgebungsvariablen übergeben und
# NONINTERACTIVE=1 setzen – PORTAL_HOSTNAME, ALLOWED_EMAIL_DOMAINS, ADMIN_ALLOW_CIDR,
# BACKUP_AGE_RECIPIENT, CERT_FILE, KEY_FILE, FIRST_ADMIN_USERNAME, FIRST_ADMIN_EMAIL,
# FIRST_ADMIN_FIRSTNAME, FIRST_ADMIN_LASTNAME, SUPPORT_PHONE, SUPPORT_HOURS.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
set_env() {
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' .env > "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
}
# ask VAR "Frage" "Vorgabe" "Regex" "Fehlermeldung"
ask() {
  local var=$1 q=$2 def=$3 re=$4 msg=$5 val
  val="${!var:-}"
  while :; do
    if [[ -z "$val" ]]; then
      [[ "${NONINTERACTIVE:-0}" == 1 ]] && die "$var fehlt (NONINTERACTIVE=1)"
      read -r -p "$q${def:+ [$def]}: " val; val="${val:-$def}"
    fi
    if [[ "$val" =~ $re ]]; then printf -v "$var" '%s' "$val"; return; fi
    echo "  $msg"; val=""
    [[ "${NONINTERACTIVE:-0}" == 1 ]] && die "$var ungültig"
  done
}

HOST_RE='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
DOMS_RE='^[a-z0-9.-]+\.[a-z]{2,}(,[a-z0-9.-]+\.[a-z]{2,})*$'
CIDR_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}/(1[6-9]|2[0-9]|3[0-2])$'
AGE_RE='^age1[0-9a-z]{58}$'

# ------------------------------------------------------------- 0. Vorprüfung
[[ $EUID -ne 0 ]] || die "Nicht als root ausführen – als Dienstkonto srp (rootless Docker)."
docker info >/dev/null 2>&1 || die "Docker nicht erreichbar. XDG_RUNTIME_DIR und DOCKER_HOST gesetzt? (siehe Kopf dieses Skripts)"
docker compose version >/dev/null 2>&1 || die "docker compose fehlt."
for c in openssl curl awk; do command -v "$c" >/dev/null || die "$c fehlt"; done

# ------------------------------------------------------ 1. Secrets und .env
say "1/7 Secrets und Grundkonfiguration"
./scripts/init-secrets.sh
cur() { local v; v=$(getenv "$1"); [[ "$v" == *example* || "$v" == *CHANGE_ME* || "$v" == age1replace* ]] && v=""; echo "$v"; }

ask PORTAL_HOSTNAME "Hostname des Portals (FQDN, z. B. servicedesk.firma.de)" "$(cur PORTAL_HOSTNAME)" "$HOST_RE" "Bitte einen vollqualifizierten Hostnamen in Kleinbuchstaben angeben."
ask ALLOWED_EMAIL_DOMAINS "E-Mail-Domains für Selbstregistrierung (kommagetrennt)" "$(cur ALLOWED_EMAIL_DOMAINS)" "$DOMS_RE" "Format: firma.de oder firma.de,firma-gruppe.de"
ask ADMIN_ALLOW_CIDR "Admin-Netz für die Keycloak-Admin-Konsole (CIDR)" "$(cur ADMIN_ALLOW_CIDR | sed 's#^10.10.0.0/24$##')" "$CIDR_RE" "Format: 10.20.30.0/24 (Präfix /16 bis /32)"
ask BACKUP_AGE_RECIPIENT "age-Public-Key für Backups (age1…; privater Schlüssel bleibt offline)" "$(cur BACKUP_AGE_RECIPIENT)" "$AGE_RE" "Erzeugen auf einem Offline-Rechner: age-keygen -o backup.key  (Ausgabe 'Public key: age1…')"

set_env PORTAL_HOSTNAME "$PORTAL_HOSTNAME"
set_env ALLOWED_EMAIL_DOMAINS "$ALLOWED_EMAIL_DOMAINS"
set_env ADMIN_ALLOW_CIDR "$ADMIN_ALLOW_CIDR"
set_env BACKUP_AGE_RECIPIENT "$BACKUP_AGE_RECIPIENT"
chmod 600 .env
echo "✓ .env aktualisiert"

# Support-Kontakt im Portal (Startseite/Hilfe)
if command -v jq >/dev/null; then
  cfg=frontend/public/config.json
  SUPPORT_PHONE="${SUPPORT_PHONE:-}"; SUPPORT_HOURS="${SUPPORT_HOURS:-}"
  if [[ "${NONINTERACTIVE:-0}" != 1 ]]; then
    [[ -n "$SUPPORT_PHONE" ]] || read -r -p "Telefonnummer des Service-Desks [$(jq -r .supportPhone "$cfg")]: " SUPPORT_PHONE
    [[ -n "$SUPPORT_HOURS" ]] || read -r -p "Servicezeiten [$(jq -r .supportHours "$cfg")]: " SUPPORT_HOURS
  fi
  [[ -z "$SUPPORT_PHONE" || "$SUPPORT_PHONE" =~ ^[0-9+\ /()-]{3,40}$ ]] || die "Telefonnummer enthält ungültige Zeichen"
  [[ ${#SUPPORT_HOURS} -le 80 ]] || die "Servicezeiten zu lang"
  tmp=$(mktemp)
  jq --arg p "$SUPPORT_PHONE" --arg h "$SUPPORT_HOURS" \
     '(if $p != "" then .supportPhone = $p else . end) | (if $h != "" then .supportHours = $h else . end)' "$cfg" > "$tmp"
  cat "$tmp" > "$cfg" && rm -f "$tmp"
fi

# ------------------------------------------------------------ 2. Zertifikat
say "2/7 TLS-Zertifikat"
mkdir -p proxy/certs
selfsigned=false
if [[ -s proxy/certs/tls.crt ]]; then
  s=$(openssl x509 -in proxy/certs/tls.crt -noout -subject -nameopt RFC2253 | sed 's/^subject=//')
  i=$(openssl x509 -in proxy/certs/tls.crt -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//')
  [[ "$s" == "$i" ]] && selfsigned=true
fi
if [[ ! -s proxy/certs/tls.crt || $selfsigned == true || -n "${CERT_FILE:-}" ]]; then
  if [[ -z "${CERT_FILE:-}" ]]; then
    [[ "${NONINTERACTIVE:-0}" == 1 ]] && die "CERT_FILE/KEY_FILE fehlen"
    echo "Zertifikat der Unternehmens-PKI (PEM, inkl. Zwischenzertifikate) und privater Schlüssel (PEM, unverschlüsselt):"
    read -r -p "  Pfad Zertifikat (fullchain): " CERT_FILE
    read -r -p "  Pfad privater Schlüssel:     " KEY_FILE
  fi
  [[ -r "$CERT_FILE" && -r "${KEY_FILE:-}" ]] || die "Zertifikat oder Schlüssel nicht lesbar"
  openssl x509 -in "$CERT_FILE" -noout -checkhost "$PORTAL_HOSTNAME" | grep -q 'does match' || die "Zertifikat gilt nicht für $PORTAL_HOSTNAME"
  [[ "$(openssl x509 -in "$CERT_FILE" -noout -pubkey | openssl sha256)" == "$(openssl pkey -in "$KEY_FILE" -pubout | openssl sha256)" ]] \
    || die "Schlüssel passt nicht zum Zertifikat"
  chmod 0700 proxy/certs
  install -m 0444 "$CERT_FILE" proxy/certs/tls.crt
  install -m 0444 "$KEY_FILE" proxy/certs/tls.key
  echo "✓ Zertifikat eingespielt: $(openssl x509 -in proxy/certs/tls.crt -noout -subject -enddate | tr '\n' ' ')"
else
  echo "• vorhandenes Zertifikat bleibt: $(openssl x509 -in proxy/certs/tls.crt -noout -enddate)"
fi

# ----------------------------------------------------------- 3. Demo-Reste
say "3/7 Demo-Inhalte entfernen"
if [[ -e keycloak/import/itportal-users-0.json ]]; then
  mv keycloak/import/itportal-users-0.json "keycloak/demo-users/.entfernt-$(date +%F).json"
  echo "✓ Demo-Benutzer aus dem Realm-Import entfernt"
else
  echo "• keine Demo-Benutzer im Realm-Import"
fi

# ------------------------------------------------------- 4. Go-Live-Prüfung
say "4/7 Konfigurationsprüfung"
./scripts/prod-preflight.sh --static || die "Bitte die Fehler oben beheben und das Skript erneut starten."

# ------------------------------------------------------- 5. Bauen + Starten
say "5/7 Images bauen und Dienste starten"
docker compose build --pull
docker compose up -d
echo "• warte auf Keycloak und Portal (max. 5 Min.) …"
port=$(getenv PROXY_HTTPS_PORT); port=${port:-8443}
for _ in $(seq 1 60); do
  code=$(curl -sk --resolve "${PORTAL_HOSTNAME}:${port}:127.0.0.1" -o /dev/null -w '%{http_code}' \
    "https://${PORTAL_HOSTNAME}:${port}/auth/realms/itportal/.well-known/openid-configuration" || true)
  [[ "$code" == 200 ]] && break; sleep 5
done
[[ "$code" == 200 ]] || { docker compose ps; die "Keycloak nicht erreichbar – Logs: docker compose logs keycloak"; }
docker compose ps

# ------------------------------------------- 6. Keycloak: MFA + erster Admin
say "6/7 Keycloak: Zwei-Faktor-Pflicht und erstes Portal-Admin-Konto"
if [[ -z "${FIRST_ADMIN_USERNAME:-}" && "${NONINTERACTIVE:-0}" != 1 ]]; then
  read -r -p "Benutzername des ersten Portal-Admins (leer = überspringen): " FIRST_ADMIN_USERNAME
  if [[ -n "$FIRST_ADMIN_USERNAME" ]]; then
    read -r -p "  E-Mail: " FIRST_ADMIN_EMAIL
    read -r -p "  Vorname: " FIRST_ADMIN_FIRSTNAME
    read -r -p "  Nachname: " FIRST_ADMIN_LASTNAME
  fi
fi
./scripts/keycloak-setup.sh "${FIRST_ADMIN_USERNAME:-}" "${FIRST_ADMIN_EMAIL:-}" "${FIRST_ADMIN_FIRSTNAME:-Portal}" "${FIRST_ADMIN_LASTNAME:-Admin}"

# ------------------------------------------------------------- 7. Abnahme
say "7/7 Funktions- und Sicherheitsprüfung"
PROXY_HTTPS_PORT="$port" ./scripts/smoke-test.sh || die "Smoke-Test fehlgeschlagen"
./scripts/prod-preflight.sh || true

cat <<EOF

=====================================================================
 Portal läuft:  https://${PORTAL_HOSTNAME}

 Noch von Hand (siehe docs/GO-LIVE.md):
  1. Als erster Portal-Admin anmelden: Passwort ändern, TOTP-App einrichten.
  2. Keycloak-Admin-Konsole (nur aus ${ADMIN_ALLOW_CIDR}):
     https://${PORTAL_HOSTNAME}/auth/admin/  → im Realm "master" personalisierte
     Admin-Konten (mit OTP) anlegen, danach Bootstrap-Konto "$(getenv KEYCLOAK_ADMIN_USER)" löschen
     und KEYCLOAK_ADMIN_PASSWORD aus .env entfernen.
  3. Backup testen: sudo systemctl start srp-backup.service && ls -l $(getenv BACKUP_DIR)
     Restore einmal in einer Testumgebung durchspielen (scripts/restore.sh).
  4. sudo fedora-hardening/scripts/verify.sh  → keine Abweichungen
  5. Prüfliste docs/GO-LIVE.md abarbeiten und Freigabe dokumentieren.
=====================================================================
EOF
