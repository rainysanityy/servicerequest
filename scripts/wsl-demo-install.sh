#!/usr/bin/env bash
# =============================================================================
# NUR DEMO/TEST: Installiert das IT-Service-Portal in einer Fedora-WSL (WSL2).
#
#   git clone https://github.com/rainysanityy/servicerequest.git
#   cd servicerequest && ./scripts/wsl-demo-install.sh
#
# Danach im Windows-Browser: https://localhost
#
# Zwei Betriebsarten (automatisch erkannt):
#   gehärtet – nach fedora-hardening/scripts/harden.sh: Portal läuft wie auf dem
#              Produktivserver rootless unter dem Dienstkonto srp in /srv/srp/app
#   einfach  – ohne Härtung: Docker (moby-engine) im Root-Modus im Repo-Ordner
#
# In beiden Fällen: Hostname "localhost", selbstsigniertes Zertifikat,
# Demo-Benutzer ohne 2FA-Pflicht und ca. 12 Monate fiktive Tickets.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$PWD"

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Vorprüfungen ---------------------------------------------------------
grep -qi fedora /etc/os-release || die "Dieses Skript ist für Fedora gedacht."
grep -qi microsoft /proc/version || echo "Hinweis: kein WSL erkannt – für echte Server bitte scripts/prod-setup.sh nutzen."
[[ "$(ps -p 1 -o comm=)" == systemd ]] || die "systemd läuft nicht. In /etc/wsl.conf eintragen:
  [boot]
  systemd=true
dann in PowerShell 'wsl --shutdown' und die WSL neu starten."
[[ $EUID -ne 0 ]] || die "Bitte als normaler Benutzer (mit sudo-Recht) starten, nicht als root."

HARDENED=no
if id srp &>/dev/null && sudo test -S "/run/user/$(id -u srp)/docker.sock"; then HARDENED=yes; fi

if [[ $HARDENED == yes ]]; then
  # ---------------------------------------------------------- gehärteter Modus
  SRP_UID=$(id -u srp)
  APP=/srv/srp/app
  say "Gehärteter Server erkannt – Installation rootless als srp in ${APP}"
  # Befehl im App-Verzeichnis als Dienstkonto srp (rootless Docker)
  app() { sudo -u srp env XDG_RUNTIME_DIR="/run/user/${SRP_UID}" DOCKER_HOST="unix:///run/user/${SRP_UID}/docker.sock" \
            DEMO_DC="docker compose" bash -c "cd '${APP}' && $*"; }
  dc() { app "docker compose $*"; }
  sudo rsync -a --delete --exclude .git --exclude .env --exclude secrets/ --exclude 'proxy/certs/tls.*' \
    --exclude 'keycloak/import/itportal-users-0.json' "${SRC}/" "${APP}/"
  sudo chown -R srp:srp "$APP"
else
  # -------------------------------------------------------------- einfacher Modus
  APP="$SRC"
  say "Pakete installieren (sudo fragt ggf. nach deinem Passwort)"
  sudo dnf -y install moby-engine docker-compose git openssl curl jq
  sudo systemctl enable --now docker
  app() { DEMO_DC="sudo docker compose" bash -c "cd '${APP}' && $*"; }
  dc() { app "sudo docker compose $*"; }
fi
dc version >/dev/null 2>&1 || die "docker compose nicht verfügbar."

# --- 1. Secrets und .env -----------------------------------------------------
say "Secrets und .env"
app ./scripts/init-secrets.sh
set_env() {  # Schlüssel Wert – setzt oder ergänzt eine Zeile in .env (als Eigentümer der Datei)
  app "if grep -q '^$1=' .env; then sed -i 's|^$1=.*|$1=$2|' .env; else echo '$1=$2' >> .env; fi"
}
set_env PORTAL_HOSTNAME localhost
set_env PROXY_HTTPS_PORT 8443
set_env PROXY_HTTP_PORT 8080
# zusätzlich 443/80 publizieren (Windows-localhost-Weiterleitung, siehe docker-compose.wsl.yml)
set_env COMPOSE_FILE docker-compose.yml:docker-compose.wsl.yml
set_env ADMIN_ALLOW_CIDR 172.16.0.0/12
set_env ADMIN_ALLOW_CIDR_EXTRA 127.0.0.0/8
set_env ALLOWED_EMAIL_DOMAINS example.local
if [[ $HARDENED == yes ]]; then set_env BACKUP_DIR /srv/backup/srp; else set_env BACKUP_DIR "$HOME/srp-backup"; fi

# --- 2. Testzertifikat + Demo-Benutzer --------------------------------------
say "Selbstsigniertes Zertifikat für localhost und Demo-Benutzer"
if sudo test -s "${APP}/proxy/certs/tls.crt"; then
  echo "• Zertifikat existiert bereits"
else
  app "./scripts/gen-selfsigned-cert.sh localhost"
fi
app ./scripts/load-demo-users.sh

# --- 3. Bauen und starten ----------------------------------------------------
say "Images bauen (dauert beim ersten Mal einige Minuten)"
dc build
say "Container starten"
dc up -d

say "Warten, bis Keycloak und Portal bereit sind (max. 5 Min.)"
code=000
for _ in $(seq 1 60); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/auth/realms/itportal/.well-known/openid-configuration || true)
  [[ "$code" == 200 ]] && break
  sleep 5
done
dc ps
[[ "$code" == 200 ]] || die "Portal nicht unter https://localhost erreichbar (HTTP $code) – Logs: docker compose logs --tail=100"

say "Smoke-Test"
app ./scripts/smoke-test.sh || echo "⚠ Smoke-Test meldet Fehler"

say "Demo-Daten für Tickets und Statistiken laden"
app ./scripts/load-demo-data.sh

# --- 4. Zusammenfassung ------------------------------------------------------
kc_user=$(app "grep -E '^KEYCLOAK_ADMIN_USER=' .env | cut -d= -f2")
cat <<EOF

=====================================================================
 Fertig ($([[ $HARDENED == yes ]] && echo "gehärtet, rootless als srp in ${APP}" || echo "einfacher Modus, Root-Docker")).
 Im Windows-Browser öffnen:  https://localhost
 (Zertifikatswarnung bestätigen – selbstsigniertes Testzertifikat)

 Demo-Benutzer (Passwort muss beim 1. Login geändert werden, keine 2FA):
   anna.mueller   Demo!User-2026    Mitarbeitende
   uwe.helpdesk   Demo!Uhd-2026x    UHD / First-Level
   alex.admin     Demo!Admin-2026   Administration

 Statistik mit Demo-Daten (ca. 2.400 Tickets): https://localhost/statistik

 Keycloak-Admin-Konsole: https://localhost/auth/admin/
   Benutzer: ${kc_user}
   Passwort: sudo grep KEYCLOAK_ADMIN_PASSWORD ${APP}/.env

 Neue Konten per Selbstregistrierung brauchen eine @example.local-Adresse.
EOF
if [[ $HARDENED == yes ]]; then
  echo " Verwaltung als Dienstkonto:"
  echo "   sudo -u srp env XDG_RUNTIME_DIR=/run/user/${SRP_UID} DOCKER_HOST=unix:///run/user/${SRP_UID}/docker.sock \\"
  echo "     docker compose --project-directory ${APP} ps"
else
  echo " Stoppen: sudo docker compose down    Starten: sudo docker compose up -d"
fi
echo "====================================================================="
