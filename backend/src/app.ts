import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { ZodError } from 'zod';
import { registerAuth, type AuthOptions } from './auth.js';
import { HttpError } from './util.js';
import { catalogRoutes } from './routes/catalog.js';
import { ticketRoutes } from './routes/tickets.js';
import { supportRoutes } from './routes/support.js';
import { adminRoutes } from './routes/admin.js';
import { userRoutes } from './routes/users.js';
import { statsRoutes } from './routes/stats.js';
import type { KeycloakAdmin } from './keycloakAdmin.js';
import { tlsRoutes } from './routes/tls.js';

export interface BuildOptions {
  pool: pg.Pool;
  auth: AuthOptions;
  publicOrigin: string;
  logLevel?: string;
  rateLimitMax?: number;
  kc?: KeycloakAdmin | null;
  tls?: { dir: string; proxyAddr: string };
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? 'info',
      // Tokens/Cookies niemals loggen
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.split('?')[0], reqId: req.id }),
      },
    },
    // Genau ein vertrauenswürdiger Hop: der Reverse Proxy (überschreibt X-Forwarded-For)
    trustProxy: (_address: string, hop: number) => hop === 0,
    bodyLimit: 64 * 1024,
    maxParamLength: 100,
    disableRequestLogging: false,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID.test(h) ? h : randomUUID();
    },
  });

  // --- Security-Header (API liefert nur JSON) ------------------------------
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // --- Rate Limiting (zusätzlich zu nginx limit_req) -----------------------
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitMax ?? 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/api/health'),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'too_many_requests',
      message: `Zu viele Anfragen. Bitte in ${Math.ceil(ctx.ttl / 1000)} s erneut versuchen.`,
    }),
  });

  // --- Origin-Prüfung für zustandsändernde Requests (Defense in Depth / CSRF)
  app.addHook('onRequest', async (req) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== opts.publicOrigin) {
        throw new HttpError(403, 'Ungültiger Origin', 'bad_origin');
      }
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    return payload;
  });

  // --- Health (ohne Authentifizierung, ohne Details) -----------------------
  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      reply.code(503);
      return { status: 'unavailable' };
    }
  });

  registerAuth(app, opts.pool, opts.auth);

  await app.register(catalogRoutes, { pool: opts.pool });
  await app.register(ticketRoutes, { pool: opts.pool });
  await app.register(supportRoutes, { pool: opts.pool });
  await app.register(adminRoutes, { pool: opts.pool });
  await app.register(statsRoutes, { pool: opts.pool });
  await app.register(userRoutes, { pool: opts.pool, kc: opts.kc ?? null });
  let tlsHost: string | null = null;
  try { tlsHost = opts.publicOrigin ? new URL(opts.publicOrigin).hostname : null; } catch { tlsHost = null; }
  await app.register(tlsRoutes, {
    pool: opts.pool, hostname: tlsHost, dir: opts.tls?.dir ?? '/tls', proxyAddr: opts.tls?.proxyAddr ?? 'proxy:8443',
  });

  // --- Einheitliche Fehlerbehandlung, keine internen Details nach außen ----
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({
        error: 'validation_error',
        message: 'Eingaben ungültig',
        issues: err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.code, message: err.message });
      return;
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      reply.code(status).send({ error: 'bad_request', message: status === 429 ? (err as Error).message : 'Ungültige Anfrage' });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    reply.code(500).send({ error: 'internal_error', message: 'Interner Fehler', requestId: req.id });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found', message: 'Nicht gefunden' });
  });

  return app;
}
