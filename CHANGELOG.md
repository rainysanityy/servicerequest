# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt
- Produktiv-Einrichtung: `scripts/prod-setup.sh` (geführt oder unbeaufsichtigt), `scripts/prod-preflight.sh` (Go-Live-Prüfung), `docs/GO-LIVE.md`
- Zwei-Faktor-Pflicht (TOTP) für UHD und Admins über Browser-Flow `browser-mfa` (`scripts/keycloak-setup.sh`), erstes Portal-Admin-Konto per Skript; CI testet den Login-Ablauf
- Härtung unter WSL2: `harden.sh`/`verify.sh` erkennen WSL, setzen alles Machbare um und weisen SELinux/auditd als N/A aus; WSL-Demo läuft nach der Härtung rootless unter `srp`
- cgroup-Delegation für Rootless-Container (Ressourcenlimits), auch im Ansible-Playbook
- `package-lock.json` für Backend und Frontend (Workflow „Lockfiles“), Builds mit `npm ci`
- Demo-Daten (ca. 12 Monate) für Tickets und Statistiken: `scripts/load-demo-data.sh`
- Statistik-Seite mit Grafiken, rollenabhängig: Mitarbeitende (allgemeine Kennzahlen, eigene Anfragen), UHD (+ Support-Betrieb), Admin (+ Katalog, Benutzer, Sicherheit); Tooltips, Tabellenansicht, validierte Farbpaletten für Dark/Light
- Keycloak-Login-Theme `itportal` im Material 3 Expressive Design (Login, Registrierung, Passwort-Reset, OTP; Dark/Light nach Systemeinstellung)
- Roboto lokal eingebunden (Portal und Login), keine externen Schriftquellen
- Selbstregistrierung über Keycloak ohne Mailserver (keine E-Mail-Bestätigung, kein Passwort-Reset per Mail; Standardgruppe `/Mitarbeitende`, Domain-Prüfung `ALLOWED_EMAIL_DOMAINS` im Backend)
- Admin-Bereich *Benutzer & Rollen*: Rollen Mitarbeitende/UHD/Admin vergeben, Konten sperren/entsperren (Service-Account `portal-admin-api`), Schutzregeln, Audit
- CI-Integrationstest gegen echten Keycloak
- Katalog v2 (Migration `003_catalog_v2.sql`):
  - Hardware: APC, Monitor, Mobiltelefon, Tablet, Maus, Tastatur, Webcam – einzeln oder als Hardware-Bundle mit Stückzahlen
  - Software als Freitext
  - Telefonie: Softphone oder Hardphone (Tisch-, Video-, DECT-, Konferenztelefon)
  - Berechtigungen & VPN: Netzlaufwerk-Zugriff, Mail-Postfach-Zugriff, eigener VPN-Eintrag
  - Neue Kategorien: Benutzerkonten (neues Konto wie Referenzperson), Server & VMs (Spezifikation), Zertifikate (SSL/TLS, S/MIME)
- Formular-Engine: bedingte Felder (`when`), Mindestens-eine-Position (`requireOneOf`), Pflicht-Bestätigung bei Checkboxen
- Neue Standardlösungen für Telefonie, VPN, Benutzerkonten, VMs und Zertifikate
- Screenshots überwiegend im Darkmode; Katalog im Screenshot-Workflow wird aus den Migrationen gelesen
- UI-Screenshots in der README, automatisch erzeugt über den Workflow „Screenshots“ (Playwright, simulierte Daten)

### Behoben
- Sicherheitsupdates: zod 4 (GHSA-mrhx-c7xc-m3w5), vitest 4, react-router 7
- Proxy bindet TLS-Zertifikat und Schlüssel als Einzeldateien ein (Rootless: Verzeichnis 0700 blieb für nginx unlesbar)
- Realm-Import: eigene Client-Scopes verhinderten die Keycloak-Standard-Scopes (`profile`, `email`, `roles`) – Tokens hätten keine Rollen enthalten; Audience-Mapper jetzt direkt am Client
- Filter in „Meine Tickets“ ging nach dem Keycloak-Login verloren (URL-Parameter `state` kollidierte mit OIDC; jetzt `filter`)
- Layout: Kategoriekacheln, Navigationsbeschriftung, Filterchips, Toolbar-Felder, mobile Detailansicht
- Backend-Typfehler, Compose-PID-Limit, Trivy-Einbindung in der CI

## [1.0.0] – 2026-11-27

### Hinzugefügt
- Self-Service-Portal mit Katalog (Hardware, Software, Berechtigungen, Allgemein) und geführten, admin-definierbaren Formularen
- Rollen `user`, `first-level`, `admin` über Keycloak (OIDC, PKCE S256, MFA für privilegierte Rollen)
- Support-Arbeitsbereich: Queue, Kennzahlen, Zuweisung, Priorisierung, Workflow, interne Notizen, Standardlösungen
- Admin-Bereich: Katalog/Formulare, Kategorien, Status & Workflow-Matrix, SLA, Standardlösungen, Rollenübersicht, Audit-Log mit Integritätsprüfung, Systemsicht
- Material 3 Expressive UI mit Dark/Light/System-Modus und dynamischen Farbpaletten
- Append-only Audit-Log mit SHA-256-Hash-Kette, automatische Anonymisierung/Löschfristen
- Docker-Compose-Stack (rootless, non-root, read-only, interne Netze), gehärteter nginx-Proxy
- Fedora-Server-Härtung (Ansible + Bash) nach BSI IT-Grundschutz / NIST SP 800-53 inkl. Prüfskript
- Dokumentation als PDF: Benutzerhandbuch, Support-&-Admin-Handbuch, Informationssicherheits-, Datenschutz- und Betriebskonzept
- CI-Workflow (Typecheck, Tests, Migrationen gegen PostgreSQL, Image-Builds, Trivy) und Dependabot
