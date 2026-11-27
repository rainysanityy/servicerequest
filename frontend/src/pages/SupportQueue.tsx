import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Agent, Category, Paged, TicketListItem } from '../api/types';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorBanner, ListSkeleton, Pagination, Segmented, Skeleton, TicketRow, useApi } from '../components/ui';
import { PRIORITY_LABEL } from '../util/format';

interface Stats { new: string; unassigned: string; mine: string; waiting_for_user: string; overdue: string; critical: string; resolved_7d: string }

type View = 'open' | 'all' | 'final';

const QUICK = [
  { key: 'unassigned', label: 'Nicht zugewiesen', icon: 'inbox', patch: { assignee: 'unassigned', overdue: null } },
  { key: 'mine', label: 'Mir zugewiesen', icon: 'person', patch: { assignee: 'me', overdue: null } },
  { key: 'overdue', label: 'SLA überschritten', icon: 'schedule', patch: { overdue: 'true', assignee: null } },
] as const;

export default function SupportQueue() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const view = (['open', 'all', 'final'].includes(get('view')) ? get('view') : 'open') as View;
  const page = Math.max(1, Number(get('page')) || 1);
  const [q, setQ] = useState(get('q'));

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = window.setTimeout(() => { if (q.trim() !== get('q')) update({ q: q.trim() || null }); }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stats = useApi(() => api.get<Stats>('/api/support/stats'), [params.toString()]);
  const agents = useApi(() => api.get<Agent[]>('/api/support/agents'), []);
  const catalog = useApi(() => api.get<{ categories: Category[] }>('/api/catalog'), []);
  const list = useApi(() => api.get<Paged<TicketListItem>>('/api/support/tickets', {
    view, page, pageSize: 20, q: get('q'), status: get('status'), priority: get('priority'),
    category: get('category'), assignee: get('assignee'), overdue: get('overdue'), sort: get('sort') || 'priority',
  }), [params.toString()]);

  const kpis: { label: string; value?: string; tone: string }[] = [
    { label: 'Neu', value: stats.data?.new, tone: 'tone-primary' },
    { label: 'Nicht zugewiesen', value: stats.data?.unassigned, tone: 'tone-secondary' },
    { label: 'Mir zugewiesen', value: stats.data?.mine, tone: 'tone-tertiary' },
    { label: 'SLA überschritten', value: stats.data?.overdue, tone: 'tone-error' },
    { label: 'Kritisch offen', value: stats.data?.critical, tone: 'tone-warning' },
    { label: 'Gelöst (7 Tage)', value: stats.data?.resolved_7d, tone: 'tone-success' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display-s">Support-Arbeitsbereich</h1>
          <p className="muted body-l">First-Level-Support: sichten, priorisieren, zuweisen und lösen.</p>
        </div>
        <button className="btn tonal" onClick={() => { stats.reload(); list.reload(); }}><Icon name="refresh" /> Aktualisieren</button>
      </div>

      <div className="kpi-row" aria-label="Kennzahlen">
        {kpis.map((k) => (
          <div key={k.label} className={`stat ${k.tone}`}>
            <span className="label-l">{k.label}</span>
            {k.value === undefined ? <Skeleton height={40} width={60} /> : <span className="value">{k.value}</span>}
          </div>
        ))}
      </div>

      <div className="row" role="group" aria-label="Schnellfilter">
        {QUICK.map((f) => {
          const active = f.key === 'overdue' ? get('overdue') === 'true' : get('assignee') === f.patch.assignee;
          return (
            <button key={f.key} className="chip filter" aria-pressed={active}
              onClick={() => update(active ? { assignee: null, overdue: null } : { ...f.patch })}>
              <Icon name={active ? 'check' : f.icon} size={18} /> {f.label}
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <Segmented<View> label="Ansicht" value={view} onChange={(v) => update({ view: v })}
          options={[{ value: 'open', label: 'Offen' }, { value: 'final', label: 'Abgeschlossen' }, { value: 'all', label: 'Alle' }]} />
        <div className="search">
          <Icon name="search" />
          <label htmlFor="sq" className="sr-only">Tickets suchen</label>
          <input id="sq" className="input" type="search" placeholder="Nummer, Titel oder Person" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="f-prio">Priorität</label>
        <select id="f-prio" className="select" value={get('priority')} onChange={(e) => update({ priority: e.target.value || null })}>
          <option value="">Alle Prioritäten</option>
          {(['critical', 'high', 'medium', 'low'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-cat">Kategorie</label>
        <select id="f-cat" className="select" value={get('category')} onChange={(e) => update({ category: e.target.value || null })}>
          <option value="">Alle Kategorien</option>
          {catalog.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-ass">Bearbeiter/in</label>
        <select id="f-ass" className="select" value={get('assignee')} onChange={(e) => update({ assignee: e.target.value || null })}>
          <option value="">Alle Bearbeitenden</option>
          <option value="me">Mir zugewiesen</option>
          <option value="unassigned">Nicht zugewiesen</option>
          {agents.data?.map((a) => <option key={a.sub} value={a.sub}>{a.display_name}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-sort">Sortierung</label>
        <select id="f-sort" className="select" value={get('sort') || 'priority'} onChange={(e) => update({ sort: e.target.value })}>
          <option value="priority">Nach Priorität</option>
          <option value="due">Nach SLA-Fälligkeit</option>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="updated">Zuletzt aktualisiert</option>
        </select>
      </div>

      <ErrorBanner error={list.error} />
      {list.loading ? <ListSkeleton rows={6} /> : list.data && list.data.items.length > 0 ? (
        <div className="stack">
          <div className="list">{list.data.items.map((t) => <TicketRow key={t.id} t={t} to={`/support/tickets/${t.id}`} showRequester />)}</div>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => update({ page: String(p) })} />
        </div>
      ) : <EmptyState icon="check" title="Keine Tickets für diese Filter" />}
    </>
  );
}
