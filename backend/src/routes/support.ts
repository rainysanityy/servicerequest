import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { mustUser, requireRole } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import {
  addEvent, lockTicketForUser, markFirstResponse, primaryRole, TICKET_LIST_COLUMNS, TICKET_LIST_JOINS,
} from '../ticketService.js';
import { conflict, HttpError, likeEscape, notFound, pagination, priority, uuid } from '../util.js';
import { allowedTargets, loadTransitions, slaFor, statusTimestampsSql } from '../workflow.js';

const SORTS = {
  newest: 't.created_at DESC',
  oldest: 't.created_at ASC',
  due: 't.due_at ASC NULLS LAST',
  priority: `CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at`,
  updated: 't.updated_at DESC',
} as const;

const QueueQuery = pagination
  .extend({
    view: z.enum(['open', 'all', 'final']).default('open'),
    status: z.string().regex(/^[a-z_]{2,32}$/).optional(),
    priority: priority.optional(),
    category: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
    assignee: z.union([z.enum(['me', 'unassigned']), z.string().min(1).max(255)]).optional(),
    overdue: z.enum(['true', 'false']).optional(),
    q: z.string().max(100).optional(),
    sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).default('priority'),
  })
  .strict();

const IdParam = z.object({ id: uuid }).strict();
const AssignBody = z.object({ assigneeSub: z.string().min(1).max(255).nullable(), version: z.number().int().min(1) }).strict();
const PriorityBody = z.object({ priority, version: z.number().int().min(1) }).strict();
const SolutionBody = z.object({ solutionId: uuid, version: z.number().int().min(1) }).strict();

export async function supportRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const support = requireRole(pool, 'first-level', 'admin');

  app.get('/api/support/stats', { preHandler: support }, async (req) => {
    const user = mustUser(req);
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE t.status = 'new')                                  AS new,
              count(*) FILTER (WHERE t.status = 'new' AND t.assignee_sub IS NULL)        AS unassigned,
              count(*) FILTER (WHERE NOT s.is_final AND t.assignee_sub = $1)            AS mine,
              count(*) FILTER (WHERE t.status = 'waiting_for_user')                     AS waiting_for_user,
              count(*) FILTER (WHERE NOT s.is_final AND t.status <> 'resolved' AND t.due_at < now()) AS overdue,
              count(*) FILTER (WHERE NOT s.is_final AND t.priority = 'critical')        AS critical,
              count(*) FILTER (WHERE t.resolved_at > now() - interval '7 days')         AS resolved_7d
         FROM tickets t JOIN ticket_statuses s ON s.code = t.status`,
      [user.sub],
    );
    return rows[0];
  });

  app.get('/api/support/tickets', { preHandler: support }, async (req) => {
    const user = mustUser(req);
    const q = QueueQuery.parse(req.query);
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.view === 'open') where.push('NOT s.is_final');
    if (q.view === 'final') where.push('s.is_final');
    if (q.status) add('t.status = ?', q.status);
    if (q.priority) add('t.priority = ?', q.priority);
    if (q.category) add('t.category_id = ?', q.category);
    if (q.assignee === 'me') add('t.assignee_sub = ?', user.sub);
    else if (q.assignee === 'unassigned') where.push('t.assignee_sub IS NULL');
    else if (q.assignee) add('t.assignee_sub = ?', q.assignee);
    if (q.overdue === 'true') where.push(`NOT s.is_final AND t.status <> 'resolved' AND t.due_at < now()`);
    if (q.q && q.q.trim()) {
      const term = `%${likeEscape(q.q.trim())}%`;
      params.push(term);
      const i = params.length;
      where.push(`(t.title ILIKE $${i} OR t.number ILIKE $${i} OR rp.display_name ILIKE $${i})`);
    }
    const whereSql = where.join(' AND ');
    const count = await pool.query<{ n: string }>(`SELECT count(*) AS n ${TICKET_LIST_JOINS} WHERE ${whereSql}`, params);
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await pool.query(
      `SELECT ${TICKET_LIST_COLUMNS} ${TICKET_LIST_JOINS} WHERE ${whereSql}
        ORDER BY ${SORTS[q.sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows, total: Number(count.rows[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
  });

  app.get('/api/support/agents', { preHandler: support }, async () => {
    const { rows } = await pool.query(
      `SELECT sub, display_name, email FROM user_profiles
        WHERE roles && ARRAY['first-level','admin']::text[] ORDER BY display_name`,
    );
    return rows;
  });

  app.get('/api/support/solutions', { preHandler: support }, async (req) => {
    const { category } = z.object({ category: z.string().regex(/^[a-z0-9-]{2,40}$/).optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, category_id, title, body FROM standard_solutions
        WHERE active AND ($1::text IS NULL OR category_id = $1 OR category_id IS NULL) ORDER BY title`,
      [category ?? null],
    );
    return rows;
  });

  // ---- Zuweisen / Annehmen -------------------------------------------------
  app.post('/api/support/tickets/:id/assign', { preHandler: support }, async (req) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = AssignBody.parse(req.body);
    return withTx(pool, async (c) => {
      const t = await lockTicketForUser(c, id, user);
      if (t.version !== body.version) throw conflict();
      if (body.assigneeSub) {
        const agent = await c.query(
          `SELECT 1 FROM user_profiles WHERE sub = $1 AND roles && ARRAY['first-level','admin']::text[]`,
          [body.assigneeSub],
        );
        if (!agent.rowCount) throw new HttpError(422, 'Zuweisung nur an Support-Mitarbeitende möglich', 'invalid_assignee');
      }
      // Annahme eines neuen Tickets setzt es automatisch auf "In Bearbeitung"
      const autoStart = t.status === 'new' && body.assigneeSub !== null;
      const { rows } = await c.query<{ version: number }>(
        `UPDATE tickets SET assignee_sub = $2,
                status = CASE WHEN $3::boolean THEN 'in_progress' ELSE status END,
                version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING version`,
        [id, body.assigneeSub, autoStart],
      );
      await addEvent(c, id, user.sub, 'assigned', t.assignee_sub, body.assigneeSub);
      if (autoStart) await addEvent(c, id, user.sub, 'status', 'new', 'in_progress');
      await writeAudit(c, req, {
        action: 'ticket.assign', entityType: 'ticket', entityId: t.number,
        details: { from: t.assignee_sub, to: body.assigneeSub },
      });
      return { version: rows[0]!.version };
    });
  });

  // ---- Priorität ändern (SLA wird neu berechnet) --------------------------
  app.post('/api/support/tickets/:id/priority', { preHandler: support }, async (req) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = PriorityBody.parse(req.body);
    return withTx(pool, async (c) => {
      const t = await lockTicketForUser(c, id, user);
      if (t.version !== body.version) throw conflict();
      const created = await c.query<{ created_at: Date }>('SELECT created_at FROM tickets WHERE id = $1', [id]);
      const sla = await slaFor(c, body.priority, created.rows[0]!.created_at);
      const { rows } = await c.query<{ version: number }>(
        `UPDATE tickets SET priority = $2, response_due_at = $3, due_at = $4, version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING version`,
        [id, body.priority, sla.responseDueAt, sla.dueAt],
      );
      await addEvent(c, id, user.sub, 'priority', t.priority, body.priority);
      await writeAudit(c, req, {
        action: 'ticket.priority', entityType: 'ticket', entityId: t.number, details: { from: t.priority, to: body.priority },
      });
      return { version: rows[0]!.version };
    });
  });

  // ---- Standardlösung anwenden --------------------------------------------
  app.post('/api/support/tickets/:id/apply-solution', { preHandler: support }, async (req) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = SolutionBody.parse(req.body);
    return withTx(pool, async (c) => {
      const t = await lockTicketForUser(c, id, user);
      if (t.version !== body.version) throw conflict();
      const sol = await c.query<{ title: string; body: string }>(
        'SELECT title, body FROM standard_solutions WHERE id = $1 AND active',
        [body.solutionId],
      );
      const s = sol.rows[0];
      if (!s) throw notFound();
      const targets = allowedTargets(await loadTransitions(c), t.status, user, false);
      if (!targets.includes('resolved')) {
        throw new HttpError(422, 'Aus dem aktuellen Status kann nicht auf „Gelöst“ gewechselt werden', 'invalid_transition');
      }
      await c.query(
        'INSERT INTO ticket_comments (ticket_id, author_sub, author_role, body, internal) VALUES ($1,$2,$3,$4,false)',
        [id, user.sub, primaryRole(user), s.body],
      );
      await markFirstResponse(c, t, user);
      const { rows } = await c.query<{ version: number }>(
        `UPDATE tickets SET status = $2, ${statusTimestampsSql('$2')},
                assignee_sub = COALESCE(assignee_sub, $3), version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING version`,
        [id, 'resolved', user.sub],
      );
      await addEvent(c, id, user.sub, 'solution', null, s.title);
      await addEvent(c, id, user.sub, 'status', t.status, 'resolved');
      await writeAudit(c, req, {
        action: 'ticket.solution', entityType: 'ticket', entityId: t.number, details: { solution: body.solutionId, from: t.status },
      });
      return { version: rows[0]!.version };
    });
  });
}
