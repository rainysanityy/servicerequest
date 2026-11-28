// =============================================================================
// Erzeugt README-Screenshots der Oberfläche mit Playwright.
// Keycloak (OIDC) und die API werden per Request-Interception mit Beispieldaten
// simuliert – der Produktionscode bleibt unverändert, es läuft kein Backend.
//
//   npm run build && npx vite preview --port 4173 &
//   node screenshots/capture.mjs http://localhost:4173 ../docs/screenshots
// =============================================================================
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? '../docs/screenshots';
mkdirSync(OUT, { recursive: true });

const now = Date.now();
const ago = (h) => new Date(now - h * 3600_000).toISOString();
const inH = (h) => new Date(now + h * 3600_000).toISOString();

// ------------------------------------------------------------------ Personen
const PERSONAS = {
  anna: { sub: 'u-anna', username: 'anna.mueller', name: 'Anna Müller', email: 'anna.mueller@example.com', roles: ['user'] },
  uwe: { sub: 'u-uwe', username: 'uwe.helpdesk', name: 'Uwe Helpdesk', email: 'uwe.helpdesk@example.com', roles: ['user', 'first-level'] },
  alex: { sub: 'u-alex', username: 'alex.admin', name: 'Alex Admin', email: 'alex.admin@example.com', roles: ['user', 'first-level', 'admin'] },
};

// ------------------------------------------------------------------ Stammdaten
const STATUS = {
  new: ['Neu', 'primary', false], in_progress: ['In Bearbeitung', 'tertiary', false],
  waiting_for_user: ['Rückfrage', 'warning', false], waiting_for_approval: ['Wartet auf Freigabe', 'secondary', false],
  resolved: ['Gelöst', 'success', false], closed: ['Geschlossen', 'neutral', true],
  rejected: ['Abgelehnt', 'error', true], withdrawn: ['Zurückgezogen', 'neutral', true],
};
const statuses = Object.entries(STATUS).map(([code, [label, color_role, is_final]], i) => ({
  code, label, color_role, is_final, description: '', sort_order: (i + 1) * 10,
}));

// Katalog direkt aus den SQL-Migrationen lesen (bleibt automatisch synchron)
const MIG = new URL('../../backend/migrations/', import.meta.url);
const sql = ['002_seed.sql', '003_catalog_v2.sql'].map((f) => readFileSync(new URL(f, MIG), 'utf8')).join('\n');
const CATS = [
  ['hardware', 'Hardware', 'APC, Monitor, Mobiltelefon, Tablet, Maus, Tastatur, Webcam – einzeln oder als Bundle', 'laptop'],
  ['software', 'Software', 'Beliebige Software per Freitext anfragen', 'apps'],
  ['telephony', 'Telefonie', 'Softphone oder Hardphone (Tischtelefon) bestellen', 'call'],
  ['access', 'Berechtigungen & VPN', 'Netzlaufwerke, Mail-Postfächer, VPN-Zugang', 'key'],
  ['accounts', 'Benutzerkonten', 'Neues Benutzerkonto mit Berechtigungen einer Referenzperson', 'person_add'],
  ['vm', 'Server & VMs', 'Virtuelle Maschinen mit individuellen Ressourcen', 'dns'],
  ['certificates', 'Zertifikate', 'SSL/TLS-Serverzertifikate und E-Mail-Zertifikate (S/MIME)', 'verified'],
  ['general', 'Allgemeine IT-Anfrage', 'Fragen, Störungen und alles Weitere', 'help'],
];
const OLD = new Set(['Notebook anfordern', 'Monitor / Dockingstation', 'Zubehör', 'Software installieren', 'Gruppenmitgliedschaft / Share-Zugriff']);
const ITEM_RE = /\('([a-z-]+)', '([^']+)', '([^']*)', '(\w+)', (TRUE|FALSE), (TRUE|FALSE), (\d+),\s*'(\{[\s\S]*?\})'::jsonb\)/g;
let k = 0;
const allItems = [...sql.matchAll(ITEM_RE)]
  .filter((m) => !OLD.has(m[2]))
  .map((m) => ({
    id: `bbbbbbbb-0000-4000-8000-${String(++k).padStart(12, '0')}`, category_id: m[1], name: m[2], description: m[3],
    default_priority: m[4], requires_approval: m[5] === 'TRUE', popular: m[6] === 'TRUE', sort_order: Number(m[7]),
    form_schema: JSON.parse(m[8].replace(/''/g, "'")), active: true,
  }));
const byName = (n) => allItems.find((i) => i.name === n);
const catalog = { categories: CATS.map(([id, name, description, icon]) => ({
  id, name, description, icon,
  items: allItems.filter((i) => i.category_id === id).sort((a, b) => a.sort_order - b.sort_order)
    .map(({ form_schema, default_priority, sort_order, active, ...rest }) => rest),
})) };
const APC = byName('APC'), BUNDLE = byName('Hardware-Bundle (mehrere Geräte)'), VM = byName('Virtuelle Maschine'),
  PHONE = byName('Telefon bestellen (Softphone / Hardphone)');

// ------------------------------------------------------------------ Tickets
const P = PERSONAS;
let seq = 1040;
function ticket(title, status, priority, cat, item, requester, assignee, createdH, updatedH, extra = {}) {
  const [label, color, final] = STATUS[status];
  const n = seq++;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`, number: `SR-00${n}`, title, status,
    status_label: label, status_color: color, is_final: final, priority, category_id: cat,
    category_name: CATS.find((c) => c[0] === cat)[1], item_name: item,
    requester_sub: requester.sub, requester_name: requester.name,
    assignee_sub: assignee?.sub ?? null, assignee_name: assignee?.name ?? null,
    response_due_at: inH(2), due_at: inH(30), created_at: ago(createdH), updated_at: ago(updatedH),
    resolved_at: status === 'resolved' || final ? ago(updatedH) : null, closed_at: final ? ago(updatedH) : null,
    version: 3, overdue: false, ...extra,
  };
}
const lisa = { sub: 'u-lisa', name: 'Lisa Schneider' }, jonas = { sub: 'u-jonas', name: 'Jonas Weber' },
  mira = { sub: 'u-mira', name: 'Mira Kaya' }, tom = { sub: 'u-tom', name: 'Tom Becker' };

const annaTickets = [
  ticket('Ersatz-APC für defektes Gerät', 'resolved', 'medium', 'hardware', 'APC', P.anna, P.uwe, 50, 1.5),
  ticket('Zugriff auf Laufwerk Vertrieb/Angebote', 'waiting_for_user', 'medium', 'access', 'Netzlaufwerk-Zugriff', P.anna, P.uwe, 26, 3),
  ticket('Arbeitsplatz für neue Kollegin (Bundle)', 'waiting_for_approval', 'medium', 'hardware', 'Hardware-Bundle (mehrere Geräte)', P.anna, P.uwe, 72, 20),
  ticket('Softphone mit Headset', 'in_progress', 'low', 'telephony', 'Telefon bestellen (Softphone / Hardphone)', P.anna, P.uwe, 6, 2),
  ticket('VPN-Zugang für Außendienst', 'new', 'medium', 'access', 'VPN-Zugang', P.anna, null, 0.4, 0.4),
  ticket('Zugriff Funktionspostfach vertrieb@', 'closed', 'low', 'access', 'Mail-Postfach-Zugriff', P.anna, P.uwe, 400, 380),
];
const queue = [
  ticket('Drucker 3. OG druckt nur leere Seiten', 'new', 'critical', 'general', 'Allgemeine Anfrage / Störung', jonas, null, 0.3, 0.3),
  ticket('Neues Benutzerkonto: M. Yilmaz (wie t.becker)', 'new', 'high', 'accounts', 'Neues Benutzerkonto', lisa, null, 1, 1),
  ticket('VM für Build-Server (8 vCPU / 32 GB)', 'in_progress', 'high', 'vm', 'Virtuelle Maschine', mira, P.uwe, 9, 1, { overdue: true, due_at: ago(1) }),
  ticket('SSL-Zertifikat intranet.example.com', 'waiting_for_approval', 'medium', 'certificates', 'SSL/TLS-Serverzertifikat', tom, P.uwe, 30, 5),
  annaTickets[4],
  annaTickets[1],
  ticket('S/MIME-Zertifikat für einkauf@', 'new', 'low', 'certificates', 'E-Mail-Zertifikat (S/MIME)', jonas, null, 2, 2),
  annaTickets[3],
];

const SR_DETAIL = annaTickets[0];
function detail(t, persona, support) {
  const transitions = support
    ? [['waiting_for_user', 'Rückfrage'], ['waiting_for_approval', 'Wartet auf Freigabe'], ['resolved', 'Gelöst'], ['rejected', 'Abgelehnt']]
    : t.status === 'resolved' ? [['closed', 'Geschlossen'], ['in_progress', 'In Bearbeitung']] : [];
  const tt = support ? { ...t, status: 'in_progress', status_label: 'In Bearbeitung', status_color: 'tertiary', resolved_at: null } : t;
  return {
    ticket: { ...tt, description: 'Gerät startet seit gestern nur noch sporadisch, Lüfter sehr laut.',
      form_schema: APC.form_schema, first_response_at: ago(47), anonymized: false, requester_email: support ? P.anna.email : undefined,
      form_data: { model: 'notebook-office', reason: 'replacement', oldAssetTag: 'APC-20431', costCenter: '4711', approverEmail: 'k.vogel@example.com', neededBy: new Date(now + 5 * 86400_000).toISOString().slice(0, 10), justification: 'Altgerät defekt, tägliche Kundentermine.' } },
    comments: [
      { id: 'c1', body: 'Danke für die Anfrage! Das Austauschgerät wird vorbereitet. Bitte das Altgerät inkl. Netzteil mitbringen.', internal: false, author_role: 'first-level', author_name: 'Uwe Helpdesk', created_at: ago(46), mine: persona === P.uwe },
      ...(support ? [{ id: 'c2', body: 'Freigabe durch K. Vogel per Mail erteilt (Ticketnr. im Betreff), Gerät APC-31877 aus Lager reserviert.', internal: true, author_role: 'first-level', author_name: 'Uwe Helpdesk', created_at: ago(30), mine: true }] : []),
      { id: 'c3', body: 'Super, kann ich das Gerät morgen ab 9 Uhr abholen?', internal: false, author_role: 'user', author_name: 'Anna Müller', created_at: ago(20), mine: persona === P.anna },
      { id: 'c4', body: 'Ihr Gerät ist vorbereitet und kann zu den Servicezeiten am IT-Service-Point abgeholt werden. Bitte Altgerät und Netzteil mitbringen.', internal: false, author_role: 'first-level', author_name: 'Uwe Helpdesk', created_at: ago(1.5), mine: persona === P.uwe },
    ],
    events: [
      { event_type: 'created', from_value: null, to_value: 'new', created_at: ago(50), actor_name: 'Anna Müller' },
      { event_type: 'assigned', from_value: null, to_value: 'u-uwe', created_at: ago(47.5), actor_name: 'Uwe Helpdesk' },
      { event_type: 'status', from_value: 'new', to_value: 'in_progress', created_at: ago(47.5), actor_name: 'Uwe Helpdesk' },
      ...(support ? [] : [{ event_type: 'status', from_value: 'in_progress', to_value: 'resolved', created_at: ago(1.5), actor_name: 'Uwe Helpdesk' }]),
    ],
    allowedTransitions: transitions.map(([code, label]) => ({ code, label })),
    canComment: true,
    canInternalComment: support,
  };
}

const workflow = {
  statuses,
  transitions: [
    ['new', 'withdrawn', 'user'], ['waiting_for_user', 'in_progress', 'user'], ['resolved', 'closed', 'user'], ['resolved', 'in_progress', 'user'],
    ...[['new', 'in_progress'], ['new', 'waiting_for_approval'], ['new', 'rejected'], ['in_progress', 'waiting_for_user'], ['in_progress', 'waiting_for_approval'],
      ['in_progress', 'resolved'], ['in_progress', 'rejected'], ['waiting_for_user', 'in_progress'], ['waiting_for_user', 'resolved'],
      ['waiting_for_approval', 'in_progress'], ['waiting_for_approval', 'rejected'], ['resolved', 'in_progress'], ['resolved', 'closed']]
      .flatMap(([f, t]) => [[f, t, 'first-level'], [f, t, 'admin']]),
    ['closed', 'in_progress', 'admin'], ['rejected', 'in_progress', 'admin'],
  ].map(([from, to, role]) => ({ from, to, role })),
};

const audit = { page: 1, pageSize: 25, total: 1284, items: [
  ['ticket.status', 'ticket', 'SR-001040', 'success', P.uwe, { from: 'in_progress', to: 'resolved', withComment: true }, '10.20.4.17'],
  ['ticket.assign', 'ticket', 'SR-001046', 'success', P.uwe, { from: null, to: 'u-uwe' }, '10.20.4.17'],
  ['authz.denied', 'route', 'GET /api/admin/audit', 'denied', P.anna, { required: ['admin'] }, '10.20.8.53'],
  ['admin.sla.update', 'sla', 'high', 'success', P.alex, { name: 'Hoch – starke Einschränkung', responseMinutes: 60, resolutionMinutes: 480 }, '10.10.0.12'],
  ['ticket.create', 'ticket', 'SR-001044', 'success', P.anna, { category: 'general', priority: 'high' }, '10.20.8.53'],
  ['admin.workflow.update', 'workflow', 'transitions', 'success', P.alex, { before: 45, after: 47 }, '10.10.0.12'],
  ['system.retention', 'system', 'retention', 'success', null, { anonymized_tickets: 12, deleted_audit: 340, cleared_ips: 918, anonymized_users: 3 }, null],
].map(([action, entity_type, entity_id, outcome, actor, details, ip], i) => ({
  id: String(9000 - i), ts: ago(i * 1.7 + 0.2), request_id: `req-${i}`, actor_sub: actor?.sub ?? null, actor_name: actor?.name ?? null,
  actor_roles: actor?.roles ?? [], action, entity_type, entity_id, outcome, client_ip: ip, details,
})) };

// ------------------------------------------------------------------ Statistik-Beispieldaten
function wave(n, base, amp, seed) { return Array.from({ length: n }, (_, i) => Math.max(0, Math.round(base + amp * Math.sin((i + seed) / 2.2) + ((i * 7 + seed * 3) % 5) - 2))); }
function statsFixture(persona) {
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(now - (11 - i) * 7 * 86400_000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }));
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400_000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }));
  const resolvedW = wave(12, 62, 14, 1), created = wave(30, 13, 5, 0), resolvedD = wave(30, 12, 4, 2);
  const st = (code, value) => ({ code, label: STATUS[code][0], value });
  const out = { scope: persona.roles.includes('admin') ? 'admin' : persona.roles.includes('first-level') ? 'support' : 'user', days: 30,
    general: { openNow: 87, resolved: 274, slaPct: 92.4, avgResolutionHours: 19.6, medianFirstResponseHours: 1.3,
      resolvedWeekly: weeks.map((label, i) => ({ label, value: resolvedW[i] })),
      resolutionByCategory: [['Hardware', 41.2, 88], ['Software', 9.8, 61], ['Telefonie', 22.5, 14], ['Berechtigungen & VPN', 6.1, 57], ['Benutzerkonten', 30.4, 12], ['Server & VMs', 52.0, 9], ['Zertifikate', 14.7, 11], ['Allgemeine IT-Anfrage', 3.2, 22]]
        .map(([label, value, n]) => ({ label, value, n })),
      mine: [st('new', 1), st('in_progress', 1), st('waiting_for_user', 1), st('waiting_for_approval', 1), st('resolved', 1), st('closed', 7), st('rejected', 0), st('withdrawn', 1)] } };
  if (out.scope !== 'user') out.support = {
    openByStatus: [st('new', 18), st('in_progress', 41), st('waiting_for_user', 12), st('waiting_for_approval', 9), st('resolved', 7)],
    openByPriority: [['low', 21], ['medium', 44], ['high', 17], ['critical', 5]].map(([code, value]) => ({ code, value })),
    flow: days30.map((label, i) => ({ label, created: created[i], resolved: resolvedD[i] })),
    aging: [['< 1 Tag', 26], ['1–3 Tage', 29], ['3–7 Tage', 18], ['7–14 Tage', 9], ['> 14 Tage', 5]].map(([label, value]) => ({ label, value })),
    categoryVolume: [['Hardware', 96], ['Software', 64], ['Telefonie', 15], ['Berechtigungen & VPN', 61], ['Benutzerkonten', 13], ['Server & VMs', 10], ['Zertifikate', 12], ['Allgemeine IT-Anfrage', 31]].map(([label, value]) => ({ label, value })),
    slaByPriority: [['low', 52, 97.1, 6.5], ['medium', 141, 93.6, 2.1], ['high', 64, 88.2, 0.7], ['critical', 17, 82.4, 0.3]].map(([code, resolved, sla_pct, median_first_response_h]) => ({ code, resolved, sla_pct, median_first_response_h })),
    unassigned: 11, overdue: 6, waitingForUser: 12 };
  if (out.scope === 'admin') out.admin = {
    topItems: [['Hardware-Bundle (mehrere Geräte)', 38], ['Software anfordern', 34], ['Netzlaufwerk-Zugriff', 29], ['APC', 24], ['VPN-Zugang', 21], ['Allgemeine Anfrage / Störung', 19], ['Monitor', 16], ['Mail-Postfach-Zugriff', 14], ['Neues Benutzerkonto', 13], ['Telefon bestellen (Softphone / Hardphone)', 12]].map(([label, value]) => ({ label, value })),
    outcomes: [st('closed', 236), st('rejected', 19), st('withdrawn', 11)],
    usersWeekly: weeks.map((label, i) => ({ label, value: wave(12, 9, 4, 3)[i] })),
    users: { total: 412, active_30d: 287, admins: 2, uhd: 6, users: 404 },
    deniedFlow: days30.map((label, i) => ({ label, value: [0, 1, 0, 2, 0, 0, 1][i % 7] + (i === 21 ? 9 : 0) })),
    topActions: [['ticket.comment', 512], ['ticket.status', 431], ['ticket.create', 298], ['ticket.assign', 244], ['ticket.priority', 61], ['admin.user.role', 14], ['authz.denied', 13], ['admin.catalog.update', 6]].map(([label, value]) => ({ label, value })) };
  return out;
}

// ------------------------------------------------------------------ API-Router
function apiResponse(path, persona, method = "GET") {
  const p = path.replace(/\?.*$/, '');
  if (p === '/api/me') return persona;
  if (p === '/api/catalog') return catalog;
  if (p.startsWith('/api/catalog/items/')) {
    const it = allItems.find((i) => p.endsWith(i.id)) ?? APC;
    return { ...it, category_name: CATS.find((c) => c[0] === it.category_id)[1] };
  }
  if (p === '/api/admin/catalog-items') return allItems;
  if (p === '/api/admin/categories') return CATS.map(([id, name, description, icon], i) => ({ id, name, description, icon, sort_order: (i + 1) * 10, active: true }));
  if (p === '/api/statuses') return statuses;
  if (p === '/api/tickets/summary') return { open: '5', waiting_for_me: '1', to_confirm: '1', closed: '1' };
  if (p === '/api/tickets') {
    const open = path.includes('state=open');
    const items = annaTickets.filter((t) => !open || !t.is_final);
    return { items, total: items.length, page: 1, pageSize: 15 };
  }
  if (p.startsWith('/api/tickets/')) return detail(SR_DETAIL, persona, persona !== P.anna);
  if (p === '/api/support/stats') return { new: '3', unassigned: '2', mine: '5', waiting_for_user: '1', overdue: '1', critical: '1', resolved_7d: '42' };
  if (p === '/api/support/tickets') return { items: queue, total: queue.length, page: 1, pageSize: 20 };
  if (p === '/api/support/agents') return [P.uwe, P.alex].map((a) => ({ sub: a.sub, display_name: a.name, email: a.email }));
  if (p === '/api/support/solutions') return [
    { id: 's1', category_id: 'hardware', title: 'Gerät bereit zur Abholung', body: '…' },
    { id: 's3', category_id: 'hardware', title: 'Bundle ausgeliefert', body: '…' },
    { id: 's2', category_id: null, title: 'Neustart & Updates', body: '…' }];
  if (p === '/api/admin/workflow') return workflow;
  if (p === '/api/admin/users/status') return { enabled: true };
  if (p === '/api/admin/tls') {
    const day = 86_400_000;
    const cert = (cnName, issuer, days, fp, chain) => ({
      subject: `CN=${cnName}, O=Firma GmbH`, issuer, subjectAltName: `DNS:${cnName}`, serialNumber: '4F1A09C2',
      validFrom: new Date(Date.now() - (365 - days) * day).toISOString(), validTo: new Date(Date.now() + days * day).toISOString(),
      daysRemaining: days, fingerprint256: fp, key: 'ECDSA P-384', selfSigned: false, chain,
    });
    const fpOld = '3A:91:5C:0E:7B:22:D4:18:9F:60:AB:CD:01:23:45:67:89:AB:CD:EF:10:32:54:76:98:BA:DC:FE:11:22:33:44';
    const fpNew = 'C7:04:E2:58:1B:9D:33:7F:A0:16:5E:C4:92:08:6B:D1:4E:77:20:F3:8C:59:A1:0B:66:3D:E5:29:B7:40:12:FE';
    const issuer = 'CN=Firma Issuing CA 02, O=Firma GmbH';
    if (method === 'POST') return {
      ok: true, installed: false, errors: [], warnings: [],
      info: cert('servicedesk.firma.de', issuer, 397, fpNew, [{ subject: issuer, issuer: 'CN=Firma Root CA, O=Firma GmbH', validTo: new Date(Date.now() + 1500 * day).toISOString() }]),
    };
    return { hostname: 'servicedesk.firma.de', enabled: true, uploaded: null, activeSource: 'server',
      active: cert('servicedesk.firma.de', issuer, 21, fpOld, []) };
  }
  if (p === '/api/stats') return statsFixture(persona);
  if (p === '/api/admin/roles') return {
    expectedRoles: [
      { role: 'user', keycloakGroup: '/Mitarbeitende', description: 'Requests erstellen, eigene Tickets einsehen/kommentieren (Standard bei Selbstregistrierung)' },
      { role: 'first-level', keycloakGroup: '/IT-UHD', description: 'Tickets sichten, zuweisen, bearbeiten, interne Notizen' },
      { role: 'admin', keycloakGroup: '/IT-Portal-Admins', description: 'Katalog, Workflow, SLA, Benutzer & Rollen, Audit' }],
    counts: { user: 214, 'first-level': 6, admin: 2 }, warnings: [], users: [] };
  if (p === '/api/admin/users') {
    const rows = [
      ['u-alex', 'alex.admin', 'Alex Admin', 'admin', true, true],
      ['u-uwe', 'uwe.helpdesk', 'Uwe Helpdesk', 'first-level', true, true],
      ['u-sara', 'sara.ohm', 'Sara Ohm', 'first-level', true, true],
      ['u-anna', 'anna.mueller', 'Anna Müller', 'user', true, true],
      ['u-jonas', 'jonas.weber', 'Jonas Weber', 'user', true, true],
      ['u-lisa', 'lisa.schneider', 'Lisa Schneider', 'user', true, true],
      ['u-mehmet', 'mehmet.yilmaz', 'Mehmet Yilmaz', 'user', true, false],
      ['u-tom', 'tom.becker', 'Tom Becker', 'user', false, true],
    ];
    return { items: rows.map(([id, username, name, role, enabled, verified], i) => ({
      id, username, name, email: `${username}@example.com`, emailVerified: verified, enabled, role,
      createdAt: ago(24 * (i + 1) * 9) })), total: 222, page: 1, pageSize: 20, counts: { admin: 2, 'first-level': 6 } };
  }
  if (p === '/api/admin/audit') return audit;
  return {};
}

// ------------------------------------------------------------------ Fake-OIDC
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;

async function newContext(browser, persona, { dark = false, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 3 : 2,
    colorScheme: dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    isMobile: mobile,
    hasTouch: mobile,
  });
  let nonce = '';
  await context.route('**/auth/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/protocol/openid-connect/auth')) {
      nonce = url.searchParams.get('nonce') ?? '';
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('state', url.searchParams.get('state'));
      back.searchParams.set('session_state', 'demo-session');
      back.searchParams.set('code', 'demo-code');
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
    if (url.pathname.endsWith('/protocol/openid-connect/token')) {
      const iat = Math.floor(Date.now() / 1000);
      const claims = { iat, exp: iat + 3600, sub: persona.sub, preferred_username: persona.username, name: persona.name,
        email: persona.email, realm_access: { roles: persona.roles }, azp: 'portal-frontend', typ: 'Bearer', nonce, sid: 'demo-session' };
      return route.fulfill({ json: { access_token: jwt(claims), refresh_token: jwt({ ...claims, typ: 'Refresh' }),
        id_token: jwt({ ...claims, typ: 'ID' }), token_type: 'Bearer', expires_in: 3600, session_state: 'demo-session' } });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  });
  await context.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ json: apiResponse(u.pathname + u.search, persona, route.request().method()) });
  });
  return context;
}

async function shot(context, path, name, prepare) {
  const page = await context.newPage();
  await page.goto(BASE + path);
  await page.waitForSelector('main#main', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 15_000 }).catch(() => {});
  if (prepare) {
    await prepare(page);
    if (path.startsWith('/anfrage/')) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    }
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✓', name);
  await page.close();
}

const browser = await chromium.launch();
try {
  const anna = await newContext(browser, P.anna, { dark: true });
  await shot(anna, '/', '01-startseite-dunkel');
  await shot(anna, '/katalog', '03-katalog');
  await shot(anna, `/anfrage/${BUNDLE.id}`, '04-formular-bundle', async (page) => {
    await page.fill('#f-title', 'Arbeitsplatz für neue Kollegin');
    for (const [f, v] of [['pcCount', '1'], ['monitorCount', '2'], ['phoneCount', '1'], ['mouseCount', '1'], ['keyboardCount', '1'], ['webcamCount', '1']]) {
      await page.fill(`#f-${f}`, v);
    }
    await page.fill('#f-location', 'Gebäude B, Raum 2.14');
    await page.fill('#f-costCenter', '4711');
  });
  await shot(anna, `/anfrage/${VM.id}`, '05-formular-vm', async (page) => {
    await page.fill('#f-title', 'Build-Server für Team Plattform');
    await page.fill('#f-hostname', 'build-plattform-01');
    await page.selectOption('#f-os', 'rhel-9');
    await page.selectOption('#f-environment', 'test');
    await page.fill('#f-vcpu', '8');
    await page.fill('#f-ramGb', '32');
    await page.fill('#f-diskGb', '120');
    await page.fill('#f-dataDiskGb', '500');
    await page.selectOption('#f-network', 'server-lan');
    await page.check('#f-backup');
    await page.check('#f-monitoring');
  });
  await shot(anna, `/anfrage/${PHONE.id}`, '06-formular-telefonie', async (page) => {
    await page.fill('#f-title', 'Tischtelefon für Empfang');
    await page.selectOption('#f-phoneType', 'hardphone');
    await page.selectOption('#f-hardphoneModel', 'desk-video');
    await page.selectOption('#f-number', 'existing');
    await page.fill('#f-existingNumber', '+49 30 1234-100');
  });
  await shot(anna, '/tickets?filter=all', '07-meine-tickets');
  await shot(anna, `/tickets/${SR_DETAIL.id}`, '08-ticket-detail');
  await shot(anna, '/statistik', '25-statistik-mitarbeitende', async (page) => {
    const bar = await page.$('.viz-plot svg rect[fill=transparent]:nth-of-type(1)');
    const box = await page.locator('.viz-plot').first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.6);
  });
  await anna.close();

  const annaLight = await newContext(browser, P.anna);
  await shot(annaLight, '/', '02-startseite-hell');
  await annaLight.close();

  const uwe = await newContext(browser, P.uwe, { dark: true });
  await shot(uwe, '/support', '09-support-queue');
  await shot(uwe, `/support/tickets/${SR_DETAIL.id}`, '10-support-bearbeitung');
  await uwe.close();

  const alex = await newContext(browser, P.alex, { dark: true });
  await shot(alex, '/admin/katalog', '11-admin-katalog', async (page) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
  });
  await shot(alex, '/admin/workflow', '12-admin-workflow');
  await shot(alex, '/admin/audit', '13-admin-audit');
  await shot(alex, '/admin/rollen', '16-admin-benutzer-rollen');
  await shot(alex, '/admin/zertifikat', '26-admin-zertifikat', async (page) => {
    await page.setInputFiles('#p12-file', { name: 'servicedesk.p12', mimeType: 'application/x-pkcs12', buffer: Buffer.from('MIIDemo-nur-Screenshot') });
    await page.fill('#p12-pw', 'geheim-geheim');
    await page.fill('#p12-reason', 'CHG-2026-118 Zertifikatserneuerung');
    await page.getByRole('button', { name: 'Prüfen' }).click();
    await page.waitForSelector('text=Prüfung bestanden');
  });
  await shot(alex, '/statistik', '22-statistik-admin');
  await shot(alex, '/statistik', '23-statistik-support', async (page) => {
    await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent?.includes('Support-Betrieb')); h?.scrollIntoView(); window.scrollBy(0, -80); });
  });
  await shot(alex, '/statistik', '24-statistik-administration', async (page) => {
    const h = page.locator('h2', { hasText: 'Administration' });
    await h.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const el = [...document.querySelectorAll('h2')].find((e) => e.textContent?.includes('Administration')); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90); });
  });
  await alex.close();

  const mobile = await newContext(browser, P.anna, { dark: true, mobile: true });
  await shot(mobile, '/', '14-mobil-startseite');
  await shot(mobile, `/tickets/${SR_DETAIL.id}`, '15-mobil-ticket');
  await mobile.close();
  // Echte Keycloak-Registrierungsseite (falls KC_URL gesetzt, z. B. im Screenshot-Workflow)
  if (process.env.KC_URL) {
    const q = 'client_id=portal-frontend&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Flocalhost%2F&code_challenge=E9Melhoe2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&kc_locale=de';
    for (const [dark, name, ep, mobile] of [
      [true, '17-registrierung-dunkel', 'registrations', false], [false, '18-registrierung-hell', 'registrations', false],
      [true, '19-login-dunkel', 'auth', false], [false, '20-login-hell', 'auth', false], [true, '21-login-mobil', 'auth', true],
    ]) {
      const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 3 : 2, colorScheme: dark ? 'dark' : 'light', locale: 'de-DE', isMobile: mobile });
      const page = await ctx.newPage();
      await page.goto(`${process.env.KC_URL}/realms/itportal/protocol/openid-connect/${ep}?${q}`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log('✓', name);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
