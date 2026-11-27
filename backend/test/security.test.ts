import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { extractRoles, verifyAccessToken, type AuthUser } from '../src/auth.js';
import { FormSchema, parseFormData } from '../src/formSchema.js';
import { allowedTargets, computeDue, type Transition } from '../src/workflow.js';
import { cleanLine, cleanText, likeEscape, sanitizeForLog } from '../src/util.js';

const ISSUER = 'https://portal.example.local/auth/realms/itportal';

async function tokenSetup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'k1';
  jwk.alg = 'RS256';
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? 'portal-api')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(privateKey);
  return { jwks, sign };
}

describe('Token-Validierung', () => {
  it('akzeptiert gültiges Token und liest Rollen', async () => {
    const { jwks, sign } = await tokenSetup();
    const t = await sign({ azp: 'portal-frontend', typ: 'Bearer', preferred_username: 'anna', realm_access: { roles: ['user', 'offline_access'] } });
    const u = await verifyAccessToken(t, { issuer: ISSUER, audience: 'portal-api', allowedAzp: 'portal-frontend', jwks });
    expect(u.roles).toEqual(['user']);
    expect(u.username).toBe('anna');
  });

  it('lehnt falsche Audience ab', async () => {
    const { jwks, sign } = await tokenSetup();
    const t = await sign({ azp: 'portal-frontend' }, { aud: 'other-api' });
    await expect(verifyAccessToken(t, { issuer: ISSUER, audience: 'portal-api', allowedAzp: 'portal-frontend', jwks })).rejects.toThrow();
  });

  it('lehnt fremden Client (azp) ab', async () => {
    const { jwks, sign } = await tokenSetup();
    const t = await sign({ azp: 'evil-client' });
    await expect(verifyAccessToken(t, { issuer: ISSUER, audience: 'portal-api', allowedAzp: 'portal-frontend', jwks })).rejects.toThrow();
  });

  it('lehnt abgelaufene Tokens ab', async () => {
    const { jwks, sign } = await tokenSetup();
    const t = await sign({ azp: 'portal-frontend' }, { exp: '-5m' });
    await expect(verifyAccessToken(t, { issuer: ISSUER, audience: 'portal-api', allowedAzp: 'portal-frontend', jwks })).rejects.toThrow();
  });

  it('Rollen-Allowlist und Hierarchie', () => {
    expect(extractRoles({ realm_access: { roles: ['admin', 'superuser'] } }).sort()).toEqual(['admin', 'first-level', 'user']);
    expect(extractRoles({ realm_access: { roles: 'admin' } })).toEqual([]);
    expect(extractRoles({})).toEqual([]);
  });
});

describe('Formular-Validierung', () => {
  const schema = {
    fields: [
      { name: 'model', label: 'Modell', type: 'select', required: true, options: [{ value: 'a', label: 'A' }] },
      { name: 'cc', label: 'Kostenstelle', type: 'text', required: true, pattern: '^[0-9]{3,10}$' },
      { name: 'qty', label: 'Anzahl', type: 'number', min: 1, max: 4 },
      { name: 'mail', label: 'Mail', type: 'email' },
    ],
  };

  it('akzeptiert gültige Daten', () => {
    expect(parseFormData(schema, { model: 'a', cc: '4711', qty: 2 })).toEqual({ model: 'a', cc: '4711', qty: 2 });
  });
  it('verwirft unbekannte Felder (Mass Assignment)', () => {
    expect(() => parseFormData(schema, { model: 'a', cc: '4711', isAdmin: true })).toThrow();
  });
  it('prüft Pflichtfelder, Muster und Optionen', () => {
    expect(() => parseFormData(schema, { model: 'b', cc: '4711' })).toThrow();
    expect(() => parseFormData(schema, { model: 'a', cc: "1'; DROP TABLE x;--" })).toThrow();
    expect(() => parseFormData(schema, { model: 'a', cc: '4711', qty: 99 })).toThrow();
    expect(() => parseFormData(schema, { model: 'a', cc: '4711', mail: 'kein-mail' })).toThrow();
  });
  it('Bundle: mindestens eine Position (requireOneOf)', () => {
    const bundle = { requireOneOf: ['a', 'b'], fields: [
      { name: 'a', label: 'A', type: 'number', min: 0, max: 5 },
      { name: 'b', label: 'B', type: 'number', min: 0, max: 5 }] };
    expect(() => parseFormData(bundle, { a: 0, b: 0 })).toThrow();
    expect(parseFormData(bundle, { a: 0, b: 2 })).toEqual({ a: 0, b: 2 });
  });
  it('Bedingte Felder (when) und Pflicht-Checkbox', () => {
    const tel = { fields: [
      { name: 'kind', label: 'Art', type: 'select', required: true, options: [{ value: 'soft', label: 'S' }, { value: 'hard', label: 'H' }] },
      { name: 'model', label: 'Modell', type: 'select', required: true, when: { field: 'kind', equals: 'hard' }, options: [{ value: 'desk', label: 'D' }] },
      { name: 'ok', label: 'Bestätigung', type: 'checkbox', required: true }] };
    expect(() => parseFormData(tel, { kind: 'hard', ok: true })).toThrow();
    expect(parseFormData(tel, { kind: 'soft', model: 'desk', ok: true })).toEqual({ kind: 'soft', ok: true });
    expect(() => parseFormData(tel, { kind: 'soft', ok: false })).toThrow();
  });
  it('blockiert ReDoS-anfällige Muster im Meta-Schema', () => {
    const bad = { fields: [{ name: 'x', label: 'X', type: 'text', pattern: '^(a+)+$' }] };
    expect(FormSchema.safeParse(bad).success).toBe(false);
  });
});

describe('Workflow', () => {
  const tr: Transition[] = [
    { from_status: 'new', to_status: 'withdrawn', allowed_role: 'user' },
    { from_status: 'new', to_status: 'in_progress', allowed_role: 'first-level' },
  ];
  const user: AuthUser = { sub: 'u', username: 'u', name: 'U', email: null, roles: ['user'] };
  const agent: AuthUser = { ...user, sub: 'a', roles: ['user', 'first-level'] };

  it('Nutzer darf nur eigene Tickets zurückziehen', () => {
    expect(allowedTargets(tr, 'new', user, true)).toEqual(['withdrawn']);
    expect(allowedTargets(tr, 'new', user, false)).toEqual([]);
  });
  it('Support darf bearbeiten, aber fremde Tickets nicht zurückziehen', () => {
    expect(allowedTargets(tr, 'new', agent, false)).toEqual(['in_progress']);
  });
  it('SLA nur in Geschäftszeiten', () => {
    const fri = new Date(2026, 10, 27, 16, 0, 0); // Fr 16:00
    const due = computeDue(fri, 120, true);
    expect(due.getDay()).toBe(1); // Mo
    expect(due.getHours()).toBe(9);
  });
});

describe('Bereinigung', () => {
  it('entfernt Steuerzeichen und Bidi-Overrides', () => {
    expect(cleanLine('a\u0000b‮c\r\nd')).toBe('abc d');
    expect(cleanText('x\r\ny')).toBe('x\ny');
  });
  it('maskiert LIKE-Wildcards', () => {
    expect(likeEscape('50%_a\\')).toBe('50\\%\\_a\\\\');
  });
  it('begrenzt Log-Objekte', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(sanitizeForLog(deep))).toContain('[…]');
  });
});

describe('Keycloak-Admin-Client', () => {
  it('leitet die Portal-Rolle aus Gruppen ab (höchste gewinnt)', async () => {
    const { roleFromGroups } = await import('../src/keycloakAdmin.js');
    expect(roleFromGroups('a', new Set(['a']), new Set(['a']))).toBe('admin');
    expect(roleFromGroups('b', new Set(), new Set(['b']))).toBe('first-level');
    expect(roleFromGroups('c', new Set(), new Set())).toBe('user');
  });

  it('nutzt Client-Credentials, kodiert Pfade und blendet Service-Accounts aus', async () => {
    const { KeycloakAdmin } = await import('../src/keycloakAdmin.js');
    const calls: string[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 120 }), { status: 200 });
      if (u.includes('/users/count')) return new Response('2', { status: 200 });
      if (u.includes('/users?')) return new Response(JSON.stringify([
        { id: '1', username: 'anna', enabled: true }, { id: '2', username: 'service-account-portal-admin-api', enabled: true }]), { status: 200 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const kc = new KeycloakAdmin({ baseUrl: 'http://kc/auth', realm: 'itportal', clientId: 'c', clientSecret: 's', fetchImpl: fake });
    const r = await kc.searchUsers('an na', 0, 20);
    expect(r.users.map((u) => u.username)).toEqual(['anna']);
    expect(calls[0]).toBe('POST http://kc/auth/realms/itportal/protocol/openid-connect/token');
    expect(calls.some((c) => c.includes('search=an+na'))).toBe(true);
  });
});

describe('Selbstregistrierung: Domain-Prüfung', () => {
  it('lässt nur bestätigte Firmenadressen zu, Support/Admin ausgenommen', async () => {
    const { emailDomainAllowed } = await import('../src/auth.js');
    const base = { sub: 's', username: 'u', name: 'U', roles: ['user'] as ('user' | 'first-level' | 'admin')[] };
    expect(emailDomainAllowed({ ...base, email: 'a@example.com', emailVerified: true }, ['example.com'])).toBe(true);
    expect(emailDomainAllowed({ ...base, email: 'a@sub.example.com', emailVerified: true }, ['example.com'])).toBe(true);
    expect(emailDomainAllowed({ ...base, email: 'a@evil-example.com', emailVerified: true }, ['example.com'])).toBe(false);
    expect(emailDomainAllowed({ ...base, email: 'a@example.com', emailVerified: false }, ['example.com'])).toBe(false);
    expect(emailDomainAllowed({ ...base, email: 'x@gmail.com', emailVerified: true, roles: ['user', 'first-level'] }, ['example.com'])).toBe(true);
    expect(emailDomainAllowed({ ...base, email: 'x@gmail.com', emailVerified: true }, [])).toBe(true);
  });
});
