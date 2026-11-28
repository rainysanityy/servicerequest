import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { mustUser, requireRole } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { parseFormData } from '../formSchema.js';
import {
  addEvent, assertNotFinal, changeStatus, getTicketDetail, lockTicketForUser, markFirstResponse, primaryRole,
  TICKET_LIST_COLUMNS, TICKET_LIST_JOINS,
} from '../ticketService.js';
import { HttpError, likeEscape, line, notFound, pagination, text, uuid, type Priority } from '../util.js';
import { slaFor } from '../workflow.js';

const CreateTicket = z
  .object({
    catalogItemId: uuid,
    title: line(3, 160),
    description: text(0, 5000).default(''),
    formData: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const ListQuery = pagination
  .extend({
    state: z.enum(['open', 'closed', 'all']).default('all'),
    status: z.string().regex(/^[a-z_]{2,32}$/).optional(),
    q: z.string().max(100).optional(),
  })
  .strict();

const CommentBody = z.object({ body: text(1, 5000), internal: z.boolean().default(false) }).strict();
const TransitionBody = z.object({
  to: z.string().regex(/^[a-z_]{2,32}$/),
  version: z.number().int().min(1),
  comment: text(1, 5000).optional(),
}).strict();
const IdParam = z.object({ id: uuid }).strict();

export async function ticketRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const anyRole = requireRole(pool, 'user', 'first-level', 'admin');

  // ---- Ticket anlegen ------------------------------------------------------
  app.post('/api/tickets', {
    preHandler: anyRole,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = mustUser(req);
    const body = CreateTicket.parse(req.body);

    const result = await withTx(pool, async (c) => {
      const item = await c.query<{ id: string; category_id: string; form_schema: unknown; default_priority: Priority; requires_approval: boolean }>(
        `SELECT ci.id, ci.category_id, ci.form_schema, ci.default_priority, ci.requires_approval
           FROM catalog_items ci JOIN categories cat ON cat.id = ci.category_id
          WHERE ci.id = $1 AND ci.active AND cat.active`,
        [body.catalogItemId],
      );
      const it = item.rows[0];
      if (!it) throw new HttpError(422, 'Katalogeintrag nicht verfügbar', 'invalid_item');

      // Serverseitige Validierung gegen die Formulardefinition (nie dem Client vertrauen)
      const formData = parseFormData(it.form_schema, body.formData);
      let prio: Priority = it.default_priority;
      if (formData['blocking'] === true || formData['impact'] === 'many') prio = 'high';

      const now = new Date();
      const sla = await slaFor(c, prio, now);
      const ins = await c.query<{ id: string; number: string }>(
        `INSERT INTO tickets (requester_sub, category_id, catalog_item_id, title, description, form_data,
                              priority, status, response_due_at, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8,$9) RETURNING id, number`,
        [user.sub, it.category_id, it.id, body.title, body.description, JSON.stringify(formData), prio, sla.responseDueAt, sla.dueAt],
      );
      const t = ins.rows[0]!;
      await addEvent(c, t.id, user.sub, 'created', null, 'new');
      await writeAudit(c, req, {
        action: 'ticket.create', entityType: 'ticket', entityId: t.number,
        details: { category: it.category_id, item: it.id, priority: prio },
      });
      return t;
    });
    reply.code(201);
    return result;
  });

  // ---- Eigene Tickets auflisten -------------------------------------------
  app.get('/api/tickets', { preHandler: anyRole }, async (req) => {
    const user = mustUser(req);
    const q = ListQuery.parse(req.query);
    const where: string[] = ['t.requester_sub = $1'];
    const params: unknown[] = [user.sub];
    if (q.state === 'open') where.push('NOT s.is_final');
    if (q.state === 'closed') where.push('s.is_final');
    if (q.status) {
      params.push(q.status);
      where.push(`t.status = $${params.length}`);
    }
    if (q.q && q.q.trim()) {
      params.push(`%${likeEscape(q.q.trim())}%`);
      where.push(`(t.title ILIKE $${params.length} OR t.number ILIKE $${params.length})`);
    }
    const whereSql = where.join(' AND ');
    const count = await pool.query<{ n: string }>(`SELECT count(*) AS n ${TICKET_LIST_JOINS} WHERE ${whereSql}`, params);
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await pool.query(
      `SELECT ${TICKET_LIST_COLUMNS} ${TICKET_LIST_JOINS} WHERE ${whereSql}
        ORDER BY s.is_final, t.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows, total: Number(count.rows[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
  });

  // ---- Zusammenfassung für Startseite -------------------------------------
  app.get('/api/tickets/summary', { preHandler: anyRole }, async (req) => {
    const user = mustUser(req);
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE NOT s.is_final)                    AS open,
              count(*) FILTER (WHERE t.status = 'waiting_for_user')    AS waiting_for_me,
              count(*) FILTER (WHERE t.status = 'resolved')            AS to_confirm,
              count(*) FILTER (WHERE s.is_final)                       AS closed
         FROM tickets t JOIN ticket_statuses s ON s.code = t.status
        WHERE t.requester_sub = $1`,
      [user.sub],
    );
    return rows[0];
  });

  // ---- Detail --------------------------------------------------------------
  app.get('/api/tickets/:id', { preHandler: anyRole }, async (req) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    return getTicketDetail(pool, id, user);
  });

  // ---- Kommentar / Rückfrage beantworten ----------------------------------
  app.post('/api/tickets/:id/comments', {
    preHandler: anyRole,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = CommentBody.parse(req.body);

    await withTx(pool, async (c) => {
      const t = await lockTicketForUser(c, id, user);
      const isRequester = t.requester_sub === user.sub;
      const isSupport = user.roles.includes('first-level') || user.roles.includes('admin');
      if (body.internal && !isSupport) throw new HttpError(403, 'Interne Notizen sind dem Support vorbehalten', 'forbidden');
      const st = await c.query<{ is_final: boolean }>('SELECT is_final FROM ticket_statuses WHERE code = $1', [t.status]);
      assertNotFinal(!!st.rows[0]?.is_final);

      const role = isRequester && !isSupport ? 'user' : primaryRole(user);
      await c.query(
        'INSERT INTO ticket_comments (ticket_id, author_sub, author_role, body, internal) VALUES ($1,$2,$3,$4,$5)',
        [id, user.sub, role, body.body, body.internal],
      );
      await addEvent(c, id, user.sub, 'comment', null, body.internal ? 'internal' : 'public');
      if (!body.internal) await markFirstResponse(c, t, user);

      // Antwort auf Rückfrage -> Ticket geht automatisch zurück an den Support
      if (isRequester && t.status === 'waiting_for_user') {
        await c.query(
          `UPDATE tickets SET status = 'in_progress', version = version + 1, updated_at = now() WHERE id = $1`,
          [id],
        );
        await addEvent(c, id, user.sub, 'status', 'waiting_for_user', 'in_progress');
      } else {
        await c.query('UPDATE tickets SET updated_at = now(), version = version + 1 WHERE id = $1', [id]);
      }
      await writeAudit(c, req, {
        action: 'ticket.comment', entityType: 'ticket', entityId: t.number, details: { internal: body.internal },
      });
    });
    reply.code(201);
    return { ok: true };
  });

  // ---- Statuswechsel (Workflow-geprüft) ------------------------------------
  app.post('/api/tickets/:id/transition', { preHandler: anyRole }, async (req) => {
    const user = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = TransitionBody.parse(req.body);
    const exists = await pool.query('SELECT 1 FROM ticket_statuses WHERE code = $1', [body.to]);
    if (!exists.rowCount) throw notFound();
    return changeStatus(pool, req, user, id, body.to, body.version, body.comment);
  });
}
