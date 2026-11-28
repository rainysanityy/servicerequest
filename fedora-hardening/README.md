# Fedora-Server-Härtung (BSI IT-Grundschutz / NIST SP 800-53)

Zwei gleichwertige Wege – **Ansible** (empfohlen für mehrere Server, wiederholbar, `--check`-fähig) oder **Bash** (Einzelserver). Beide verwenden dieselben Konfigurationsdateien aus `files/`.

## Voraussetzungen

* Fedora Server 41 oder neuer, Minimalinstallation, Partitionierung mit **LUKS2-Verschlüsselung** für `/srv` (Daten, Backups) und separaten Mountpoints `/var/log`, `/var/log/audit`, `/home` (empfohlen, BSI SYS.1.3).
* Mindestens **ein personalisiertes Admin-Konto mit hinterlegtem SSH-Public-Key** (`~/.ssh/authorized_keys`). Ohne Key wird die SSH-Härtung automatisch übersprungen (Aussperrschutz).
* Konsolenzugang (iLO/iDRAC/VM-Konsole) für den Notfall.

## Variante A – Ansible

```bash
cd fedora-hardening/ansible
ansible-galaxy collection install -r requirements.yml
cp inventory.example.ini inventory.ini        # Hosts eintragen
vi group_vars/all.yml                         # srp_admin_cidr, srp_admin_users, NTP
ansible-playbook -i inventory.ini site.yml --check --diff   # Trockenlauf
ansible-playbook -i inventory.ini site.yml
```

## Variante B – Bash

```bash
sudo ADMIN_CIDR=10.10.0.0/24 ADMIN_USERS="max.admin" \
     NTP_SERVERS="ntp1.example.local ntp2.example.local" \
     ./scripts/harden.sh
sudo ./scripts/verify.sh            # Compliance-Nachweis (Exit-Code = Abweichungen)
sudo systemctl reboot               # Audit-Regeln (immutable), tmp.mount, Kernelparameter
```

## Umgesetzte Maßnahmen

| Bereich | Maßnahme | BSI-Baustein | NIST 800-53 |
|---|---|---|---|
| SELinux | `enforcing`/`targeted`, restriktive Container-Booleans, `deny_ptrace` | SYS.1.3 | AC-3, AC-6 |
| SSH | nur Public Key, kein Root, `AllowGroups sshusers`, TR-02102-4-Algorithmen, Banner, Forwarding aus | SYS.1.3, OPS.1.2.5 | AC-17, IA-2, SC-8 |
| Firewall | firewalld/nftables, Zone `srp` Target DROP, SSH nur aus Admin-Netz, 443→8443 | NET.3.2, SYS.1.1 | SC-7, CM-7 |
| Kernel | sysctl (ASLR, kptr/dmesg restrict, BPF, Redirects, rp_filter, SYN-Cookies), Core-Dumps aus, Modul-Blacklist | SYS.1.3 | SC-5, SI-16 |
| Dateisysteme | `/tmp`, `/dev/shm` mit `nosuid,nodev,noexec` | SYS.1.3 | CM-6 |
| Konten | pwquality, faillock (5 Versuche), UMASK 027, YESCRYPT, sudo-I/O-Logging, Root gesperrt | ORP.4 | AC-2, AC-7, IA-5 |
| Protokollierung | auditd (Identitäten, Privilegien, Module, Zeit, Container, Portal-Secrets, immutable), journald persistent + FSS-Siegel | OPS.1.1.5 | AU-2, AU-9, AU-12 |
| Updates | dnf(5)-automatic: Sicherheitsupdates automatisch, Neustart bei Bedarf | OPS.1.1.3 | SI-2 |
| Integrität | AIDE-Datenbank + täglicher Timer | SYS.1.1, SYS.1.3 | SI-7 |
| Zeit | chrony mit internen Quellen | OPS.1.1.5 | AU-8 |
| Kryptografie | systemweite Crypto-Policy `BSI` (falls verfügbar) sonst `DEFAULT:NO-SHA1` | CON.1 | SC-13 |
| Container | Docker CE **rootless** unter Dienstkonto `srp` (nologin), rootful Daemon deaktiviert, SELinux-Labels, slirp4netns (echte Client-IP) | SYS.1.6 | CM-7, AC-6 |
| Backup | systemd-Timer 02:15, age-verschlüsselt, Rotation | CON.3 | CP-9, SC-28 |

## Wichtige Hinweise

* **Audit-Regeln sind immutable** (`-e 2`): Änderungen werden erst nach Neustart wirksam.
* **FSS-Schlüssel** des Journals liegt nach der Härtung in `/root/journal-fss-verification-key.txt` → offline sichern, dann Datei löschen.
* **Cockpit** ist deaktiviert. Falls benötigt: nur aus dem Admin-Netz freigeben (Rich Rule) und MFA nutzen.
* **Rootless Docker & Ports < 1024**: nicht über `ip_unprivileged_port_start` absenken, sondern firewalld-Forward-Ports nutzen (bereits konfiguriert).
* Ausnahmen/Abweichungen sind im Infosicherheitskonzept zu dokumentieren (Risikoakzeptanz).

## Betrieb unter WSL2 (Test-/Schulungsumgebung)

`harden.sh` und `verify.sh` erkennen Fedora unter WSL2 automatisch. Alles, was der WSL-Kernel bereitstellt, wird wie auf
einem echten Server umgesetzt (SSH, firewalld-Zone `srp`, sysctl, `/tmp`/`/dev/shm`, journald mit Seal, dnf-automatic,
AIDE, chrony, Konten/sudo, rootless Docker unter `srp`).

| Kontrolle | WSL2 |
|---|---|
| SELinux enforcing, Booleans | **N/A** – WSL-Kernel ohne SELinux; `/etc/selinux/config` steht trotzdem auf `enforcing` |
| auditd, Audit-Regeln, immutable | **N/A** – WSL-Kernel ohne Audit-Subsystem; Regeln liegen in `/etc/audit/rules.d/` |
| USB-Storage | geprüft wird die modprobe-Sperre (WSL hat keinen direkten USB-Zugriff) |
| SSH ohne `authorized_keys` | Härtung wird trotzdem angewendet (kein Aussperr-Risiko, `wsl` öffnet immer eine Konsole) |
| Ports 80/443 | `net.ipv4.ip_unprivileged_port_start=80`, weil die localhost-Weiterleitung von Windows die firewalld-Portumleitung umgeht |
| `ADMIN_CIDR` | Standard `172.16.0.0/12` (WSL-NAT) |

Ablauf: `sudo ADMIN_USERS="$USER" fedora-hardening/scripts/harden.sh` → in PowerShell `wsl --shutdown` → WSL neu öffnen →
`sudo fedora-hardening/scripts/verify.sh` → `./scripts/wsl-demo-install.sh` (installiert dann rootless als `srp`).

Hinweise: Alle WSL-Distributionen teilen sich einen Kernel – sysctl-Werte wie `net.ipv4.ip_forward=0` wirken auch in
anderen Distributionen (z. B. Docker Desktop). Ressourcenlimits für rootless Container brauchen cgroup v2; falls `harden.sh`
davor warnt, in `%UserProfile%\.wslconfig` unter `[wsl2]` die Zeile `kernelCommandLine = cgroup_no_v1=all` ergänzen.

