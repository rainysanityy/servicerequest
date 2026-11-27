#!/usr/bin/env bash
# =============================================================================
# Erzeugt zufällige Secrets (Docker-Secrets + .env-Werte) – einmalig vor dem 1. Start.
# Bereits vorhandene Secrets werden NICHT überschrieben.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

umask 077
mkdir -p secrets
chmod 700 secrets

gen() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }

for name in postgres_superuser_password portal_migrator_db_password portal_app_db_password; do
  f="secrets/${name}"
  if [[ -s "$f" ]]; then
    echo "• $f existiert bereits – unverändert"
  else
    gen > "$f"
    echo "✓ $f erzeugt"
  fi
  # Rootless-Docker: Container-UIDs (z. B. 70/65532) liegen im subuid-Bereich und
  # müssen die Datei lesen können. Schutz erfolgt über das Verzeichnis (0700).
  chmod 0444 "$f"
done

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  sed -i "s|^KEYCLOAK_ADMIN_PASSWORD=.*|KEYCLOAK_ADMIN_PASSWORD=$(gen)|" .env
  sed -i "s|^KEYCLOAK_DB_PASSWORD=.*|KEYCLOAK_DB_PASSWORD=$(gen)|" .env
  echo "✓ .env aus Vorlage erstellt (Keycloak-Passwörter zufällig gesetzt)"
  echo "  → PORTAL_HOSTNAME, ADMIN_ALLOW_CIDR und BACKUP_AGE_RECIPIENT in .env anpassen!"
else
  echo "• .env existiert bereits – unverändert"
fi
