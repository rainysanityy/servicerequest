import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Paged, TicketListItem } from '../api/types';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorBanner, ListSkeleton, Pagination, Segmented, TicketRow, useApi } from '../components/ui';

type State = 'open' | 'closed' | 'all';

export default function MyTickets() {
  const [params, setParams] = useSearchParams();
  const state = (['open', 'closed', 'all'].includes(params.get('state') ?? '') ? params.get('state') : 'open') as State;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };

  useEffect(() => { if ((params.get('q') ?? '') !== debounced) update({ q: debounced, page: null }); /* eslint-disable-next-line */ }, [debounced]);

  const { data, error, loading, reload } = useApi(
    () => api.get<Paged<TicketListItem>>('/api/tickets', { state, q: debounced, page, pageSize: 15 }),
    [state, debounced, page],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display-s">Meine Tickets</h1>
          <p className="muted body-l">Status verfolgen, Rückfragen beantworten, Lösungen bestätigen.</p>
        </div>
        <Link to="/katalog" className="btn filled"><Icon name="add" /> Neue Anfrage</Link>
      </div>
      <div className="toolbar">
        <Segmented<State> label="Ticketstatus filtern" value={state} onChange={(v) => update({ state: v, page: null })}
          options={[{ value: 'open', label: 'Offen' }, { value: 'closed', label: 'Abgeschlossen' }, { value: 'all', label: 'Alle' }]} />
        <div className="search">
          <Icon name="search" />
          <label htmlFor="t-search" className="sr-only">Tickets durchsuchen</label>
          <input id="t-search" type="search" className="input" placeholder="Titel oder Ticketnummer suchen" value={q} maxLength={100}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="icon-btn" onClick={reload} aria-label="Aktualisieren" title="Aktualisieren"><Icon name="refresh" /></button>
      </div>
      <ErrorBanner error={error} />
      {loading ? <ListSkeleton rows={5} /> : data && data.items.length > 0 ? (
        <div className="stack">
          <div className="list">{data.items.map((t) => <TicketRow key={t.id} t={t} to={`/tickets/${t.id}`} />)}</div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />
        </div>
      ) : (
        <EmptyState title={state === 'open' ? 'Keine offenen Tickets' : 'Keine Tickets gefunden'}>
          <Link to="/katalog" className="btn tonal">Neue Anfrage stellen</Link>
        </EmptyState>
      )}
    </>
  );
}
