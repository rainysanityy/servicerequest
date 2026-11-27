import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Agent, FieldDef, Priority, Solution, TicketDetail as TD } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Dialog, ErrorBanner, PageLoader, PriorityLabel, StatusChip, useApi, useSnackbar } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRelative, PRIORITY_LABEL, ROLE_LABEL } from '../util/format';

const USER_ACTION_LABEL: Record<string, { label: string; icon: string; style: string }> = {
  withdrawn: { label: 'Anfrage zurückziehen', icon: 'undo', style: 'outlined' },
  closed: { label: 'Lösung bestätigen', icon: 'check', style: 'filled' },
  in_progress: { label: 'Nicht gelöst – erneut öffnen', icon: 'refresh', style: 'tonal' },
};

const EVENT_TEXT: Record<string, (e: { from_value: string | null; to_value: string | null }, label: (c: string | null) => string) => string> = {
  created: () => 'Ticket erstellt',
  status: (e, l) => `Status: ${l(e.from_value)} → ${l(e.to_value)}`,
  priority: (e) => `Priorität: ${PRIORITY_LABEL[e.from_value ?? ''] ?? e.from_value} → ${PRIORITY_LABEL[e.to_value ?? ''] ?? e.to_value}`,
  assigned: (e) => (e.to_value ? 'Ticket zugewiesen' : 'Zuweisung aufgehoben'),
  withdrawn: () => 'Anfrage zurückgezogen',
  solution: (e) => `Standardlösung angewendet: ${e.to_value ?? ''}`,
};

function renderValue(f: FieldDef, v: unknown): string {
  if (v === undefined || v === null || v === '') return '–';
  if (f.type === 'checkbox') return v ? 'Ja' : 'Nein';
  if (f.type === 'select') return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === 'date') return fmtDate(String(v));
  return String(v);
}

export default function TicketDetail({ supportView = false }: { supportView?: boolean }) {
  const { id = '' } = useParams();
  const { me, hasRole } = useAuth();
  const snack = useSnackbar();
  const isSupport = hasRole('first-level', 'admin');
  const detail = useApi(() => api.get<TD>(`/api/tickets/${encodeURIComponent(id)}`), [id]);
  const statuses = useApi(() => api.get<{ code: string; label: string }[]>('/api/statuses'), []);
  const agents = useApi(() => (isSupport ? api.get<Agent[]>('/api/support/agents') : Promise.resolve([])), [isSupport]);
  const catId = detail.data?.ticket.category_id;
  const solutions = useApi(
    () => (isSupport && catId ? api.get<Solution[]>('/api/support/solutions', { category: catId }) : Promise.resolve([])),
    [isSupport, catId],
  );

  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<{ code: string; label: string } | null>(null);
  const [pendingComment, setPendingComment] = useState('');
  const [solutionId, setSolutionId] = useState('');

  const labelOf = useMemo(() => {
    const m = new Map((statuses.data ?? []).map((s) => [s.code, s.label]));
    return (c: string | null) => (c ? m.get(c) ?? c : '–');
  }, [statuses.data]);

  if (detail.loading && !detail.data) return <PageLoader />;
  if (detail.error || !detail.data) return <ErrorBanner error={detail.error ?? new ApiError(404, 'Ticket nicht gefunden')} />;

  const { ticket: t, comments, events, allowedTransitions, canComment, canInternalComment } = detail.data;
  const isRequester = t.requester_sub === me.sub;
  const showSupportPanel = isSupport && (supportView || !isRequester);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      snack(okMsg);
      detail.reload();
    } catch (e) {
      setActionError(e);
      if (e instanceof ApiError && e.status === 409) detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const sendComment = (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    void run(async () => {
      await api.post(`/api/tickets/${t.id}/comments`, { body: comment.trim(), internal });
      setComment('');
      setInternal(false);
    }, internal ? 'Interne Notiz gespeichert' : 'Nachricht gesendet');
  };

  const doTransition = (code: string, withComment?: string) =>
    run(() => api.post(`/api/tickets/${t.id}/transition`, { to: code, version: t.version, ...(withComment ? { comment: withComment } : {}) }),
      `Status geändert: ${labelOf(code)}`);

  // Zeitleiste aus Kommentaren und Ereignissen
  const timeline = [
    ...comments.map((c) => ({ kind: 'c' as const, at: c.created_at, c })),
    ...events.filter((e) => e.event_type !== 'comment').map((e) => ({ kind: 'e' as const, at: e.created_at, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const userActions = allowedTransitions.filter((a) => isRequester && USER_ACTION_LABEL[a.code]);
  const backTo = supportView ? '/support' : '/tickets';

  return (
    <>
      <nav className="breadcrumb" aria-label="Brotkrumen">
        <Link to={backTo} className="row gap-sm"><Icon name="back" size={18} /> {supportView ? 'Support-Queue' : 'Meine Tickets'}</Link>
      </nav>

      <header className="page-head">
        <div className="stack gap-sm">
          <span className="row">
            <span className="mono muted">{t.number}</span>
            <StatusChip label={t.status_label} color={t.status_color} />
            <PriorityLabel priority={t.priority} />
            {t.overdue ? <span className="chip tone-error"><Icon name="schedule" size={16} /> SLA überschritten</span> : null}
          </span>
          <h1 className="headline-l">{t.title}</h1>
          <span className="muted body-m">{t.category_name}{t.item_name ? ` · ${t.item_name}` : ''} · erstellt {fmtDateTime(t.created_at)}</span>
        </div>
      </header>

      {t.status === 'waiting_for_user' && isRequester ? (
        <div className="banner tone-warning" role="status"><Icon name="chat" /><div><strong>Der Support hat eine Rückfrage.</strong> Bitte antworten Sie unten – das Ticket geht danach automatisch zurück in die Bearbeitung.</div></div>
      ) : null}
      {t.status === 'resolved' && isRequester ? (
        <div className="banner tone-success" role="status"><Icon name="check" /><div><strong>Ihr Anliegen wurde gelöst.</strong> Bitte bestätigen Sie die Lösung oder öffnen Sie das Ticket erneut.</div></div>
      ) : null}
      <ErrorBanner error={actionError} />

      <div className="split">
        <div className="stack">
          {userActions.length > 0 ? (
            <div className="row">
              {userActions.map((a) => {
                const ua = USER_ACTION_LABEL[a.code]!;
                return (
                  <button key={a.code} className={`btn ${ua.style}`} disabled={busy}
                    onClick={() => (a.code === 'withdrawn' ? setPending(a) : void doTransition(a.code))}>
                    <Icon name={ua.icon} size={18} /> {ua.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <section className="card stack" aria-labelledby="details-title">
            <h2 id="details-title" className="title-l">Angaben zur Anfrage</h2>
            {t.anonymized ? <p className="muted">Dieses Ticket wurde gemäß Löschkonzept anonymisiert.</p> : (
              <dl className="kv">
                {(t.form_schema?.fields ?? []).map((f) => (
                  <div key={f.name} className="kv-row"><dt>{f.label}</dt><dd>{renderValue(f, t.form_data[f.name])}</dd></div>
                ))}
                {t.description ? <div className="kv-row"><dt>Weitere Hinweise</dt><dd className="pre">{t.description}</dd></div> : null}
              </dl>
            )}
          </section>

          <section className="card stack" aria-labelledby="conv-title">
            <h2 id="conv-title" className="title-l">Verlauf & Kommunikation</h2>
            <div className="timeline" aria-live="polite">
              {timeline.map((item, idx) => item.kind === 'c' ? (
                <div key={`c${item.c.id}`} className={`bubble ${item.c.mine ? 'mine' : ''} ${item.c.internal ? 'internal' : ''}`}>
                  <div className="who">
                    {item.c.author_name} · {ROLE_LABEL[item.c.author_role] ?? item.c.author_role}
                    {item.c.internal ? ' · INTERNE NOTIZ' : ''} · <time dateTime={item.c.created_at} title={fmtDateTime(item.c.created_at)}>{fmtRelative(item.c.created_at)}</time>
                  </div>
                  {item.c.body}
                </div>
              ) : (
                <div key={`e${idx}`} className="event">
                  {(EVENT_TEXT[item.e.event_type] ?? (() => item.e.event_type))(item.e, labelOf)}
                  {item.e.actor_name ? ` · ${item.e.actor_name}` : ''} · {fmtDateTime(item.e.created_at)}
                </div>
              ))}
            </div>
            {canComment ? (
              <form onSubmit={sendComment} className="stack">
                <div className="field">
                  <label htmlFor="comment">{isRequester && t.status === 'waiting_for_user' ? 'Ihre Antwort' : 'Nachricht'}</label>
                  <textarea id="comment" className="textarea" maxLength={5000} value={comment} onChange={(e) => setComment(e.target.value)}
                    placeholder={internal ? 'Interne Notiz – nur für den Support sichtbar' : 'Nachricht schreiben …'} />
                </div>
                <div className="row between">
                  {canInternalComment ? (
                    <label className="checkbox"><input type="checkbox" className="switch" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Interne Notiz</label>
                  ) : <span />}
                  <button className="btn filled" type="submit" disabled={busy || !comment.trim()}><Icon name="send" size={18} /> Senden</button>
                </div>
              </form>
            ) : <p className="muted">Das Ticket ist abgeschlossen. Für neue Anliegen erstellen Sie bitte eine neue Anfrage.</p>}
          </section>
        </div>

        <aside className="stack sticky-side" aria-label="Ticketinformationen">
          {showSupportPanel ? (
            <section className="card stack" aria-labelledby="sp-title">
              <h2 id="sp-title" className="title-l row"><Icon name="support" /> Bearbeitung</h2>
              <div className="field">
                <label htmlFor="assignee">Zugewiesen an</label>
                <select id="assignee" className="select" value={t.assignee_sub ?? ''} disabled={busy}
                  onChange={(e) => void run(() => api.post(`/api/support/tickets/${t.id}/assign`, { assigneeSub: e.target.value || null, version: t.version }), 'Zuweisung gespeichert')}>
                  <option value="">– nicht zugewiesen –</option>
                  {(agents.data ?? []).map((a) => <option key={a.sub} value={a.sub}>{a.display_name}</option>)}
                </select>
                {t.assignee_sub !== me.sub ? (
                  <button className="btn text small" disabled={busy}
                    onClick={() => void run(() => api.post(`/api/support/tickets/${t.id}/assign`, { assigneeSub: me.sub, version: t.version }), 'Ticket übernommen')}>
                    <Icon name="person" size={18} /> Mir zuweisen
                  </button>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="prio">Priorität</label>
                <select id="prio" className="select" value={t.priority} disabled={busy}
                  onChange={(e) => void run(() => api.post(`/api/support/tickets/${t.id}/priority`, { priority: e.target.value as Priority, version: t.version }), 'Priorität geändert')}>
                  {(['critical', 'high', 'medium', 'low'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </div>
              <div className="stack gap-sm">
                <span className="label-l">Status ändern</span>
                <div className="row">
                  {allowedTransitions.length === 0 ? <span className="muted body-m">Keine Übergänge verfügbar</span> : allowedTransitions.map((a) => (
                    <button key={a.code} className={`btn small ${a.code === 'resolved' ? 'filled' : a.code === 'rejected' ? 'outlined' : 'tonal'}`}
                      disabled={busy} onClick={() => { setPending(a); setPendingComment(''); }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              {(solutions.data ?? []).length > 0 && allowedTransitions.some((a) => a.code === 'resolved') ? (
                <div className="field">
                  <label htmlFor="sol">Standardlösung anwenden</label>
                  <div className="row">
                    <select id="sol" className="select" value={solutionId} onChange={(e) => setSolutionId(e.target.value)}>
                      <option value="">Bitte wählen …</option>
                      {solutions.data!.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                    <button className="btn tonal" disabled={!solutionId || busy}
                      onClick={() => void run(() => api.post(`/api/support/tickets/${t.id}/apply-solution`, { solutionId, version: t.version }), 'Lösung gesendet, Ticket gelöst')}>
                      <Icon name="lightbulb" size={18} /> Anwenden
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card outlined stack" aria-labelledby="info-title">
            <h2 id="info-title" className="title-m">Übersicht</h2>
            <dl className="kv">
              <div className="kv-row"><dt>Status</dt><dd>{t.status_label}</dd></div>
              <div className="kv-row"><dt>Priorität</dt><dd>{PRIORITY_LABEL[t.priority]}</dd></div>
              <div className="kv-row"><dt>Angefragt von</dt><dd>{t.requester_name}{t.requester_email ? <><br /><span className="body-s muted">{t.requester_email}</span></> : null}</dd></div>
              <div className="kv-row"><dt>Bearbeitung</dt><dd>{t.assignee_name ?? 'Noch nicht zugewiesen'}</dd></div>
              <div className="kv-row"><dt>Reaktion bis</dt><dd>{fmtDateTime(t.response_due_at)}{t.first_response_at ? ' ✓' : ''}</dd></div>
              <div className="kv-row"><dt>Lösung bis</dt><dd className={t.overdue ? 'overdue' : ''}>{fmtDateTime(t.due_at)}</dd></div>
              {t.resolved_at ? <div className="kv-row"><dt>Gelöst am</dt><dd>{fmtDateTime(t.resolved_at)}</dd></div> : null}
              {t.closed_at ? <div className="kv-row"><dt>Abgeschlossen</dt><dd>{fmtDateTime(t.closed_at)}</dd></div> : null}
            </dl>
          </section>
        </aside>
      </div>

      <Dialog open={!!pending} title={pending ? (pending.code === 'withdrawn' ? 'Anfrage zurückziehen?' : `Status: ${pending.label}`) : ''}
        onClose={() => setPending(null)}
        actions={<>
          <button className="btn text" onClick={() => setPending(null)}>Abbrechen</button>
          <button className={`btn ${pending?.code === 'withdrawn' || pending?.code === 'rejected' ? 'danger' : 'filled'}`} disabled={busy || (pending?.code === 'waiting_for_user' && !pendingComment.trim())}
            onClick={() => { const p = pending!; setPending(null); void doTransition(p.code, pendingComment.trim() || undefined); }}>
            Bestätigen
          </button>
        </>}>
        {pending?.code === 'withdrawn' ? <p>Die Anfrage wird geschlossen und nicht weiter bearbeitet.</p> : (
          <div className="field">
            <label htmlFor="pc">{pending?.code === 'waiting_for_user' ? 'Rückfrage an die anfragende Person (Pflicht)' : 'Kommentar an die anfragende Person (optional)'}</label>
            <textarea id="pc" className="textarea" maxLength={5000} value={pendingComment} onChange={(e) => setPendingComment(e.target.value)} />
          </div>
        )}
      </Dialog>
    </>
  );
}
