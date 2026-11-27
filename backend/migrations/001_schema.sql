-- =============================================================================
-- 001_schema.sql – Grundschema IT-Service-Request-Portal
-- Ausgeführt als portal_migrator (Schema-Owner). Die Laufzeitrolle portal_app
-- erhält nur die minimal nötigen DML-Rechte; das Audit-Log ist append-only.
-- =============================================================================
SET search_path = portal;

-- ---------------------------------------------------------------------------
-- Stammdaten: SLA, Status, Kategorien, Katalog
-- ---------------------------------------------------------------------------
CREATE TABLE sla_policies (
  id                  SERIAL PRIMARY KEY,
  priority            TEXT NOT NULL UNIQUE CHECK (priority IN ('low','medium','high','critical')),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  response_minutes    INTEGER NOT NULL CHECK (response_minutes > 0),
  resolution_minutes  INTEGER NOT NULL CHECK (resolution_minutes > 0),
  business_hours_only BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_statuses (
  code        TEXT PRIMARY KEY CHECK (code ~ '^[a-z_]{2,32}$'),
  label       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT '',
  color_role  TEXT NOT NULL DEFAULT 'neutral'
              CHECK (color_role IN ('neutral','primary','secondary','tertiary','success','warning','error')),
  is_final    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Erlaubte Statusübergänge (Workflow). allowed_role: wer den Übergang auslösen darf
CREATE TABLE status_transitions (
  from_status  TEXT NOT NULL REFERENCES ticket_statuses(code) ON DELETE CASCADE,
  to_status    TEXT NOT NULL REFERENCES ticket_statuses(code) ON DELETE CASCADE,
  allowed_role TEXT NOT NULL CHECK (allowed_role IN ('user','first-level','admin')),
  PRIMARY KEY (from_status, to_status, allowed_role),
  CHECK (from_status <> to_status)
);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  icon        TEXT NOT NULL DEFAULT 'help' CHECK (icon ~ '^[a-z_]{2,40}$'),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalog_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       TEXT NOT NULL REFERENCES categories(id),
  name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description       TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  -- Formulardefinition (vom Backend gegen ein Meta-Schema validiert)
  form_schema       JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  default_priority  TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low','medium','high','critical')),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  popular           BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX catalog_items_category_idx ON catalog_items(category_id) WHERE active;

-- Standardlösungen / Textbausteine für den First-Level-Support
CREATE TABLE standard_solutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id TEXT REFERENCES categories(id),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Benutzerprofile (Cache aus dem Token; Quelle der Wahrheit ist Keycloak)
-- ---------------------------------------------------------------------------
CREATE TABLE user_profiles (
  sub          TEXT PRIMARY KEY CHECK (char_length(sub) BETWEEN 1 AND 255),
  username     TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email        TEXT,
  roles        TEXT[] NOT NULL DEFAULT '{}',
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_profiles_roles_idx ON user_profiles USING GIN (roles);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
CREATE SEQUENCE ticket_number_seq START 1000;

CREATE TABLE tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          TEXT NOT NULL UNIQUE DEFAULT ('SR-' || lpad(nextval('ticket_number_seq')::text, 6, '0')),
  requester_sub   TEXT NOT NULL REFERENCES user_profiles(sub),
  category_id     TEXT NOT NULL REFERENCES categories(id),
  catalog_item_id UUID REFERENCES catalog_items(id),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description     TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  form_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'new' REFERENCES ticket_statuses(code),
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  assignee_sub    TEXT REFERENCES user_profiles(sub),
  response_due_at TIMESTAMPTZ,
  due_at          TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  anonymized      BOOLEAN NOT NULL DEFAULT FALSE,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_requester_idx ON tickets(requester_sub, created_at DESC);
CREATE INDEX tickets_status_idx    ON tickets(status, priority, created_at);
CREATE INDEX tickets_assignee_idx  ON tickets(assignee_sub) WHERE assignee_sub IS NOT NULL;
CREATE INDEX tickets_search_idx    ON tickets USING GIN (to_tsvector('german', title || ' ' || description));

CREATE TABLE ticket_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_sub  TEXT NOT NULL REFERENCES user_profiles(sub),
  author_role TEXT NOT NULL CHECK (author_role IN ('user','first-level','admin','system')),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  internal    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_comments_ticket_idx ON ticket_comments(ticket_id, created_at);

-- Fachliche Historie eines Tickets (für Nutzer sichtbare Zeitleiste)
CREATE TABLE ticket_events (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_sub  TEXT REFERENCES user_profiles(sub),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status','priority','assigned','comment','withdrawn','solution')),
  from_value TEXT,
  to_value   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events(ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Sicherheits-/Audit-Log (append-only, NIST AU-2/AU-3/AU-9)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id  TEXT,
  actor_sub   TEXT,
  actor_name  TEXT,
  actor_roles TEXT[] NOT NULL DEFAULT '{}',
  action      TEXT NOT NULL CHECK (action ~ '^[a-z_.]{3,64}$'),
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  outcome     TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failure')),
  client_ip   INET,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Hash-Kette zur Manipulationserkennung
  prev_hash   TEXT,
  row_hash    TEXT
);
CREATE INDEX audit_log_ts_idx     ON audit_log(ts DESC);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX audit_log_actor_idx  ON audit_log(actor_sub);

-- Hash-Kette: jeder Eintrag enthält SHA-256 über Inhalt + Vorgänger-Hash
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(424242);
  SELECT row_hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, 'GENESIS');
  NEW.row_hash := encode(sha256(convert_to(
      NEW.prev_hash || '|' || (NEW.ts AT TIME ZONE 'UTC')::text || '|' || COALESCE(NEW.actor_sub,'') || '|' ||
      NEW.action || '|' || NEW.entity_type || '|' || COALESCE(NEW.entity_id,'') || '|' ||
      NEW.outcome || '|' || NEW.details::text, 'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_log_chain_trg BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Schutz gegen UPDATE/DELETE (auch falls Rechte versehentlich vergeben werden)
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('portal.retention', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log ist unveränderlich (append-only)';
END $$;

CREATE TRIGGER audit_log_immutable_trg BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Aufbewahrung / Löschkonzept (DSGVO Art. 5 Abs. 1 lit. e, Art. 17)
-- Läuft als SECURITY DEFINER (Owner: portal_migrator); portal_app darf nur
-- diese Funktion ausführen, nicht direkt löschen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_retention(ticket_days INTEGER, audit_days INTEGER, ip_days INTEGER)
RETURNS TABLE(anonymized_tickets INTEGER, deleted_audit INTEGER, cleared_ips INTEGER, anonymized_users INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = portal AS $$
DECLARE
  t INTEGER; a INTEGER; i INTEGER; u INTEGER;
BEGIN
  IF ticket_days < 30 OR audit_days < 30 OR ip_days < 7 THEN
    RAISE EXCEPTION 'Aufbewahrungsfristen unterhalb des Minimums';
  END IF;

  -- Tickets anonymisieren (statt Löschen -> Statistik bleibt erhalten)
  WITH upd AS (
    UPDATE tickets
       SET description = '[anonymisiert]',
           form_data   = '{}'::jsonb,
           title       = number || ' (anonymisiert)',
           anonymized  = TRUE,
           updated_at  = now()
     WHERE NOT anonymized
       AND closed_at IS NOT NULL
       AND closed_at < now() - make_interval(days => ticket_days)
    RETURNING id)
  SELECT count(*) INTO t FROM upd;

  DELETE FROM ticket_comments c USING tickets tk
   WHERE c.ticket_id = tk.id AND tk.anonymized;

  -- Profile ausgeschiedener/inaktiver Personen pseudonymisieren (Name, E-Mail entfernen)
  WITH upd AS (
    UPDATE user_profiles
       SET display_name = 'Ehemalige Person',
           email        = NULL,
           username     = 'anon-' || left(md5(sub), 10),
           roles        = '{}'
     WHERE last_seen < now() - make_interval(days => ticket_days)
       AND username NOT LIKE 'anon-%'
       AND NOT EXISTS (SELECT 1 FROM tickets tk
                        JOIN ticket_statuses st ON st.code = tk.status
                       WHERE tk.requester_sub = user_profiles.sub AND NOT st.is_final)
    RETURNING 1)
  SELECT count(*) INTO u FROM upd;

  PERFORM set_config('portal.retention', 'on', true);

  WITH upd AS (
    UPDATE audit_log SET client_ip = NULL
     WHERE client_ip IS NOT NULL AND ts < now() - make_interval(days => ip_days)
    RETURNING 1)
  SELECT count(*) INTO i FROM upd;

  WITH del AS (
    DELETE FROM audit_log WHERE ts < now() - make_interval(days => audit_days) RETURNING 1)
  SELECT count(*) INTO a FROM del;

  PERFORM set_config('portal.retention', 'off', true);

  RETURN QUERY SELECT t, a, i, u;
END $$;

-- ---------------------------------------------------------------------------
-- Rechte für die Laufzeitrolle (Least Privilege)
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_retention(INTEGER, INTEGER, INTEGER) FROM PUBLIC;

GRANT SELECT ON sla_policies, ticket_statuses, status_transitions, categories, catalog_items, standard_solutions TO portal_app;
GRANT INSERT, UPDATE ON sla_policies, ticket_statuses, categories, catalog_items, standard_solutions TO portal_app;
GRANT INSERT, DELETE ON status_transitions TO portal_app;
GRANT SELECT, INSERT, UPDATE ON user_profiles TO portal_app;
GRANT SELECT, INSERT, UPDATE ON tickets TO portal_app;
GRANT SELECT, INSERT ON ticket_comments, ticket_events TO portal_app;
GRANT SELECT, INSERT ON audit_log TO portal_app;              -- kein UPDATE/DELETE
GRANT USAGE ON ALL SEQUENCES IN SCHEMA portal TO portal_app;
GRANT EXECUTE ON FUNCTION apply_retention(INTEGER, INTEGER, INTEGER) TO portal_app;
