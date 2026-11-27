// =============================================================================
// Erzeugt README-Screenshots der Oberfläche mit Playwright.
// Keycloak (OIDC) und die API werden per Request-Interception mit Beispieldaten
// simuliert – der Produktionscode bleibt unverändert, es läuft kein Backend.
//
//   npm run build && npx vite preview --port 4173 &
//   node screenshots/capture.mjs http://localhost:4173 ../docs/screenshots
// =============================================================================
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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

const NOTEBOOK_SCHEMA = { fields: [
  { name: 'model', label: 'Modell', type: 'select', required: true, options: [
    { value: 'standard-14', label: 'Standard 14" (Office)' }, { value: 'performance-16', label: 'Performance 16" (Entwicklung/CAD)' },
    { value: 'ultralight-13', label: 'Ultralight 13" (Mobil)' }] },
  { name: 'reason', label: 'Anlass', type: 'select', required: true, options: [
    { value: 'new-hire', label: 'Neue/r Mitarbeitende/r' }, { value: 'replacement', label: 'Ersatz (defekt/veraltet)' },
    { value: 'additional', label: 'Zusätzliches Gerät' }] },
  { name: 'oldAssetTag', label: 'Inventarnummer Altgerät', type: 'text', maxLength: 30, help: 'Nur bei Ersatz' },
  { name: 'costCenter', label: 'Kostenstelle', type: 'text', required: true, maxLength: 10, pattern: '^[0-9]{3,10}$' },
  { name: 'approverEmail', label: 'E-Mail der/des Vorgesetzten (Freigabe)', type: 'email', required: true },
  { name: 'neededBy', label: 'Benötigt bis', type: 'date' },
  { name: 'justification', label: 'Begründung', type: 'textarea', required: true, maxLength: 2000 },
] };

const catalog = { categories: [
  { id: 'hardware', name: 'Hardware', description: 'Notebooks, Monitore, Dockingstationen, Zubehör', icon: 'laptop', items: [
    { id: '11111111-1111-4111-8111-111111111111', category_id: 'hardware', name: 'Notebook anfordern', description: 'Neues oder Ersatz-Notebook nach Unternehmensstandard', requires_approval: true, popular: true },
    { id: '11111111-1111-4111-8111-111111111112', category_id: 'hardware', name: 'Monitor / Dockingstation', description: 'Zusätzlicher Monitor, Dock oder Ersatz', requires_approval: true, popular: true },
    { id: '11111111-1111-4111-8111-111111111113', category_id: 'hardware', name: 'Zubehör', description: 'Headset, Maus, Tastatur, Adapter', requires_approval: false, popular: false }] },
  { id: 'software', name: 'Software', description: 'Standard- und Fachsoftware, Lizenzen, Installationen', icon: 'apps', items: [
    { id: '22222222-2222-4222-8222-222222222221', category_id: 'software', name: 'Software installieren', description: 'Standard- oder Fachsoftware aus dem Softwarekatalog', requires_approval: false, popular: true }] },
  { id: 'access', name: 'Berechtigungen', description: 'Gruppen, Laufwerke/Shares, Applikationsrollen', icon: 'key', items: [
    { id: '33333333-3333-4333-8333-333333333331', category_id: 'access', name: 'Gruppenmitgliedschaft / Share-Zugriff', description: 'Zugriff auf Gruppen, Laufwerke oder Netzfreigaben', requires_approval: true, popular: true }] },
  { id: 'general', name: 'Allgemeine IT-Anfrage', description: 'Fragen, Störungen und alles Weitere', icon: 'help', items: [
    { id: '44444444-4444-4444-8444-444444444441', category_id: 'general', name: 'Allgemeine Anfrage / Störung', description: 'Frage, Problem oder Wunsch ohne passende Kategorie', requires_approval: false, popular: true }] },
] };

// ------------------------------------------------------------------ Tickets
const P = PERSONAS;
let seq = 1040;
function ticket(title, status, priority, cat, item, requester, assignee, createdH, updatedH, extra = {}) {
  const [label, color, final] = STATUS[status];
  const n = seq++;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`, number: `SR-00${n}`, title, status,
    status_label: label, status_color: color, is_final: final, priority, category_id: cat,
    category_name: catalog.categories.find((c) => c.id === cat).name, item_name: item,
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
  ticket('Ersatz-Notebook für defektes Gerät', 'resolved', 'medium', 'hardware', 'Notebook anfordern', P.anna, P.uwe, 50, 1.5),
  ticket('Zugriff auf Laufwerk Vertrieb/Angebote', 'waiting_for_user', 'medium', 'access', 'Gruppenmitgliedschaft / Share-Zugriff', P.anna, P.uwe, 26, 3),
  ticket('Zweiter Monitor 27" für Homeoffice', 'waiting_for_approval', 'low', 'hardware', 'Monitor / Dockingstation', P.anna, P.uwe, 72, 20),
  ticket('Installation Visio Professional', 'in_progress', 'medium', 'software', 'Software installieren', P.anna, P.uwe, 6, 2),
  ticket('VPN bricht im Hotel-WLAN ab', 'new', 'high', 'general', 'Allgemeine Anfrage / Störung', P.anna, null, 0.4, 0.4),
  ticket('Headset für Teams-Calls', 'closed', 'low', 'hardware', 'Zubehör', P.anna, P.uwe, 400, 380),
];
const queue = [
  ticket('Drucker 3. OG druckt nur leere Seiten', 'new', 'critical', 'general', 'Allgemeine Anfrage / Störung', jonas, null, 0.3, 0.3),
  annaTickets[4],
  ticket('CAD-Workstation: Grafikkartentreiber', 'in_progress', 'high', 'software', 'Software installieren', mira, P.uwe, 9, 1, { overdue: true, due_at: ago(1) }),
  ticket('Neue Mitarbeiterin: Notebook & Zugänge', 'waiting_for_approval', 'medium', 'hardware', 'Notebook anfordern', lisa, P.uwe, 30, 5),
  annaTickets[1],
  ticket('Leserechte SAP-Rolle Controlling (befristet)', 'new', 'medium', 'access', 'Gruppenmitgliedschaft / Share-Zugriff', tom, null, 2, 2),
  annaTickets[3],
  ticket('Docking-Station erkennt Monitor nicht', 'in_progress', 'low', 'hardware', 'Monitor / Dockingstation', lisa, P.alex, 48, 26),
];

const SR_DETAIL = annaTickets[0];
function detail(t, persona, support) {
  const transitions = support
    ? [['waiting_for_user', 'Rückfrage'], ['waiting_for_approval', 'Wartet auf Freigabe'], ['resolved', 'Gelöst'], ['rejected', 'Abgelehnt']]
    : t.status === 'resolved' ? [['closed', 'Geschlossen'], ['in_progress', 'In Bearbeitung']] : [];
  const tt = support ? { ...t, status: 'in_progress', status_label: 'In Bearbeitung', status_color: 'tertiary', resolved_at: null } : t;
  return {
    ticket: { ...tt, description: 'Display hat seit gestern einen Riss, Gerät startet nur noch sporadisch.',
      form_schema: NOTEBOOK_SCHEMA, first_response_at: ago(47), anonymized: false, requester_email: support ? P.anna.email : undefined,
      form_data: { model: 'standard-14', reason: 'replacement', oldAssetTag: 'NB-20431', costCenter: '4711', approverEmail: 'k.vogel@example.com', neededBy: new Date(now + 5 * 86400_000).toISOString().slice(0, 10), justification: 'Altgerät defekt (Displaybruch), tägliche Kundentermine.' } },
    comments: [
      { id: 'c1', body: 'Danke für die Anfrage! Das Austauschgerät wird vorbereitet. Bitte das Altgerät inkl. Netzteil mitbringen.', internal: false, author_role: 'first-level', author_name: 'Uwe Helpdesk', created_at: ago(46), mine: persona === P.uwe },
      ...(support ? [{ id: 'c2', body: 'Freigabe durch K. Vogel per Mail erteilt (Ticketnr. im Betreff), Gerät NB-31877 aus Lager reserviert.', internal: true, author_role: 'first-level', author_name: 'Uwe Helpdesk', created_at: ago(30), mine: true }] : []),
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

// ------------------------------------------------------------------ API-Router
function apiResponse(path, persona) {
  const p = path.replace(/\?.*$/, '');
  if (p === '/api/me') return persona;
  if (p === '/api/catalog') return catalog;
  if (p.startsWith('/api/catalog/items/')) return { ...catalog.categories[0].items[0], category_name: 'Hardware', form_schema: NOTEBOOK_SCHEMA, default_priority: 'medium' };
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
    { id: 's2', category_id: null, title: 'Neustart & Updates', body: '…' }];
  if (p === '/api/admin/workflow') return workflow;
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
    return route.fulfill({ json: apiResponse(u.pathname + u.search, persona) });
  });
  return context;
}

async function shot(context, path, name, prepare) {
  const page = await context.newPage();
  await page.goto(BASE + path);
  await page.waitForSelector('main#main', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 15_000 }).catch(() => {});
  if (prepare) await prepare(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✓', name);
  await page.close();
}

const browser = await chromium.launch();
try {
  const annaLight = await newContext(browser, P.anna);
  await shot(annaLight, '/', '01-startseite-hell');
  await shot(annaLight, '/katalog', '03-katalog');
  await shot(annaLight, `/anfrage/${catalog.categories[0].items[0].id}`, '04-anfrage-formular', async (page) => {
    await page.fill('#f-title', 'Ersatz-Notebook für defektes Gerät');
    await page.selectOption('#f-model', 'standard-14');
    await page.selectOption('#f-reason', 'replacement');
    await page.fill('#f-oldAssetTag', 'NB-20431');
    await page.fill('#f-costCenter', '47A1');
    await page.fill('#f-approverEmail', 'k.vogel@example.com');
    await page.click('button[type=submit]');
  });
  await shot(annaLight, '/tickets?state=all', '05-meine-tickets');
  await shot(annaLight, `/tickets/${SR_DETAIL.id}`, '06-ticket-detail');
  await annaLight.close();

  const annaDark = await newContext(browser, P.anna, { dark: true });
  await shot(annaDark, '/', '02-startseite-dunkel');
  await annaDark.close();

  const uweDark = await newContext(browser, P.uwe, { dark: true });
  await shot(uweDark, '/support', '07-support-queue');
  await uweDark.close();

  const uweLight = await newContext(browser, P.uwe);
  await shot(uweLight, `/support/tickets/${SR_DETAIL.id}`, '08-support-bearbeitung');
  await uweLight.close();

  const alex = await newContext(browser, P.alex);
  await shot(alex, '/admin/workflow', '09-admin-workflow');
  await shot(alex, '/admin/audit', '10-admin-audit');
  await alex.close();

  const mobile = await newContext(browser, P.anna, { dark: true, mobile: true });
  await shot(mobile, '/', '11-mobil-startseite');
  await shot(mobile, `/tickets/${SR_DETAIL.id}`, '12-mobil-ticket');
  await mobile.close();
} finally {
  await browser.close();
}
