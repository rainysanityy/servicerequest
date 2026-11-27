#!/usr/bin/env bash
# =============================================================================
# Wiederherstellung aus einem verschlüsselten Backup.
# Aufruf: ./scripts/restore.sh <backup-verzeichnis> <age-identity-datei>
# ACHTUNG: überschreibt die aktuellen Datenbanken. Vorher Wartungsfenster ankündigen.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

SRC="${1:?Backup-Verzeichnis angeben}"
KEY="${2:?age-Identity-Datei (privater Schlüssel) angeben}"

( cd "$SRC" && sha256sum -c SHA256SUMS ) || { echo "Prüfsummen ungültig – Abbruch"; exit 1; }

read -r -p "Datenbanken wirklich überschreiben? Tippen Sie RESTORE: " c
[[ "$c" == "RESTORE" ]] || { echo "Abgebrochen"; exit 1; }

docker compose stop proxy backend keycloak

restore() { # $1=service $2=db $3=user
  age -d -i "$KEY" "${SRC}/${2}.dump.age" \
    | docker compose exec -T "$1" pg_restore -U "$3" -d "$2" --clean --if-exists --single-transaction
}
restore db "${PORTAL_DB_NAME:-portal}" postgres
restore keycloak-db keycloak keycloak

# Rechte der App-Rolle nach dem Restore sicherstellen
docker compose run --rm migrate
docker compose up -d
echo "✓ Wiederherstellung abgeschlossen – Funktionstest gemäß Betriebskonzept durchführen"
