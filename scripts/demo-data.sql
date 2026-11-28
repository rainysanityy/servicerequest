-- =============================================================================
-- NUR DEMO/TEST: füllt die Portal-Datenbank mit fiktiven Daten (ca. 12 Monate),
-- damit Ticketlisten und Statistiken Inhalt haben.
-- Aufruf: ./scripts/load-demo-data.sh   (niemals in Produktion!)
-- Idempotent: läuft nur, wenn noch keine Demo-Daten vorhanden sind.
-- =============================================================================
SET search_path = portal;
\set ON_ERROR_STOP on

DO $demo$
DECLARE
  first_names TEXT[] := ARRAY['Lena','Jonas','Mia','Felix','Hannah','Lukas','Sophie','Paul','Laura','Tim','Julia','Max',
    'Lea','Leon','Sarah','David','Anna','Tom','Marie','Jan','Katharina','Niklas','Lisa','Moritz','Clara','Simon','Emma',
    'Fabian','Johanna','Tobias','Nina','Florian','Carina','Sebastian','Melanie','Daniel','Sandra','Markus','Petra','Stefan'];
  last_names TEXT[] := ARRAY['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann',
    'Koch','Bauer','Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann','Braun','Krüger','Hofmann',
    'Hartmann','Lange','Schmitt','Werner','Krause','Meier','Lehmann','Huber','Kaiser','Fuchs','Peters','Lang','Scholz'];
  -- feste Keycloak-IDs der Demo-Benutzer (siehe keycloak/demo-users/itportal-users-0.json)
  anna  CONSTANT TEXT := 'a1000000-0000-4000-8000-000000000001';
  uwe   CONSTANT TEXT := 'a1000000-0000-4000-8000-000000000002';
  alex  CONSTANT TEXT := 'a1000000-0000-4000-8000-000000000003';
  n_users CONSTANT INT := 380;
  n_days  CONSTANT INT := 365;
  agents TEXT[];
  items  RECORD;
  item_ids UUID[]; item_cats TEXT[]; item_prio TEXT[]; item_w INT[];
  total_w INT := 0;
  d INT; k INT; per_day INT; r DOUBLE PRECISION; pick INT; acc INT;
  t_id UUID; t_created TIMESTAMPTZ; t_prio TEXT; t_status TEXT; t_req TEXT; t_agent TEXT;
  resp_min INT; res_min INT; biz BOOLEAN; mult DOUBLE PRECISION;
  t_resp_due TIMESTAMPTZ; t_due TIMESTAMPTZ; t_first TIMESTAMPTZ; t_resolved TIMESTAMPTZ; t_closed TIMESTAMPTZ;
  age_days DOUBLE PRECISION; i INT; fn TEXT; ln TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM user_profiles WHERE sub LIKE 'demo-%') THEN
    RAISE NOTICE 'Demo-Daten sind bereits vorhanden – nichts zu tun.';
    RETURN;
  END IF;
  PERFORM setseed(0.4711);

  -- ---------------------------------------------------------------- Benutzer
  INSERT INTO user_profiles (sub, username, display_name, email, roles, first_seen, last_seen) VALUES
    (anna, 'anna.mueller', 'Anna Müller',  'anna.mueller@example.local', '{user}',        now() - interval '300 days', now() - interval '2 days'),
    (uwe,  'uwe.helpdesk', 'Uwe Helpdesk', 'uwe.helpdesk@example.local', '{first-level}', now() - interval '360 days', now() - interval '1 day'),
    (alex, 'alex.admin',   'Alex Admin',   'alex.admin@example.local',   '{admin}',       now() - interval '365 days', now() - interval '1 day')
  ON CONFLICT (sub) DO NOTHING;

  FOR i IN 1..5 LOOP
    fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
    ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
    INSERT INTO user_profiles (sub, username, display_name, email, roles, first_seen, last_seen)
    VALUES ('demo-uhd-' || i, lower(fn || '.' || ln) || '.uhd', fn || ' ' || ln, lower(fn || '.' || ln) || '.uhd@example.local',
            '{first-level}', now() - interval '365 days', now() - (random() * interval '3 days'));
  END LOOP;
  INSERT INTO user_profiles (sub, username, display_name, email, roles, first_seen, last_seen)
  VALUES ('demo-admin-1', 'it.leitung', 'IT Leitung', 'it.leitung@example.local', '{admin}', now() - interval '365 days', now() - interval '4 days');

  FOR i IN 1..n_users LOOP
    fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
    ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
    INSERT INTO user_profiles (sub, username, display_name, email, roles, first_seen, last_seen)
    VALUES ('demo-u-' || lpad(i::text, 4, '0'),
            lower(fn || '.' || ln) || i, fn || ' ' || ln, lower(fn || '.' || ln) || i || '@example.local', '{user}',
            -- Großteil früh registriert, laufend einige neue
            CASE WHEN random() < 0.6 THEN now() - interval '365 days' - random() * interval '30 days'
                 ELSE now() - random() * interval '330 days' END,
            CASE WHEN random() < 0.72 THEN now() - random() * interval '30 days'
                 ELSE now() - interval '30 days' - random() * interval '200 days' END);
  END LOOP;
  UPDATE user_profiles SET last_seen = greatest(last_seen, first_seen) WHERE sub LIKE 'demo-u-%';

  agents := ARRAY[uwe, 'demo-uhd-1', 'demo-uhd-2', 'demo-uhd-3', 'demo-uhd-4', 'demo-uhd-5'];

  -- --------------------------------------------------- Katalog-Gewichtung
  item_ids := '{}'; item_cats := '{}'; item_prio := '{}'; item_w := '{}';
  FOR items IN SELECT id, category_id, default_priority, popular, name FROM catalog_items WHERE active ORDER BY sort_order, name LOOP
    item_ids  := item_ids  || items.id;
    item_cats := item_cats || items.category_id;
    item_prio := item_prio || items.default_priority;
    k := CASE WHEN items.popular THEN 9
              WHEN items.category_id IN ('general','software','access') THEN 6
              WHEN items.category_id = 'hardware' THEN 4
              ELSE 2 END;
    item_w := item_w || k;
    total_w := total_w + k;
  END LOOP;
  IF total_w = 0 THEN RAISE EXCEPTION 'Kein aktiver Katalog gefunden – zuerst Migrationen ausführen.'; END IF;

  -- ----------------------------------------------------------------- Tickets
  FOR d IN REVERSE n_days..0 LOOP
    -- Werktage deutlich mehr Last, leichte Saisonalität, leichter Aufwärtstrend
    per_day := CASE WHEN extract(isodow FROM now() - d * interval '1 day') >= 6 THEN floor(random() * 2)::int
                    ELSE 5 + floor(random() * 6 + 2 * sin(d / 30.0) + (n_days - d) / 120.0)::int END;
    FOR k IN 1..per_day LOOP
      r := random() * total_w; acc := 0; pick := 1;
      FOR i IN 1..array_length(item_w, 1) LOOP
        acc := acc + item_w[i];
        IF r < acc THEN pick := i; EXIT; END IF;
      END LOOP;

      t_created := date_trunc('day', now() - d * interval '1 day') + interval '7 hours' + random() * interval '10 hours';
      IF t_created > now() THEN t_created := now() - random() * interval '3 hours'; END IF;
      age_days := extract(epoch FROM now() - t_created) / 86400;

      r := random();
      t_prio := CASE WHEN r < 0.04 THEN 'critical' WHEN r < 0.20 THEN 'high'
                     WHEN r < 0.70 THEN item_prio[pick] ELSE (ARRAY['low','medium'])[1 + floor(random() * 2)::int] END;
      SELECT response_minutes, resolution_minutes, business_hours_only INTO resp_min, res_min, biz
        FROM sla_policies WHERE priority = t_prio;
      mult := CASE WHEN biz THEN 3.0 ELSE 1.0 END;   -- grobe Umrechnung Geschäftszeit -> Kalenderzeit
      t_resp_due := t_created + make_interval(mins => (resp_min * mult)::int);
      t_due      := t_created + make_interval(mins => (res_min * mult)::int);

      t_req := CASE WHEN random() < 0.01 THEN anna ELSE 'demo-u-' || lpad((1 + floor(random() * n_users))::int::text, 4, '0') END;
      t_agent := agents[1 + floor(random() * array_length(agents, 1))::int];

      -- Reaktion: meist innerhalb des Ziels
      t_first := t_created + (resp_min * mult * (CASE WHEN random() < 0.9 THEN random() * 0.8 ELSE 1 + random() END)) * interval '1 minute';
      -- Lösung: ~87 % innerhalb SLA
      t_resolved := t_created + (res_min * mult * (CASE WHEN random() < 0.87 THEN 0.05 + random() * 0.9 ELSE 1.05 + random() * 1.5 END)) * interval '1 minute';
      t_closed := NULL;

      r := random();
      IF t_resolved < now() - interval '2 days' THEN
        -- abgeschlossene Vorgänge
        IF r < 0.06 THEN
          t_status := 'rejected';  t_closed := t_first + random() * interval '1 day'; t_resolved := NULL;
        ELSIF r < 0.10 THEN
          t_status := 'withdrawn'; t_closed := t_created + random() * interval '6 hours'; t_resolved := NULL; t_first := NULL; t_agent := NULL;
        ELSIF r < 0.55 AND t_resolved > now() - interval '5 days' THEN   -- Lösung noch nicht bestätigt
          t_status := 'resolved';
        ELSE
          t_status := 'closed';    t_closed := t_resolved + random() * interval '3 days';
        END IF;
      ELSE
        -- noch offene Vorgänge
        t_resolved := NULL;
        IF age_days < 0.3 AND r < 0.6 THEN
          t_status := 'new'; t_agent := NULL; t_first := NULL;
        ELSIF r < 0.15 THEN
          t_status := 'new'; t_agent := CASE WHEN random() < 0.5 THEN NULL ELSE t_agent END; t_first := NULL;
        ELSIF r < 0.65 THEN t_status := 'in_progress';
        ELSIF r < 0.82 THEN t_status := 'waiting_for_user';
        ELSE t_status := 'waiting_for_approval';
        END IF;
        IF t_first IS NOT NULL AND t_first > now() THEN t_first := now() - random() * interval '1 hour'; END IF;
      END IF;
      IF t_closed IS NOT NULL AND t_closed > now() THEN t_closed := now() - random() * interval '1 hour'; END IF;

      INSERT INTO tickets (requester_sub, category_id, catalog_item_id, title, description, status, priority, assignee_sub,
                           response_due_at, due_at, first_response_at, resolved_at, closed_at, created_at, updated_at)
      SELECT t_req, item_cats[pick], item_ids[pick],
             ci.name || ' – ' || split_part(up.display_name, ' ', 2),
             'Demo-Datensatz (automatisch erzeugt).',
             t_status, t_prio, t_agent, t_resp_due, t_due, t_first, t_resolved, t_closed, t_created,
             coalesce(t_closed, t_resolved, t_first, t_created)
        FROM catalog_items ci, user_profiles up
       WHERE ci.id = item_ids[pick] AND up.sub = t_req
      RETURNING id INTO t_id;

      INSERT INTO ticket_events (ticket_id, actor_sub, event_type, to_value, created_at) VALUES (t_id, t_req, 'created', 'new', t_created);
      IF t_agent IS NOT NULL THEN
        INSERT INTO ticket_events (ticket_id, actor_sub, event_type, to_value, created_at)
        VALUES (t_id, t_agent, 'assigned', t_agent, coalesce(t_first, t_created + interval '5 minutes'));
      END IF;
      IF t_status <> 'new' THEN
        INSERT INTO ticket_events (ticket_id, actor_sub, event_type, from_value, to_value, created_at)
        VALUES (t_id, CASE WHEN t_status = 'withdrawn' THEN t_req ELSE coalesce(t_agent, t_req) END, 'status', 'new', t_status,
                coalesce(t_closed, t_resolved, t_first, t_created + interval '10 minutes'));
      END IF;
      IF t_first IS NOT NULL AND random() < 0.35 THEN
        INSERT INTO ticket_comments (ticket_id, author_sub, author_role, body, internal, created_at)
        VALUES (t_id, t_agent, 'first-level',
                (ARRAY['Vielen Dank für Ihre Anfrage, wir kümmern uns darum.',
                       'Bitte teilen Sie uns noch die Inventarnummer mit.',
                       'Die Bestellung wurde ausgelöst, Lieferzeit ca. 3 Werktage.',
                       'Berechtigung wurde eingerichtet, bitte einmal ab- und wieder anmelden.'])[1 + floor(random() * 4)::int],
                FALSE, t_first);
      END IF;
    END LOOP;
  END LOOP;

  -- Anna bekommt eine übersichtliche, gemischte Ticketliste
  UPDATE tickets SET status = 'in_progress', resolved_at = NULL, closed_at = NULL
   WHERE id = (SELECT id FROM tickets WHERE requester_sub = anna ORDER BY created_at DESC LIMIT 1);
  UPDATE tickets SET status = 'waiting_for_user', resolved_at = NULL, closed_at = NULL
   WHERE id = (SELECT id FROM tickets WHERE requester_sub = anna ORDER BY created_at DESC OFFSET 1 LIMIT 1);

  -- ------------------------------------------------------- Audit-Log (Hash-Kette bleibt gültig)
  INSERT INTO audit_log (ts, actor_sub, actor_name, actor_roles, action, entity_type, entity_id, outcome, details)
  SELECT x.ts, x.actor, up.display_name, up.roles, x.action, x.etype, x.eid, x.outcome, x.details
    FROM (
      SELECT t.created_at AS ts, t.requester_sub AS actor, 'ticket.create' AS action, 'ticket' AS etype, t.id::text AS eid,
             'success' AS outcome, jsonb_build_object('demo', true) AS details FROM tickets t WHERE t.description LIKE 'Demo-Datensatz%'
      UNION ALL
      SELECT e.created_at, e.actor_sub, CASE e.event_type WHEN 'assigned' THEN 'ticket.assign' ELSE 'ticket.status' END, 'ticket', e.ticket_id::text,
             'success', jsonb_build_object('demo', true, 'to', e.to_value)
        FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
       WHERE t.description LIKE 'Demo-Datensatz%' AND e.event_type IN ('assigned','status')
      UNION ALL
      SELECT c.created_at, c.author_sub, 'ticket.comment', 'ticket', c.ticket_id::text, 'success', jsonb_build_object('demo', true)
        FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id WHERE t.description LIKE 'Demo-Datensatz%'
      UNION ALL
      -- abgewiesene Zugriffe: sporadisch, mit einer auffälligen Spitze vor ca. 6 Wochen
      SELECT now() - g * interval '1 day' + random() * interval '10 hours',
             'demo-u-' || lpad((1 + floor(random() * n_users))::int::text, 4, '0'),
             CASE WHEN random() < 0.5 THEN 'authz.denied' ELSE 'auth.denied' END, 'api', NULL, 'denied',
             jsonb_build_object('demo', true, 'reason', CASE WHEN random() < 0.5 THEN 'role' ELSE 'email_domain' END)
        FROM generate_series(0, n_days) AS g, generate_series(1, 3) AS rep
       WHERE random() < CASE WHEN g BETWEEN 40 AND 44 THEN 0.9 ELSE 0.12 END
      UNION ALL
      SELECT now() - g * interval '9 days', alex, 'admin.catalog.update', 'catalog_item', NULL, 'success', jsonb_build_object('demo', true)
        FROM generate_series(1, 40) AS g
    ) x
    LEFT JOIN user_profiles up ON up.sub = x.actor
   WHERE x.actor IS NOT NULL
   ORDER BY x.ts;

  RAISE NOTICE 'Demo-Daten erzeugt: % Tickets, % Benutzerprofile, % Audit-Einträge',
    (SELECT count(*) FROM tickets), (SELECT count(*) FROM user_profiles), (SELECT count(*) FROM audit_log);
END
$demo$;
