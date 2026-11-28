import { buildApp } from './app.js';
import { remoteJwks } from './auth.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { KeycloakAdmin } from './keycloakAdmin.js';

const cfg = loadConfig();
const { env } = cfg;
const pool = createPool(cfg);

const secret = env.KEYCLOAK_ADMIN_CLIENT_SECRET?.trim();
const kc = secret && secret.length >= 16 && !secret.includes('CHANGE_ME')
  ? new KeycloakAdmin({ baseUrl: env.KEYCLOAK_INTERNAL_URL, realm: env.KEYCLOAK_REALM, clientId: env.KEYCLOAK_ADMIN_CLIENT_ID, clientSecret: secret })
  : null;

const app = await buildApp({
  pool,
  kc,
  publicOrigin: env.PUBLIC_ORIGIN!,
  logLevel: env.LOG_LEVEL,
  rateLimitMax: env.RATE_LIMIT_MAX,
  tls: { dir: env.TLS_DIR, proxyAddr: env.PROXY_TLS_ADDR },
  auth: {
    issuer: env.OIDC_ISSUER!,
    audience: env.OIDC_AUDIENCE,
    allowedAzp: env.OIDC_ALLOWED_AZP,
    jwks: remoteJwks(env.OIDC_JWKS_URL!),
    allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS,
  },
});

// --- Tägliche Aufbewahrungs-/Löschroutine (Datenschutzkonzept) -------------
async function runRetention(): Promise<void> {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM apply_retention($1, $2, $3)',
      [env.RETENTION_TICKET_DAYS, env.RETENTION_AUDIT_DAYS, env.RETENTION_IP_DAYS],
    );
    app.log.info({ retention: rows[0] }, 'retention job finished');
    await pool.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES ('system.retention','system','retention',$1)`,
      [JSON.stringify(rows[0] ?? {})],
    );
  } catch (err) {
    app.log.error({ err }, 'retention job failed');
  }
}
const retentionTimer = setInterval(runRetention, 24 * 60 * 60 * 1000);
retentionTimer.unref();
setTimeout(runRetention, 60_000).unref();

// --- Graceful Shutdown -----------------------------------------------------
const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(retentionTimer);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
