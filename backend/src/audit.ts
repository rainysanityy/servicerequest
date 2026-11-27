import type { FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import type { DbClient } from './db.js';
import { sanitizeForLog } from './util.js';

export interface AuditEntry {
  action: string; // z. B. ticket.create, ticket.status, admin.catalog.update
  entityType: string;
  entityId?: string | null;
  outcome?: 'success' | 'denied' | 'failure';
  details?: Record<string, unknown>;
}

/**
 * Schreibt einen Audit-Eintrag (append-only, Hash-verkettet in der DB).
 * Enthält: wer (sub, Name, Rollen), wann (DB-Zeit), was (action/entity),
 * Ergebnis, Request-ID und Quell-IP (wird nach RETENTION_IP_DAYS entfernt).
 */
export async function writeAudit(db: DbClient, req: FastifyRequest | null, entry: AuditEntry): Promise<void> {
  const user = req?.user ?? null;
  const ip = req?.ip && isIP(req.ip) ? req.ip : null;
  await db.query(
    `INSERT INTO audit_log (request_id, actor_sub, actor_name, actor_roles, action, entity_type, entity_id, outcome, client_ip, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      req ? String(req.id).slice(0, 64) : null,
      user?.sub ?? null,
      user?.name ?? null,
      user?.roles ?? [],
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.outcome ?? 'success',
      ip,
      JSON.stringify(sanitizeForLog(entry.details ?? {})),
    ],
  );
  // Zusätzlich strukturiert ins Applikationslog (für SIEM), ohne Freitextinhalte
  req?.log.info(
    { audit: { action: entry.action, entity: entry.entityType, id: entry.entityId, outcome: entry.outcome ?? 'success', actor: user?.sub } },
    'audit',
  );
}
