#!/usr/bin/env bash
# =============================================================================
#  Compliance-Prüfung der Härtung (nur lesend). Exit-Code = Anzahl Abweichungen.
#  Ausgabe eignet sich als Nachweis für Audits (BSI-Check / NIST CA-7).
# =============================================================================
set -uo pipefail
fails=0; nas=0
IS_WSL=no
grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null && IS_WSL=yes
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fails=$((fails+1)); }
na()   { printf '  \033[33mN/A \033[0m  %s – %s\n' "$1" "$2"; nas=$((nas+1)); }
chk()  { if eval "$2" &>/dev/null; then pass "$1"; else fail "$1"; fi; }
# chk_k: Kontrolle, die der WSL-Kernel technisch nicht bereitstellt
chk_k() { if [[ $IS_WSL == yes ]]; then na "$1" "im WSL-Kernel nicht verfügbar"; else chk "$1" "$2"; fi; }
sshv() { sshd -T 2>/dev/null | awk -v k="$1" '$1==k{print $2}'; }

echo "Härtungsprüfung $(hostname -f 2>/dev/null || cat /etc/hostname) – $(date -Is)$([[ $IS_WSL == yes ]] && echo ' – WSL2')"
echo "--- SELinux"
chk_k "SELinux enforcing"                     '[[ $(getenforce) == Enforcing ]]'
chk "SELinux-Konfig persistent enforcing"     'grep -q "^SELINUX=enforcing" /etc/selinux/config'
chk_k "Boolean container_manage_cgroup=off"   '[[ $(getsebool container_manage_cgroup | awk "{print \$3}") == off ]]'
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
if [[ $IS_WSL == yes ]]; then
  chk "USB-Storage gesperrt (modprobe-Blacklist)" 'grep -q "install usb-storage /bin/false" /etc/modprobe.d/90-bsi-blacklist.conf'
else
  chk "USB-Storage deaktiviert"               'modprobe -n -v usb-storage | grep -q "/bin/false"'
fi
echo "--- Dateisysteme"
chk "/tmp noexec"                             'findmnt -no OPTIONS /tmp | grep -q noexec'
chk "/dev/shm noexec,nosuid,nodev"            'findmnt -no OPTIONS /dev/shm | grep -q noexec'
echo "--- Protokollierung"
chk_k "auditd aktiv"                          'systemctl is-active auditd'
chk_k "Audit-Regeln geladen (>20)"            '(( $(auditctl -l | wc -l) > 20 ))'
chk_k "Audit-Regeln immutable"                'auditctl -s | grep -q "enabled 2"'
chk "Audit-Regeln hinterlegt"                 '[[ -s /etc/audit/rules.d/90-bsi.rules ]]'
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
chk "cgroup-Delegation für Rootless"          'grep -q "Delegate=.*cpu" /etc/systemd/system/user@.service.d/delegate.conf'
chk "Rootless Docker (srp) aktiv"             'runuser -u srp -- env XDG_RUNTIME_DIR=/run/user/$(id -u srp) systemctl --user is-active docker'
chk "Unnötige Dienste aus (cups/avahi)"       '! systemctl is-active cups avahi-daemon'
echo
na_txt=""; (( nas > 0 )) && na_txt=" – ${nas} Kontrolle(n) plattformbedingt nicht anwendbar (WSL2)"
if (( fails == 0 )); then echo "Ergebnis: alle anwendbaren Prüfungen bestanden${na_txt}"; else echo "Ergebnis: ${fails} Abweichung(en)${na_txt}"; fi
exit "$fails"
