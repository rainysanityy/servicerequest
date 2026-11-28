#!/usr/bin/env bash
# =============================================================================
# Update des Portals im Produktivbetrieb (als Dienstkonto srp in /srv/srp/app).
#
#   ./scripts/update.sh v1.2.0            # /srv/srp/app ist ein Git-Klon: Tag auschecken
#   ./scripts/update.sh /pfad/zur/quelle  # sonst: neue Version aus diesem Verzeichnis übernehmen
#
# Ablauf: Prüfung → verschlüsseltes Backup → neue Version → Images bauen → Neustart
# (Migrationen laufen automatisch) → Smoke-Test. .env, secrets/, proxy/certs/ und das
# hochgeladene Zertifikat (Volume tls) bleiben unverändert.
# Rückweg: ./scripts/update.sh <alte Version> und bei Schemaänderungen restore.sh.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:?Version (Git-Tag) oder Quellverzeichnis angeben}"
getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

[[ $EUID -ne 0 ]] || { echo "Als Dienstkonto srp ausführen, nicht als root."; exit 1; }
[[ -f .env ]] || { echo ".env fehlt – zuerst prod-setup.sh"; exit 1; }

say "1/5 Prüfung vor dem Update"
./scripts/prod-preflight.sh --static

say "2/5 Verschlüsseltes Backup"
./scripts/backup.sh

say "3/5 Neue Version übernehmen: $target"
before="$(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
cfg=frontend/public/config.json
cfg_saved="$(mktemp)"; cp "$cfg" "$cfg_saved"
if [[ -d .git && ! -d "$target" ]]; then
  git checkout --quiet -- "$cfg"   # lokale Anpassung (Support-Kontakt) wird unten wieder eingespielt
  git fetch --tags --quiet origin
  git -c advice.detachedHead=false checkout --quiet "$target"
elif [[ -d "$target" ]]; then
  rsync -a --delete \
    --exclude .git --exclude .env --exclude 'secrets/' --exclude 'proxy/certs/tls.*' \
    --exclude 'keycloak/import/itportal-users-0.json' --exclude 'frontend/public/config.json' \
    "${target%/}/" ./
else
  echo "„$target“ ist weder ein Git-Tag (kein Git-Klon) noch ein Verzeichnis."; exit 1
fi
if command -v jq >/dev/null; then
  tmp="$(mktemp)"
  jq --slurpfile old "$cfg_saved" '.supportPhone = $old[0].supportPhone | .supportHours = $old[0].supportHours' "$cfg" > "$tmp" && cat "$tmp" > "$cfg"
  rm -f "$tmp"
fi
rm -f "$cfg_saved"
echo "  $before → $(git rev-parse --short HEAD 2>/dev/null || echo "$target")"

say "4/5 Bauen und neu starten"
docker compose build --pull
docker compose up -d --remove-orphans
host=$(getenv PORTAL_HOSTNAME); port=$(getenv PROXY_HTTPS_PORT); port=${port:-8443}
for _ in $(seq 1 60); do
  code=$(curl -sk --resolve "${host}:${port}:127.0.0.1" -o /dev/null -w '%{http_code}' "https://${host}:${port}/api/health/ready" || true)
  [[ "$code" == 200 ]] && break; sleep 5
done

say "5/5 Abnahme"
PROXY_HTTPS_PORT="$port" ./scripts/smoke-test.sh
./scripts/prod-preflight.sh || true
echo "✓ Update abgeschlossen"
