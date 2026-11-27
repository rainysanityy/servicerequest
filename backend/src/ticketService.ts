import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { hasRole, type AuthUser } from './auth.js';
import { writeAudit } from './audit.js';
import { withTx, type DbClient } from './db.js';
import { conflict, forbidden, HttpError, notFound } from './util.js';
import { allowedTargets, loadTransitions, statusTimestampsSql } from './workflow.js';

export interface TicketRow {
  id: string;
  number: string;
  requester_sub: string;
  status: string;
  priority: string;
  assignee_sub: string | null;
  version: number;
  first_response_at: string | null;
}

export const TICKET_LIST_COLUMNS = `
  t.id, t.number, t.title, t.status, s.label AS status_label, s.color_role AS status_color, s.is_final,
  t.priority, t.category_id, c.name AS category_name, ci.name AS item_name,
  t.requester_sub, rp.display_name AS requester_name,
  t.assignee_sub, ap.display_name AS assignee_name,
  t.response_due_at, t.due_at, t.created_at, t.updated_at, t.resolved_at, t.closed_at, t.version,
  (NOT s.is_final AND t.status <> 'resolved' AND t.due_at IS NOT NULL AND t.due_at < now()) AS overdue`;

export const TICKET_LIST_JOINS = `
  FROM tickets t
  JOIN ticket_statuses s ON s.code = t.status
  JOIN categories c ON c.id = t.category_id
  LEFT JOIN catalog_items ci ON ci.id = t.catalog_item_id
  JOIN user_profiles rp ON rp.sub = t.requester_sub
  LEFT JOIN user_profiles ap ON ap.sub = t.assignee_sub`;

/** Lädt ein Ticket mit Sperre und prüft die Objektberechtigung (IDOR-Schutz). */
export async function lockTicketForUser(db: DbClient, id: string, user: AuthUser): Promise<TicketRow> {
  const { rows } = await db.query<TicketRow>(
    `SELECT id, number, requester_sub, status, priority, assignee_sub, version, first_response_at
       FROM tickets WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const t = rows[0];
  if (!t) throw notFound();
  if (t.requester_sub !== user.sub && !hasRole(user, 'first-level', 'admin')) {
    // 404 statt 403: Existenz fremder Tickets nicht offenlegen
    throw notFound();
  }
  return t;
}

export async function getTicketDetail(db: DbClient, id: string, user: AuthUser) {
  const isSupport = hasRole(user, 'first-level', 'admin');
  const { rows } = await db.query(
    `SELECT ${TICKET_LIST_COLUMNS}, t.description, t.form_data, t.first_response_at, t.anonymized,
            ci.form_schema, rp.email AS requester_email
       ${TICKET_LIST_JOINS}
      WHERE t.id = $1`,
    [id],
  );
  const ticket = rows[0] as Record<string, unknown> | undefined;
  if (!ticket) throw notFound();
  const isRequester = ticket['requester_sub'] === user.sub;
  if (!isRequester && !isSupport) throw notFound();

  const comments = await db.query(
    `SELECT c.id, c.body, c.internal, c.author_role, c.created_at, p.display_name AS author_name,
            (c.author_sub = $2) AS mine
       FROM ticket_comments c JOIN user_profiles p ON p.sub = c.author_sub
      WHERE c.ticket_id = $1 AND ($3::boolean OR NOT c.internal)
      ORDER BY c.created_at`,
    [id, user.sub, isSupport],
  );
  const events = await db.query(
    `SELECT e.event_type, e.from_value, e.to_value, e.created_at, p.display_name AS actor_name
       FROM ticket_events e LEFT JOIN user_profiles p ON p.sub = e.actor_sub
      WHERE e.ticket_id = $1 ORDER BY e.created_at`,
    [id],
  );
  const transitions = await loadTransitions(db);
  const targets = allowedTargets(transitions, String(ticket['status']), user, isRequester);
  const statuses = await db.query('SELECT code, label FROM ticket_statuses');
  const labelOf = new Map(statuses.rows.map((s: { code: string; label: string }) => [s.code, s.label]));

  if (!isSupport) {
    delete ticket['requester_email'];
  }
  return {
    ticket,
    comments: comments.rows,
    events: events.rows,
    allowedTransitions: targets.map((code) => ({ code, label: labelOf.get(code) ?? code })),
    canComment: !ticket['is_final'],
    canInternalComment: isSupport,
  };
}

export async function addEvent(
  db: DbClient,
  ticketId: string,
  actorSub: string | null,
  type: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  await db.query(
    'INSERT INTO ticket_events (ticket_id, actor_sub, event_type, from_value, to_value) VALUES ($1,$2,$3,$4,$5)',
    [ticketId, actorSub, type, from, to],
  );
}

/** Statuswechsel mit Workflow-Prüfung und optimistischer Sperre (version). */
export async function changeStatus(
  pool: pg.Pool,
  req: FastifyRequest,
  user: AuthUser,
  id: string,
  to: string,
  expectedVersion: number,
  comment?: string,
): Promise<{ version: number }> {
  return withTx(pool, async (c) => {
    const t = await lockTicketForUser(c, id, user);
    if (t.version !== expectedVersion) throw conflict();
    const transitions = await loadTransitions(c);
    const targets = allowedTargets(transitions, t.status, user, t.requester_sub === user.sub);
    if (!targets.includes(to)) {
      await writeAudit(c, req, {
        action: 'ticket.status', entityType: 'ticket', entityId: t.number, outcome: 'denied',
        details: { from: t.status, to },
      });
      throw new HttpError(422, 'Dieser Statuswechsel ist nicht zulässig', 'invalid_transition');
    }
    const { rows } = await c.query<{ version: number }>(
      `UPDATE tickets SET status = $2, ${statusTimestampsSql('$2')},
              version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING version`,
      [id, to],
    );
    await addEvent(c, id, user.sub, to === 'withdrawn' ? 'withdrawn' : 'status', t.status, to);
    if (comment) {
      const role = t.requester_sub === user.sub && !hasRole(user, 'first-level', 'admin') ? 'user' : primaryRole(user);
      await c.query(
        'INSERT INTO ticket_comments (ticket_id, author_sub, author_role, body, internal) VALUES ($1,$2,$3,$4,false)',
        [id, user.sub, role, comment],
      );
      await markFirstResponse(c, t, user);
    }
    await writeAudit(c, req, {
      action: 'ticket.status', entityType: 'ticket', entityId: t.number,
      details: { from: t.status, to, withComment: !!comment },
    });
    return { version: rows[0]!.version };
  });
}

export function primaryRole(user: AuthUser): 'admin' | 'first-level' | 'user' {
  if (user.roles.includes('admin')) return 'admin';
  if (user.roles.includes('first-level')) return 'first-level';
  return 'user';
}

export async function markFirstResponse(c: DbClient, t: TicketRow, user: AuthUser): Promise<void> {
  if (!t.first_response_at && t.requester_sub !== user.sub && hasRole(user, 'first-level', 'admin')) {
    await c.query('UPDATE tickets SET first_response_at = now() WHERE id = $1 AND first_response_at IS NULL', [t.id]);
  }
}

export function assertNotFinal(isFinal: boolean): void {
  if (isFinal) throw new HttpError(422, 'Das Ticket ist abgeschlossen', 'ticket_final');
}

export { forbidden };
