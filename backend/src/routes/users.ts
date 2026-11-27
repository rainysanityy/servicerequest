import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { mustUser, requireRole } from '../auth.js';
import { writeAudit } from '../audit.js';
import { KeycloakAdmin, PORTAL_GROUPS, roleFromGroups, type PortalRole } from '../keycloakAdmin.js';
import { HttpError, text, uuid } from '../util.js';

const ListQuery = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const RoleBody = z.object({ role: z.enum(['user', 'first-level', 'admin']), reason: text(0, 300).default('') }).strict();
const EnabledBody = z.object({ enabled: z.boolean(), reason: text(0, 300).default('') }).strict();
const IdParam = z.object({ id: uuid }).strict();

const RANK: Record<PortalRole, number> = { user: 0, 'first-level': 1, admin: 2 };

/**
 * Benutzer- und Rollenverwaltung für Administratoren.
 * Rollen werden ausschließlich über die drei Portal-Gruppen in Keycloak abgebildet.
 */
export async function userRoutes(app: FastifyInstance, { pool, kc }: { pool: pg.Pool; kc: KeycloakAdmin | null }) {
  const admin = requireRole(pool, 'admin');
  const need = () => {
    if (!kc) throw new HttpError(503, 'Benutzerverwaltung ist nicht konfiguriert (KEYCLOAK_ADMIN_CLIENT_SECRET fehlt)', 'not_configured');
    return kc;
  };

  app.get('/api/admin/users/status', { preHandler: admin }, async () => ({ enabled: kc !== null }));

  app.get('/api/admin/users', { preHandler: admin }, async (req) => {
    const k = need();
    const q = ListQuery.parse(req.query);
    const [{ users, total }, admins, uhd] = await Promise.all([
      k.searchUsers((q.q ?? '').trim(), (q.page - 1) * q.pageSize, q.pageSize),
      k.groupMemberIds(PORTAL_GROUPS.admin),
      k.groupMemberIds(PORTAL_GROUPS['first-level']),
    ]);
    return {
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
        email: u.email ?? null,
        emailVerified: !!u.emailVerified,
        enabled: u.enabled,
        createdAt: u.createdTimestamp ? new Date(u.createdTimestamp).toISOString() : null,
        role: roleFromGroups(u.id, admins, uhd),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: { admin: admins.size, 'first-level': uhd.size },
    };
  });

  app.put('/api/admin/users/:id/role', { preHandler: admin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const k = need();
    const me = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = RoleBody.parse(req.body);
    const target = await k.getUser(id);
    const [admins, uhd] = await Promise.all([k.groupMemberIds(PORTAL_GROUPS.admin), k.groupMemberIds(PORTAL_GROUPS['first-level'])]);
    const current = roleFromGroups(id, admins, uhd);

    // Schutzregeln gegen Aussperren
    if (id === me.sub && RANK[body.role] < RANK.admin) {
      throw new HttpError(422, 'Sie können sich die eigene Administratorrolle nicht selbst entziehen', 'self_demotion');
    }
    if (current === 'admin' && body.role !== 'admin' && admins.size <= 1) {
      throw new HttpError(422, 'Der letzte Administrator kann nicht herabgestuft werden', 'last_admin');
    }
    if (current === body.role) return { role: current, changed: false };

    // Gruppen setzen: genau eine Portal-Rollengruppe (+ Mitarbeitende als Basis)
    await k.addToGroup(id, PORTAL_GROUPS.user);
    if (body.role === 'admin') {
      await k.addToGroup(id, PORTAL_GROUPS.admin);
      if (uhd.has(id)) await k.removeFromGroup(id, PORTAL_GROUPS['first-level']);
    } else if (body.role === 'first-level') {
      await k.addToGroup(id, PORTAL_GROUPS['first-level']);
      if (admins.has(id)) await k.removeFromGroup(id, PORTAL_GROUPS.admin);
    } else {
      if (admins.has(id)) await k.removeFromGroup(id, PORTAL_GROUPS.admin);
      if (uhd.has(id)) await k.removeFromGroup(id, PORTAL_GROUPS['first-level']);
    }
    // Rechteentzug sofort wirksam machen (bestehende Tokens/Sitzungen beenden)
    if (RANK[body.role] < RANK[current]) await k.logout(id);

    await writeAudit(pool, req, {
      action: 'admin.user.role', entityType: 'user', entityId: target.username,
      details: { from: current, to: body.role, reason: body.reason, sessionsRevoked: RANK[body.role] < RANK[current] },
    });
    return { role: body.role, changed: true };
  });

  app.put('/api/admin/users/:id/enabled', { preHandler: admin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const k = need();
    const me = mustUser(req);
    const { id } = IdParam.parse(req.params);
    const body = EnabledBody.parse(req.body);
    if (id === me.sub && !body.enabled) throw new HttpError(422, 'Sie können Ihr eigenes Konto nicht sperren', 'self_disable');
    const target = await k.getUser(id);
    if (!body.enabled) {
      const admins = await k.groupMemberIds(PORTAL_GROUPS.admin);
      if (admins.has(id) && admins.size <= 1) throw new HttpError(422, 'Der letzte Administrator kann nicht gesperrt werden', 'last_admin');
    }
    await k.setEnabled(id, body.enabled);
    if (!body.enabled) await k.logout(id);
    await writeAudit(pool, req, {
      action: body.enabled ? 'admin.user.enable' : 'admin.user.disable', entityType: 'user', entityId: target.username,
      details: { reason: body.reason },
    });
    return { enabled: body.enabled };
  });
}
