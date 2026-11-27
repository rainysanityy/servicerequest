import type { DbClient } from './db.js';
import type { AuthUser, Role } from './auth.js';
import type { Priority } from './util.js';

export interface Transition {
  from_status: string;
  to_status: string;
  allowed_role: Role;
}

/**
 * Ermittelt die für den Benutzer zulässigen Zielstatus.
 * - Rolle "user" gilt nur für eigene Tickets (Requester).
 * - Rollen "first-level"/"admin" gelten für alle Tickets.
 */
export function allowedTargets(
  transitions: Transition[],
  fromStatus: string,
  user: AuthUser,
  isRequester: boolean,
): string[] {
  const targets = new Set<string>();
  for (const t of transitions) {
    if (t.from_status !== fromStatus) continue;
    if (t.allowed_role === 'user') {
      if (isRequester) targets.add(t.to_status);
    } else if (user.roles.includes(t.allowed_role)) {
      targets.add(t.to_status);
    }
  }
  return [...targets];
}

export async function loadTransitions(db: DbClient): Promise<Transition[]> {
  const { rows } = await db.query<Transition>('SELECT from_status, to_status, allowed_role FROM status_transitions');
  return rows;
}

export interface SlaTimes {
  responseDueAt: Date;
  dueAt: Date;
}

/**
 * Berechnet SLA-Fälligkeiten. Für "business_hours_only" werden nur
 * Mo–Fr 08:00–17:00 (Serverzeit Europe/Berlin) gezählt.
 */
export function computeDue(start: Date, minutes: number, businessHoursOnly: boolean): Date {
  if (!businessHoursOnly) return new Date(start.getTime() + minutes * 60_000);
  const d = new Date(start.getTime());
  let remaining = minutes;
  const OPEN = 8, CLOSE = 17;
  // Iteriert in Minuten-Blöcken pro Tag (max. ~1 Jahr Schutzgrenze)
  for (let guard = 0; remaining > 0 && guard < 400; guard++) {
    const day = d.getDay();
    if (day === 0 || day === 6) {
      d.setDate(d.getDate() + 1);
      d.setHours(OPEN, 0, 0, 0);
      continue;
    }
    if (d.getHours() < OPEN) d.setHours(OPEN, 0, 0, 0);
    const close = new Date(d);
    close.setHours(CLOSE, 0, 0, 0);
    const available = Math.max(0, Math.floor((close.getTime() - d.getTime()) / 60_000));
    if (available >= remaining) {
      return new Date(d.getTime() + remaining * 60_000);
    }
    remaining -= available;
    d.setDate(d.getDate() + 1);
    d.setHours(OPEN, 0, 0, 0);
  }
  return d;
}

export async function slaFor(db: DbClient, prio: Priority, start: Date): Promise<SlaTimes> {
  const { rows } = await db.query<{ response_minutes: number; resolution_minutes: number; business_hours_only: boolean }>(
    'SELECT response_minutes, resolution_minutes, business_hours_only FROM sla_policies WHERE priority = $1',
    [prio],
  );
  const p = rows[0] ?? { response_minutes: 240, resolution_minutes: 2400, business_hours_only: true };
  return {
    responseDueAt: computeDue(start, p.response_minutes, p.business_hours_only),
    dueAt: computeDue(start, p.resolution_minutes, p.business_hours_only),
  };
}

/** SQL-Fragment, das Lösungs-/Abschlusszeitpunkte passend zum neuen Status setzt. */
export function statusTimestampsSql(param: string): string {
  return `
  resolved_at = CASE WHEN ${param} = 'resolved' THEN now()
                     WHEN ${param} IN ('closed','rejected','withdrawn') THEN resolved_at
                     ELSE NULL END,
  closed_at   = CASE WHEN ${param} IN ('closed','rejected','withdrawn') THEN now() ELSE NULL END`;
}
