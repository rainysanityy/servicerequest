import { access, constants, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect } from 'node:tls';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { mustUser, requireRole } from '../auth.js';
import { writeAudit } from '../audit.js';
import { checkServerCertificate, describePem, parsePkcs12, P12Error, type CertInfo } from '../pkcs12.js';
import { HttpError, text } from '../util.js';

/**
 * TLS-Serverzertifikat des Portals per PKCS#12 (.p12/.pfx) austauschen – nur Administration.
 *
 * Ablauf: Datei + Passwort → Prüfung (Schlüssel passt, Hostname, Laufzeit, Schlüsselstärke, EKU)
 * → bei "install" Ablage als PEM im Volume `tls` (nur Backend schreibt, Proxy liest) → der Proxy
 * übernimmt das Zertifikat innerhalb von ~15 s, prüft die Konfiguration (nginx -t) und lädt neu;
 * bei Fehlern behält er das bisherige Zertifikat. Passwort und Schlüssel werden nie protokolliert.
 */
const UploadBody = z.object({
  p12: z.string().min(16).max(90_000).regex(/^[A-Za-z0-9+/=\s]+$/, 'Base64 erwartet'),
  password: z.string().max(256),
  install: z.boolean().default(false),
  reason: text(0, 300).default(''),
}).strict();
const RevertBody = z.object({ reason: text(0, 300).default('') }).strict();

interface Meta { fingerprint256: string; uploadedAt: string; uploadedBy: string; info: CertInfo }

export interface TlsOptions { pool: pg.Pool; dir: string; hostname: string | null; proxyAddr: string }

/** Liefert das aktuell vom Proxy ausgelieferte Zertifikat (TLS-Handshake mit SNI). */
function activeCertificate(addr: string, servername: string): Promise<CertInfo | null> {
  const [host, port] = addr.split(':');
  return new Promise((resolve) => {
    const sock = connect({ host, port: Number(port ?? 8443), servername, rejectUnauthorized: false, timeout: 3000 });
    const done = (v: CertInfo | null) => { sock.destroy(); resolve(v); };
    sock.once('secureConnect', () => {
      try {
        const x = sock.getPeerX509Certificate();
        done(x ? describePem(x.toString()) : null);
      } catch { done(null); }
    });
    sock.once('timeout', () => done(null));
    sock.once('error', () => done(null));
  });
}

export async function tlsRoutes(app: FastifyInstance, opts: TlsOptions) {
  const { pool, dir, hostname, proxyAddr } = opts;
  const admin = requireRole(pool, 'admin');
  const metaPath = join(dir, 'meta.json');

  const readMeta = async (): Promise<Meta | null> => {
    try { return JSON.parse(await readFile(metaPath, 'utf8')) as Meta; } catch { return null; }
  };
  const writable = async () => { try { await access(dir, constants.W_OK); return true; } catch { return false; } };
  const atomic = async (name: string, data: string, mode: number) => {
    const tmp = join(dir, `.${name}.tmp`);
    await writeFile(tmp, data, { mode });
    await rename(tmp, join(dir, name));
  };

  app.get('/api/admin/tls', { preHandler: admin }, async () => {
    const [meta, canWrite, active] = await Promise.all([
      readMeta(), writable(), hostname ? activeCertificate(proxyAddr, hostname) : Promise.resolve(null),
    ]);
    return {
      hostname,
      enabled: Boolean(hostname) && canWrite,
      active,
      uploaded: meta,
      // aktiv = hochgeladenes Zertifikat, sobald der Proxy es übernommen hat
      activeSource: active && meta && active.fingerprint256 === meta.fingerprint256 ? 'uploaded' : active ? 'server' : null,
    };
  });

  app.post('/api/admin/tls', {
    preHandler: admin,
    bodyLimit: 128 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const user = mustUser(req);
    if (!hostname) throw new HttpError(503, 'PUBLIC_ORIGIN ist nicht gesetzt – Hostname unbekannt', 'not_configured');
    const body = UploadBody.parse(req.body);
    const raw = Buffer.from(body.p12.replace(/\s+/g, ''), 'base64');

    let result;
    try {
      result = checkServerCertificate(parsePkcs12(raw, body.password), hostname);
    } catch (e) {
      if (e instanceof P12Error) {
        if (body.install) {
          await writeAudit(pool, req, { action: 'admin.tls.install', entityType: 'tls', outcome: 'failure', details: { reason: e.code } });
        }
        throw new HttpError(422, e.message, e.code);
      }
      throw e;
    }
    const response = { ok: result.ok, errors: result.errors, warnings: result.warnings, info: result.info, installed: false };
    if (!body.install || !result.ok) {
      if (body.install) {
        await writeAudit(pool, req, { action: 'admin.tls.install', entityType: 'tls', outcome: 'failure', details: { errors: result.errors } });
      }
      return response;
    }
    if (!(await writable())) throw new HttpError(503, 'Zertifikatsablage ist nicht beschreibbar (Volume „tls“ fehlt)', 'not_configured');

    // Reihenfolge: Schlüssel → Zertifikat → meta.json (der Proxy reagiert auf meta.json)
    // Volume-Verzeichnis ist 0750 (Gruppe 101 = nginx); Dateien darin für den Proxy lesbar
    await atomic('tls.key', result.keyPem, 0o644);
    await atomic('tls.crt', result.certPem, 0o644);
    const meta: Meta = {
      fingerprint256: result.info!.fingerprint256,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.username,
      info: result.info!,
    };
    await atomic('meta.json', JSON.stringify(meta, null, 2), 0o644);
    await writeAudit(pool, req, {
      action: 'admin.tls.install', entityType: 'tls', entityId: result.info!.fingerprint256.slice(0, 59),
      details: {
        subject: result.info!.subject, issuer: result.info!.issuer, validTo: result.info!.validTo,
        serial: result.info!.serialNumber, warnings: result.warnings.length, reason: body.reason,
      },
    });
    return { ...response, installed: true };
  });

  /** Hochgeladenes Zertifikat entfernen → Proxy verwendet wieder das Server-Zertifikat (proxy/certs). */
  app.post('/api/admin/tls/revert', { preHandler: admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = RevertBody.parse(req.body ?? {});
    const meta = await readMeta();
    if (!meta) throw new HttpError(409, 'Es ist kein hochgeladenes Zertifikat vorhanden', 'conflict');
    await rm(metaPath, { force: true }); // zuerst meta.json: Proxy schaltet um
    await rm(join(dir, 'tls.crt'), { force: true });
    await rm(join(dir, 'tls.key'), { force: true });
    await writeAudit(pool, req, {
      action: 'admin.tls.remove', entityType: 'tls', entityId: meta.fingerprint256.slice(0, 59), details: { reason: body.reason },
    });
    return { ok: true };
  });
}
