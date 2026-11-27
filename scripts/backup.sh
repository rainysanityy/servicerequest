#!/usr/bin/env bash
# =============================================================================
# Verschlüsseltes Backup (BSI CON.3 / NIST CP-9, SC-28)
#  - pg_dump beider Datenbanken (Portal + Keycloak) im Custom-Format
#  - Verschlüsselung mit age (Public Key; privater Schlüssel liegt offline)
#  - SHA-256-Prüfsummen, Rotation nach BACKUP_RETENTION_DAYS
# Aufruf: ./scripts/backup.sh   (z. B. per systemd-Timer, siehe fedora-hardening)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

: "${BACKUP_DIR:?BACKUP_DIR fehlt}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT fehlt}"
RET="${BACKUP_RETENTION_DAYS:-30}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR}/${TS}"

command -v age >/dev/null || { echo "age nicht installiert (dnf install age)"; exit 1; }
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] || { echo "BACKUP_AGE_RECIPIENT ist kein age-Public-Key"; exit 1; }

umask 077
mkdir -p "$DEST"

dump() { # $1=service $2=db $3=user
  docker compose exec -T "$1" pg_dump -U "$3" -d "$2" --format=custom --compress=6 \
    | age -r "$BACKUP_AGE_RECIPIENT" -o "${DEST}/${2}.dump.age"
}

echo "→ Sichere Portal-Datenbank"
dump db "${PORTAL_DB_NAME:-portal}" postgres
echo "→ Sichere Keycloak-Datenbank"
dump keycloak-db keycloak keycloak
echo "→ Sichere Konfiguration (ohne Klartext-Secrets)"
tar -C . -czf - docker-compose.yml keycloak/import proxy/templates proxy/nginx.conf \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "${DEST}/config.tar.gz.age"

( cd "$DEST" && sha256sum ./* > SHA256SUMS )
echo "✓ Backup abgeschlossen: $DEST"

# Rotation
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${RET}" -print -exec rm -rf {} +
logger -t srp-backup "backup ok ${DEST}" 2>/dev/null || true
