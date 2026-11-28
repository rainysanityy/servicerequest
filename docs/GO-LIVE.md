# Go-Live-Checkliste – IT-Service-Portal

Abarbeiten vor der Freigabe für den Produktivbetrieb. Jede Zeile mit Datum und Kürzel abhaken; die ausgefüllte Liste
gehört zur Freigabedokumentation (Betriebskonzept, Anhang B).

## 1. Plattform

| ✓ | Prüfpunkt | Nachweis |
|---|---|---|
| ☐ | Server mit `fedora-hardening/scripts/harden.sh` (oder Ansible) gehärtet, Neustart erfolgt | Protokoll `/var/log/srp-hardening.log` |
| ☐ | `sudo fedora-hardening/scripts/verify.sh` ohne FAIL (auf echtem Server kein N/A) | Ausgabe archivieren |
| ☐ | `/srv` auf verschlüsseltem Volume (LUKS) | `lsblk -f` |
| ☐ | journald-FSS-Verifikationsschlüssel offline gesichert, Datei `/root/journal-fss-verification-key.txt` gelöscht | Tresor-Eintrag |
| ☐ | Zeitquellen = interne NTP-Server (`NTP_SERVERS`), `chronyc tracking` synchron | Ausgabe |

## 2. Konfiguration

| ✓ | Prüfpunkt | Nachweis |
|---|---|---|
| ☐ | `./scripts/prod-setup.sh` vollständig durchgelaufen | Ausgabe |
| ☐ | `./scripts/prod-preflight.sh` ohne Fehler, Warnungen bewertet | Ausgabe archivieren |
| ☐ | Zertifikat der Unternehmens-PKI, SAN = Hostname, Kette vollständig, Ablauf überwacht | *Admin → Zertifikat* (Ampel) bzw. `openssl x509 -in proxy/certs/tls.crt -noout -text` |
| ☐ | Zertifikatstausch einmal geübt (.p12 hochladen, aktivieren, wiederherstellen) | Audit `admin.tls.install` |
| ☐ | TLS-Test (z. B. `testssl.sh https://<host>`): nur TLS 1.2/1.3, keine schwachen Suiten | Bericht |
| ☐ | `package-lock.json` versioniert, Image-Scan (Trivy in der CI) ohne kritische Befunde | CI-Lauf |
| ☐ | Keine Demo-Benutzer, keine Demo-Daten (`prod-preflight.sh` prüft beides) | Ausgabe |

## 3. Identitäten und Rechte

| ✓ | Prüfpunkt | Nachweis |
|---|---|---|
| ☐ | Zwei-Faktor-Pflicht aktiv: Realm `itportal` → Authentication → Browser-Flow `browser-mfa` | Screenshot |
| ☐ | Test: UHD-Konto muss beim Login TOTP einrichten, normales Konto nicht | Testprotokoll |
| ☐ | Erstes Portal-Admin-Konto angemeldet, Passwort geändert, TOTP eingerichtet | – |
| ☐ | Personalisierte Admin-Konten im Realm `master` mit OTP angelegt | – |
| ☐ | Bootstrap-Konto (`KEYCLOAK_ADMIN_USER`) gelöscht, `KEYCLOAK_ADMIN_PASSWORD` aus `.env` entfernt | `prod-preflight.sh` ohne Warnung |
| ☐ | Admin-Konsole nur aus dem Admin-Netz erreichbar (Test von außerhalb → 403) | Testprotokoll |
| ☐ | `ALLOWED_EMAIL_DOMAINS` = eigene Domains; Verfahren zur Sichtung neuer Konten festgelegt | Betriebshandbuch |
| ☐ | Optional: LDAP/AD-Anbindung statt Selbstregistrierung getestet | – |

## 4. Betrieb

| ✓ | Prüfpunkt | Nachweis |
|---|---|---|
| ☐ | Backup manuell ausgelöst (`sudo systemctl start srp-backup.service`), Dateien `*.age` vorhanden | `ls -l /srv/backup/srp` |
| ☐ | Restore in Testumgebung erfolgreich (`scripts/restore.sh`), Daten vollständig | Testprotokoll |
| ☐ | Kopie der Backups auf zentrales Backup-System eingerichtet | – |
| ☐ | Monitoring: Healthchecks, Zertifikatsablauf, Plattenplatz; Alarme getestet | – |
| ☐ | Logs (journald/Audit) an SIEM angebunden | – |
| ☐ | Audit-Log im Portal: *Admin → Audit → Integrität prüfen* = „Hash-Kette intakt“ | Screenshot |
| ☐ | Support-Telefonnummer und Servicezeiten im Portal korrekt | Startseite |

## 5. Organisation

| ✓ | Prüfpunkt | Nachweis |
|---|---|---|
| ☐ | Informationssicherheitskonzept freigegeben, Restrisiken (u. a. R20 Selbstregistrierung) vom ISB akzeptiert | Unterschrift |
| ☐ | Datenschutzkonzept freigegeben, Verarbeitungsverzeichnis ergänzt, Betriebsrat beteiligt | Unterschrift |
| ☐ | UHD- und Admin-Team geschult (Support- & Admin-Handbuch) | Teilnehmerliste |
| ☐ | Nutzende informiert (Benutzerhandbuch, Datenschutzhinweis) | Mitteilung |

**Freigabe:** _______________________ (Verfahrensverantwortliche/r) Datum: __________
