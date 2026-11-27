import pg from 'pg';
import type { AppConfig } from './config.js';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(cfg: AppConfig): pg.Pool {
  const { env } = cfg;
  const ssl =
    env.DB_SSLMODE === 'disable'
      ? false
      : { rejectUnauthorized: env.DB_SSLMODE === 'verify-full' };
  const pool = new pg.Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: cfg.dbPassword,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'srp-backend',
    ssl,
  });
  pool.on('error', () => {
    /* Fehler einzelner Idle-Clients werden vom Pool behandelt */
  });
  return pool;
}

/** Führt fn in einer Transaktion aus (READ COMMITTED) und rollt bei Fehlern zurück. */
export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
