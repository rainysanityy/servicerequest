#!/usr/bin/env bash
# =============================================================================
# NUR DEMO/TEST: Installiert das IT-Service-Portal in einer Fedora-WSL (WSL2).
#
#   git clone https://github.com/rainysanityy/servicerequest.git
#   cd servicerequest && ./scripts/wsl-demo-install.sh
#
# Danach im Windows-Browser: https://localhost
#
# Unterschiede zur Produktion (bewusst, weil WSL kein Fedora Server ist):
#   - KEINE Härtung per fedora-hardening/ (kein SELinux in WSL, firewalld/sysctl
#     nur teilweise wirksam, SSH-Härtung unnötig)
#   - Docker im Root-Modus (moby-engine) statt Rootless – Container laufen
#     trotzdem non-root, read-only, cap_drop ALL
#   - Proxy direkt auf 443/80, Hostname "localhost", selbstsigniertes Zertifikat
#   - Demo-Benutzer werden importiert
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Vorprüfungen ---------------------------------------------------------
grep -qi fedora /etc/os-release || die "Dieses Skript ist für Fedora gedacht."
grep -qi microsoft /proc/version || echo "Hinweis: kein WSL erkannt – für echte Server bitte README/Schnellstart nutzen."
[[ "$(ps -p 1 -o comm=)" == systemd ]] || die "systemd läuft nicht. In /etc/wsl.conf eintragen:
  [boot]
  systemd=true
dann in PowerShell 'wsl --shutdown' und die WSL neu starten."
[[ $EUID -ne 0 ]] || die "Bitte als normaler Benutzer (mit sudo-Recht) starten, nicht als root."

# --- 1. Pakete ---------------------------------------------------------------
say "Pakete installieren (sudo fragt ggf. nach deinem Passwort)"
sudo dnf -y install moby-engine docker-compose git openssl curl jq
sudo systemctl enable --now docker

if sudo docker compose version >/dev/null 2>&1; then
  DC=(sudo docker compose)
elif command -v docker-compose >/dev/null; then
  DC=(sudo docker-compose)
else
  die "Docker Compose nicht gefunden."
fi
echo "✓ $("${DC[@]}" version | head -1)"

# --- 2. Secrets und .env -----------------------------------------------------
say "Secrets und .env erzeugen"
./scripts/init-secrets.sh
set_env() { sed -i "s|^$1=.*|$1=$2|" .env; }
set_env PORTAL_HOSTNAME localhost
set_env PROXY_HTTPS_PORT 443
set_env PROXY_HTTP_PORT 80
# Zugriffe aus Windows kommen über das WSL-/Docker-NAT (172.16.0.0/12)
set_env ADMIN_ALLOW_CIDR 172.16.0.0/12
set_env ALLOWED_EMAIL_DOMAINS example.local
set_env BACKUP_DIR "$HOME/srp-backup"

# --- 3. Testzertifikat + Demo-Benutzer --------------------------------------
say "Selbstsigniertes Zertifikat für localhost"
if [[ ! -s proxy/certs/tls.crt ]]; then
  ./scripts/gen-selfsigned-cert.sh localhost
else
  echo "• Zertifikat existiert bereits"
fi
# Root-Docker: nginx (UID 101) muss das 0700-Verzeichnis betreten dürfen
sudo chown -R 101:101 proxy/certs

./scripts/load-demo-users.sh

# --- 4. Bauen und starten ----------------------------------------------------
say "Images bauen (dauert beim ersten Mal einige Minuten)"
"${DC[@]}" build
say "Container starten"
"${DC[@]}" up -d

say "Warten, bis Keycloak und Portal bereit sind (max. 5 Min.)"
for _ in $(seq 1 60); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/auth/realms/itportal/.well-known/openid-configuration || true)
  [[ "$code" == 200 ]] && break
  sleep 5
done
"${DC[@]}" ps

say "Smoke-Test"
PROXY_HTTPS_PORT=443 ./scripts/smoke-test.sh || echo "⚠ Smoke-Test meldet Fehler – Logs: ${DC[*]} logs --tail=100"

# --- 5. Zusammenfassung ------------------------------------------------------
kc_user=$(grep -E '^KEYCLOAK_ADMIN_USER=' .env | cut -d= -f2)
cat <<EOF

=====================================================================
 Fertig.  Im Windows-Browser öffnen:  https://localhost
 (Zertifikatswarnung bestätigen – selbstsigniertes Testzertifikat)

 Demo-Benutzer (Passwort muss beim 1. Login geändert werden):
   anna.mueller   Demo!User-2026    Mitarbeitende
   uwe.helpdesk   Demo!Uhd-2026x    UHD / First-Level
   alex.admin     Demo!Admin-2026   Administration

 Keycloak-Admin-Konsole: https://localhost/auth/admin/
   Benutzer: ${kc_user}   Passwort: steht in .env (KEYCLOAK_ADMIN_PASSWORD)

 Neue Konten per Selbstregistrierung brauchen eine @example.local-Adresse
 (ALLOWED_EMAIL_DOMAINS in .env).

 Stoppen:  ${DC[*]} down      Starten: ${DC[*]} up -d
=====================================================================
EOF
