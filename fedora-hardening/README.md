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
