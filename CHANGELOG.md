# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt
- UI-Screenshots in der README, automatisch erzeugt über den Workflow „Screenshots“ (Playwright, simulierte Daten)

### Behoben
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
