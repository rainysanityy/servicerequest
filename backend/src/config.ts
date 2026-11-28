import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Zentrale, validierte Konfiguration. Die Anwendung startet nicht, wenn
 * Pflichtwerte fehlen oder ungültig sind (Fail-Secure).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_ORIGIN: z.string().url().optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).default('portal-api'),
  OIDC_ALLOWED_AZP: z.string().min(1).default('portal-frontend'),
  DB_HOST: z.string().min(1).default('db'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().min(1).default('portal'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().optional(),
  DB_PASSWORD_FILE: z.string().optional(),
  DB_SSLMODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10000).default(300),
  RETENTION_TICKET_DAYS: z.coerce.number().int().min(30).default(1095),
  RETENTION_AUDIT_DAYS: z.coerce.number().int().min(30).default(365),
  RETENTION_IP_DAYS: z.coerce.number().int().min(7).default(90),
  MIGRATIONS_DIR: z.string().default('/app/migrations'),
  // Keycloak-Admin-API (Benutzer & Rollen). Ohne Secret ist die Funktion deaktiviert.
  KEYCLOAK_INTERNAL_URL: z.string().url().default('http://keycloak:8080/auth'),
  KEYCLOAK_REALM: z.string().regex(/^[a-z0-9-]{1,64}$/).default('itportal'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('portal-admin-api'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  // TLS-Zertifikat per Admin-Oberfläche (Volume "tls", vom Proxy gelesen)
  TLS_DIR: z.string().min(1).default('/tls'),
  PROXY_TLS_ADDR: z.string().regex(/^[a-z0-9.-]+:\d{2,5}$/).default('proxy:8443'),
  // Kommagetrennte E-Mail-Domains für Mitarbeitende (Selbstregistrierung). Leer = keine Einschränkung.
  ALLOWED_EMAIL_DOMAINS: z.string().default('').transform((v) =>
    v.split(',').map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))),
});

export type Env = z.infer<typeof EnvSchema>;

function readSecret(env: Env): string {
  if (env.DB_PASSWORD_FILE) {
    return readFileSync(env.DB_PASSWORD_FILE, 'utf8').trim();
  }
  if (env.DB_PASSWORD) return env.DB_PASSWORD;
  throw new Error('DB_PASSWORD_FILE oder DB_PASSWORD muss gesetzt sein');
}

export interface AppConfig {
  env: Env;
  dbPassword: string;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env, requireOidc = true): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ungültige Konfiguration: ${issues}`);
  }
  const env = parsed.data;
  if (requireOidc && (!env.OIDC_ISSUER || !env.OIDC_JWKS_URL || !env.PUBLIC_ORIGIN)) {
    throw new Error('OIDC_ISSUER, OIDC_JWKS_URL und PUBLIC_ORIGIN sind Pflichtwerte');
  }
  return { env, dbPassword: readSecret(env) };
}

export const APP_VERSION = '1.1.0';
