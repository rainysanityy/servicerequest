-- =============================================================================
-- 003_catalog_v2.sql – Katalog v2
--  * Hardware: APC (Arbeitsplatz-PC), Monitor, Mobiltelefon, Tablet, Maus, Tastatur, Webcam
--    einzeln oder als Bundle (mind. eine Position, "requireOneOf")
--  * Software als Freitext
--  * Berechtigungen: Netzlaufwerke, Mail-Postfächer, eigener Eintrag VPN
--  * Neue Kategorien: Telefonie, Benutzerkonten, Server & VMs, Zertifikate
-- Alte Einträge werden gelöscht, sofern keine Tickets darauf verweisen,
-- andernfalls deaktiviert (Historie bleibt erhalten).
-- =============================================================================
SET search_path = portal;

-- ---------------------------------------------------------------- Kategorien
UPDATE categories SET description = 'PC, Monitor, Mobiltelefon, Tablet, Maus, Tastatur, Webcam – einzeln oder als Bundle', sort_order = 10, updated_at = now() WHERE id = 'hardware';
UPDATE categories SET description = 'Beliebige Software per Freitext anfragen', sort_order = 20, updated_at = now() WHERE id = 'software';
UPDATE categories SET name = 'Berechtigungen & VPN', description = 'Netzlaufwerke, Mail-Postfächer, VPN-Zugang', sort_order = 30, updated_at = now() WHERE id = 'access';
UPDATE categories SET sort_order = 90, updated_at = now() WHERE id = 'general';

INSERT INTO categories (id, name, description, icon, sort_order) VALUES
  ('telephony',    'Telefonie',       'Softphone oder Hardphone (Tischtelefon) bestellen',            'call',       25),
  ('accounts',     'Benutzerkonten',  'Neues Benutzerkonto mit Berechtigungen einer Referenzperson', 'person_add', 40),
  ('vm',           'Server & VMs',    'Virtuelle Maschinen mit individuellen Ressourcen',            'dns',        50),
  ('certificates', 'Zertifikate',     'SSL/TLS-Serverzertifikate und E-Mail-Zertifikate (S/MIME)',    'verified',   60)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- Alte Einträge
DELETE FROM catalog_items ci
 WHERE ci.name IN ('Notebook anfordern', 'Monitor / Dockingstation', 'Zubehör', 'Software installieren', 'Gruppenmitgliedschaft / Share-Zugriff')
   AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.catalog_item_id = ci.id);
UPDATE catalog_items SET active = FALSE, popular = FALSE, updated_at = now()
 WHERE name IN ('Notebook anfordern', 'Monitor / Dockingstation', 'Zubehör', 'Software installieren', 'Gruppenmitgliedschaft / Share-Zugriff');

-- ---------------------------------------------------------------- Hardware
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('hardware', 'Hardware-Bundle (mehrere Geräte)', 'Mehrere Geräte in einer Anfrage, z. B. kompletter Arbeitsplatz', 'medium', TRUE, TRUE, 5,
 '{"requireOneOf":["pcCount","monitorCount","phoneCount","tabletCount","mouseCount","keyboardCount","webcamCount"],
   "fields":[
   {"name":"pcCount","label":"APC (Anzahl)","type":"number","min":0,"max":5},
   {"name":"monitorCount","label":"Monitor (Anzahl)","type":"number","min":0,"max":4},
   {"name":"phoneCount","label":"Mobiltelefon (Anzahl)","type":"number","min":0,"max":2},
   {"name":"tabletCount","label":"Tablet (Anzahl)","type":"number","min":0,"max":2},
   {"name":"mouseCount","label":"Maus (Anzahl)","type":"number","min":0,"max":5},
   {"name":"keyboardCount","label":"Tastatur (Anzahl)","type":"number","min":0,"max":5},
   {"name":"webcamCount","label":"Webcam (Anzahl)","type":"number","min":0,"max":5},
   {"name":"forUser","label":"Für Person (Benutzerkennung, leer = für mich)","type":"text","maxLength":64,"pattern":"^[A-Za-z0-9._-]*$"},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"neededBy","label":"Benötigt bis","type":"date"},
   {"name":"details","label":"Besondere Wünsche zu den Geräten","type":"textarea","maxLength":2000,"help":"z. B. Modellwünsche, Tastaturlayout, Monitorgröße"},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'APC', 'Arbeitsplatz-PC (Desktop, Notebook oder Workstation) nach Unternehmensstandard', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"model","label":"Gerät","type":"select","required":true,"options":[
      {"value":"desktop-office","label":"Desktop-PC (Office)"},
      {"value":"notebook-office","label":"Notebook 14\" (Office)"},
      {"value":"notebook-mobile","label":"Ultralight-Notebook 13\" (Mobil)"},
      {"value":"workstation","label":"Workstation (Entwicklung/CAD)"}]},
   {"name":"reason","label":"Anlass","type":"select","required":true,"options":[
      {"value":"new-hire","label":"Neue/r Mitarbeitende/r"},
      {"value":"replacement","label":"Ersatz (defekt/veraltet)"},
      {"value":"additional","label":"Zusätzliches Gerät"}]},
   {"name":"oldAssetTag","label":"Inventarnummer Altgerät","type":"text","required":true,"maxLength":30,"pattern":"^[A-Za-z0-9-]*$","when":{"field":"reason","equals":"replacement"}},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"neededBy","label":"Benötigt bis","type":"date"},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Monitor', 'Zusätzlicher Monitor oder Ersatz', 'low', TRUE, FALSE, 20,
 '{"fields":[
   {"name":"size","label":"Größe","type":"select","required":true,"options":[
      {"value":"24-fhd","label":"24\" Full HD"},
      {"value":"27-qhd","label":"27\" QHD"},
      {"value":"34-uw","label":"34\" UltraWide (USB-C)"}]},
   {"name":"quantity","label":"Anzahl","type":"number","required":true,"min":1,"max":4},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Mobiltelefon', 'Dienstliches Smartphone inkl. SIM/eSIM', 'medium', TRUE, FALSE, 30,
 '{"fields":[
   {"name":"model","label":"Modell","type":"select","required":true,"options":[
      {"value":"standard","label":"Standard-Smartphone"},
      {"value":"business","label":"Business-Smartphone (größerer Speicher)"}]},
   {"name":"sim","label":"SIM","type":"select","required":true,"options":[
      {"value":"new-esim","label":"Neue eSIM"},
      {"value":"new-sim","label":"Neue physische SIM"},
      {"value":"port","label":"Bestehende Rufnummer übernehmen"},
      {"value":"none","label":"Ohne SIM"}]},
   {"name":"existingNumber","label":"Bestehende Rufnummer","type":"text","required":true,"maxLength":30,"pattern":"^[0-9 +()/-]*$","when":{"field":"sim","equals":"port"}},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Tablet', 'Tablet für mobiles Arbeiten', 'low', TRUE, FALSE, 40,
 '{"fields":[
   {"name":"model","label":"Modell","type":"select","required":true,"options":[
      {"value":"standard-11","label":"Standard 11\""},
      {"value":"pro-13","label":"Pro 13\" mit Stift"}]},
   {"name":"connectivity","label":"Konnektivität","type":"select","required":true,"options":[
      {"value":"wifi","label":"WLAN"},
      {"value":"cellular","label":"WLAN + Mobilfunk (5G)"}]},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Maus', 'Maus für den Arbeitsplatz', 'low', FALSE, FALSE, 50,
 '{"fields":[
   {"name":"type","label":"Ausführung","type":"select","required":true,"options":[
      {"value":"wired","label":"Kabelgebunden"},
      {"value":"wireless","label":"Kabellos"},
      {"value":"ergonomic","label":"Ergonomisch (vertikal)"}]},
   {"name":"quantity","label":"Anzahl","type":"number","required":true,"min":1,"max":2},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60}
 ]}'::jsonb),
('hardware', 'Tastatur', 'Tastatur für den Arbeitsplatz', 'low', FALSE, FALSE, 60,
 '{"fields":[
   {"name":"layout","label":"Layout","type":"select","required":true,"options":[
      {"value":"de","label":"Deutsch (QWERTZ)"},
      {"value":"de-ergo","label":"Deutsch, ergonomisch"},
      {"value":"en","label":"Englisch (QWERTY)"}]},
   {"name":"type","label":"Ausführung","type":"select","required":true,"options":[
      {"value":"wired","label":"Kabelgebunden"},
      {"value":"wireless","label":"Kabellos"}]},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60}
 ]}'::jsonb),
('hardware', 'Webcam', 'Webcam für Videokonferenzen', 'low', FALSE, FALSE, 70,
 '{"fields":[
   {"name":"type","label":"Ausführung","type":"select","required":true,"options":[
      {"value":"fhd","label":"Full HD"},
      {"value":"4k","label":"4K mit Autofokus"}]},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Software
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('software', 'Software anfordern', 'Beliebige Software per Freitext – Prüfung von Lizenz und Sicherheit durch die IT', 'medium', FALSE, TRUE, 10,
 '{"fields":[
   {"name":"software","label":"Gewünschte Software","type":"textarea","required":true,"maxLength":1000,"help":"Name, Version, Hersteller, ggf. Link zur Produktseite"},
   {"name":"targetDevice","label":"Zielgerät (Hostname / Inventarnr.)","type":"text","required":true,"maxLength":40,"pattern":"^[A-Za-z0-9.-]+$"},
   {"name":"justification","label":"Geschäftlicher Zweck","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Telefonie
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('telephony', 'Telefon bestellen (Softphone / Hardphone)', 'Softphone-Lizenz für den Rechner oder Hardphone als Tisch-/Konferenz-/DECT-Telefon', 'low', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"phoneType","label":"Art","type":"select","required":true,"options":[
      {"value":"softphone","label":"Softphone (Telefonie-Client auf dem Rechner)"},
      {"value":"hardphone","label":"Hardphone (physisches Telefon)"}]},
   {"name":"hardphoneModel","label":"Hardphone-Modell","type":"select","options":[
      {"value":"desk","label":"Standard-Tischtelefon"},
      {"value":"desk-video","label":"Tischtelefon mit Display/Video"},
      {"value":"dect","label":"Schnurlos (DECT)"},
      {"value":"conference","label":"Konferenztelefon"}],"required":true,"when":{"field":"phoneType","equals":"hardphone"}},
   {"name":"number","label":"Rufnummer","type":"select","required":true,"options":[
      {"value":"new","label":"Neue Durchwahl"},
      {"value":"existing","label":"Bestehende Durchwahl verwenden"}]},
   {"name":"existingNumber","label":"Bestehende Durchwahl","type":"text","required":true,"maxLength":30,"pattern":"^[0-9 +()/-]*$","when":{"field":"number","equals":"existing"}},
   {"name":"headset","label":"Headset mitbestellen","type":"checkbox"},
   {"name":"forUser","label":"Für Person (Benutzerkennung, leer = für mich)","type":"text","maxLength":64,"pattern":"^[A-Za-z0-9._-]*$"},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","maxLength":2000}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Berechtigungen & VPN
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('access', 'Netzlaufwerk-Zugriff', 'Zugriff auf Netzlaufwerke und Freigaben (Shares)', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"path","label":"Pfad des Netzlaufwerks","type":"text","required":true,"maxLength":260,"help":"z. B. \\\\fileserver\\vertrieb\\angebote"},
   {"name":"permission","label":"Berechtigungsstufe","type":"select","required":true,"options":[
      {"value":"read","label":"Lesen"},
      {"value":"modify","label":"Lesen & Schreiben"},
      {"value":"owner","label":"Besitzer / Verwalter"}]},
   {"name":"forUser","label":"Für Person (Benutzerkennung)","type":"text","required":true,"maxLength":64,"pattern":"^[A-Za-z0-9._-]+$"},
   {"name":"validUntil","label":"Befristet bis","type":"date","required":true,"help":"Berechtigungen werden grundsätzlich befristet vergeben (Least Privilege)"},
   {"name":"approverEmail","label":"Freigabe durch (Ressourcenverantwortliche/r)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('access', 'Mail-Postfach-Zugriff', 'Zugriff auf Funktions-, Gruppen- oder Ressourcenpostfächer', 'medium', TRUE, FALSE, 20,
 '{"fields":[
   {"name":"mailbox","label":"Postfachadresse","type":"email","required":true,"maxLength":254},
   {"name":"mailboxType","label":"Art des Postfachs","type":"select","required":true,"options":[
      {"value":"shared","label":"Funktions- / Gruppenpostfach"},
      {"value":"resource","label":"Raum- / Ressourcenpostfach"},
      {"value":"delegate","label":"Persönliches Postfach (Vertretung)"}]},
   {"name":"permission","label":"Berechtigung","type":"select","required":true,"options":[
      {"value":"read","label":"Lesen"},
      {"value":"full","label":"Vollzugriff"},
      {"value":"send-as","label":"Senden als"},
      {"value":"send-on-behalf","label":"Senden im Auftrag"}]},
   {"name":"forUser","label":"Für Person (Benutzerkennung)","type":"text","required":true,"maxLength":64,"pattern":"^[A-Za-z0-9._-]+$"},
   {"name":"validUntil","label":"Befristet bis","type":"date","required":true},
   {"name":"approverEmail","label":"Freigabe durch (Postfachverantwortliche/r)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('access', 'VPN-Zugang', 'Fernzugriff auf das Unternehmensnetz', 'medium', TRUE, TRUE, 30,
 '{"fields":[
   {"name":"accessType","label":"Art des Zugangs","type":"select","required":true,"options":[
      {"value":"employee","label":"Standard-VPN für Mitarbeitende"},
      {"value":"external","label":"Zugang für externe Dienstleister"},
      {"value":"admin","label":"Administrativer Zugang (Admin-Netz)"}]},
   {"name":"forUser","label":"Für Person (Benutzerkennung)","type":"text","required":true,"maxLength":64,"pattern":"^[A-Za-z0-9._-]+$"},
   {"name":"device","label":"Gerät (Hostname / Inventarnr.)","type":"text","required":true,"maxLength":40,"pattern":"^[A-Za-z0-9.-]+$","help":"VPN nur von verwalteten Geräten"},
   {"name":"validUntil","label":"Befristet bis","type":"date","required":true},
   {"name":"approverEmail","label":"Freigabe durch (Vorgesetzte/r)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Benutzerkonten
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('accounts', 'Neues Benutzerkonto', 'Konto für neue Mitarbeitende mit denselben Berechtigungen wie eine Referenzperson', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"firstName","label":"Vorname","type":"text","required":true,"maxLength":60},
   {"name":"lastName","label":"Nachname","type":"text","required":true,"maxLength":60},
   {"name":"startDate","label":"Eintrittsdatum","type":"date","required":true},
   {"name":"endDate","label":"Befristet bis (optional)","type":"date","help":"z. B. bei Praktika oder befristeten Verträgen"},
   {"name":"department","label":"Abteilung","type":"text","required":true,"maxLength":80},
   {"name":"jobTitle","label":"Funktion / Stelle","type":"text","maxLength":80},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"referenceUser","label":"Berechtigungen übernehmen von (Benutzerkennung)","type":"text","required":true,"maxLength":64,"pattern":"^[A-Za-z0-9._-]+$","help":"Gruppen, Laufwerke und Postfächer dieser Person werden als Vorlage verwendet"},
   {"name":"sameTasks","label":"Die neue Person übernimmt dieselben Aufgaben wie die Referenzperson","type":"checkbox","required":true},
   {"name":"mailbox","label":"Persönliches E-Mail-Postfach anlegen","type":"checkbox"},
   {"name":"managerEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"notes","label":"Abweichungen von der Referenzperson","type":"textarea","maxLength":2000,"help":"Berechtigungen, die NICHT übernommen oder zusätzlich benötigt werden"}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Server & VMs
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('vm', 'Virtuelle Maschine', 'VM mit frei wählbaren Ressourcen (CPU, RAM, Speicher, Netz)', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"hostname","label":"Gewünschter Hostname","type":"text","maxLength":30,"pattern":"^[a-z0-9-]*$","help":"Kleinbuchstaben, Ziffern, Bindestrich – leer = automatisch"},
   {"name":"os","label":"Betriebssystem","type":"select","required":true,"options":[
      {"value":"rhel-9","label":"Red Hat Enterprise Linux 9"},
      {"value":"fedora-server","label":"Fedora Server (aktuell)"},
      {"value":"ubuntu-24-04","label":"Ubuntu Server 24.04 LTS"},
      {"value":"windows-2022","label":"Windows Server 2022"},
      {"value":"windows-2025","label":"Windows Server 2025"}]},
   {"name":"environment","label":"Umgebung","type":"select","required":true,"options":[
      {"value":"prod","label":"Produktion"},
      {"value":"test","label":"Test / Staging"},
      {"value":"dev","label":"Entwicklung"}]},
   {"name":"vcpu","label":"vCPU","type":"number","required":true,"min":1,"max":32},
   {"name":"ramGb","label":"Arbeitsspeicher (GB)","type":"number","required":true,"min":1,"max":256},
   {"name":"diskGb","label":"Systemplatte (GB)","type":"number","required":true,"min":20,"max":2048},
   {"name":"dataDiskGb","label":"Zusätzliche Datenplatte (GB)","type":"number","min":0,"max":16384},
   {"name":"network","label":"Netzsegment","type":"select","required":true,"options":[
      {"value":"server-lan","label":"Server-LAN (intern)"},
      {"value":"dmz","label":"DMZ (aus dem Internet erreichbar)"},
      {"value":"isolated","label":"Isoliertes Netz"}]},
   {"name":"backup","label":"In die tägliche Datensicherung aufnehmen","type":"checkbox"},
   {"name":"monitoring","label":"Überwachung (Monitoring) einrichten","type":"checkbox"},
   {"name":"ownerEmail","label":"Technisch verantwortlich (E-Mail)","type":"email","required":true,"maxLength":254},
   {"name":"validUntil","label":"Benötigt bis (Laufzeit)","type":"date"},
   {"name":"purpose","label":"Zweck / Anwendung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Zertifikate
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('certificates', 'SSL/TLS-Serverzertifikat', 'Zertifikat für Webserver und Dienste (interne PKI oder öffentlich)', 'medium', TRUE, FALSE, 10,
 '{"fields":[
   {"name":"fqdn","label":"Hostname (FQDN / Common Name)","type":"text","required":true,"maxLength":253,"pattern":"^[a-z0-9.-]+$"},
   {"name":"sans","label":"Weitere DNS-Namen (SAN)","type":"textarea","maxLength":2000,"help":"Ein Name pro Zeile"},
   {"name":"certType","label":"Aussteller","type":"select","required":true,"options":[
      {"value":"internal","label":"Interne Unternehmens-PKI"},
      {"value":"public","label":"Öffentlich vertrauenswürdig"}]},
   {"name":"keyType","label":"Schlüsseltyp","type":"select","required":true,"options":[
      {"value":"ecdsa-p384","label":"ECDSA P-384 (empfohlen)"},
      {"value":"ecdsa-p256","label":"ECDSA P-256"},
      {"value":"rsa-3072","label":"RSA 3072"},
      {"value":"rsa-4096","label":"RSA 4096"}]},
   {"name":"csrReady","label":"CSR wird auf dem Zielsystem erzeugt und nachgereicht","type":"checkbox","help":"Der private Schlüssel verlässt das Zielsystem nie – niemals Schlüssel per Ticket senden"},
   {"name":"system","label":"Einsatzsystem / Anwendung","type":"text","required":true,"maxLength":120},
   {"name":"ownerEmail","label":"Technisch verantwortlich (E-Mail)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","maxLength":2000}
 ]}'::jsonb),
('certificates', 'E-Mail-Zertifikat (S/MIME)', 'Zertifikat zum Signieren und Verschlüsseln von E-Mails', 'low', TRUE, FALSE, 20,
 '{"fields":[
   {"name":"email","label":"E-Mail-Adresse","type":"email","required":true,"maxLength":254},
   {"name":"mailboxKind","label":"Postfachart","type":"select","required":true,"options":[
      {"value":"personal","label":"Persönliches Postfach"},
      {"value":"function","label":"Funktionspostfach"}]},
   {"name":"usage","label":"Verwendung","type":"select","required":true,"options":[
      {"value":"sign","label":"Signieren"},
      {"value":"encrypt","label":"Verschlüsseln"},
      {"value":"both","label":"Signieren & Verschlüsseln"}]},
   {"name":"client","label":"E-Mail-Programm","type":"select","required":true,"options":[
      {"value":"outlook","label":"Outlook (Desktop)"},
      {"value":"outlook-mobile","label":"Outlook (Mobil)"},
      {"value":"thunderbird","label":"Thunderbird"}]},
   {"name":"justification","label":"Begründung","type":"textarea","maxLength":2000}
 ]}'::jsonb);

-- ---------------------------------------------------------------- Standardlösungen
INSERT INTO standard_solutions (category_id, title, body) VALUES
  ('telephony',    'Softphone freigeschaltet', 'Ihre Softphone-Lizenz ist freigeschaltet. Starten Sie den Telefonie-Client neu und melden Sie sich mit Ihrem Unternehmenskonto an; Ihre Durchwahl wird automatisch zugewiesen.'),
  ('access',       'VPN-Zugang eingerichtet', 'Ihr VPN-Zugang ist eingerichtet und befristet. Bitte installieren bzw. starten Sie den VPN-Client über das Softwarecenter und melden Sie sich mit Ihrem Unternehmenskonto und dem zweiten Faktor an.'),
  ('accounts',     'Benutzerkonto angelegt', 'Das Benutzerkonto wurde angelegt und mit den Berechtigungen der Referenzperson (abzüglich der genannten Abweichungen) ausgestattet. Die Zugangsdaten werden am Eintrittstag persönlich übergeben.'),
  ('vm',           'VM bereitgestellt', 'Die virtuelle Maschine wurde bereitgestellt und gemäß Basis-Härtung konfiguriert. Zugangsdaten und Hostname erhalten Sie über den vereinbarten sicheren Kanal.'),
  ('certificates', 'Zertifikat ausgestellt', 'Das Zertifikat wurde ausgestellt. Sie finden es zusammen mit der Zertifikatskette im Zertifikatsportal. Bitte tragen Sie das Ablaufdatum in Ihre Betriebsdokumentation ein.');
