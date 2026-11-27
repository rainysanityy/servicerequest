-- =============================================================================
-- 002_seed.sql – Stammdaten: Status-Workflow, SLA, Kategorien, Katalog
-- =============================================================================
SET search_path = portal;

INSERT INTO ticket_statuses (code, label, description, color_role, is_final, sort_order) VALUES
  ('new',                  'Neu',                'Eingegangen, noch nicht gesichtet',              'primary',   FALSE, 10),
  ('in_progress',          'In Bearbeitung',     'Wird vom Support bearbeitet',                    'tertiary',  FALSE, 20),
  ('waiting_for_user',     'Rückfrage',          'Support wartet auf Antwort der anfragenden Person','warning',  FALSE, 30),
  ('waiting_for_approval', 'Wartet auf Freigabe','Freigabe durch Vorgesetzte/Kostenstelle ausstehend','secondary',FALSE, 40),
  ('resolved',             'Gelöst',             'Lösung bereitgestellt, Bestätigung ausstehend',  'success',   FALSE, 50),
  ('closed',               'Geschlossen',        'Abgeschlossen',                                  'neutral',   TRUE,  60),
  ('rejected',             'Abgelehnt',          'Anfrage wurde abgelehnt',                        'error',     TRUE,  70),
  ('withdrawn',            'Zurückgezogen',      'Von der anfragenden Person zurückgezogen',       'neutral',   TRUE,  80);

INSERT INTO status_transitions (from_status, to_status, allowed_role) VALUES
  -- Nutzer
  ('new',                  'withdrawn',            'user'),
  ('waiting_for_user',     'in_progress',          'user'),
  ('resolved',             'closed',               'user'),
  ('resolved',             'in_progress',          'user'),
  -- First-Level-Support
  ('new',                  'in_progress',          'first-level'),
  ('new',                  'waiting_for_approval', 'first-level'),
  ('new',                  'rejected',             'first-level'),
  ('in_progress',          'waiting_for_user',     'first-level'),
  ('in_progress',          'waiting_for_approval', 'first-level'),
  ('in_progress',          'resolved',             'first-level'),
  ('in_progress',          'rejected',             'first-level'),
  ('waiting_for_user',     'in_progress',          'first-level'),
  ('waiting_for_user',     'resolved',             'first-level'),
  ('waiting_for_approval', 'in_progress',          'first-level'),
  ('waiting_for_approval', 'rejected',             'first-level'),
  ('resolved',             'in_progress',          'first-level'),
  ('resolved',             'closed',               'first-level');

-- Admin darf alle Support-Übergänge plus Wiedereröffnen abgeschlossener Tickets
INSERT INTO status_transitions (from_status, to_status, allowed_role)
  SELECT from_status, to_status, 'admin' FROM status_transitions WHERE allowed_role = 'first-level';
INSERT INTO status_transitions (from_status, to_status, allowed_role) VALUES
  ('closed',   'in_progress', 'admin'),
  ('rejected', 'in_progress', 'admin');

INSERT INTO sla_policies (priority, name, response_minutes, resolution_minutes, business_hours_only) VALUES
  ('critical', 'Kritisch – Betriebsunterbrechung', 30,    240,   FALSE),
  ('high',     'Hoch – starke Einschränkung',      60,    480,   TRUE),
  ('medium',   'Mittel – Standardanfrage',         240,   2400,  TRUE),
  ('low',      'Niedrig – Planbar',                480,   7200,  TRUE);

INSERT INTO categories (id, name, description, icon, sort_order) VALUES
  ('hardware',     'Hardware',        'Notebooks, Monitore, Dockingstationen, Zubehör',           'laptop',     10),
  ('software',     'Software',        'Standard- und Fachsoftware, Lizenzen, Installationen',     'apps',       20),
  ('access',       'Berechtigungen',  'Gruppen, Laufwerke/Shares, Applikationsrollen',            'key',        30),
  ('general',      'Allgemeine IT-Anfrage', 'Fragen, Störungen und alles Weitere',                'help',       40);

-- ---------------------------------------------------------------------------
-- Katalog mit geführten Formularen
-- ---------------------------------------------------------------------------
INSERT INTO catalog_items (category_id, name, description, default_priority, requires_approval, popular, sort_order, form_schema) VALUES
('hardware', 'Notebook anfordern', 'Neues oder Ersatz-Notebook nach Unternehmensstandard', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"model","label":"Modell","type":"select","required":true,"options":[
      {"value":"standard-14","label":"Standard 14\" (Office)"},
      {"value":"performance-16","label":"Performance 16\" (Entwicklung/CAD)"},
      {"value":"ultralight-13","label":"Ultralight 13\" (Mobil)"}]},
   {"name":"reason","label":"Anlass","type":"select","required":true,"options":[
      {"value":"new-hire","label":"Neue/r Mitarbeitende/r"},
      {"value":"replacement","label":"Ersatz (defekt/veraltet)"},
      {"value":"additional","label":"Zusätzliches Gerät"}]},
   {"name":"oldAssetTag","label":"Inventarnummer Altgerät","type":"text","maxLength":30,"pattern":"^[A-Za-z0-9-]*$","help":"Nur bei Ersatz"},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"approverEmail","label":"E-Mail der/des Vorgesetzten (Freigabe)","type":"email","required":true,"maxLength":254},
   {"name":"neededBy","label":"Benötigt bis","type":"date"},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Monitor / Dockingstation', 'Zusätzlicher Monitor, Dock oder Ersatz', 'low', TRUE, TRUE, 20,
 '{"fields":[
   {"name":"item","label":"Gerät","type":"select","required":true,"options":[
      {"value":"monitor-24","label":"Monitor 24\""},
      {"value":"monitor-27","label":"Monitor 27\" QHD"},
      {"value":"dock-usbc","label":"USB-C-Dockingstation"}]},
   {"name":"quantity","label":"Anzahl","type":"number","required":true,"min":1,"max":4},
   {"name":"location","label":"Standort / Raum","type":"text","required":true,"maxLength":60},
   {"name":"costCenter","label":"Kostenstelle","type":"text","required":true,"maxLength":10,"pattern":"^[0-9]{3,10}$"},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('hardware', 'Zubehör', 'Headset, Maus, Tastatur, Adapter', 'low', FALSE, FALSE, 30,
 '{"fields":[
   {"name":"item","label":"Zubehör","type":"select","required":true,"options":[
      {"value":"headset","label":"Headset (zertifiziert)"},
      {"value":"mouse","label":"Maus"},
      {"value":"keyboard","label":"Tastatur"},
      {"value":"adapter","label":"Adapter / Kabel"}]},
   {"name":"details","label":"Details","type":"textarea","maxLength":1000}
 ]}'::jsonb),
('software', 'Software installieren', 'Standard- oder Fachsoftware aus dem Softwarekatalog', 'medium', FALSE, TRUE, 10,
 '{"fields":[
   {"name":"product","label":"Software / Produkt","type":"text","required":true,"maxLength":120},
   {"name":"softwareType","label":"Art","type":"select","required":true,"options":[
      {"value":"standard","label":"Standardsoftware (freigegeben)"},
      {"value":"specialist","label":"Fachsoftware"},
      {"value":"new","label":"Neue, noch nicht geprüfte Software"}]},
   {"name":"licenseType","label":"Lizenztyp","type":"select","required":true,"options":[
      {"value":"existing","label":"Vorhandene Unternehmenslizenz"},
      {"value":"named-user","label":"Neue Named-User-Lizenz"},
      {"value":"device","label":"Gerätelizenz"},
      {"value":"open-source","label":"Open Source / kostenfrei"}]},
   {"name":"targetDevice","label":"Zielgerät (Hostname / Inventarnr.)","type":"text","required":true,"maxLength":40,"pattern":"^[A-Za-z0-9.-]+$"},
   {"name":"justification","label":"Geschäftlicher Zweck","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('access', 'Gruppenmitgliedschaft / Share-Zugriff', 'Zugriff auf Gruppen, Laufwerke oder Netzfreigaben', 'medium', TRUE, TRUE, 10,
 '{"fields":[
   {"name":"accessType","label":"Art des Zugriffs","type":"select","required":true,"options":[
      {"value":"ad-group","label":"AD-/Verzeichnisgruppe"},
      {"value":"share","label":"Netzlaufwerk / Share"},
      {"value":"app-role","label":"Applikationsrolle"}]},
   {"name":"resource","label":"Gruppe / Pfad / Applikation","type":"text","required":true,"maxLength":200},
   {"name":"permission","label":"Berechtigungsstufe","type":"select","required":true,"options":[
      {"value":"read","label":"Lesen"},
      {"value":"write","label":"Lesen & Schreiben"},
      {"value":"owner","label":"Besitzer / Verwalter"}]},
   {"name":"forUser","label":"Für Person (Benutzerkennung)","type":"text","required":true,"maxLength":64,"pattern":"^[A-Za-z0-9._-]+$"},
   {"name":"validUntil","label":"Befristet bis","type":"date","required":true,"help":"Berechtigungen werden grundsätzlich befristet vergeben (Least Privilege)"},
   {"name":"approverEmail","label":"Freigabe durch (Ressourcenverantwortliche/r)","type":"email","required":true,"maxLength":254},
   {"name":"justification","label":"Begründung","type":"textarea","required":true,"maxLength":2000}
 ]}'::jsonb),
('general', 'Allgemeine Anfrage / Störung', 'Frage, Problem oder Wunsch ohne passende Kategorie', 'medium', FALSE, TRUE, 10,
 '{"fields":[
   {"name":"impact","label":"Auswirkung","type":"select","required":true,"options":[
      {"value":"single","label":"Nur ich bin betroffen"},
      {"value":"team","label":"Mein Team ist betroffen"},
      {"value":"many","label":"Viele / ganze Abteilung betroffen"}]},
   {"name":"phone","label":"Rückrufnummer","type":"text","maxLength":30,"pattern":"^[0-9 +()/-]*$"},
   {"name":"blocking","label":"Ich kann nicht weiterarbeiten","type":"checkbox"}
 ]}'::jsonb);

INSERT INTO standard_solutions (category_id, title, body) VALUES
  ('general',  'Neustart & Updates', 'Bitte starten Sie Ihr Gerät neu und installieren Sie alle ausstehenden Updates (Softwarecenter → Updates). Sollte das Problem weiterhin bestehen, antworten Sie einfach auf dieses Ticket.'),
  ('software', 'Installation über Softwarecenter', 'Die gewünschte Software ist freigegeben und steht im Softwarecenter zur Selbstinstallation bereit: Start → Softwarecenter → Anwendungen → Installieren.'),
  ('access',   'Berechtigung eingerichtet', 'Die Berechtigung wurde wie beantragt und befristet eingerichtet. Bitte melden Sie sich einmal ab und wieder an, damit die Gruppenmitgliedschaft wirksam wird.'),
  ('hardware', 'Gerät bereit zur Abholung', 'Ihr Gerät ist vorbereitet und kann zu den Servicezeiten am IT-Service-Point abgeholt werden. Bitte Altgerät und Netzteil mitbringen.');
