import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { ColorRole, TicketListItem } from '../api/types';
import { fmtRelative, PRIORITY_LABEL } from '../util/format';
import { Icon } from './Icon';

/* ---------------------------------------------------------------- Status-Chip */
export function StatusChip({ label, color }: { label: string; color: ColorRole }) {
  return <span className={`chip status tone-${color}`}>{label}</span>;
}

export function PriorityLabel({ priority }: { priority: string }) {
  return (
    <span className={`prio ${priority}`}>
      {priority === 'critical' || priority === 'high' ? <Icon name="bolt" size={16} /> : null}
      {PRIORITY_LABEL[priority] ?? priority}
    </span>
  );
}

/* ---------------------------------------------------------------- Skeleton */
export function Skeleton({ height = 20, width = '100%', radius }: { height?: number; width?: number | string; radius?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Maße per CSSOM setzen (CSP-konform)
    if (!ref.current) return;
    ref.current.style.height = `${height}px`;
    ref.current.style.width = typeof width === 'number' ? `${width}px` : width;
    if (radius !== undefined) ref.current.style.borderRadius = `${radius}px`;
  }, [height, width, radius]);
  return <div ref={ref} className="skeleton" aria-hidden="true" />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" role="status" aria-label="Wird geladen">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={76} radius={20} />
      ))}
    </div>
  );
}

export function PageLoader({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div className="loader-wavy" role="status" aria-live="polite">
      <div className="stack">
        <div className="progress-linear" />
        <span className="muted">{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={48} />
      <p className="title-l">{title}</p>
      {children}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Unerwarteter Fehler. Bitte erneut versuchen.';
  return (
    <div className="banner tone-error" role="alert">
      <Icon name="warning" />
      <div>
        <strong>{msg}</strong>
        {error instanceof ApiError && error.issues.length > 0 ? (
          <ul className="body-m">{error.issues.map((i) => <li key={i.path + i.message}>{i.message}</li>)}</ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Ticketzeile */
export function TicketRow({ t, to, showRequester }: { t: TicketListItem; to: string; showRequester?: boolean }) {
  return (
    <Link className="list-item" to={to}>
      <span className={`avatar ${t.overdue ? 'tone-error' : 'tone-secondary'}`} aria-hidden="true">
        <Icon name={t.category_id === 'hardware' ? 'laptop' : t.category_id === 'software' ? 'apps' : t.category_id === 'access' ? 'key' : 'help'} size={20} />
      </span>
      <span className="stack">
        <span className="title-m">{t.title}</span>
        <span className="meta">
          <span className="mono">{t.number}</span>
          <span>{t.item_name ?? t.category_name}</span>
          {showRequester ? <span>von {t.requester_name}</span> : null}
          <span>aktualisiert {fmtRelative(t.updated_at)}</span>
          {showRequester ? <span>{t.assignee_name ? `→ ${t.assignee_name}` : 'nicht zugewiesen'}</span> : null}
          {t.overdue ? <span className="overdue">SLA überschritten</span> : null}
        </span>
      </span>
      <span className="row">
        {showRequester ? <PriorityLabel priority={t.priority} /> : null}
        <StatusChip label={t.status_label} color={t.status_color} />
        <Icon name="chevron" />
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- Segmented */
export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value ? <Icon name="check" size={18} /> : o.icon ? <Icon name={o.icon} size={18} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row between" aria-label="Seitennavigation">
      <span className="muted body-m">{total} Einträge · Seite {page} von {pages}</span>
      <span className="row">
        <button className="btn outlined small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Zurück</button>
        <button className="btn outlined small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Weiter</button>
      </span>
    </nav>
  );
}

/* ---------------------------------------------------------------- Dialog */
export function Dialog({ open, title, children, onClose, actions }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onClose={onClose} onCancel={onClose}>
      <h2 id="dlg-title" className="headline-s">{title}</h2>
      <div className="stack">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}

/* ---------------------------------------------------------------- Snackbar */
interface Snack { id: number; text: string; error?: boolean }
const SnackCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snacks, setSnacks] = useState<Snack[]>([]);
  const show = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setSnacks((s) => [...s.slice(-2), { id, text, error }]);
    window.setTimeout(() => setSnacks((s) => s.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <SnackCtx.Provider value={show}>
      {children}
      <div className="snackbar-host" role="status" aria-live="polite">
        {snacks.map((s) => (
          <div key={s.id} className={`snackbar ${s.error ? 'error' : ''}`}>
            <Icon name={s.error ? 'warning' : 'check'} size={20} />
            <span>{s.text}</span>
          </div>
        ))}
      </div>
    </SnackCtx.Provider>
  );
}
export const useSnackbar = () => useContext(SnackCtx);

/* ---------------------------------------------------------------- Datenhook */
export function useApi<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
