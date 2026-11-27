import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { accountUrl, logout } from '../auth/keycloak';
import { SEEDS, useTheme, type SchemeVariant, type ThemeMode } from '../theme/ThemeProvider';
import { initials, ROLE_LABEL } from '../util/format';
import { ExpressiveShape, Icon } from './Icon';

interface NavEntry { to: string; label: string; icon: string; end?: boolean }

function useNav(): NavEntry[] {
  const { hasRole } = useAuth();
  const items: NavEntry[] = [
    { to: '/', label: 'Start', icon: 'home', end: true },
    { to: '/katalog', label: 'Katalog', icon: 'category' },
    { to: '/tickets', label: 'Meine Tickets', icon: 'list' },
  ];
  if (hasRole('first-level', 'admin')) items.push({ to: '/support', label: 'Support', icon: 'support' });
  if (hasRole('admin')) items.push({ to: '/admin', label: 'Admin', icon: 'admin' });
  return items;
}

function NavItems({ items }: { items: NavEntry[] }) {
  return (
    <>
      {items.map((i) => (
        // NavLink setzt aria-current="page" automatisch
        <NavLink key={i.to} to={i.to} end={i.end} className="nav-item">
          <span className="indicator"><Icon name={i.icon} /></span>
          <span>{i.label}</span>
        </NavLink>
      ))}
    </>
  );
}

const MODES: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Hell', icon: 'light' },
  { value: 'dark', label: 'Dunkel', icon: 'dark' },
  { value: 'system', label: 'System', icon: 'auto' },
];
const VARIANTS: { value: SchemeVariant; label: string }[] = [
  { value: 'vibrant', label: 'Lebendig' },
  { value: 'expressive', label: 'Expressiv' },
  { value: 'tonal', label: 'Ruhig' },
];

function ThemeToggle() {
  const { mode, setMode, resolved } = useTheme();
  const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const current = MODES.find((m) => m.value === mode)!;
  return (
    <button className="icon-btn" onClick={() => setMode(next)}
      aria-label={`Farbmodus: ${current.label} (aktiv: ${resolved === 'dark' ? 'dunkel' : 'hell'}). Wechseln zu ${MODES.find((m) => m.value === next)!.label}`}
      title={`Farbmodus: ${current.label}`}>
      <Icon name={current.icon} />
    </button>
  );
}

function UserMenu() {
  const { me } = useAuth();
  const { mode, setMode, seed, setSeed, variant, setVariant } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  return (
    <div ref={ref} className="menu-anchor">
      <button className="avatar tone-tertiary icon-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={`Benutzermenü für ${me.name}`}>
        {initials(me.name)}
      </button>
      {open ? (
        <div className="menu-pop" role="menu">
          <div className="stack">
            <div className="menu-head">
              <div className="title-m">{me.name}</div>
              <div className="body-s muted">{me.email ?? me.username}</div>
              <div className="row menu-roles">
                {me.roles.map((r) => <span key={r} className="chip tone-secondary">{ROLE_LABEL[r] ?? r}</span>)}
              </div>
            </div>
          </div>
          <hr />
          <div className="menu-section">
            <div className="label-m muted">Darstellung</div>
            <div className="segmented" role="group" aria-label="Farbmodus">
              {MODES.map((m) => (
                <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>
                  <Icon name={m.icon} size={18} />{m.label}
                </button>
              ))}
            </div>
            <div className="label-m muted">Farbpalette</div>
            <div className="row" role="group" aria-label="Farbpalette">
              {SEEDS.map((s) => (
                <button key={s.id} type="button" className={`swatch swatch-${s.id}`} aria-pressed={seed === s.hex}
                  aria-label={s.label} title={s.label} onClick={() => setSeed(s.hex)} />
              ))}
            </div>
            <div className="label-m muted">Farbschema</div>
            <div className="segmented" role="group" aria-label="Farbschema">
              {VARIANTS.map((v) => (
                <button key={v.value} type="button" aria-pressed={variant === v.value} onClick={() => setVariant(v.value)}>{v.label}</button>
              ))}
            </div>
          </div>
          <hr />
          <a className="menu-item" role="menuitem" href={accountUrl()} rel="noopener noreferrer">
            <Icon name="person" /> Konto & Sicherheit (Keycloak)
          </a>
          <button className="menu-item" role="menuitem" onClick={logout}>
            <Icon name="logout" /> Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const items = useNav();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Zum Inhalt springen</a>
      <nav className="nav-rail" aria-label="Hauptnavigation">
        <Link to="/katalog" className="fab" aria-label="Neue Anfrage erstellen" title="Neue Anfrage">
          <Icon name="add" />
        </Link>
        <NavItems items={items} />
        <div className="nav-spacer" />
      </nav>
      <div className="main">
        <header className="top-bar">
          <Link to="/" className="brand" aria-label="IT-Service-Portal Startseite">
            <span className="brand-mark"><ExpressiveShape lobes={8} depth={0.07} /></span>
            <span>IT-Service-Portal</span>
          </Link>
          <span className="grow" />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="content">
          {children}
        </main>
      </div>
      <Link to="/katalog" className="fab extended fab-mobile" aria-label="Neue Anfrage erstellen">
        <Icon name="add" /> Neue Anfrage
      </Link>
      <nav className="nav-bar" aria-label="Hauptnavigation (mobil)">
        <NavItems items={items} />
      </nav>
    </div>
  );
}
