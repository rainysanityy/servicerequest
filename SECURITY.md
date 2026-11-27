# Sicherheitsrichtlinie

## Schwachstellen melden

Bitte melde Sicherheitslücken **nicht** über öffentliche Issues, sondern vertraulich über
**GitHub → Security → Report a vulnerability** (Private Vulnerability Reporting) dieses Repositorys.

Bitte angeben:

* betroffene Komponente (Frontend, Backend, Proxy, Keycloak-Konfiguration, Härtungsskripte),
* Beschreibung, Reproduktionsschritte und erwartete Auswirkung,
* ggf. Vorschlag zur Behebung.

Wir bestätigen den Eingang in der Regel innerhalb von 5 Arbeitstagen.

## Unterstützte Versionen

| Version | Unterstützt |
|---|---|
| 1.0.x | ✓ |

## Hinweise für Betreiber

* Niemals echte Secrets (`.env`, `secrets/*`, `proxy/certs/*`) committen – sie sind in `.gitignore` ausgeschlossen.
* `keycloak/demo-users/` enthält **ausschließlich Demo-Konten** mit temporären Passwörtern für Testumgebungen. In Produktion nicht importieren.
* Sicherheitsarchitektur, Risikoanalyse und Incident-Prozess: [`docs/pdf/Infosicherheitskonzept.pdf`](docs/pdf/Infosicherheitskonzept.pdf).
