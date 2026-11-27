import { getAccessToken, keycloak } from '../auth/keycloak';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  // Nur relative API-Pfade derselben Origin zulassen
  if (!path.startsWith('/api/')) throw new Error('Ungültiger API-Pfad');
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(buildUrl(path, query), {
    method,
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    await keycloak().login();
    throw new ApiError(401, 'Sitzung abgelaufen');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, data.message ?? `Fehler ${res.status}`, data.issues ?? []);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};
