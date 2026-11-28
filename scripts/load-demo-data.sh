#!/usr/bin/env bash
# =============================================================================
# NUR DEMO/TEST: lädt fiktive Tickets, Benutzerprofile und Audit-Einträge
# (ca. 12 Monate) in die Portal-Datenbank, damit die Statistiken Inhalt haben.
# Voraussetzung: Stack läuft (docker compose up -d), Migrationen sind durch.
# Mehrfaches Ausführen ist unschädlich (läuft nur einmal).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${DEMO_DC:-}" ]]; then read -r -a dc <<<"$DEMO_DC"
elif docker compose version >/dev/null 2>&1; then dc=(docker compose)
elif sudo -n true 2>/dev/null && sudo docker compose version >/dev/null 2>&1; then dc=(sudo docker compose)
else dc=(docker-compose); fi

pw="$(cat secrets/postgres_superuser_password)"
db_name="$(grep -E '^PORTAL_DB_NAME=' .env | cut -d= -f2)"; db_name="${db_name:-portal}"

echo "• Warte auf abgeschlossene Migrationen …"
for _ in $(seq 1 60); do
  if "${dc[@]}" exec -T -e PGPASSWORD="$pw" db psql -U postgres -d "$db_name" -tAc \
       "SELECT 1 FROM portal.catalog_items WHERE active LIMIT 1" 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 5
done

"${dc[@]}" exec -T -e PGPASSWORD="$pw" db psql -U postgres -d "$db_name" -v ON_ERROR_STOP=1 -q < scripts/demo-data.sql
echo "✓ Demo-Daten geladen – Statistik unter https://<host>/statistik"
