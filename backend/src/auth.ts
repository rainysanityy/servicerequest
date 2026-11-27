import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import { cleanLine, forbidden, HttpError } from './util.js';
import { writeAudit } from './audit.js';

export const ROLES = ['user', 'first-level', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  sub: string;
  username: string;
  name: string;
  email: string | null;
  emailVerified?: boolean;
  roles: Role[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export interface AuthOptions {
  issuer: string;
  audience: string;
  allowedAzp: string;
  jwks: JWTVerifyGetKey;
  /** Erlaubte E-Mail-Domains für Konten, die nur die Rolle "user" haben (Selbstregistrierung). */
  allowedEmailDomains?: string[];
}

export function remoteJwks(url: string): JWTVerifyGetKey {
  // Fest konfigurierte JWKS-URL (kein Nutzer-Input -> kein SSRF)
  return createRemoteJWKSet(new URL(url), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
}

/** Extrahiert ausschließlich bekannte Realm-Rollen (Allowlist). */
export function extractRoles(payload: JWTPayload): Role[] {
  const realmAccess = payload['realm_access'] as { roles?: unknown } | undefined;
  const raw = Array.isArray(realmAccess?.roles) ? realmAccess.roles : [];
  const roles = raw.filter((r): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r));
  // Rollen-Hierarchie: admin ⊃ first-level ⊃ user (Portal-Sicht)
  const set = new Set<Role>(roles);
  if (set.has('admin')) set.add('first-level');
  if (set.has('first-level')) set.add('user');
  return [...set];
}

export async function verifyAccessToken(token: string, opts: AuthOptions): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, opts.jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: ['RS256', 'PS256', 'ES256'],
    clockTolerance: 30,
    requiredClaims: ['sub', 'exp', 'iat'],
  });
  if (payload['typ'] !== undefined && payload['typ'] !== 'Bearer') {
    throw new HttpError(401, 'Ungültiger Token-Typ', 'invalid_token');
  }
  if (payload['azp'] !== opts.allowedAzp) {
    throw new HttpError(401, 'Token wurde für einen anderen Client ausgestellt', 'invalid_token');
  }
  const sub = String(payload.sub);
  const username = cleanLine(String(payload['preferred_username'] ?? sub)).slice(0, 120);
  const name = cleanLine(String(payload['name'] ?? username)).slice(0, 160) || username;
  const emailRaw = payload['email'];
  const email = typeof emailRaw === 'string' ? cleanLine(emailRaw).slice(0, 254) : null;
  return { sub, username, name, email, emailVerified: payload['email_verified'] === true, roles: extractRoles(payload) };
}

const lastProfileSync = new Map<string, number>();
const PROFILE_SYNC_MS = 5 * 60_000;

async function syncProfile(pool: pg.Pool, user: AuthUser): Promise<void> {
  const now = Date.now();
  const last = lastProfileSync.get(user.sub);
  if (last && now - last < PROFILE_SYNC_MS) return;
  await pool.query(
    `INSERT INTO user_profiles (sub, username, display_name, email, roles)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (sub) DO UPDATE
       SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
           email = EXCLUDED.email, roles = EXCLUDED.roles, last_seen = now()`,
    [user.sub, user.username, user.name, user.email, user.roles],
  );
  lastProfileSync.set(user.sub, now);
  if (lastProfileSync.size > 50_000) lastProfileSync.clear();
}

/**
 * Registriert die Authentifizierung für alle /api-Routen außer /api/health*.
 * Jede Anfrage MUSS ein gültiges Bearer-Token tragen (Zero Trust).
 */
export function registerAuth(app: FastifyInstance, pool: pg.Pool, opts: AuthOptions): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return;

    const header = req.headers.authorization;
    if (!header || !/^Bearer [A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(header)) {
      throw new HttpError(401, 'Anmeldung erforderlich', 'unauthenticated');
    }
    try {
      req.user = await verifyAccessToken(header.slice(7), opts);
    } catch (err) {
      req.log.warn({ err: (err as Error).name }, 'token verification failed');
      throw new HttpError(401, 'Ungültiges oder abgelaufenes Token', 'invalid_token');
    }
    if (req.user.roles.length === 0) {
      await writeAudit(pool, req, {
        action: 'auth.denied', entityType: 'route', entityId: req.routeOptions.url ?? req.url, outcome: 'denied',
        details: { reason: 'no_portal_role' },
      });
      throw forbidden();
    }
    if (!emailDomainAllowed(req.user, opts.allowedEmailDomains)) {
      await writeAudit(pool, req, {
        action: 'auth.denied', entityType: 'user', entityId: req.user.username, outcome: 'denied',
        details: { reason: 'email_domain_or_unverified' },
      });
      throw new HttpError(403, 'Zugriff nur mit bestätigter geschäftlicher E-Mail-Adresse', 'email_domain');
    }
    await syncProfile(pool, req.user);
  });
}

/**
 * Selbst registrierte Konten (nur Rolle "user") benötigen eine bestätigte E-Mail-Adresse
 * aus einer erlaubten Domain. Support/Admin-Konten werden zentral vergeben und sind ausgenommen.
 */
export function emailDomainAllowed(user: AuthUser, domains: string[] | undefined): boolean {
  if (!domains || domains.length === 0) return true;
  if (user.roles.includes('first-level') || user.roles.includes('admin')) return true;
  if (!user.email || user.emailVerified !== true) return false;
  const domain = user.email.toLowerCase().split('@')[1] ?? '';
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** preHandler-Fabrik: verlangt mindestens eine der Rollen; protokolliert Ablehnungen. */
export function requireRole(pool: pg.Pool, ...allowed: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Anmeldung erforderlich', 'unauthenticated');
    if (!user.roles.some((r) => allowed.includes(r))) {
      await writeAudit(pool, req, {
        action: 'authz.denied',
        entityType: 'route',
        entityId: `${req.method} ${req.routeOptions.url ?? ''}`,
        outcome: 'denied',
        details: { required: allowed },
      });
      throw forbidden();
    }
  };
}

export function hasRole(user: AuthUser | null, ...roles: Role[]): boolean {
  return !!user && user.roles.some((r) => roles.includes(r));
}

export function mustUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new HttpError(401, 'Anmeldung erforderlich', 'unauthenticated');
  return req.user;
}
