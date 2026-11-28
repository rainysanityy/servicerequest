// =============================================================================
// Keycloak-Nacharbeiten für den Produktivbetrieb (idempotent, Node ≥ 20, keine Abhängigkeiten)
//
//  1. Zwei-Faktor-Pflicht (TOTP) für UHD und Administration:
//     Flow "browser-mfa" = Kopie von "browser" mit
//       - optionalem OTP für alle übrigen Konten (nur wenn eingerichtet)
//       - verpflichtendem OTP für Konten mit Realm-Rolle "first-level" (UHD + Admins);
//         ohne eingerichtetes OTP erzwingt Keycloak die Einrichtung beim Login.
//  2. Optional: erstes Portal-Admin-Konto anlegen (Gruppe /IT-Portal-Admins,
//     temporäres Passwort, TOTP-Einrichtung beim ersten Login).
//
// Aufruf über ./scripts/keycloak-setup.sh (läuft im Backend-Container im Docker-Netz)
// oder direkt:  KC_URL=http://localhost:8080/auth KC_ADMIN_USER=… KC_ADMIN_PASSWORD=… node scripts/keycloak-setup.mjs
//
// Umgebungsvariablen:
//   KC_URL, KC_ADMIN_USER, KC_ADMIN_PASSWORD   Bootstrap-/Master-Admin (Pflicht)
//   KC_REALM                                   Standard: itportal
//   MFA_ROLE                                   Standard: first-level
//   FIRST_ADMIN_USERNAME, FIRST_ADMIN_EMAIL, FIRST_ADMIN_FIRSTNAME, FIRST_ADMIN_LASTNAME   optional
// =============================================================================
import { randomBytes } from 'node:crypto';

const env = (k, d) => process.env[k] ?? d;
const KC = env('KC_URL', 'http://keycloak:8080/auth').replace(/\/$/, '');
const REALM = env('KC_REALM', 'itportal');
const MFA_ROLE = env('MFA_ROLE', 'first-level');
const FLOW = 'browser-mfa';
const PRIV_FLOW = `${FLOW} MFA-Pflicht`;
const A = `${KC}/admin/realms/${encodeURIComponent(REALM)}`;

const log = (m) => console.log(m);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

if (!env('KC_ADMIN_USER') || !env('KC_ADMIN_PASSWORD')) die('KC_ADMIN_USER und KC_ADMIN_PASSWORD fehlen.');

async function token() {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: env('KC_ADMIN_USER'), password: env('KC_ADMIN_PASSWORD') }),
  });
  if (!r.ok) die(`Anmeldung am Master-Realm fehlgeschlagen (HTTP ${r.status}) – Bootstrap-Admin gelöscht? Dann KC_ADMIN_USER/KC_ADMIN_PASSWORD eines Master-Admins setzen.`);
  return (await r.json()).access_token;
}

const TOKEN = await token();
async function api(method, path, body) {
  const r = await fetch(path.startsWith('http') ? path : `${A}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) die(`${method} ${path} → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const enc = encodeURIComponent;
const executions = (alias) => api('GET', `/authentication/flows/${enc(alias)}/executions`);
async function setRequirement(exec, requirement) {
  if (exec.requirement === requirement) return;
  await api('PUT', `/authentication/flows/${enc(FLOW)}/executions`, { ...exec, requirement });
}
async function addExecution(parentAlias, provider) {
  const before = new Set((await executions(parentAlias)).map((e) => e.id));
  await api('POST', `/authentication/flows/${enc(parentAlias)}/executions/execution`, { provider });
  const after = await executions(parentAlias);
  return after.find((e) => !before.has(e.id) && e.providerId === provider);
}
async function roleCondition(exec, alias, negate) {
  if (exec.authenticationConfig) return;
  await api('POST', `/authentication/executions/${exec.id}/config`, {
    alias, config: { condUserRole: MFA_ROLE, negate: String(negate) },
  });
}

// --------------------------------------------------------------- 1. MFA-Flow
const flows = await api('GET', '/authentication/flows');
if (!flows.some((f) => f.alias === FLOW)) {
  await api('POST', '/authentication/flows/browser/copy', { newName: FLOW });
  log(`✓ Flow "${FLOW}" als Kopie von "browser" angelegt`);
}

let ex = await executions(FLOW);
const forms = ex.find((e) => e.level === 0 && e.authenticationFlow && /forms$/i.test(e.displayName));
if (!forms) die('Unterflow "forms" im Browser-Flow nicht gefunden.');
const formsIdx = ex.indexOf(forms);
const childrenOf = (list, parent) => {
  const out = [];
  for (let i = list.indexOf(parent) + 1; i < list.length && list[i].level > parent.level; i++) {
    if (list[i].level === parent.level + 1) out.push(list[i]);
  }
  return out;
};

// a) bestehendes optionales OTP nur noch für nicht privilegierte Konten
const optional = childrenOf(ex, ex[formsIdx]).find((e) => e.authenticationFlow && e.requirement === 'CONDITIONAL' && e.displayName !== PRIV_FLOW);
if (optional) {
  let cond = childrenOf(ex, optional).find((e) => e.providerId === 'conditional-user-role');
  if (!cond) cond = await addExecution(optional.displayName, 'conditional-user-role');
  ex = await executions(FLOW);
  cond = ex.find((e) => e.id === cond.id);
  await setRequirement(cond, 'REQUIRED');
  await roleCondition(cond, `${FLOW}-ohne-${MFA_ROLE}`, true);
}

// b) verpflichtendes OTP für privilegierte Konten
ex = await executions(FLOW);
let priv = ex.find((e) => e.authenticationFlow && e.displayName === PRIV_FLOW);
if (!priv) {
  await api('POST', `/authentication/flows/${enc(forms.displayName)}/executions/flow`, {
    alias: PRIV_FLOW, type: 'basic-flow', provider: 'registration-page-form',
    description: `TOTP-Pflicht für Konten mit Rolle ${MFA_ROLE} (UHD, Admin)`,
  });
  ex = await executions(FLOW);
  priv = ex.find((e) => e.authenticationFlow && e.displayName === PRIV_FLOW);
}
await setRequirement(priv, 'CONDITIONAL');
ex = await executions(FLOW);
let kids = childrenOf(ex, ex.find((e) => e.id === priv.id));
let pcond = kids.find((e) => e.providerId === 'conditional-user-role') ?? (await addExecution(PRIV_FLOW, 'conditional-user-role'));
let potp = kids.find((e) => e.providerId === 'auth-otp-form') ?? (await addExecution(PRIV_FLOW, 'auth-otp-form'));
ex = await executions(FLOW);
pcond = ex.find((e) => e.id === pcond.id);
potp = ex.find((e) => e.id === potp.id);
await setRequirement(pcond, 'REQUIRED');
await setRequirement(potp, 'REQUIRED');
await roleCondition(pcond, `${FLOW}-mit-${MFA_ROLE}`, false);

// CONFIGURE_TOTP muss als Required Action aktiv sein
const ra = (await api('GET', '/authentication/required-actions')).find((a) => a.alias === 'CONFIGURE_TOTP');
if (ra && !ra.enabled) await api('PUT', '/authentication/required-actions/CONFIGURE_TOTP', { ...ra, enabled: true });

const realm = await api('GET', '');
if (realm.browserFlow !== FLOW) {
  await api('PUT', '', { realm: REALM, browserFlow: FLOW });
}
log(`✓ Zwei-Faktor-Pflicht aktiv: Konten mit Rolle "${MFA_ROLE}" (UHD, Admin) müssen TOTP nutzen`);

// ------------------------------------------------------- 2. erstes Portal-Admin-Konto
const username = env('FIRST_ADMIN_USERNAME', '').trim().toLowerCase();
if (username) {
  const email = env('FIRST_ADMIN_EMAIL', '').trim();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) die('FIRST_ADMIN_USERNAME: nur a–z, 0–9, Punkt, Minus, Unterstrich (3–64 Zeichen).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die('FIRST_ADMIN_EMAIL ist keine gültige E-Mail-Adresse.');
  const existing = await api('GET', `/users?username=${enc(username)}&exact=true`);
  let id = existing[0]?.id;
  let password = null;
  if (!id) {
    password = `${randomBytes(12).toString('base64url')}-Aa1!`;
    await api('POST', '/users', {
      username, email, emailVerified: true, enabled: true,
      firstName: env('FIRST_ADMIN_FIRSTNAME', 'Portal'), lastName: env('FIRST_ADMIN_LASTNAME', 'Admin'),
      credentials: [{ type: 'password', value: password, temporary: true }],
      requiredActions: ['CONFIGURE_TOTP'],
    });
    id = (await api('GET', `/users?username=${enc(username)}&exact=true`))[0].id;
  }
  const group = await api('GET', '/group-by-path/IT-Portal-Admins');
  await api('PUT', `/users/${id}/groups/${group.id}`);
  log(`✓ Portal-Admin "${username}" ist Mitglied von /IT-Portal-Admins`);
  if (password) {
    log('');
    log('  Temporäres Passwort (wird NUR JETZT angezeigt, beim 1. Login ändern + TOTP einrichten):');
    log(`  ${password}`);
    log('');
  } else {
    log('  (Konto bestand bereits – Passwort unverändert)');
  }
}
