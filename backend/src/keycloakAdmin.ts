/**
 * Minimaler Client für die Keycloak-Admin-REST-API (nur Realm "itportal").
 *
 * Sicherheit:
 *  - Authentisierung per Client-Credentials des vertraulichen Clients "portal-admin-api"
 *    (Service-Account mit query-users, view-users, query-groups, manage-users).
 *  - Feste, konfigurierte Basis-URL im internen Docker-Netz (kein Nutzer-Input → kein SSRF).
 *  - Alle Pfadbestandteile werden URL-kodiert, IDs vorher als UUID validiert.
 *  - Das Backend nutzt ausschließlich: Benutzer suchen, Gruppenmitgliedschaft der drei
 *    Portal-Gruppen ändern, Konto sperren/entsperren, Sitzungen beenden.
 */
import { HttpError } from './util.js';

export const PORTAL_GROUPS = {
  user: '/Mitarbeitende',
  'first-level': '/IT-UHD',
  admin: '/IT-Portal-Admins',
} as const;
export type PortalRole = keyof typeof PORTAL_GROUPS;

export interface KcUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled: boolean;
  createdTimestamp?: number;
}

interface KcGroup {
  id: string;
  name: string;
  path: string;
}

export interface KeycloakAdminOptions {
  baseUrl: string; // z. B. http://keycloak:8080/auth
  realm: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export class KeycloakAdmin {
  private token: { value: string; exp: number } | null = null;
  private groupIds = new Map<string, string>();
  private readonly f: typeof fetch;

  constructor(private readonly o: KeycloakAdminOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.exp - 20_000) return this.token.value;
    const res = await this.f(`${this.o.baseUrl}/realms/${encodeURIComponent(this.o.realm)}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.o.clientId, client_secret: this.o.clientSecret }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new HttpError(502, 'Anmeldung an der Benutzerverwaltung fehlgeschlagen', 'idp_unavailable');
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.o.baseUrl}/admin/realms/${encodeURIComponent(this.o.realm)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) throw new HttpError(404, 'Benutzer nicht gefunden', 'not_found');
    if (!res.ok) throw new HttpError(502, `Benutzerverwaltung antwortet mit Fehler ${res.status}`, 'idp_error');
    if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async groupId(path: string): Promise<string> {
    const cached = this.groupIds.get(path);
    if (cached) return cached;
    const g = await this.call<KcGroup>('GET', `/group-by-path/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`);
    this.groupIds.set(path, g.id);
    return g.id;
  }

  async searchUsers(search: string, first: number, max: number): Promise<{ users: KcUser[]; total: number }> {
    const q = new URLSearchParams({ first: String(first), max: String(max), briefRepresentation: 'true' });
    const c = new URLSearchParams();
    if (search) {
      q.set('search', search);
      c.set('search', search);
    }
    const [users, total] = await Promise.all([
      this.call<KcUser[]>('GET', `/users?${q.toString()}`),
      this.call<number>('GET', `/users/count?${c.toString()}`),
    ]);
    return { users: users.filter((u) => !u.username.startsWith('service-account-')), total };
  }

  async getUser(id: string): Promise<KcUser> {
    return this.call<KcUser>('GET', `/users/${encodeURIComponent(id)}`);
  }

  async groupMemberIds(path: string): Promise<Set<string>> {
    const gid = await this.groupId(path);
    const ids = new Set<string>();
    for (let first = 0; first < 10_000; first += 500) {
      const page = await this.call<KcUser[]>('GET', `/groups/${encodeURIComponent(gid)}/members?first=${first}&max=500&briefRepresentation=true`);
      page.forEach((u) => ids.add(u.id));
      if (page.length < 500) break;
    }
    return ids;
  }

  async addToGroup(userId: string, path: string): Promise<void> {
    await this.call('PUT', `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(await this.groupId(path))}`);
  }

  async removeFromGroup(userId: string, path: string): Promise<void> {
    await this.call('DELETE', `/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(await this.groupId(path))}`);
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.call('PUT', `/users/${encodeURIComponent(userId)}`, { enabled });
  }

  /** Beendet alle Sitzungen (Rechteentzug wirkt sofort, nicht erst nach Token-Ablauf). */
  async logout(userId: string): Promise<void> {
    await this.call('POST', `/users/${encodeURIComponent(userId)}/logout`);
  }
}

/** Effektive Portal-Rolle aus den Gruppenmitgliedschaften (höchste gewinnt). */
export function roleFromGroups(id: string, admins: Set<string>, uhd: Set<string>): PortalRole {
  if (admins.has(id)) return 'admin';
  if (uhd.has(id)) return 'first-level';
  return 'user';
}
