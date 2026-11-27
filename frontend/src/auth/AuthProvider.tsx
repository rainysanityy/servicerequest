import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Me, Role } from '../api/types';
import { PageLoader } from '../components/ui';
import { initKeycloak, loadRuntimeConfig } from './keycloak';

interface AuthState {
  me: Me;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

// Einmalige Initialisierung (StrictMode führt Effekte in der Entwicklung doppelt aus)
let bootstrap: Promise<Me> | null = null;
function bootstrapOnce(): Promise<Me> {
  bootstrap ??= (async () => {
    const cfg = await loadRuntimeConfig();
    await initKeycloak(cfg);
    // Rollen kommen aus der serverseitig validierten Sicht (/api/me).
    // Die UI blendet nur aus – die Durchsetzung erfolgt ausschließlich im Backend.
    return api.get<Me>('/api/me');
  })();
  return bootstrap;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrapOnce().then((me) => {
      setState({ me, hasRole: (...roles) => me.roles.some((r) => roles.includes(r)) });
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen');
    });
  }, []);

  if (error) {
    return (
      <main className="loader-wavy">
        <div className="card stack" role="alert">
          <h1 className="headline-s">Anmeldung nicht möglich</h1>
          <p className="muted">{error}</p>
          <button className="btn filled" onClick={() => window.location.reload()}>Erneut versuchen</button>
        </div>
      </main>
    );
  }
  if (!state) return <PageLoader label="Anmeldung über Keycloak …" />;
  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('AuthProvider fehlt');
  return ctx;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}
