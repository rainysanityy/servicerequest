/**
 * Minimaler, transaktionaler Migrations-Runner.
 * - läuft als portal_migrator (Schema-Owner), getrennt von der App-Rolle
 * - jede Datei genau einmal, in lexikografischer Reihenfolge
 * - SHA-256-Prüfsumme verhindert unbemerkte Änderungen bereits angewandter Migrationen
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const cfg = loadConfig(process.env, false);
const pool = createPool(cfg);
const dir = cfg.env.MIGRATIONS_DIR;

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SET search_path = portal');
    await client.query('SELECT pg_advisory_lock(777001)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query('GRANT SELECT ON schema_migrations TO portal_app');

    const applied = new Map(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );
    const files = readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      const known = applied.get(file);
      if (known) {
        if (known !== sum) throw new Error(`Prüfsumme von ${file} hat sich geändert – Migrationen sind unveränderlich`);
        continue;
      }
      console.log(JSON.stringify({ level: 'info', msg: 'applying migration', file }));
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [file, sum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log(JSON.stringify({ level: 'info', msg: 'migrations complete', count: files.length }));
  } finally {
    await client.query('SELECT pg_advisory_unlock(777001)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error(JSON.stringify({ level: 'error', msg: 'migration failed', error: err.message }));
  process.exit(1);
});
