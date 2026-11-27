import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { mustUser, requireRole } from '../auth.js';
import { notFound, uuid } from '../util.js';

export async function catalogRoutes(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  const anyRole = requireRole(pool, 'user', 'first-level', 'admin');

  app.get('/api/me', { preHandler: anyRole }, async (req) => {
    const u = mustUser(req);
    return { sub: u.sub, username: u.username, name: u.name, email: u.email, roles: u.roles };
  });

  app.get('/api/catalog', { preHandler: anyRole }, async () => {
    const cats = await pool.query(
      'SELECT id, name, description, icon FROM categories WHERE active ORDER BY sort_order, name',
    );
    const items = await pool.query(
      `SELECT ci.id, ci.category_id, ci.name, ci.description, ci.requires_approval, ci.popular
         FROM catalog_items ci JOIN categories c ON c.id = ci.category_id
        WHERE ci.active AND c.active ORDER BY ci.sort_order, ci.name`,
    );
    return {
      categories: cats.rows.map((c: { id: string }) => ({
        ...c,
        items: items.rows.filter((i: { category_id: string }) => i.category_id === c.id),
      })),
    };
  });

  app.get('/api/catalog/items/:id', { preHandler: anyRole }, async (req) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.params);
    const { rows } = await pool.query(
      `SELECT ci.id, ci.category_id, c.name AS category_name, ci.name, ci.description, ci.form_schema,
              ci.requires_approval, ci.default_priority
         FROM catalog_items ci JOIN categories c ON c.id = ci.category_id
        WHERE ci.id = $1 AND ci.active AND c.active`,
      [id],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.get('/api/statuses', { preHandler: anyRole }, async () => {
    const { rows } = await pool.query(
      'SELECT code, label, description, color_role, is_final FROM ticket_statuses ORDER BY sort_order',
    );
    return rows;
  });
}
