#!/usr/bin/env bash
# =============================================================================
#  Fedora Server – Härtung nach BSI IT-Grundschutz (SYS.1.1, SYS.1.3, OPS.1.1.3,
#  OPS.1.1.5, NET.3.2, SYS.1.6) und NIST SP 800-53 (CM-6/7, AC-17, AU-2, SC-7/8/28, SI-2)
#
#  Idempotent – kann mehrfach ausgeführt werden. Als root ausführen:
#     sudo ADMIN_CIDR=10.10.0.0/24 ADMIN_USERS="max.admin" ./harden.sh
#
#  Optionen (Umgebungsvariablen):
#     ADMIN_CIDR       Netz, aus dem SSH erlaubt ist (Pflicht)
#     ADMIN_USERS      Leerzeichen-getrennte Admin-Konten (müssen authorized_keys haben)
#     SRP_USER         Dienstkonto für rootless Docker (Default: srp)
#     APP_DIR          Installationsverzeichnis Portal (Default: /srv/srp/app)
#     INSTALL_DOCKER   yes|no – Docker CE rootless installieren (Default: yes)
#     NTP_SERVERS      Leerzeichen-getrennt (Default: aus files/misc/chrony-sources.conf)
#     SKIP_SSH         yes – SSH-Härtung überspringen (z. B. bei fehlenden Keys)
#
#  WSL2 (Fedora unter Windows) wird erkannt: alles, was der WSL-Kernel kann, wird
#  wie auf einem echten Server umgesetzt. Nicht möglich sind SELinux und auditd
#  (im WSL-Kernel nicht enthalten) – verify.sh weist diese als "N/A" aus.
#  Zusätzlich dürfen unprivilegierte Prozesse Port 80/443 binden, weil die
#  localhost-Weiterleitung von Windows die firewalld-Portumleitung umgeht.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FILES="${HERE}/../files"
IS_WSL=no
grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null && IS_WSL=yes
# WSL: Windows-Host erreicht die VM über das NAT-Netz 172.16.0.0/12
[[ "$IS_WSL" == yes ]] && ADMIN_CIDR="${ADMIN_CIDR:-172.16.0.0/12}"
ADMIN_CIDR="${ADMIN_CIDR:?ADMIN_CIDR setzen, z. B. 10.10.0.0/24}"
ADMIN_USERS="${ADMIN_USERS:-}"
SRP_USER="${SRP_USER:-srp}"
APP_DIR="${APP_DIR:-/srv/srp/app}"
INSTALL_DOCKER="${INSTALL_DOCKER:-yes}"
SKIP_SSH="${SKIP_SSH:-no}"
LOG="/var/log/srp-hardening.log"

[[ $EUID -eq 0 ]] || { echo "Bitte als root ausführen"; exit 1; }
grep -qi fedora /etc/os-release || { echo "Nur für Fedora Server vorgesehen"; exit 1; }
exec > >(tee -a "$LOG") 2>&1

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
install_file() { # src dest mode
  install -D -m "${3:-0644}" -o root -g root "$1" "$2"
  restorecon -F "$2" 2>/dev/null || true
}

echo "Start Härtung: $(date -Is) auf $(hostname -f 2>/dev/null || cat /etc/hostname)$([[ $IS_WSL == yes ]] && echo ' (WSL2)')"

# -----------------------------------------------------------------------------
step "1. System aktualisieren & Pakete minimieren (OPS.1.1.3, CM-7)"
dnf -y upgrade --refresh
BASE_PKGS="policycoreutils-python-utils audit aide chrony firewalld openssh-server age openssl tar jq libpwquality shadow-utils fuse-overlayfs slirp4netns iproute rsync sudo"
# shellcheck disable=SC2086
dnf -y install $BASE_PKGS setools-console dnf5-plugin-automatic || dnf -y install $BASE_PKGS dnf-automatic
for p in telnet telnet-server rsh rsh-server ypbind ypserv tftp tftp-server talk xinetd vsftpd; do
  rpm -q "$p" &>/dev/null && dnf -y remove "$p" && ok "entfernt: $p"
done
ok "Pakete aktualisiert"

# -----------------------------------------------------------------------------
step "2. Nicht benötigte Dienste deaktivieren (SYS.1.3)"
for s in avahi-daemon.service avahi-daemon.socket cups.service cups.socket bluetooth.service \
         ModemManager.service rpcbind.service rpcbind.socket nfs-server.service \
         cockpit.socket kdump.service; do
  if systemctl list-unit-files "$s" &>/dev/null && systemctl is-enabled "$s" &>/dev/null; then
    systemctl disable --now "$s" && ok "deaktiviert: $s"
  fi
done
systemctl mask --now ctrl-alt-del.target >/dev/null 2>&1 || true
install_file "${FILES}/modprobe/90-bsi-blacklist.conf" /etc/modprobe.d/90-bsi-blacklist.conf

# -----------------------------------------------------------------------------
step "3. SELinux enforcing (SYS.1.3, AC-3)"
if [[ "$IS_WSL" == yes ]]; then
  sed -i 's/^SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config
  warn "WSL2: Der WSL-Kernel enthält kein SELinux – Konfiguration gesetzt, Durchsetzung nicht möglich (verify: N/A)"
elif [[ "$(getenforce)" == "Disabled" ]]; then
  warn "SELinux ist deaktiviert – Relabel beim nächsten Boot wird vorbereitet"
  sed -i 's/^SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config
  touch /.autorelabel
else
  sed -i 's/^SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config
  sed -i 's/^SELINUXTYPE=.*/SELINUXTYPE=targeted/' /etc/selinux/config
  setenforce 1
fi
# Container-Booleans restriktiv (nur was das Portal braucht – nichts davon)
for b in container_manage_cgroup=off container_use_devices=off virt_use_nfs=off virt_use_samba=off \
         container_connect_any=off selinuxuser_execheap=off selinuxuser_execstack=off \
         ssh_sysadm_login=off deny_ptrace=on; do
  name="${b%%=*}"; val="${b#*=}"
  if getsebool "$name" &>/dev/null; then setsebool -P "$name" "$val"; ok "SELinux-Boolean $name=$val"; fi
done
ok "SELinux: $(getenforce 2>/dev/null || echo n/a)"

# -----------------------------------------------------------------------------
step "4. Kryptorichtlinie (TR-02102 / SC-13)"
if [[ -f /usr/share/crypto-policies/policies/BSI.pol ]]; then
  update-crypto-policies --set BSI && ok "Crypto-Policy BSI aktiv"
else
  update-crypto-policies --set DEFAULT:NO-SHA1 && ok "Crypto-Policy DEFAULT:NO-SHA1 aktiv (BSI-Policy nicht verfügbar)"
fi

# -----------------------------------------------------------------------------
step "5. Konten, Passwortqualität, Sperren, sudo (ORP.4, AC-2/AC-7)"
install_file "${FILES}/security/90-bsi-pwquality.conf" /etc/security/pwquality.conf.d/90-bsi.conf
install_file "${FILES}/security/faillock.conf" /etc/security/faillock.conf
authselect current &>/dev/null && authselect enable-feature with-faillock >/dev/null 2>&1 || true
sed -i 's/^UMASK.*/UMASK\t\t027/' /etc/login.defs
grep -q '^ENCRYPT_METHOD' /etc/login.defs && sed -i 's/^ENCRYPT_METHOD.*/ENCRYPT_METHOD YESCRYPT/' /etc/login.defs || echo 'ENCRYPT_METHOD YESCRYPT' >> /etc/login.defs
install_file "${FILES}/misc/umask.sh" /etc/profile.d/99-umask.sh
install_file "${FILES}/sudoers/90-bsi" /etc/sudoers.d/90-bsi 0440
visudo -cf /etc/sudoers.d/90-bsi >/dev/null && ok "sudo-Härtung geprüft"
mkdir -p /var/log/sudo-io && chmod 0700 /var/log/sudo-io
getent group sshusers >/dev/null || groupadd -r sshusers
for u in $ADMIN_USERS; do
  if id "$u" &>/dev/null; then usermod -aG sshusers,wheel "$u"; ok "Admin $u → sshusers, wheel"; else warn "Konto $u existiert nicht"; fi
done
passwd -l root >/dev/null 2>&1 && ok "Root-Passwort gesperrt (Konsole: sudo über personalisierte Konten)"

# -----------------------------------------------------------------------------
step "6. SSH-Härtung (TR-02102-4, AC-17)"
systemctl enable --now sshd >/dev/null 2>&1 || warn "sshd konnte nicht gestartet werden"
if [[ "$SKIP_SSH" == "yes" ]]; then
  warn "SSH-Härtung übersprungen (SKIP_SSH=yes)"
else
  has_key=no
  for u in $ADMIN_USERS; do
    h="$(getent passwd "$u" | cut -d: -f6)"
    [[ -s "${h}/.ssh/authorized_keys" ]] && has_key=yes
  done
  # WSL: kein Aussperr-Risiko (Konsole über "wsl" bleibt immer erreichbar)
  if [[ "$has_key" != "yes" && "$IS_WSL" == yes ]]; then
    warn "WSL2: kein authorized_keys gefunden – SSH-Härtung wird trotzdem angewendet (Login danach nur mit Schlüssel)"
    has_key=yes
  fi
  if [[ "$has_key" != "yes" ]]; then
    warn "Kein Admin mit authorized_keys gefunden – SSH-Härtung NICHT angewendet (Aussperr-Schutz)."
  else
    [[ -f /etc/ssh/ssh_host_ecdsa_key ]] || ssh-keygen -q -t ecdsa -b 384 -N '' -f /etc/ssh/ssh_host_ecdsa_key
    # Schwache RSA-Hostkeys ersetzen
    if [[ -f /etc/ssh/ssh_host_rsa_key ]] && (( $(ssh-keygen -lf /etc/ssh/ssh_host_rsa_key | awk '{print $1}') < 3072 )); then
      rm -f /etc/ssh/ssh_host_rsa_key*; ssh-keygen -q -t rsa -b 4096 -N '' -f /etc/ssh/ssh_host_rsa_key
    fi
    install_file "${FILES}/misc/issue.net" /etc/issue.net
    install_file "${FILES}/ssh/00-bsi-hardening.conf" /etc/ssh/sshd_config.d/00-bsi-hardening.conf 0600
    if sshd -t; then systemctl reload sshd; ok "sshd neu geladen (Key-only, kein Root, starke Algorithmen)"
    else warn "sshd -t fehlgeschlagen – Konfiguration wird zurückgenommen"; rm -f /etc/ssh/sshd_config.d/00-bsi-hardening.conf; fi
  fi
fi

# -----------------------------------------------------------------------------
step "7. Firewall – firewalld/nftables, Default DROP (NET.3.2, SC-7)"
systemctl enable --now firewalld || { warn "firewalld startet nicht"; [[ "$IS_WSL" == yes ]] || exit 1; }
sed "s#ADMIN_CIDR_PLACEHOLDER#${ADMIN_CIDR}#" "${FILES}/firewalld/srp.xml" > /etc/firewalld/zones/srp.xml
restorecon -F /etc/firewalld/zones/srp.xml || true
firewall-cmd --reload >/dev/null
if command -v nmcli >/dev/null; then
  IFACES="$(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="ethernet"{print $1}')"
else
  IFACES="$(ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -E '^(eth|en)' || true)"
fi
for ifc in $IFACES; do
  firewall-cmd --permanent --zone=srp --change-interface="$ifc" >/dev/null && ok "Interface $ifc → Zone srp"
done
firewall-cmd --set-default-zone=srp >/dev/null
firewall-cmd --permanent --remove-service=cockpit --zone=srp >/dev/null 2>&1 || true
firewall-cmd --set-log-denied=unicast >/dev/null
firewall-cmd --reload >/dev/null
ok "Aktive Zone: $(firewall-cmd --get-default-zone) – $(firewall-cmd --zone=srp --list-services)"

# -----------------------------------------------------------------------------
step "8. Kernel/sysctl-Härtung (SYS.1.3, SC-5)"
install_file "${FILES}/sysctl/90-bsi-hardening.conf" /etc/sysctl.d/90-bsi-hardening.conf
if [[ "$IS_WSL" == yes ]]; then
  # Windows leitet localhost:443 direkt auf 127.0.0.1:443 in der VM weiter (ohne PREROUTING/forward-port)
  printf '# WSL2: Portal (rootless) bindet 80/443 direkt\nnet.ipv4.ip_unprivileged_port_start = 80\n' > /etc/sysctl.d/91-wsl.conf
  warn "WSL2: Kernel wird von allen WSL-Distributionen geteilt – sysctl-Werte (z. B. ip_forward=0) wirken auch dort"
fi
sysctl --system >/dev/null 2>&1 && ok "sysctl angewendet" || warn "sysctl: einzelne Parameter nicht setzbar (sysctl --system prüfen)"
mkdir -p /etc/systemd/coredump.conf.d
printf '[Coredump]\nStorage=none\nProcessSizeMax=0\n' > /etc/systemd/coredump.conf.d/90-bsi.conf
printf '* hard core 0\n' > /etc/security/limits.d/90-nocore.conf

# -----------------------------------------------------------------------------
step "9. Dateisysteme: /tmp & /dev/shm (SYS.1.3)"
install_file "${FILES}/misc/tmp.mount.conf" /etc/systemd/system/tmp.mount.d/90-bsi.conf
if ! grep -qE '^\S+\s+/dev/shm\s' /etc/fstab; then
  echo 'tmpfs /dev/shm tmpfs defaults,nosuid,nodev,noexec 0 0' >> /etc/fstab
fi
systemctl daemon-reload
mount -o remount,nosuid,nodev,noexec /dev/shm || true
ok "Mount-Optionen gesetzt (Neustart von tmp.mount beim nächsten Boot)"

# -----------------------------------------------------------------------------
step "10. Protokollierung: auditd & journald (OPS.1.1.5, AU-2/AU-9/AU-11)"
install_file "${FILES}/audit/90-bsi.rules" /etc/audit/rules.d/90-bsi.rules 0640
sed -i 's/^max_log_file_action.*/max_log_file_action = keep_logs/; s/^space_left_action.*/space_left_action = email/; s/^admin_space_left_action.*/admin_space_left_action = single/; s/^disk_full_action.*/disk_full_action = halt/; s/^log_group.*/log_group = root/' /etc/audit/auditd.conf
if [[ "$IS_WSL" == yes ]]; then
  warn "WSL2: Der WSL-Kernel enthält kein Audit-Subsystem – Regeln installiert, auditd nicht aktivierbar (verify: N/A)"
else
  systemctl enable auditd >/dev/null
  augenrules --check >/dev/null 2>&1 || true
  augenrules --load >/dev/null 2>&1 || warn "Audit-Regeln sind bereits immutable (-e 2) – werden nach Neustart aktiv"
fi
install_file "${FILES}/journald/90-bsi.conf" /etc/systemd/journald.conf.d/90-bsi.conf
mkdir -p /var/log/journal && systemd-tmpfiles --create --prefix /var/log/journal
systemctl restart systemd-journald
if [[ ! -f /var/log/journal/$(cat /etc/machine-id)/fss ]]; then
  journalctl --setup-keys --force > /root/journal-fss-verification-key.txt 2>&1 || true
  chmod 0400 /root/journal-fss-verification-key.txt
  warn "FSS-Verifikationsschlüssel in /root/journal-fss-verification-key.txt – OFFLINE sichern und Datei löschen!"
fi
ok "auditd & journald konfiguriert"

# -----------------------------------------------------------------------------
step "11. Zeitsynchronisation (chrony)"
install_file "${FILES}/misc/chrony-sources.conf" /etc/chrony.d/90-srp-sources.conf
if [[ -n "${NTP_SERVERS:-}" ]]; then
  : > /etc/chrony.d/90-srp-sources.conf
  for s in $NTP_SERVERS; do echo "server $s iburst" >> /etc/chrony.d/90-srp-sources.conf; done
fi
if systemctl enable --now chronyd >/dev/null 2>&1 && systemctl restart chronyd; then ok "chrony aktiv"; else warn "chrony konnte nicht gestartet werden"; fi

# -----------------------------------------------------------------------------
step "12. Automatische Sicherheitsupdates (OPS.1.1.3, SI-2)"
install_file "${FILES}/dnf/automatic.conf" /etc/dnf/automatic.conf
if systemctl list-unit-files dnf5-automatic.timer &>/dev/null; then
  systemctl enable --now dnf5-automatic.timer >/dev/null && ok "dnf5-automatic.timer aktiv"
else
  systemctl enable --now dnf-automatic.timer >/dev/null && ok "dnf-automatic.timer aktiv"
fi

# -----------------------------------------------------------------------------
step "13. Dateiintegrität – AIDE (SI-7)"
if [[ ! -f /var/lib/aide/aide.db.gz ]]; then
  aide --init >/dev/null 2>&1 && mv -f /var/lib/aide/aide.db.new.gz /var/lib/aide/aide.db.gz && ok "AIDE-Datenbank initialisiert"
fi
install_file "${FILES}/systemd/aide-check.service" /etc/systemd/system/aide-check.service
install_file "${FILES}/systemd/aide-check.timer" /etc/systemd/system/aide-check.timer
systemctl daemon-reload && systemctl enable --now aide-check.timer >/dev/null && ok "AIDE-Timer aktiv"

# -----------------------------------------------------------------------------
step "14. Dienstkonto & rootless Docker (SYS.1.6)"
if ! id "$SRP_USER" &>/dev/null; then
  useradd --system --create-home --home-dir "/home/${SRP_USER}" --shell /sbin/nologin "$SRP_USER"
  ok "Dienstkonto $SRP_USER angelegt (keine Login-Shell)"
fi
grep -q "^${SRP_USER}:" /etc/subuid || usermod --add-subuids 200000-265535 "$SRP_USER"
grep -q "^${SRP_USER}:" /etc/subgid || usermod --add-subgids 200000-265535 "$SRP_USER"
SRP_UID="$(id -u "$SRP_USER")"
install -d -m 0750 -o "$SRP_USER" -g "$SRP_USER" /srv/srp "$APP_DIR"
install -d -m 0700 -o "$SRP_USER" -g "$SRP_USER" /srv/backup/srp

# Rootless-Container brauchen delegierte cgroup-Controller (cpu/io für Ressourcenlimits)
if ! cmp -s "${FILES}/systemd/user-delegate.conf" /etc/systemd/system/user@.service.d/delegate.conf; then
  install_file "${FILES}/systemd/user-delegate.conf" /etc/systemd/system/user@.service.d/delegate.conf
  systemctl daemon-reload
  systemctl try-restart "user@${SRP_UID}.service" 2>/dev/null || true
  ok "cgroup-Delegation (cpu, cpuset, io, memory, pids) für Benutzerdienste"
fi
if [[ ! -f /sys/fs/cgroup/cgroup.controllers ]]; then
  warn "cgroup v2 nicht aktiv – Ressourcenlimits der Container greifen rootless nicht."
  [[ "$IS_WSL" == yes ]] && warn "WSL2: in %UserProfile%\\.wslconfig unter [wsl2] 'kernelCommandLine = cgroup_no_v1=all' setzen, dann 'wsl --shutdown'"
fi

if [[ "$INSTALL_DOCKER" == "yes" ]]; then
  # Fedora-Pakete (moby-engine, z. B. aus der WSL-Demo) kollidieren mit Docker CE
  if rpm -q moby-engine &>/dev/null; then
    systemctl disable --now docker.service docker.socket >/dev/null 2>&1 || true
    dnf -y remove moby-engine docker-compose docker-cli >/dev/null 2>&1 || dnf -y remove moby-engine
    warn "moby-engine (rootful) entfernt – Container/Volumes des Root-Daemons werden nicht übernommen"
  fi
  if ! rpm -q docker-ce &>/dev/null; then
    dnf -y install dnf-plugins-core
    dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null \
      || dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras
  fi
  # Rootful-Daemon deaktivieren – nur rootless Betrieb
  systemctl disable --now docker.service docker.socket containerd.service >/dev/null 2>&1 || true
  loginctl enable-linger "$SRP_USER"
  sleep 2
  SRP_HOME="$(getent passwd "$SRP_USER" | cut -d: -f6)"
  install -D -m 0644 -o "$SRP_USER" -g "$SRP_USER" "${FILES}/docker/daemon.json" "${SRP_HOME}/.config/docker/daemon.json"
  install -D -m 0644 -o "$SRP_USER" -g "$SRP_USER" "${FILES}/docker/rootless-override.conf" "${SRP_HOME}/.config/systemd/user/docker.service.d/override.conf"
  runuser -u "$SRP_USER" -- env XDG_RUNTIME_DIR="/run/user/${SRP_UID}" \
    dockerd-rootless-setuptool.sh install --skip-iptables >/dev/null 2>&1 || warn "dockerd-rootless-setuptool: bitte Ausgabe manuell prüfen"
  for _ in 1 2 3 4 5; do [[ -d "/run/user/${SRP_UID}" ]] && break; sleep 2; done
  runuser -u "$SRP_USER" -- env XDG_RUNTIME_DIR="/run/user/${SRP_UID}" systemctl --user daemon-reload
  runuser -u "$SRP_USER" -- env XDG_RUNTIME_DIR="/run/user/${SRP_UID}" systemctl --user enable --now docker
  ok "Rootless Docker für ${SRP_USER} aktiv (DOCKER_HOST=unix:///run/user/${SRP_UID}/docker.sock)"
fi

# Backup-Timer
sed "s/@SRP_UID@/${SRP_UID}/g" "${FILES}/systemd/srp-backup.service" > /etc/systemd/system/srp-backup.service
install_file "${FILES}/systemd/srp-backup.timer" /etc/systemd/system/srp-backup.timer
systemctl daemon-reload && systemctl enable srp-backup.timer >/dev/null && ok "Backup-Timer aktiviert (02:15)"

# -----------------------------------------------------------------------------
step "15. Abschluss"
"${HERE}/verify.sh" || true
echo
echo "Härtung abgeschlossen. Empfohlen: Neustart (Audit-Regeln immutable, tmp.mount, Kernelparameter)."
echo "Protokoll: $LOG"
