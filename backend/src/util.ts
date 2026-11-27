import { z } from 'zod';

/** Fachlicher Fehler mit HTTP-Status – Nachricht ist für Clients bestimmt. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'error',
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, 'Nicht gefunden', 'not_found');
export const forbidden = () => new HttpError(403, 'Keine Berechtigung', 'forbidden');
export const conflict = (msg = 'Der Datensatz wurde zwischenzeitlich geändert. Bitte neu laden.') =>
  new HttpError(409, msg, 'conflict');

// Steuerzeichen außer \t \n entfernen (Schutz vor Log-/Header-Injection, unsichtbaren Zeichen)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

export function cleanText(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim();
}

/** Einzeilige Variante (Titel, Namen): auch Zeilenumbrüche entfernen. */
export function cleanLine(value: string): string {
  return cleanText(value).replace(/[\n\t]+/g, ' ');
}

/** Zod-Helfer: bereinigter Freitext mit Längenbegrenzung. */
export const text = (min: number, max: number) =>
  z.string().max(max * 2).transform(cleanText).pipe(z.string().min(min).max(max));
export const line = (min: number, max: number) =>
  z.string().max(max * 2).transform(cleanLine).pipe(z.string().min(min).max(max));

export const uuid = z.string().uuid();
export const priority = z.enum(['low', 'medium', 'high', 'critical']);
export type Priority = z.infer<typeof priority>;

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Für Logs/Audit: Werte kürzen und bereinigen, keine Objekte beliebiger Tiefe. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanLine(value).slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 3) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeForLog(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[cleanLine(k).slice(0, 64)] = sanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 100);
}

/** Escaping für ILIKE-Suchen (verhindert Wildcard-Injection). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
