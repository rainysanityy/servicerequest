import Keycloak from 'keycloak-js';

export interface RuntimeConfig {
  keycloakUrl: string;
  realm: string;
  clientId: string;
  supportPhone?: string;
  supportHours?: string;
}

let kc: Keycloak | null = null;
let runtimeConfig: RuntimeConfig | null = null;

/** Lädt /config.json (zur Laufzeit austauschbar, kein Rebuild nötig). Gleiche Origin als Default. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  let raw: Partial<RuntimeConfig> = {};
  try {
    const res = await fetch('/config.json', { cache: 'no-store', credentials: 'omit' });
    if (res.ok) raw = (await res.json()) as Partial<RuntimeConfig>;
  } catch {
    /* Defaults verwenden */
  }
  const sameOriginAuth = `${window.location.origin}/auth`;
  const url = typeof raw.keycloakUrl === 'string' && raw.keycloakUrl.startsWith('https://') ? raw.keycloakUrl : sameOriginAuth;
  runtimeConfig = {
    keycloakUrl: url,
    realm: raw.realm || 'itportal',
    clientId: raw.clientId || 'portal-frontend',
    supportPhone: raw.supportPhone,
    supportHours: raw.supportHours,
  };
  return runtimeConfig;
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return runtimeConfig;
}

/**
 * OIDC Authorization Code Flow mit PKCE (S256).
 * Tokens werden ausschließlich im Speicher gehalten (kein localStorage → geringere XSS-Exfiltrationsfläche).
 */
export async function initKeycloak(cfg: RuntimeConfig): Promise<Keycloak> {
  kc = new Keycloak({ url: cfg.keycloakUrl, realm: cfg.realm, clientId: cfg.clientId });
  await kc.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    checkLoginIframe: false,
    responseMode: 'query',
    scope: 'openid profile email',
  });
  // Redirect-Parameter aus der URL entfernen
  kc.onTokenExpired = () => {
    kc?.updateToken(30).catch(() => kc?.login());
  };
  return kc;
}

export function keycloak(): Keycloak {
  if (!kc) throw new Error('Keycloak nicht initialisiert');
  return kc;
}

export async function getAccessToken(): Promise<string> {
  const k = keycloak();
  try {
    await k.updateToken(30);
  } catch {
    await k.login();
    throw new Error('Sitzung abgelaufen');
  }
  if (!k.token) throw new Error('Kein Token');
  return k.token;
}

export function logout(): void {
  void keycloak().logout({ redirectUri: `${window.location.origin}/` });
}

export function accountUrl(): string {
  return keycloak().createAccountUrl();
}
