---
title: "Datenschutzkonzept"
subtitle: "IT-Service-Request-Portal – Verarbeitung personenbezogener Daten nach DSGVO/BDSG"
version: "1.0"
date: "November 2026"
classification: "Intern"
audience: "Datenschutzbeauftragte/r, Service Owner, IT-Leitung, Betriebsrat"
---

# Einleitung

## Zweck des Dokuments

Dieses Datenschutzkonzept beschreibt, welche personenbezogenen Daten das IT-Service-Request-Portal (*Portal*) zu welchen Zwecken und auf welcher Rechtsgrundlage verarbeitet, wie lange sie gespeichert werden und mit welchen technischen und organisatorischen Maßnahmen (TOM) sie geschützt sind. Es dient als Grundlage für den Eintrag im **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30 DSGVO), die Information der Beschäftigten (Art. 13 DSGVO) und die Abstimmung mit dem Betriebsrat.

::: info
Dieses Konzept ist eine fachlich-technische Vorlage. Die abschließende rechtliche Bewertung (insbesondere der Rechtsgrundlagen und Fristen) erfolgt durch die/den Datenschutzbeauftragte/n und – soweit erforderlich – die Rechtsabteilung des Unternehmens.
:::

## Verantwortlichkeit

| Rolle | Angabe |
|---|---|
| Verantwortlicher (Art. 4 Nr. 7 DSGVO) | *[Unternehmen, Anschrift, Vertretung]* |
| Datenschutzbeauftragte/r | *[Name, Kontakt]* |
| Fachlich verantwortlich (Service Owner) | *[IT-Service-Management]* |
| Technisch verantwortlich | *[IT-Betrieb]* |

## Grundsätze (Art. 5 DSGVO)

| Grundsatz | Umsetzung im Portal |
|---|---|
| Rechtmäßigkeit, Transparenz | Rechtsgrundlagen (Kap. 3), Datenschutzhinweis (Anhang), Betriebsvereinbarung |
| Zweckbindung | Daten ausschließlich zur Bearbeitung von IT-Anfragen und zur IT-Sicherheit; **keine Leistungs- oder Verhaltenskontrolle** |
| Datenminimierung | Nur Token-Basisdaten, Formulare mit notwendigen Feldern, keine Datei-Uploads, kein Tracking |
| Richtigkeit | Name/E-Mail werden bei jeder Anmeldung aus dem zentralen IdP aktualisiert |
| Speicherbegrenzung | Automatische Anonymisierung und Löschung (Kap. 6) |
| Integrität & Vertraulichkeit | TOM (Kap. 9), Informationssicherheitskonzept |
| Rechenschaftspflicht | Dieses Konzept, Audit-Log, Verzeichnis der Verarbeitungstätigkeiten |

# Beschreibung der Verarbeitung

## Zwecke

| Nr. | Zweck |
|---|---|
| Z1 | Entgegennahme, Bearbeitung und Dokumentation von IT-Anfragen (Hardware, Software, Telefonie, Berechtigungen/VPN, Benutzerkonten, virtuelle Maschinen, Zertifikate, Störungen) |
| Z2 | Kommunikation zwischen anfragender Person und IT-Support zum jeweiligen Ticket |
| Z3 | Nachvollziehbarkeit von Freigaben und Berechtigungsvergaben (Revisionssicherheit, IT-Compliance) |
| Z4 | Gewährleistung der Informationssicherheit (Authentisierung, Zugriffskontrolle, Protokollierung, Missbrauchserkennung) |
| Z5 | Steuerung des IT-Service (SLA-Fristen, aggregierte Kennzahlen **ohne** Personenbezug zu Bearbeitenden) |

## Betroffene Personen

* Beschäftigte, die Anfragen stellen (inkl. Auszubildende, Leiharbeitnehmende mit Unternehmenskonto),
* Beschäftigte des IT-Supports und der Portal-Administration,
* in Formularen benannte Dritte: Vorgesetzte bzw. Freigabepersonen (E-Mail), Personen, für die Berechtigungen oder Geräte beantragt werden (Benutzerkennung), Referenzpersonen bei neuen Benutzerkonten,
* künftige Beschäftigte, für die vor dem Eintritt ein Benutzerkonto beantragt wird (Name, Eintrittsdatum, Abteilung).

## Datenkategorien

| Kategorie | Datenfelder | Quelle | Zweck |
|---|---|---|---|
| Identitätsdaten | Keycloak-Subjekt-ID (`sub`), Benutzername, Anzeigename, E-Mail, Portal-Rollen, erster/letzter Zugriff | ID-Token/Access-Token (Keycloak) | Z1, Z2, Z4 |
| Ticketdaten | Ticketnummer, Kategorie, Katalogeintrag, Titel, Beschreibung, Status, Priorität, Zuweisung, Zeitstempel, SLA-Fristen | Eingabe der Person / Support | Z1, Z5 |
| Formulardaten | z. B. Gerätetyp und Stückzahl, Kostenstelle, Standort/Raum, Hostname, Inventarnummer, Rufnummer/Durchwahl, Postfachadresse, VM-Spezifikation, Zertifikatsdaten (FQDN, E-Mail-Adresse), Begründung, gewünschter Termin | Eingabe der Person | Z1, Z3 |
| Daten neuer Beschäftigter | Vor- und Nachname, Eintrittsdatum, ggf. Befristung, Abteilung, Funktion, Kostenstelle, Benutzerkennung der Referenzperson | Eingabe der Führungskraft/Assistenz | Z1, Z3 |
| Daten Dritter | E-Mail der Freigabeperson bzw. technisch verantwortlichen Person, Benutzerkennung der berechtigten Person bzw. Referenzperson | Eingabe der Person | Z1, Z3 |
| Kommunikationsdaten | Kommentare, interne Notizen, Verlaufsereignisse | Person / Support | Z2, Z3 |
| Audit-Daten | Akteur (ID, Name, Rollen), Aktion, Objekt, Ergebnis, Zeitpunkt, Request-ID, IP-Adresse | System | Z3, Z4 |
| Technische Protokolle | IP-Adresse, Zeit, Pfad (ohne Parameter), Statuscode, User-Agent | Reverse Proxy, Backend | Z4 |
| Registrierungsdaten | Vorname, Nachname, geschäftliche E-Mail-Adresse, Benutzername, Zeitpunkt der Registrierung | betroffene Person (Selbstregistrierung in Keycloak) | Z1, Z4 |
| Authentisierungsdaten | Login-Ereignisse, Fehlversuche, IP-Adresse, Sitzungen; Passwort-Hash und TOTP-Geheimnis ausschließlich in Keycloak | Keycloak | Z4 |
| Präferenzen | Farbmodus/Farbpalette (nur im Browser, `localStorage`) | Endgerät | Bedienkomfort |

**Besondere Kategorien (Art. 9 DSGVO)** werden nicht planmäßig verarbeitet. Freitextfelder enthalten den Hinweis, keine sensiblen Daten und keine Zugangsdaten einzutragen. Werden dennoch z. B. Gesundheitsangaben (etwa zur Begründung ergonomischer Hardware) eingetragen, bewertet der Support, ob die Angabe erforderlich ist, und veranlasst ggf. die Entfernung durch die Administration.

## Empfänger und Zugriff

| Empfänger | Umfang |
|---|---|
| Anfragende Person | eigene Tickets inkl. öffentlicher Kommentare (keine internen Notizen) |
| First-Level-Support (`first-level`) | alle Tickets, interne Notizen, E-Mail der anfragenden Person |
| Portal-Administration (`admin`) | zusätzlich Audit-Log (inkl. IP-Adressen bis zur Löschfrist), Rollenübersicht |
| IT-Betrieb (Server-Administration) | technischer Zugriff auf Datenbank/Backups im Rahmen von Wartung und Störungsbeseitigung, protokolliert (auditd, sudo-I/O-Log) |
| Freigabepersonen | erhalten die für die Freigabe nötigen Angaben außerhalb des Portals (z. B. E-Mail mit Ticketnummer) |

Eine Übermittlung an Dritte außerhalb des Unternehmens oder in Drittländer findet **nicht** statt. Das Portal lädt keine externen Ressourcen (Schriften, Skripte, CDNs, Analyse-Dienste).

## Cookies und Endgerätezugriff

Das Portal setzt **keine Tracking- oder Analyse-Cookies**. Keycloak verwendet technisch notwendige Sitzungscookies für die Anmeldung; das Portal speichert die Darstellungspräferenz im `localStorage` des Browsers. Beides ist für den vom Nutzer ausdrücklich gewünschten Dienst unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist nicht erforderlich. Zugriffstokens werden nur im Arbeitsspeicher gehalten.

# Rechtsgrundlagen

| Verarbeitung | Rechtsgrundlage | Erläuterung |
|---|---|---|
| Bearbeitung von IT-Anfragen (Z1, Z2) | Art. 6 Abs. 1 lit. b DSGVO i. V. m. Art. 88 DSGVO / § 26 BDSG, ggf. Betriebsvereinbarung | Bereitstellung der Arbeitsmittel ist zur Durchführung des Beschäftigungsverhältnisses erforderlich |
| Daten Dritter in Formularen (Freigabeperson, berechtigte Person) | Art. 6 Abs. 1 lit. f DSGVO | Berechtigtes Interesse an ordnungsgemäßen Freigabe- und Berechtigungsprozessen |
| Nachweis von Freigaben/Berechtigungen (Z3) | Art. 6 Abs. 1 lit. c DSGVO (soweit gesetzliche Nachweis-/Aufbewahrungspflichten bestehen), im Übrigen lit. f | IT-Compliance, Revision, Sicherheitsanforderungen (z. B. Art. 32 DSGVO) |
| Sicherheitsprotokollierung, Authentisierung (Z4) | Art. 6 Abs. 1 lit. c i. V. m. Art. 32 DSGVO; Art. 6 Abs. 1 lit. f DSGVO | Gewährleistung der Sicherheit der Verarbeitung, Erkennung von Missbrauch |
| Aggregierte Service-Kennzahlen (Z5) | Art. 6 Abs. 1 lit. f DSGVO | Steuerung des IT-Service; nur aggregiert |
| Speicherung der Darstellungspräferenz | § 25 Abs. 2 Nr. 2 TDDDG; Art. 6 Abs. 1 lit. f DSGVO | Unbedingt erforderlich für die gewünschte Darstellung |

::: warning
**Hinweis zu § 26 BDSG:** Nach der Rechtsprechung des EuGH (Urteil vom 30.03.2023, C-34/21) ist die Eignung nationaler Beschäftigtendatenschutz-Regelungen als „spezifischere Vorschrift“ i. S. d. Art. 88 DSGVO eingeschränkt. Die Verarbeitung wird daher vorrangig auf **Art. 6 Abs. 1 lit. b, c und f DSGVO** gestützt; die/der DSB prüft die aktuelle Rechtslage.
:::

## Mitbestimmung

Das Portal ist objektiv geeignet, Verhalten oder Leistung von Beschäftigten zu überwachen (Audit-Log, Bearbeitungszeiten). Vor Einführung ist daher der **Betriebsrat** nach § 87 Abs. 1 Nr. 6 BetrVG zu beteiligen. Empfohlene Regelungsinhalte einer Betriebsvereinbarung:

* Ausschluss der Leistungs- und Verhaltenskontrolle; Auswertungen nur aggregiert auf Team-/Kategorieebene,
* Zugriff auf das Audit-Log nur durch die Rolle `admin` und nur anlassbezogen (Sicherheitsvorfall, Revision, Betroffenenanfrage),
* Vier-Augen-Prinzip und Information des Betriebsrats bei personenbezogenen Auswertungen im Verdachtsfall,
* Speicherfristen gemäß Kap. 6.

# Datenschutz durch Technikgestaltung (Art. 25 DSGVO)

| Maßnahme | Wirkung |
|---|---|
| Pseudonyme Schlüssel | Datensätze referenzieren die Keycloak-ID (`sub`) statt Name/E-Mail |
| Minimale Token-Claims | Nur `sub`, Benutzername, Name, E-Mail, Rollen; keine weiteren Attribute (Abteilung, Kostenstelle) werden aus dem IdP übernommen |
| Rollenabhängige Sichten | Nutzende sehen nur eigene Tickets; interne Notizen und E-Mail-Adressen nur für Support |
| Keine Datei-Uploads | Verhindert unkontrollierte Ablage von Dokumenten (Screenshots mit Fremddaten) |
| Eingabehinweise | „Bitte keine Passwörter oder sonstigen Zugangsdaten angeben“ in Formularen |
| Kein Tracking | Keine externen Dienste, keine Analyse-Cookies, keine Fremdschriften |
| Log-Minimierung | Proxy protokolliert Pfade ohne Query-Parameter; Tokens/Cookies werden nie geloggt; IP-Adressen im Audit-Log werden nach 90 Tagen entfernt |
| Minimale Angaben für neue Konten | Für Kontoanträge werden nur Name, Eintritt, Organisation und Referenzperson erfasst – keine Privatanschrift, Geburtsdaten o. Ä. |
| Statistiken nur aggregiert | Kennzahlen ausschließlich als Summen/Durchschnitte; keine Auswertung je bearbeitender Person; allgemeine Kennzahlen unterdrücken Gruppen mit weniger als 3 Tickets; Umfang je Rolle serverseitig begrenzt |
| Anonymisierung statt Löschung | Abgeschlossene Tickets verlieren nach Fristablauf alle Inhalte und Personenbezüge; aggregierte Statistik bleibt möglich |
| Befristete Berechtigungen | Formular erzwingt Ablaufdatum für Zugriffsrechte |

# Speicher- und Löschfristen

| Datenkategorie | Frist | Umsetzung |
|---|---|---|
| Ticketinhalte (Titel, Beschreibung, Formulardaten) abgeschlossener Tickets | **3 Jahre** nach Abschluss (`RETENTION_TICKET_DAYS=1095`) | Automatische **Anonymisierung** durch täglichen Löschlauf (`apply_retention`) |
| Kommentare und interne Notizen | mit Anonymisierung des Tickets | Löschung im selben Lauf |
| Benutzerprofile (Name, E-Mail, Benutzername) | 3 Jahre nach letzter Anmeldung, sofern keine offenen Tickets | Pseudonymisierung („Ehemalige Person“) im selben Lauf |
| Audit-Log-Einträge | **365 Tage** (`RETENTION_AUDIT_DAYS`) | Löschung im täglichen Lauf (einzige zulässige Löschung) |
| IP-Adressen im Audit-Log | **90 Tage** (`RETENTION_IP_DAYS`) | Feld wird geleert |
| Keycloak-Anmeldeereignisse | 90 Tage | Realm-Einstellung `eventsExpiration` |
| Gesperrte, unplausible Registrierungen | 30 Tage nach Sperrung | Löschung in Keycloak im Rahmen der monatlichen Admin-Checkliste |
| System-/Containerprotokolle (journald) | 180 Tage | `MaxRetentionSec=180day` |
| Datensicherungen | 30 Tage rollierend (`BACKUP_RETENTION_DAYS`) | Rotation im Backup-Skript; Löschungen wirken spätestens nach 30 Tagen auch in Backups |
| Darstellungspräferenz | bis zur Löschung durch den Nutzer | Browserdaten löschen |

**Begründung der 3-Jahres-Frist:** Nachweis von Hardware-Ausgaben und Berechtigungsfreigaben für Revision, Lizenz-Audits und Gewährleistung; Orientierung an der regelmäßigen Verjährungsfrist (§ 195 BGB). Kürzere Fristen sind über die Umgebungsvariablen konfigurierbar (Mindestwerte im Code: 30 bzw. 7 Tage). Steuer- oder handelsrechtlich relevante Belege (Rechnungen, Bestellungen) werden **nicht** im Portal, sondern in den dafür vorgesehenen Systemen aufbewahrt.

Die Ausführung des Löschlaufs wird im Audit-Log (`system.retention`) mit Anzahl der betroffenen Datensätze protokolliert.

# Betroffenenrechte

| Recht | Umsetzung |
|---|---|
| Information (Art. 13) | Datenschutzhinweis im Intranet und im Benutzerhandbuch (Muster im Anhang) |
| Auskunft (Art. 15) | Die Person sieht ihre Tickets jederzeit selbst. Vollständige Auskunft (inkl. Audit-Einträge) erstellt die Administration auf Anforderung der/des DSB über einen SQL-Export (siehe Betriebskonzept, Anhang) |
| Berichtigung (Art. 16) | Name/E-Mail im zentralen Verzeichnis bzw. Keycloak; Ticketinhalte über Kommentar oder Korrektur durch Administration |
| Löschung (Art. 17) | Automatische Fristen; vorzeitige Löschung/Anonymisierung einzelner Inhalte auf Antrag, sofern keine Aufbewahrungsgründe (Art. 17 Abs. 3 lit. b, e) entgegenstehen |
| Einschränkung (Art. 18) | Kennzeichnung durch Administration, Ausschluss aus Löschlauf nach Abstimmung mit DSB |
| Widerspruch (Art. 21) | Für auf Art. 6 Abs. 1 lit. f gestützte Verarbeitungen; Einzelfallprüfung durch DSB |
| Datenübertragbarkeit (Art. 20) | Export der eigenen Tickets als JSON über die Administration (SQL-Export, siehe Betriebskonzept) |

Anfragen werden über die/den DSB koordiniert und innerhalb **eines Monats** beantwortet (Art. 12 Abs. 3 DSGVO). Die Identität der anfragenden Person wird über das Unternehmenskonto geprüft.

# Auftragsverarbeitung und Dienstleister

* Das Portal wird **on-premises** auf unternehmenseigenen Servern betrieben; eine Auftragsverarbeitung findet im Regelbetrieb nicht statt.
* Werden externe Dienstleister für Betrieb, Wartung oder Fernsupport eingesetzt, ist vor Zugriffsgewährung ein **Vertrag nach Art. 28 DSGVO** abzuschließen; Zugriffe erfolgen ausschließlich über personalisierte Konten, MFA und protokolliert.
* Software-Komponenten (Keycloak, PostgreSQL, Node.js, nginx, React) sind Open-Source-Software, die lokal betrieben wird. Beim Bezug von Container-Images und Paketen werden **keine personenbezogenen Daten** übermittelt.

# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Die Maßnahmen sind im *Informationssicherheitskonzept* detailliert beschrieben. Zusammenfassung:

| Schutzziel | Maßnahmen |
|---|---|
| **Vertraulichkeit – Zutritt** | Server im gesicherten Rechenzentrum, Zutrittskontrolle, Besucherregelung |
| **Vertraulichkeit – Zugang** | Single Sign-On (Keycloak), Passwortrichtlinie, MFA für privilegierte Rollen, Brute-Force-Schutz, SSH nur mit Schlüssel aus dem Admin-Netz, gesperrter Root-Login |
| **Vertraulichkeit – Zugriff** | RBAC (user / first-level / admin), Objektberechtigungen, getrennte Datenbankrollen, Least Privilege für Container und Dienste |
| **Vertraulichkeit – Trennung** | Getrennte Datenbanken für Portal und Keycloak, segmentierte Container-Netze, eigener Keycloak-Realm |
| **Pseudonymisierung / Verschlüsselung** | Pseudonyme Benutzer-IDs, TLS 1.2/1.3, LUKS2-verschlüsselte Datenpartition, age-verschlüsselte Backups |
| **Integrität – Weitergabe** | TLS, HSTS, keine Übermittlung an Dritte |
| **Integrität – Eingabe** | Audit-Log (wer hat wann was geändert), Hash-Kette, unveränderliche Einträge, Verlauf je Ticket |
| **Verfügbarkeit & Belastbarkeit** | Healthchecks, automatische Neustarts, Ressourcenlimits, Rate Limiting, USV/Redundanz des Rechenzentrums |
| **Wiederherstellbarkeit** | Tägliche Backups, dokumentiertes Restore-Verfahren, quartalsweiser Restore-Test |
| **Regelmäßige Überprüfung** | Monatlicher Härtungsnachweis (`verify.sh`), Audit-Integritätsprüfung, jährliche Überprüfung dieses Konzepts, Penetrationstest |

# Datenschutz-Folgenabschätzung (Schwellwertanalyse)

| Kriterium (WP 248 / DSK-Liste) | Bewertung |
|---|---|
| Bewertung/Scoring, Profiling | Nein |
| Automatisierte Entscheidungen mit Rechtswirkung | Nein – alle Entscheidungen treffen Menschen |
| Systematische Überwachung | Nein – Protokollierung dient der IT-Sicherheit, keine Verhaltensauswertung (Betriebsvereinbarung) |
| Besondere Kategorien / höchstpersönliche Daten | Nicht planmäßig |
| Umfangreiche Verarbeitung | Mittel (Beschäftigte eines Unternehmens) |
| Zusammenführung von Datensätzen | Nein |
| Schutzbedürftige Betroffene (Beschäftigte) | Ja |
| Innovative Technologie | Nein |

**Ergebnis:** Es ist lediglich ein Kriterium (Beschäftigte als schutzbedürftige Gruppe) erfüllt; ein voraussichtlich hohes Risiko i. S. v. Art. 35 DSGVO liegt nicht vor. Eine DSFA ist derzeit **nicht erforderlich**. Die Bewertung ist zu wiederholen, wenn personenbezogene Auswertungen von Bearbeitenden, Datei-Uploads, KI-gestützte Klassifizierung oder Schnittstellen zu HR-Systemen ergänzt werden.

# Verletzungen des Schutzes personenbezogener Daten

1. Feststellung (z. B. durch Support, Monitoring, Hinweis von Beschäftigten) → **unverzügliche Meldung** an DSB und ISB.
2. Bewertung von Art, Umfang und Risiko für die Betroffenen durch DSB (gemeinsam mit ISB).
3. Meldung an die zuständige Aufsichtsbehörde **binnen 72 Stunden** nach Bekanntwerden, sofern ein Risiko nicht unwahrscheinlich ist (Art. 33 DSGVO).
4. Benachrichtigung der Betroffenen bei voraussichtlich hohem Risiko (Art. 34 DSGVO).
5. Dokumentation jeder Verletzung (auch nicht meldepflichtiger) im Vorfallregister (Art. 33 Abs. 5).

Technische Unterstützung: Das Audit-Log ermöglicht die Feststellung, wer wann auf welche Tickets zugegriffen bzw. sie verändert hat; Keycloak-Ereignisse zeigen Anmeldungen und Fehlversuche.

# Anhang: Muster-Datenschutzhinweis für Beschäftigte

> **Datenschutzhinweis zum IT-Service-Portal**
>
> Im IT-Service-Portal verarbeiten wir Ihren Namen, Ihre Benutzerkennung, Ihre E-Mail-Adresse und Ihre Portal-Rolle (aus der zentralen Anmeldung) sowie die von Ihnen eingegebenen Angaben zu Ihren IT-Anfragen und die Kommunikation mit dem IT-Support. Zweck ist die Bearbeitung Ihrer Anfragen und die Bereitstellung Ihrer Arbeitsmittel (Art. 6 Abs. 1 lit. b DSGVO) sowie die Sicherheit unserer IT-Systeme (Art. 6 Abs. 1 lit. c i. V. m. Art. 32, lit. f DSGVO). Zur Sicherheit protokollieren wir Anmeldungen und Änderungen einschließlich IP-Adresse; IP-Adressen werden nach 90 Tagen, Protokolleinträge nach einem Jahr gelöscht. Abgeschlossene Tickets werden nach drei Jahren anonymisiert.
>
> Zugriff haben Sie selbst (eigene Tickets), der IT-Support und die Portal-Administration. Eine Weitergabe an Dritte erfolgt nicht. Eine Leistungs- oder Verhaltenskontrolle findet nicht statt.
>
> Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Widerspruch sowie Beschwerde bei einer Aufsichtsbehörde. Kontakt: *[Datenschutzbeauftragte/r]*.

# Änderungshistorie

| Version | Datum | Änderung | Freigabe |
|---|---|---|---|
| 1.0 | November 2026 | Erstfassung | DSB (ausstehend) |
