import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Category, Paged, TicketListItem } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { getRuntimeConfig } from '../auth/keycloak';
import { ExpressiveShape, Icon } from '../components/Icon';
import { EmptyState, ErrorBanner, ListSkeleton, Skeleton, TicketRow, useApi } from '../components/ui';
import { CATEGORY_TONE } from '../util/format';

interface Summary { open: string; waiting_for_me: string; to_confirm: string; closed: string }

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export default function Home() {
  const { me } = useAuth();
  const cfg = getRuntimeConfig();
  const catalog = useApi(() => api.get<{ categories: Category[] }>('/api/catalog'), []);
  const summary = useApi(() => api.get<Summary>('/api/tickets/summary'), []);
  const recent = useApi(() => api.get<Paged<TicketListItem>>('/api/tickets', { state: 'open', pageSize: 5 }), []);

  const popular = catalog.data?.categories.flatMap((c) => c.items.filter((i) => i.popular).map((i) => ({ ...i, icon: c.icon }))).slice(0, 6) ?? [];
  const firstName = me.name.split(' ')[0];

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <ExpressiveShape className="shape a" lobes={10} depth={0.06} />
        <ExpressiveShape className="shape b" lobes={6} depth={0.1} />
        <div>
          <p className="title-m mt-0">{greeting()}, {firstName}!</p>
          <h1 id="hero-title" className="display-m">Wobei können wir helfen?</h1>
          <p className="body-l">Neue Hardware, Software, Berechtigungen oder eine allgemeine Frage – stellen Sie Ihre Anfrage in wenigen Schritten.</p>
          <div className="hero-actions">
            <Link to="/katalog" className="btn filled large"><Icon name="add" /> Neue Anfrage</Link>
            <Link to="/tickets" className="btn tonal large"><Icon name="list" /> Meine Tickets</Link>
          </div>
        </div>
      </section>

      {summary.data && (Number(summary.data.waiting_for_me) > 0 || Number(summary.data.to_confirm) > 0) ? (
        <div className="banner tone-warning" role="status">
          <Icon name="info" />
          <div>
            {Number(summary.data.waiting_for_me) > 0 ? <div><strong>{summary.data.waiting_for_me}</strong> Ticket(s) warten auf Ihre Antwort.</div> : null}
            {Number(summary.data.to_confirm) > 0 ? <div><strong>{summary.data.to_confirm}</strong> gelöste(s) Ticket(s) bitte bestätigen.</div> : null}
            <Link to="/tickets?filter=open">Jetzt ansehen</Link>
          </div>
        </div>
      ) : null}

      <div className="section-title">
        <h2 className="headline-s">Kategorien</h2>
        <Link to="/katalog" className="btn text">Gesamter Katalog <Icon name="chevron" size={18} /></Link>
      </div>
      <ErrorBanner error={catalog.error} />
      <div className="grid cols-4">
        {catalog.loading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={196} radius={28} />)
          : catalog.data?.categories.map((c) => (
              <Link key={c.id} to={`/katalog/${c.id}`} className="card interactive category-tile">
                <span className={`tile-icon ${CATEGORY_TONE[c.id] ?? 'tone-primary'}`}><Icon name={c.icon} size={32} /></span>
                <span className="title-l">{c.name}</span>
                <span className="body-m muted">{c.description}</span>
              </Link>
            ))}
      </div>

      <div className="split">
        <section aria-labelledby="recent-title">
          <div className="section-title">
            <h2 id="recent-title" className="headline-s">Meine offenen Tickets</h2>
            {summary.data ? <span className="chip tone-secondary">{summary.data.open} offen</span> : null}
          </div>
          <ErrorBanner error={recent.error} />
          {recent.loading ? <ListSkeleton rows={3} /> : recent.data && recent.data.items.length > 0 ? (
            <div className="list">{recent.data.items.map((t) => <TicketRow key={t.id} t={t} to={`/tickets/${t.id}`} />)}</div>
          ) : (
            <div className="card"><EmptyState icon="check" title="Keine offenen Tickets">
              <p className="muted">Alles erledigt. Neue Anfragen erstellen Sie über den Katalog.</p>
            </EmptyState></div>
          )}
        </section>

        <aside aria-labelledby="quick-title">
          <div className="section-title"><h2 id="quick-title" className="headline-s">Schnellzugriff</h2></div>
          <div className="card stack">
            {catalog.loading ? <ListSkeleton rows={3} /> : popular.map((i) => (
              <Link key={i.id} to={`/anfrage/${i.id}`} className="row between list-link">
                <span className="row"><span className="avatar tone-primary"><Icon name={i.icon} size={20} /></span>
                  <span><span className="title-s">{i.name}</span><br /><span className="body-s muted">{i.description}</span></span></span>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
          <div className="card filled stack quick-help">
            <span className="row"><Icon name="support" /><strong>Dringende Störung?</strong></span>
            <span className="body-m">Bei Betriebsunterbrechungen erreichen Sie den Service Desk telefonisch unter <strong>{cfg?.supportPhone ?? '—'}</strong> ({cfg?.supportHours ?? 'Servicezeiten'}).</span>
          </div>
        </aside>
      </div>
    </>
  );
}
