import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireRole, ROLES } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { FormSchema } from '../formSchema.js';
import { APP_VERSION } from '../config.js';
import { HttpError, likeEscape, line, notFound, pagination, priority, text, uuid } from '../util.js';

const CategoryBody = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: line(1, 80),
  description: text(0, 500).default(''),
  icon: z.string().regex(/^[a-z_]{2,40}$/).default('help'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
}).strict();

const ItemBody = z.object({
  categoryId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: line(1, 120),
  description: text(0, 1000).default(''),
  formSchema: FormSchema,
  defaultPriority: priority.default('medium'),
  requiresApproval: z.boolean().default(false),
  popular: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
}).strict();

const SlaBody = z.object({
  name: line(1, 80),
  responseMinutes: z.number().int().min(1).max(525_600),
  resolutionMinutes: z.number().int().min(1).max(525_600),
  businessHoursOnly: z.boolean(),
}).strict().refine((b) => b.resolutionMinutes >= b.responseMinutes, 'Lösungszeit muss ≥ Reaktionszeit sein');

const StatusBody = z.object({
  label: line(1, 60),
  description: text(0, 300).default(''),
  colorRole: z.enum(['neutral', 'primary', 'secondary', 'tertiary', 'success', 'warning', 'error']),
}).strict();

const TransitionsBody = z.object({
  transitions: z.array(z.object({
    from: z.string().regex(/^[a-z_]{2,32}$/),
    to: z.string().regex(/^[a-z_]{2,32}$/),
    role: z.enum(ROLES),
  }).strict()).max(500),
}).strict();

const SolutionBody = z.object({
  categoryId: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable(),
  title: line(1, 120),
  body: text(1, 5000),
  active: z.boolean().default(true),
}).strict();

const AuditQuery = pagination.extend({
  action: z.string().regex(/^[a-z_.]{1,64}$/).optional(),
  actor: z.string().max(255).optional(),
  entity: z.string().max(100).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict();

export async function adminRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const admin = requireRole(pool, 'admin');
  const opts = { preHandler: admin };

  // ---------------------------------------------------------------- Kategorien
  app.get('/api/admin/categories', opts, async () =>
    (await pool.query('SELECT id, name, description, icon, sort_order, active FROM categories ORDER BY sort_order, name')).rows);

  app.put('/api/admin/categories/:id', opts, async (req) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) }).parse(req.params);
    const b = CategoryBody.parse(req.body);
    if (b.id !== id) throw new HttpError(400, 'ID passt nicht zur URL', 'bad_request');
    return withTx(pool, async (c) => {
      await c.query(
        `INSERT INTO categories (id, name, description, icon, sort_order, active) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, icon=$4, sort_order=$5, active=$6, updated_at=now()`,
        [b.id, b.name, b.description, b.icon, b.sortOrder, b.active],
      );
      await writeAudit(c, req, { action: 'admin.category.upsert', entityType: 'category', entityId: id, details: { name: b.name, active: b.active } });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ Katalog
  app.get('/api/admin/catalog-items', opts, async () =>
    (await pool.query(
      `SELECT id, category_id, name, description, form_schema, default_priority, requires_approval, popular, sort_order, active, updated_at
         FROM catalog_items ORDER BY category_id, sort_order, name`,
    )).rows);

  app.post('/api/admin/catalog-items', opts, async (req, reply) => {
    const b = ItemBody.parse(req.body);
    const row = await withTx(pool, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO catalog_items (category_id, name, description, form_schema, default_priority, requires_approval, popular, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [b.categoryId, b.name, b.description, JSON.stringify(b.formSchema), b.defaultPriority, b.requiresApproval, b.popular, b.sortOrder, b.active],
      );
      await writeAudit(c, req, { action: 'admin.catalog.create', entityType: 'catalog_item', entityId: rows[0]!.id, details: { name: b.name } });
      return rows[0];
    });
    reply.code(201);
    return row;
  });

  app.put('/api/admin/catalog-items/:id', opts, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = ItemBody.parse(req.body);
    return withTx(pool, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE catalog_items SET category_id=$2, name=$3, description=$4, form_schema=$5, default_priority=$6,
                requires_approval=$7, popular=$8, sort_order=$9, active=$10, updated_at=now() WHERE id=$1`,
        [id, b.categoryId, b.name, b.description, JSON.stringify(b.formSchema), b.defaultPriority, b.requiresApproval, b.popular, b.sortOrder, b.active],
      );
      if (!rowCount) throw notFound();
      await writeAudit(c, req, { action: 'admin.catalog.update', entityType: 'catalog_item', entityId: id, details: { name: b.name, active: b.active, fields: b.formSchema.fields.length } });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------------- SLA
  app.get('/api/admin/sla', opts, async () =>
    (await pool.query(
      `SELECT priority, name, response_minutes, resolution_minutes, business_hours_only, updated_at FROM sla_policies
        ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
    )).rows);

  app.put('/api/admin/sla/:priority', opts, async (req) => {
    const p = z.object({ priority }).parse(req.params).priority;
    const b = SlaBody.parse(req.body);
    return withTx(pool, async (c) => {
      await c.query(
        `UPDATE sla_policies SET name=$2, response_minutes=$3, resolution_minutes=$4, business_hours_only=$5, updated_at=now()
          WHERE priority=$1`,
        [p, b.name, b.responseMinutes, b.resolutionMinutes, b.businessHoursOnly],
      );
      await writeAudit(c, req, { action: 'admin.sla.update', entityType: 'sla', entityId: p, details: b });
      return { ok: true };
    });
  });

  // ------------------------------------------------------- Status & Workflow
  app.get('/api/admin/workflow', opts, async () => {
    const statuses = await pool.query('SELECT code, label, description, color_role, is_final, sort_order FROM ticket_statuses ORDER BY sort_order');
    const transitions = await pool.query('SELECT from_status AS "from", to_status AS "to", allowed_role AS role FROM status_transitions ORDER BY 1,2,3');
    return { statuses: statuses.rows, transitions: transitions.rows };
  });

  app.put('/api/admin/statuses/:code', opts, async (req) => {
    const { code } = z.object({ code: z.string().regex(/^[a-z_]{2,32}$/) }).parse(req.params);
    const b = StatusBody.parse(req.body);
    return withTx(pool, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE ticket_statuses SET label=$2, description=$3, color_role=$4, updated_at=now() WHERE code=$1',
        [code, b.label, b.description, b.colorRole],
      );
      if (!rowCount) throw notFound();
      await writeAudit(c, req, { action: 'admin.status.update', entityType: 'status', entityId: code, details: b });
      return { ok: true };
    });
  });

  app.put('/api/admin/transitions', opts, async (req) => {
    const b = TransitionsBody.parse(req.body);
    return withTx(pool, async (c) => {
      const codes = new Set((await c.query<{ code: string }>('SELECT code FROM ticket_statuses')).rows.map((r) => r.code));
      for (const t of b.transitions) {
        if (!codes.has(t.from) || !codes.has(t.to) || t.from === t.to) {
          throw new HttpError(422, `Ungültiger Übergang ${t.from} → ${t.to}`, 'invalid_transition');
        }
      }
      // Schutz vor Aussperren: Support muss "new" verlassen können
      if (!b.transitions.some((t) => t.from === 'new' && t.role !== 'user')) {
        throw new HttpError(422, 'Mindestens ein Übergang aus „Neu“ für den Support ist erforderlich', 'invalid_workflow');
      }
      const before = (await c.query('SELECT count(*)::int AS n FROM status_transitions')).rows[0];
      await c.query('DELETE FROM status_transitions');
      for (const t of b.transitions) {
        await c.query(
          'INSERT INTO status_transitions (from_status, to_status, allowed_role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [t.from, t.to, t.role],
        );
      }
      await writeAudit(c, req, {
        action: 'admin.workflow.update', entityType: 'workflow', entityId: 'transitions',
        details: { before: before?.n, after: b.transitions.length },
      });
      return { ok: true };
    });
  });

  // -------------------------------------------------------- Standardlösungen
  app.get('/api/admin/solutions', opts, async () =>
    (await pool.query('SELECT id, category_id, title, body, active, updated_at FROM standard_solutions ORDER BY title')).rows);

  app.post('/api/admin/solutions', opts, async (req, reply) => {
    const b = SolutionBody.parse(req.body);
    const row = await withTx(pool, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'INSERT INTO standard_solutions (category_id, title, body, active) VALUES ($1,$2,$3,$4) RETURNING id',
        [b.categoryId, b.title, b.body, b.active],
      );
      await writeAudit(c, req, { action: 'admin.solution.create', entityType: 'solution', entityId: rows[0]!.id, details: { title: b.title } });
      return rows[0];
    });
    reply.code(201);
    return row;
  });

  app.put('/api/admin/solutions/:id', opts, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = SolutionBody.parse(req.body);
    return withTx(pool, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE standard_solutions SET category_id=$2, title=$3, body=$4, active=$5, updated_at=now() WHERE id=$1',
        [id, b.categoryId, b.title, b.body, b.active],
      );
      if (!rowCount) throw notFound();
      await writeAudit(c, req, { action: 'admin.solution.update', entityType: 'solution', entityId: id, details: { title: b.title, active: b.active } });
      return { ok: true };
    });
  });

  // ------------------------------------------------------ Rollen / Mappings
  app.get('/api/admin/roles', opts, async () => {
    const users = await pool.query<{ sub: string; username: string; display_name: string; roles: string[]; last_seen: string }>(
      'SELECT sub, username, display_name, roles, last_seen FROM user_profiles ORDER BY last_seen DESC LIMIT 500',
    );
    const counts = Object.fromEntries(ROLES.map((r) => [r, users.rows.filter((u) => u.roles.includes(r)).length]));
    const warnings: string[] = [];
    if (counts['admin'] === 0) warnings.push('Kein Benutzer mit Rolle „admin“ hat sich bisher angemeldet.');
    if ((counts['admin'] ?? 0) > 5) warnings.push('Mehr als 5 Administratoren – Least-Privilege-Prinzip prüfen.');
    const stale = users.rows.filter((u) => u.roles.includes('admin') && Date.now() - new Date(u.last_seen).getTime() > 90 * 86_400_000);
    if (stale.length) warnings.push(`${stale.length} Administrator(en) seit über 90 Tagen inaktiv – Rezertifizierung empfohlen.`);
    return {
      expectedRoles: [
        { role: 'user', keycloakGroup: '/Mitarbeitende', description: 'Requests erstellen, eigene Tickets einsehen/kommentieren' },
        { role: 'first-level', keycloakGroup: '/IT-UHD', description: 'Tickets sichten, zuweisen, bearbeiten, interne Notizen' },
        { role: 'admin', keycloakGroup: '/IT-Portal-Admins', description: 'Katalog, Workflow, SLA, Audit, Systemansicht' },
      ],
      counts,
      warnings,
      users: users.rows,
    };
  });

  // ------------------------------------------------------------------ Audit
  app.get('/api/admin/audit', opts, async (req) => {
    const q = AuditQuery.parse(req.query);
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.action) add(`action LIKE ? ESCAPE '\\'`, `${likeEscape(q.action)}%`);
    if (q.actor) {
      params.push(q.actor, `%${likeEscape(q.actor)}%`);
      where.push(`(actor_sub = $${params.length - 1} OR actor_name ILIKE $${params.length})`);
    }
    if (q.entity) add('entity_id = ?', q.entity);
    if (q.outcome) add('outcome = ?', q.outcome);
    if (q.from) add('ts >= ?', q.from);
    if (q.to) add('ts <= ?', q.to);
    const w = where.join(' AND ');
    const total = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE ${w}`, params);
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await pool.query(
      `SELECT id, ts, request_id, actor_sub, actor_name, actor_roles, action, entity_type, entity_id, outcome,
              host(client_ip) AS client_ip, details
         FROM audit_log WHERE ${w} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows, total: Number(total.rows[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
  });

  /** Prüft die Hash-Kette des Audit-Logs (Integritätsnachweis). */
  app.get('/api/admin/audit/verify', opts, async (req) => {
    let prev: string | null = null;
    let lastId = 0;
    let checked = 0;
    let firstBroken: number | null = null;
    for (;;) {
      const { rows } = await pool.query<{
        id: string; ts_text: string; actor_sub: string | null; action: string; entity_type: string;
        entity_id: string | null; outcome: string; details_text: string; prev_hash: string; row_hash: string;
      }>(
        `SELECT id, (ts AT TIME ZONE 'UTC')::text AS ts_text, actor_sub, action, entity_type, entity_id, outcome, details::text AS details_text,
                prev_hash, row_hash
           FROM audit_log WHERE id > $1 ORDER BY id LIMIT 2000`,
        [lastId],
      );
      if (!rows.length) break;
      for (const r of rows) {
        // Nach Retention-Löschungen beginnt die Kette beim ältesten verbliebenen Eintrag
        const expectedPrev = prev ?? r.prev_hash;
        const material = [r.prev_hash, r.ts_text, r.actor_sub ?? '', r.action, r.entity_type, r.entity_id ?? '', r.outcome, r.details_text].join('|');
        const hash = createHash('sha256').update(material, 'utf8').digest('hex');
        if ((hash !== r.row_hash || r.prev_hash !== expectedPrev) && firstBroken === null) firstBroken = Number(r.id);
        prev = r.row_hash;
        lastId = Number(r.id);
        checked++;
      }
    }
    await writeAudit(pool, req, { action: 'admin.audit.verify', entityType: 'audit_log', outcome: firstBroken ? 'failure' : 'success', details: { checked, firstBroken } });
    return { checked, intact: firstBroken === null, firstBrokenId: firstBroken };
  });

  // ------------------------------------------------------------- Systemsicht
  app.get('/api/admin/system', opts, async () => {
    const db = await pool.query<{ version: string }>('SELECT version()');
    const migrations = await pool.query('SELECT name, applied_at FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] }));
    const counts = await pool.query(
      `SELECT (SELECT count(*) FROM tickets) AS tickets,
              (SELECT count(*) FROM tickets t JOIN ticket_statuses s ON s.code=t.status WHERE NOT s.is_final) AS open_tickets,
              (SELECT count(*) FROM user_profiles) AS users,
              (SELECT count(*) FROM audit_log) AS audit_entries,
              (SELECT count(*) FROM catalog_items WHERE active) AS active_items`,
    );
    return {
      version: APP_VERSION,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      database: db.rows[0]?.version.split(',')[0],
      migrations: migrations.rows,
      counts: counts.rows[0],
      retention: {
        ticketDays: Number(process.env['RETENTION_TICKET_DAYS'] ?? 1095),
        auditDays: Number(process.env['RETENTION_AUDIT_DAYS'] ?? 365),
        ipDays: Number(process.env['RETENTION_IP_DAYS'] ?? 90),
      },
    };
  });
}
