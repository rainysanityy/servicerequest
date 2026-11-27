import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { hasRole, mustUser, requireRole } from '../auth.js';

/**
 * Statistiken mit rollenabhängigem Umfang (serverseitig durchgesetzt):
 *  - user        → allgemeine Service-Kennzahlen + eigene Anfragen
 *  - first-level → zusätzlich operative Support-Kennzahlen
 *  - admin       → zusätzlich Katalog-, Nutzer- und Sicherheitskennzahlen
 *
 * Datenschutz (siehe Datenschutzkonzept): ausschließlich aggregierte Werte, keine
 * Auswertungen je bearbeitender Person (keine Leistungs-/Verhaltenskontrolle).
 * Allgemeine Kennzahlen unterdrücken Gruppen mit weniger als K_MIN Tickets.
 */
const K_MIN = 3;
const Query = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d)).default(30) }).strict();

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function statsRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const anyRole = requireRole(pool, 'user', 'first-level', 'admin');

  app.get('/api/stats', { preHandler: anyRole, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const user = mustUser(req);
    const { days } = Query.parse(req.query);
    const bucket = days <= 90 ? 'day' : 'week';
    const isSupport = hasRole(user, 'first-level', 'admin');
    const isAdmin = hasRole(user, 'admin');
    const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

    // ------------------------------------------------------------ allgemein (alle)
    const [headline] = await q(
      `SELECT
         (SELECT count(*) FROM tickets t JOIN ticket_statuses s ON s.code = t.status WHERE NOT s.is_final) AS open_now,
         count(*) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
         round((100.0 * count(*) FILTER (WHERE t.resolved_at <= t.due_at) / NULLIF(count(*) FILTER (WHERE t.due_at IS NOT NULL), 0))::numeric, 1) AS sla_pct,
         round((avg(extract(epoch FROM t.resolved_at - t.created_at)) / 3600)::numeric, 1) AS avg_resolution_h,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.first_response_at - t.created_at)) / 3600)::numeric, 1) AS median_first_response_h
       FROM tickets t
      WHERE t.resolved_at >= now() - make_interval(days => $1)`,
      [days],
    );
    const resolvedWeekly = await q(
      `SELECT to_char(w.week, 'DD.MM.') AS label, count(t.id)::int AS value
         FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
         LEFT JOIN tickets t ON t.resolved_at >= w.week AND t.resolved_at < w.week + interval '1 week'
        GROUP BY w.week ORDER BY w.week`,
    );
    const resolutionByCategory = await q(
      `SELECT c.name AS label, count(*)::int AS n,
              round((avg(extract(epoch FROM t.resolved_at - t.created_at)) / 3600)::numeric, 1) AS value
         FROM tickets t JOIN categories c ON c.id = t.category_id
        WHERE t.resolved_at >= now() - make_interval(days => $1)
        GROUP BY c.name, c.sort_order HAVING count(*) >= $2 ORDER BY c.sort_order`,
      [days, K_MIN],
    );
    const mine = await q(
      `SELECT s.code, s.label, s.sort_order, count(t.id)::int AS value
         FROM ticket_statuses s LEFT JOIN tickets t ON t.status = s.code AND t.requester_sub = $1
        GROUP BY s.code, s.label, s.sort_order ORDER BY s.sort_order`,
      [user.sub],
    );

    const result: Record<string, unknown> = {
      scope: isAdmin ? 'admin' : isSupport ? 'support' : 'user',
      days,
      general: {
        openNow: num(headline?.['open_now']),
        resolved: num(headline?.['resolved']),
        slaPct: num(headline?.['sla_pct']),
        avgResolutionHours: num(headline?.['avg_resolution_h']),
        medianFirstResponseHours: num(headline?.['median_first_response_h']),
        resolvedWeekly,
        resolutionByCategory: resolutionByCategory.map((r) => ({ ...r, value: num(r['value']) })),
        mine,
      },
    };

    // ------------------------------------------------------------ Support (UHD + Admin)
    if (isSupport) {
      const [openByStatus, openByPriority, flow, slaByPriority, aging, categoryVolume, [ops]] = await Promise.all([
        q(`SELECT s.code, s.label, count(t.id)::int AS value FROM ticket_statuses s
             LEFT JOIN tickets t ON t.status = s.code WHERE NOT s.is_final
            GROUP BY s.code, s.label, s.sort_order ORDER BY s.sort_order`),
        q(`SELECT p.priority AS code, count(t.id)::int AS value
             FROM unnest(ARRAY['low','medium','high','critical']) WITH ORDINALITY AS p(priority, ord)
             LEFT JOIN (SELECT t.priority, t.id FROM tickets t JOIN ticket_statuses s ON s.code = t.status WHERE NOT s.is_final) t
               ON t.priority = p.priority
            GROUP BY p.priority, p.ord ORDER BY p.ord`),
        q(`SELECT to_char(b.ts, 'DD.MM.') AS label,
                  (SELECT count(*) FROM tickets t WHERE t.created_at >= b.ts AND t.created_at < b.ts + ('1 ' || $2)::interval)::int AS created,
                  (SELECT count(*) FROM tickets t WHERE t.resolved_at >= b.ts AND t.resolved_at < b.ts + ('1 ' || $2)::interval)::int AS resolved
             FROM generate_series(date_trunc($2, now() - make_interval(days => $1 - 1)), date_trunc($2, now()), ('1 ' || $2)::interval) AS b(ts)
            ORDER BY b.ts`, [days, bucket]),
        q(`SELECT p.priority AS code,
                  count(t.id) FILTER (WHERE t.resolved_at IS NOT NULL)::int AS resolved,
                  round((100.0 * count(t.id) FILTER (WHERE t.resolved_at <= t.due_at) / NULLIF(count(t.id) FILTER (WHERE t.resolved_at IS NOT NULL), 0))::numeric, 1) AS sla_pct,
                  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.first_response_at - t.created_at)) / 3600)::numeric, 1) AS median_first_response_h
             FROM unnest(ARRAY['low','medium','high','critical']) WITH ORDINALITY AS p(priority, ord)
             LEFT JOIN tickets t ON t.priority = p.priority AND t.created_at >= now() - make_interval(days => $1)
            GROUP BY p.priority, p.ord ORDER BY p.ord`, [days]),
        q(`SELECT b.label, count(t.id)::int AS value
             FROM (VALUES (1, '< 1 Tag', 0, 1), (2, '1–3 Tage', 1, 3), (3, '3–7 Tage', 3, 7), (4, '7–14 Tage', 7, 14), (5, '> 14 Tage', 14, 100000))
                  AS b(ord, label, lo, hi)
             LEFT JOIN (SELECT t.id, extract(epoch FROM now() - t.created_at) / 86400 AS age
                          FROM tickets t JOIN ticket_statuses s ON s.code = t.status WHERE NOT s.is_final) t
               ON t.age >= b.lo AND t.age < b.hi
            GROUP BY b.ord, b.label ORDER BY b.ord`),
        q(`SELECT c.name AS label, count(t.id)::int AS value FROM categories c
             LEFT JOIN tickets t ON t.category_id = c.id AND t.created_at >= now() - make_interval(days => $1)
            WHERE c.active GROUP BY c.name, c.sort_order ORDER BY c.sort_order`, [days]),
        q(`SELECT count(*) FILTER (WHERE t.assignee_sub IS NULL)::int AS unassigned,
                  count(*) FILTER (WHERE t.status <> 'resolved' AND t.due_at < now())::int AS overdue,
                  count(*) FILTER (WHERE t.status = 'waiting_for_user')::int AS waiting_for_user
             FROM tickets t JOIN ticket_statuses s ON s.code = t.status WHERE NOT s.is_final`),
      ]);
      result['support'] = {
        openByStatus, openByPriority, flow, aging, categoryVolume,
        slaByPriority: slaByPriority.map((r) => ({ ...r, sla_pct: num(r['sla_pct']), median_first_response_h: num(r['median_first_response_h']) })),
        unassigned: ops?.['unassigned'] ?? 0, overdue: ops?.['overdue'] ?? 0, waitingForUser: ops?.['waiting_for_user'] ?? 0,
      };
    }

    // ------------------------------------------------------------ Administration
    if (isAdmin) {
      const [topItems, outcomes, usersWeekly, [userCounts], deniedFlow, topActions] = await Promise.all([
        q(`SELECT ci.name AS label, count(t.id)::int AS value FROM tickets t JOIN catalog_items ci ON ci.id = t.catalog_item_id
            WHERE t.created_at >= now() - make_interval(days => $1)
            GROUP BY ci.name ORDER BY value DESC, ci.name LIMIT 10`, [days]),
        q(`SELECT s.code, s.label, count(t.id)::int AS value
             FROM ticket_statuses s LEFT JOIN tickets t ON t.status = s.code AND t.closed_at >= now() - make_interval(days => $1)
            WHERE s.is_final GROUP BY s.code, s.label, s.sort_order ORDER BY s.sort_order`, [days]),
        q(`SELECT to_char(w.week, 'DD.MM.') AS label,
                  (SELECT count(*) FROM user_profiles p WHERE p.first_seen >= w.week AND p.first_seen < w.week + interval '1 week')::int AS value
             FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
            ORDER BY w.week`),
        q(`SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE last_seen >= now() - interval '30 days')::int AS active_30d,
                  count(*) FILTER (WHERE 'admin' = ANY(roles))::int AS admins,
                  count(*) FILTER (WHERE 'first-level' = ANY(roles) AND NOT 'admin' = ANY(roles))::int AS uhd,
                  count(*) FILTER (WHERE NOT roles && ARRAY['first-level','admin']::text[])::int AS users
             FROM user_profiles WHERE username NOT LIKE 'anon-%'`),
        q(`SELECT to_char(b.ts, 'DD.MM.') AS label,
                  (SELECT count(*) FROM audit_log a WHERE a.outcome = 'denied' AND a.ts >= b.ts AND a.ts < b.ts + ('1 ' || $2)::interval)::int AS value
             FROM generate_series(date_trunc($2, now() - make_interval(days => $1 - 1)), date_trunc($2, now()), ('1 ' || $2)::interval) AS b(ts)
            ORDER BY b.ts`, [days, bucket]),
        q(`SELECT action AS label, count(*)::int AS value FROM audit_log
            WHERE ts >= now() - make_interval(days => $1) GROUP BY action ORDER BY value DESC LIMIT 8`, [days]),
      ]);
      result['admin'] = { topItems, outcomes, usersWeekly, users: userCounts, deniedFlow, topActions };
    }
    return result;
  });
}
