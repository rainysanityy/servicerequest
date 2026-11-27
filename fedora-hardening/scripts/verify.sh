#!/usr/bin/env bash
# =============================================================================
#  Compliance-Prüfung der Härtung (nur lesend). Exit-Code = Anzahl Abweichungen.
#  Ausgabe eignet sich als Nachweis für Audits (BSI-Check / NIST CA-7).
# =============================================================================
set -uo pipefail
fails=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fails=$((fails+1)); }
chk()  { if eval "$2" &>/dev/null; then pass "$1"; else fail "$1"; fi; }
sshv() { sshd -T 2>/dev/null | awk -v k="$1" '$1==k{print $2}'; }

echo "Härtungsprüfung $(hostname -f) – $(date -Is)"
echo "--- SELinux"
chk "SELinux enforcing"                       '[[ $(getenforce) == Enforcing ]]'
chk "SELinux-Konfig persistent enforcing"     'grep -q "^SELINUX=enforcing" /etc/selinux/config'
chk "Boolean container_manage_cgroup=off"     '[[ $(getsebool container_manage_cgroup | awk "{print \$3}") == off ]]'
echo "--- SSH"
chk "PermitRootLogin no"                      '[[ $(sshv permitrootlogin) == no ]]'
chk "PasswordAuthentication no"               '[[ $(sshv passwordauthentication) == no ]]'
chk "KbdInteractiveAuthentication no"         '[[ $(sshv kbdinteractiveauthentication) == no ]]'
chk "X11Forwarding no"                        '[[ $(sshv x11forwarding) == no ]]'
chk "AllowTcpForwarding no"                   '[[ $(sshv allowtcpforwarding) == no ]]'
chk "MaxAuthTries <= 3"                       '(( $(sshv maxauthtries) <= 3 ))'
chk "Keine CBC-/SHA1-Algorithmen"             '! sshd -T | grep -E "^(ciphers|macs) " | grep -qiE "cbc|hmac-sha1|md5"'
echo "--- Firewall"
chk "firewalld aktiv"                         'systemctl is-active firewalld'
chk "Default-Zone srp"                        '[[ $(firewall-cmd --get-default-zone) == srp ]]'
chk "Zone-Target DROP"                        '[[ $(firewall-cmd --permanent --zone=srp --get-target) == DROP ]]'
chk "SSH nicht global geöffnet"               '! firewall-cmd --zone=srp --list-services | grep -qw ssh'
chk "Weiterleitung 443->8443"                 'firewall-cmd --zone=srp --list-forward-ports | grep -q "port=443:proto=tcp:toport=8443"'
echo "--- Kernel"
for kv in kernel.kptr_restrict=2 kernel.dmesg_restrict=1 kernel.randomize_va_space=2 fs.suid_dumpable=0 \
          net.ipv4.ip_forward=0 net.ipv4.conf.all.accept_redirects=0 net.ipv4.conf.all.send_redirects=0 \
          net.ipv4.tcp_syncookies=1 net.ipv4.conf.all.rp_filter=1 kernel.unprivileged_bpf_disabled=1; do
  k="${kv%%=*}"; v="${kv#*=}"
  chk "sysctl $k=$v" "[[ \$(sysctl -n $k) == $v ]]"
done
chk "USB-Storage deaktiviert"                 'modprobe -n -v usb-storage | grep -q "/bin/false"'
echo "--- Dateisysteme"
chk "/tmp noexec"                             'findmnt -no OPTIONS /tmp | grep -q noexec'
chk "/dev/shm noexec,nosuid,nodev"            'findmnt -no OPTIONS /dev/shm | grep -q noexec'
echo "--- Protokollierung"
chk "auditd aktiv"                            'systemctl is-active auditd'
chk "Audit-Regeln geladen (>20)"              '(( $(auditctl -l | wc -l) > 20 ))'
chk "Audit-Regeln immutable"                  'auditctl -s | grep -q "enabled 2"'
chk "journald persistent"                     '[[ -d /var/log/journal ]]'
chk "journald Seal=yes"                       'grep -rq "^Seal=yes" /etc/systemd/journald.conf.d/'
echo "--- Updates & Integrität"
chk "dnf-automatic Timer aktiv"               'systemctl is-active dnf5-automatic.timer || systemctl is-active dnf-automatic.timer'
chk "AIDE-Datenbank vorhanden"                '[[ -f /var/lib/aide/aide.db.gz ]]'
chk "AIDE-Timer aktiv"                        'systemctl is-active aide-check.timer'
chk "chrony synchronisiert"                   'chronyc tracking | grep -q "Leap status     : Normal"'
echo "--- Konten"
chk "Root-Passwort gesperrt"                  'passwd -S root | grep -qE "LK|L "'
chk "faillock aktiv"                          'grep -q "^deny = 5" /etc/security/faillock.conf'
chk "UMASK 027"                               'grep -qE "^UMASK\s+027" /etc/login.defs'
chk "sudo use_pty & Logfile"                  'grep -q use_pty /etc/sudoers.d/90-bsi'
echo "--- Container"
chk "Rootful Docker deaktiviert"              '! systemctl is-active docker.service'
chk "Rootless Docker (srp) aktiv"             'runuser -u srp -- env XDG_RUNTIME_DIR=/run/user/$(id -u srp) systemctl --user is-active docker'
chk "Unnötige Dienste aus (cups/avahi)"       '! systemctl is-active cups avahi-daemon'
echo
if (( fails == 0 )); then echo "Ergebnis: alle Prüfungen bestanden"; else echo "Ergebnis: ${fails} Abweichung(en)"; fi
exit "$fails"
