import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Category } from '../api/types';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorBanner, Skeleton, useApi } from '../components/ui';
import { CATEGORY_TONE } from '../util/format';

export default function Catalog() {
  const { categoryId } = useParams();
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi(() => api.get<{ categories: Category[] }>('/api/catalog'), []);

  const categories = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.categories ?? [])
      .filter((c) => !categoryId || c.id === categoryId)
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => !term || `${i.name} ${i.description} ${c.name}`.toLowerCase().includes(term)),
      }))
      .filter((c) => c.items.length > 0);
  }, [data, q, categoryId]);

  const active = data?.categories.find((c) => c.id === categoryId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display-s">{active ? active.name : 'Service-Katalog'}</h1>
          <p className="muted body-l">{active ? active.description : 'Wählen Sie die passende Anfrage – wir führen Sie durch das Formular.'}</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="cat-search">Katalog durchsuchen</label>
          <input id="cat-search" className="input" type="search" placeholder="Katalog durchsuchen (z. B. Monitor, Lizenz, Laufwerk)"
            value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div className="row" role="group" aria-label="Kategorie filtern">
        <Link to="/katalog" className="chip filter" aria-pressed={!categoryId}>Alle</Link>
        {data?.categories.map((c) => (
          <Link key={c.id} to={`/katalog/${c.id}`} className="chip filter" aria-pressed={c.id === categoryId}>
            <Icon name={c.icon} size={18} /> {c.name}
          </Link>
        ))}
      </div>

      <ErrorBanner error={error} />
      {loading ? (
        <div className="grid cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={160} radius={28} />)}</div>
      ) : categories.length === 0 ? (
        <EmptyState icon="search" title="Keine passenden Einträge">
          <p>Nichts gefunden? Nutzen Sie die <Link to="/katalog/general">allgemeine IT-Anfrage</Link>.</p>
        </EmptyState>
      ) : (
        categories.map((c) => (
          <section key={c.id} aria-labelledby={`cat-${c.id}`}>
            <div className="section-title">
              <h2 id={`cat-${c.id}`} className="headline-s row"><span className={`avatar ${CATEGORY_TONE[c.id] ?? 'tone-primary'}`}><Icon name={c.icon} size={20} /></span>{c.name}</h2>
            </div>
            <div className="grid cols-3">
              {c.items.map((i) => (
                <Link key={i.id} to={`/anfrage/${i.id}`} className="card interactive stack">
                  <span className="row between">
                    <span className="title-l">{i.name}</span>
                    <Icon name="chevron" />
                  </span>
                  <span className="body-m muted">{i.description}</span>
                  <span className="row">
                    {i.requires_approval ? <span className="chip tone-warning"><Icon name="verified" size={16} /> Freigabe erforderlich</span> : <span className="chip tone-success"><Icon name="bolt" size={16} /> Ohne Freigabe</span>}
                    {i.popular ? <span className="chip tone-tertiary">Häufig genutzt</span> : null}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
