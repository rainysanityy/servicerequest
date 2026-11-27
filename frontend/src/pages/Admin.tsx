import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api/client';
import type { ColorRole, FormSchema, Paged, Priority, Solution } from '../api/types';
import { Icon } from '../components/Icon';
import { Dialog, EmptyState, ErrorBanner, ListSkeleton, Pagination, StatusChip, useApi, useSnackbar } from '../components/ui';
import { fmtDateTime, PRIORITY_LABEL, ROLE_LABEL } from '../util/format';
import { useAuth } from '../auth/AuthProvider';

/* =============================================================== Hilfen */
function useSaver() {
  const snack = useSnackbar();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (fn: () => Promise<unknown>, msg: string, after?: () => void) => {
    setBusy(true); setError(null);
    try { await fn(); snack(msg); after?.(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  return { busy, error, save, setError };
}

/* =============================================================== Übersicht */
interface SystemInfo {
  version: string; node: string; uptimeSeconds: number; database: string;
  migrations: { name: string; applied_at: string }[];
  counts: Record<string, string>;
  retention: { ticketDays: number; auditDays: number; ipDays: number };
}
function Overview() {
  const { data, error, loading } = useApi(() => api.get<SystemInfo>('/api/admin/system'), []);
  if (loading) return <ListSkeleton rows={3} />;
  if (error || !data) return <ErrorBanner error={error} />;
  const c = data.counts;
  return (
    <div className="stack">
      <div className="kpi-row">
        <div className="stat tone-primary"><span className="label-l">Tickets gesamt</span><span className="value">{c['tickets']}</span></div>
        <div className="stat tone-tertiary"><span className="label-l">Offen</span><span className="value">{c['open_tickets']}</span></div>
        <div className="stat tone-secondary"><span className="label-l">Benutzer (gesehen)</span><span className="value">{c['users']}</span></div>
        <div className="stat tone-success"><span className="label-l">Aktive Katalogeinträge</span><span className="value">{c['active_items']}</span></div>
        <div className="stat tone-neutral"><span className="label-l">Audit-Einträge</span><span className="value">{c['audit_entries']}</span></div>
      </div>
      <div className="grid cols-2">
        <section className="card stack">
          <h2 className="title-l row"><Icon name="dns" /> System</h2>
          <dl className="kv">
            <div className="kv-row"><dt>Portal-Version</dt><dd>{data.version}</dd></div>
            <div className="kv-row"><dt>Node.js</dt><dd>{data.node}</dd></div>
            <div className="kv-row"><dt>Datenbank</dt><dd>{data.database}</dd></div>
            <div className="kv-row"><dt>Laufzeit</dt><dd>{Math.round(data.uptimeSeconds / 3600)} h</dd></div>
            <div className="kv-row"><dt>Migrationen</dt><dd>{data.migrations.map((m) => m.name).join(', ')}</dd></div>
          </dl>
        </section>
        <section className="card stack">
          <h2 className="title-l row"><Icon name="lock" /> Aufbewahrung (DSGVO)</h2>
          <dl className="kv">
            <div className="kv-row"><dt>Tickets anonymisieren nach</dt><dd>{data.retention.ticketDays} Tagen</dd></div>
            <div className="kv-row"><dt>Audit-Log löschen nach</dt><dd>{data.retention.auditDays} Tagen</dd></div>
            <div className="kv-row"><dt>IP-Adressen entfernen nach</dt><dd>{data.retention.ipDays} Tagen</dd></div>
          </dl>
          <p className="body-s muted">Konfiguration über Umgebungsvariablen RETENTION_* (siehe Betriebs- und Datenschutzkonzept).</p>
        </section>
      </div>
      <Link className="btn tonal" to="/support?view=all"><Icon name="list" /> Übergreifende Ticketverwaltung öffnen</Link>
    </div>
  );
}

/* =============================================================== Katalog */
interface AdminItem {
  id: string; category_id: string; name: string; description: string; form_schema: FormSchema;
  default_priority: Priority; requires_approval: boolean; popular: boolean; sort_order: number; active: boolean;
}
interface AdminCategory { id: string; name: string; description: string; icon: string; sort_order: number; active: boolean }

const EMPTY_ITEM: Omit<AdminItem, 'id'> = {
  category_id: 'general', name: '', description: '', form_schema: { fields: [] }, default_priority: 'medium',
  requires_approval: false, popular: false, sort_order: 0, active: true,
};

function CatalogAdmin() {
  const items = useApi(() => api.get<AdminItem[]>('/api/admin/catalog-items'), []);
  const cats = useApi(() => api.get<AdminCategory[]>('/api/admin/categories'), []);
  const [edit, setEdit] = useState<(Omit<AdminItem, 'id'> & { id?: string }) | null>(null);
  const [schemaText, setSchemaText] = useState('');
  const [catEdit, setCatEdit] = useState<AdminCategory | null>(null);
  const s = useSaver();

  const open = (it: (Omit<AdminItem, 'id'> & { id?: string })) => { setEdit(it); setSchemaText(JSON.stringify(it.form_schema, null, 2)); s.setError(null); };

  const saveItem = async () => {
    if (!edit) return;
    let schema: FormSchema;
    try { schema = JSON.parse(schemaText) as FormSchema; } catch { s.setError(new Error('Formulardefinition ist kein gültiges JSON')); return; }
    const body = {
      categoryId: edit.category_id, name: edit.name, description: edit.description, formSchema: schema,
      defaultPriority: edit.default_priority, requiresApproval: edit.requires_approval, popular: edit.popular,
      sortOrder: edit.sort_order, active: edit.active,
    };
    await s.save(() => (edit.id ? api.put(`/api/admin/catalog-items/${edit.id}`, body) : api.post('/api/admin/catalog-items', body)),
      'Katalogeintrag gespeichert', () => { setEdit(null); items.reload(); });
  };

  const saveCat = async () => {
    if (!catEdit) return;
    await s.save(() => api.put(`/api/admin/categories/${encodeURIComponent(catEdit.id)}`, {
      id: catEdit.id, name: catEdit.name, description: catEdit.description, icon: catEdit.icon, sortOrder: catEdit.sort_order, active: catEdit.active,
    }), 'Kategorie gespeichert', () => { setCatEdit(null); cats.reload(); });
  };

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="headline-s">Kategorien</h2>
        <button className="btn tonal" onClick={() => setCatEdit({ id: '', name: '', description: '', icon: 'help', sort_order: 100, active: true })}><Icon name="add" /> Kategorie</button>
      </div>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>ID</th><th>Name</th><th>Beschreibung</th><th>Reihenfolge</th><th>Aktiv</th><th /></tr></thead>
        <tbody>{cats.data?.map((c) => (
          <tr key={c.id}><td className="mono">{c.id}</td><td><span className="row"><Icon name={c.icon} size={18} />{c.name}</span></td><td>{c.description}</td><td>{c.sort_order}</td>
            <td>{c.active ? 'Ja' : 'Nein'}</td><td><button className="icon-btn" aria-label={`${c.name} bearbeiten`} onClick={() => setCatEdit(c)}><Icon name="edit" /></button></td></tr>
        ))}</tbody>
      </table></div>

      <div className="row between">
        <h2 className="headline-s">Katalogeinträge & Formulare</h2>
        <button className="btn filled" onClick={() => open({ ...EMPTY_ITEM })}><Icon name="add" /> Neuer Eintrag</button>
      </div>
      <ErrorBanner error={items.error} />
      {items.loading ? <ListSkeleton /> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Name</th><th>Kategorie</th><th>Felder</th><th>Priorität</th><th>Freigabe</th><th>Status</th><th /></tr></thead>
          <tbody>{items.data?.map((i) => (
            <tr key={i.id}>
              <td><strong>{i.name}</strong><br /><span className="body-s muted">{i.description}</span></td>
              <td>{i.category_id}</td><td>{i.form_schema.fields.length}</td><td>{PRIORITY_LABEL[i.default_priority]}</td>
              <td>{i.requires_approval ? 'Ja' : 'Nein'}</td>
              <td>{i.active ? <span className="chip tone-success">aktiv</span> : <span className="chip tone-neutral">inaktiv</span>}</td>
              <td><button className="icon-btn" aria-label={`${i.name} bearbeiten`} onClick={() => open(i)}><Icon name="edit" /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <Dialog open={!!edit} title={edit?.id ? 'Katalogeintrag bearbeiten' : 'Neuer Katalogeintrag'} onClose={() => setEdit(null)}
        actions={<><button className="btn text" onClick={() => setEdit(null)}>Abbrechen</button><button className="btn filled" disabled={s.busy} onClick={() => void saveItem()}>Speichern</button></>}>
        {edit ? (
          <>
            <ErrorBanner error={s.error} />
            <div className="field"><label htmlFor="i-name">Name</label><input id="i-name" className="input" maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="i-desc">Beschreibung</label><input id="i-desc" className="input" maxLength={1000} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="i-cat">Kategorie</label>
                <select id="i-cat" className="select" value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="i-prio">Standardpriorität</label>
                <select id="i-prio" className="select" value={edit.default_priority} onChange={(e) => setEdit({ ...edit, default_priority: e.target.value as Priority })}>
                  {(['low', 'medium', 'high', 'critical'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select></div>
              <div className="field"><label htmlFor="i-sort">Reihenfolge</label><input id="i-sort" type="number" className="input" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) || 0 })} /></div>
            </div>
            <div className="row">
              <label className="checkbox"><input type="checkbox" checked={edit.requires_approval} onChange={(e) => setEdit({ ...edit, requires_approval: e.target.checked })} /> Freigabe erforderlich</label>
              <label className="checkbox"><input type="checkbox" checked={edit.popular} onChange={(e) => setEdit({ ...edit, popular: e.target.checked })} /> Schnellzugriff</label>
              <label className="checkbox"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Aktiv</label>
            </div>
            <div className="field">
              <label htmlFor="i-schema">Formulardefinition (JSON)</label>
              <textarea id="i-schema" className="textarea code-edit" spellCheck={false} value={schemaText} onChange={(e) => setSchemaText(e.target.value)} />
              <span className="supporting">Feldtypen: text, textarea, email, number, date, checkbox, select. Attribute: name, label, required, help, maxLength, pattern, min, max, options[], when {`{field, equals}`} (bedingtes Feld). Formularebene: requireOneOf [Feldnamen] (mind. eines ausgefüllt, z. B. Bundles). Die Definition wird serverseitig validiert (u. a. ReDoS-Schutz für Muster).</span>
            </div>
          </>
        ) : null}
      </Dialog>

      <Dialog open={!!catEdit} title="Kategorie" onClose={() => setCatEdit(null)}
        actions={<><button className="btn text" onClick={() => setCatEdit(null)}>Abbrechen</button><button className="btn filled" disabled={s.busy} onClick={() => void saveCat()}>Speichern</button></>}>
        {catEdit ? (
          <>
            <ErrorBanner error={s.error} />
            <div className="field"><label htmlFor="c-id">ID (a–z, 0–9, -)</label><input id="c-id" className="input" pattern="[a-z0-9-]{2,40}" value={catEdit.id} onChange={(e) => setCatEdit({ ...catEdit, id: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-name">Name</label><input id="c-name" className="input" value={catEdit.name} onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-desc">Beschreibung</label><input id="c-desc" className="input" value={catEdit.description} onChange={(e) => setCatEdit({ ...catEdit, description: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="c-icon">Icon</label>
                <select id="c-icon" className="select" value={catEdit.icon} onChange={(e) => setCatEdit({ ...catEdit, icon: e.target.value })}>
                  {['laptop', 'apps', 'call', 'key', 'person_add', 'dns', 'verified', 'help', 'support', 'lock', 'group', 'chat', 'bolt'].map((i) => <option key={i} value={i}>{i}</option>)}
                </select></div>
              <div className="field"><label htmlFor="c-sort">Reihenfolge</label><input id="c-sort" type="number" className="input" value={catEdit.sort_order} onChange={(e) => setCatEdit({ ...catEdit, sort_order: Number(e.target.value) || 0 })} /></div>
            </div>
            <label className="checkbox"><input type="checkbox" checked={catEdit.active} onChange={(e) => setCatEdit({ ...catEdit, active: e.target.checked })} /> Aktiv</label>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

/* =============================================================== Workflow */
interface WfStatus { code: string; label: string; description: string; color_role: ColorRole; is_final: boolean }
interface WfTransition { from: string; to: string; role: 'user' | 'first-level' | 'admin' }
const COLOR_ROLES: ColorRole[] = ['neutral', 'primary', 'secondary', 'tertiary', 'success', 'warning', 'error'];

function WorkflowAdmin() {
  const wf = useApi(() => api.get<{ statuses: WfStatus[]; transitions: WfTransition[] }>('/api/admin/workflow'), []);
  const [role, setRole] = useState<WfTransition['role']>('first-level');
  const [set, setSet] = useState<Set<string>>(new Set());
  const [statusEdit, setStatusEdit] = useState<WfStatus | null>(null);
  const s = useSaver();

  useEffect(() => {
    if (wf.data) setSet(new Set(wf.data.transitions.map((t) => `${t.from}|${t.to}|${t.role}`)));
  }, [wf.data]);

  if (wf.loading) return <ListSkeleton />;
  if (wf.error || !wf.data) return <ErrorBanner error={wf.error} />;
  const st = wf.data.statuses;
  const toggle = (k: string) => setSet((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const saveTransitions = () => s.save(() => api.put('/api/admin/transitions', {
    transitions: [...set].map((k) => { const [from, to, r] = k.split('|'); return { from, to, role: r }; }),
  }), 'Workflow gespeichert', wf.reload);

  return (
    <div className="stack">
      <ErrorBanner error={s.error} />
      <h2 className="headline-s">Status</h2>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Code</th><th>Anzeige</th><th>Beschreibung</th><th>Endstatus</th><th /></tr></thead>
        <tbody>{st.map((x) => (
          <tr key={x.code}><td className="mono">{x.code}</td><td><StatusChip label={x.label} color={x.color_role} /></td><td>{x.description}</td><td>{x.is_final ? 'Ja' : 'Nein'}</td>
            <td><button className="icon-btn" aria-label={`Status ${x.label} bearbeiten`} onClick={() => setStatusEdit(x)}><Icon name="edit" /></button></td></tr>
        ))}</tbody>
      </table></div>

      <div className="row between">
        <h2 className="headline-s">Statusübergänge</h2>
        <div className="segmented" role="group" aria-label="Rolle">
          {(['user', 'first-level', 'admin'] as const).map((r) => (
            <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
      </div>
      <p className="body-m muted">Zeile = Ausgangsstatus, Spalte = Zielstatus. Die Rolle „Mitarbeitende“ gilt nur für eigene Tickets. Alle Übergänge werden serverseitig erzwungen und im Audit-Log protokolliert.</p>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>von \ nach</th>{st.map((x) => <th key={x.code}>{x.label}</th>)}</tr></thead>
        <tbody>{st.map((from) => (
          <tr key={from.code}><th scope="row">{from.label}</th>
            {st.map((to) => (
              <td key={to.code}>{from.code === to.code ? '—' : (
                <input type="checkbox" aria-label={`${from.label} nach ${to.label} für ${ROLE_LABEL[role]}`}
                  checked={set.has(`${from.code}|${to.code}|${role}`)} onChange={() => toggle(`${from.code}|${to.code}|${role}`)} />
              )}</td>
            ))}
          </tr>
        ))}</tbody>
      </table></div>
      <div className="row"><button className="btn filled" disabled={s.busy} onClick={() => void saveTransitions()}><Icon name="check" /> Workflow speichern</button></div>

      <Dialog open={!!statusEdit} title="Status bearbeiten" onClose={() => setStatusEdit(null)}
        actions={<><button className="btn text" onClick={() => setStatusEdit(null)}>Abbrechen</button>
          <button className="btn filled" disabled={s.busy} onClick={() => statusEdit && void s.save(() => api.put(`/api/admin/statuses/${statusEdit.code}`, {
            label: statusEdit.label, description: statusEdit.description, colorRole: statusEdit.color_role,
          }), 'Status gespeichert', () => { setStatusEdit(null); wf.reload(); })}>Speichern</button></>}>
        {statusEdit ? (
          <>
            <div className="field"><label htmlFor="s-l">Anzeigename</label><input id="s-l" className="input" maxLength={60} value={statusEdit.label} onChange={(e) => setStatusEdit({ ...statusEdit, label: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-d">Beschreibung</label><input id="s-d" className="input" maxLength={300} value={statusEdit.description} onChange={(e) => setStatusEdit({ ...statusEdit, description: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-c">Farbrolle</label>
              <select id="s-c" className="select" value={statusEdit.color_role} onChange={(e) => setStatusEdit({ ...statusEdit, color_role: e.target.value as ColorRole })}>
                {COLOR_ROLES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <StatusChip label={statusEdit.label} color={statusEdit.color_role} />
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

/* =============================================================== SLA */
interface Sla { priority: Priority; name: string; response_minutes: number; resolution_minutes: number; business_hours_only: boolean }
function SlaAdmin() {
  const sla = useApi(() => api.get<Sla[]>('/api/admin/sla'), []);
  const [rows, setRows] = useState<Sla[]>([]);
  const s = useSaver();
  useEffect(() => { if (sla.data) setRows(sla.data); }, [sla.data]);
  if (sla.loading) return <ListSkeleton />;
  const upd = (p: Priority, patch: Partial<Sla>) => setRows((r) => r.map((x) => (x.priority === p ? { ...x, ...patch } : x)));
  return (
    <div className="stack">
      <ErrorBanner error={sla.error ?? s.error} />
      <p className="body-m muted">Zeiten in Minuten. „Nur Geschäftszeiten“ zählt Mo–Fr 08:00–17:00. Änderungen gelten für neu erstellte bzw. neu priorisierte Tickets.</p>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Priorität</th><th>Bezeichnung</th><th>Reaktion (min)</th><th>Lösung (min)</th><th>Nur Geschäftszeiten</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.priority}>
            <td><span className={`prio ${r.priority}`}>{PRIORITY_LABEL[r.priority]}</span></td>
            <td><input aria-label="Bezeichnung" className="input" value={r.name} maxLength={80} onChange={(e) => upd(r.priority, { name: e.target.value })} /></td>
            <td><input aria-label="Reaktionszeit" type="number" min={1} className="input" value={r.response_minutes} onChange={(e) => upd(r.priority, { response_minutes: Number(e.target.value) })} /></td>
            <td><input aria-label="Lösungszeit" type="number" min={1} className="input" value={r.resolution_minutes} onChange={(e) => upd(r.priority, { resolution_minutes: Number(e.target.value) })} /></td>
            <td><input aria-label="Nur Geschäftszeiten" type="checkbox" className="switch" checked={r.business_hours_only} onChange={(e) => upd(r.priority, { business_hours_only: e.target.checked })} /></td>
            <td><button className="btn tonal small" disabled={s.busy} onClick={() => void s.save(() => api.put(`/api/admin/sla/${r.priority}`, {
              name: r.name, responseMinutes: r.response_minutes, resolutionMinutes: r.resolution_minutes, businessHoursOnly: r.business_hours_only,
            }), `SLA „${PRIORITY_LABEL[r.priority]}“ gespeichert`, sla.reload)}>Speichern</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

/* =============================================================== Lösungen */
function SolutionsAdmin() {
  const sol = useApi(() => api.get<Solution[]>('/api/admin/solutions'), []);
  const cats = useApi(() => api.get<AdminCategory[]>('/api/admin/categories'), []);
  const [edit, setEdit] = useState<(Solution & { active: boolean }) | null>(null);
  const s = useSaver();
  return (
    <div className="stack">
      <div className="row between">
        <h2 className="headline-s">Standardlösungen / Textbausteine</h2>
        <button className="btn filled" onClick={() => setEdit({ id: '', category_id: null, title: '', body: '', active: true })}><Icon name="add" /> Neu</button>
      </div>
      <ErrorBanner error={sol.error} />
      {sol.loading ? <ListSkeleton /> : sol.data?.length ? (
        <div className="grid cols-2">{sol.data.map((x) => (
          <div key={x.id} className="card stack">
            <span className="row between"><span className="title-m">{x.title}</span>
              <button className="icon-btn" aria-label={`${x.title} bearbeiten`} onClick={() => setEdit({ ...x, active: x.active ?? true })}><Icon name="edit" /></button></span>
            <span className="row"><span className="chip tone-secondary">{x.category_id ?? 'alle Kategorien'}</span>{x.active ? null : <span className="chip tone-neutral">inaktiv</span>}</span>
            <p className="body-m muted pre">{x.body}</p>
          </div>
        ))}</div>
      ) : <EmptyState title="Noch keine Standardlösungen" />}
      <Dialog open={!!edit} title={edit?.id ? 'Lösung bearbeiten' : 'Neue Lösung'} onClose={() => setEdit(null)}
        actions={<><button className="btn text" onClick={() => setEdit(null)}>Abbrechen</button>
          <button className="btn filled" disabled={s.busy} onClick={() => edit && void s.save(() => {
            const body = { categoryId: edit.category_id, title: edit.title, body: edit.body, active: edit.active };
            return edit.id ? api.put(`/api/admin/solutions/${edit.id}`, body) : api.post('/api/admin/solutions', body);
          }, 'Lösung gespeichert', () => { setEdit(null); sol.reload(); })}>Speichern</button></>}>
        {edit ? (
          <>
            <ErrorBanner error={s.error} />
            <div className="field"><label htmlFor="so-t">Titel</label><input id="so-t" className="input" maxLength={120} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="so-c">Kategorie</label>
              <select id="so-c" className="select" value={edit.category_id ?? ''} onChange={(e) => setEdit({ ...edit, category_id: e.target.value || null })}>
                <option value="">Alle Kategorien</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="so-b">Text an die anfragende Person</label><textarea id="so-b" className="textarea" maxLength={5000} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></div>
            <label className="checkbox"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Aktiv</label>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

/* =============================================================== Benutzer & Rollen */
interface RolesInfo {
  expectedRoles: { role: string; keycloakGroup: string; description: string }[];
  counts: Record<string, number>;
  warnings: string[];
}
type PortalRole = 'user' | 'first-level' | 'admin';
interface KcUserRow {
  id: string; username: string; name: string; email: string | null; emailVerified: boolean;
  enabled: boolean; createdAt: string | null; role: PortalRole;
}
const ROLE_OPTIONS: { value: PortalRole; label: string; icon: string }[] = [
  { value: 'user', label: 'Mitarbeitende', icon: 'person' },
  { value: 'first-level', label: 'UHD', icon: 'support' },
  { value: 'admin', label: 'Admin', icon: 'admin' },
];
const ROLE_TONE: Record<PortalRole, string> = { user: 'tone-neutral', 'first-level': 'tone-tertiary', admin: 'tone-primary' };

function UsersAdmin() {
  const { me } = useAuth();
  const status = useApi(() => api.get<{ enabled: boolean }>('/api/admin/users/status'), []);
  const info = useApi(() => api.get<RolesInfo>('/api/admin/roles'), []);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const enabled = status.data?.enabled === true;
  const list = useApi(
    () => (enabled ? api.get<Paged<KcUserRow> & { counts: Record<string, number> }>('/api/admin/users', { q: applied, page, pageSize: 20 }) : Promise.resolve(null)),
    [applied, page, enabled],
  );
  const [pending, setPending] = useState<{ user: KcUserRow; role?: PortalRole; enable?: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const s = useSaver();

  useEffect(() => {
    const t = window.setTimeout(() => { setPage(1); setApplied(q.trim()); }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const confirm = () => {
    if (!pending) return;
    const p = pending;
    void s.save(
      () => (p.role
        ? api.put(`/api/admin/users/${p.user.id}/role`, { role: p.role, reason })
        : api.put(`/api/admin/users/${p.user.id}/enabled`, { enabled: !!p.enable, reason })),
      p.role ? `Rolle von ${p.user.name} geändert` : p.enable ? `${p.user.name} entsperrt` : `${p.user.name} gesperrt`,
      () => { setPending(null); setReason(''); list.reload(); info.reload(); },
    );
  };

  return (
    <div className="stack">
      {info.data?.warnings.map((w) => <div key={w} className="banner tone-warning" role="status"><Icon name="warning" />{w}</div>)}
      <div className="grid cols-3">
        {ROLE_OPTIONS.map((r) => (
          <div key={r.value} className="card stack">
            <span className="row between">
              <span className="title-l row"><span className={`avatar ${ROLE_TONE[r.value]}`}><Icon name={r.icon} size={20} /></span>{ROLE_LABEL[r.value]}</span>
              {r.value !== 'user' && list.data ? <span className="chip tone-primary">{list.data.counts[r.value] ?? 0}</span> : null}
            </span>
            <span className="mono body-s">Keycloak-Gruppe: {info.data?.expectedRoles.find((e) => e.role === r.value)?.keycloakGroup}</span>
            <span className="body-m muted">{info.data?.expectedRoles.find((e) => e.role === r.value)?.description}</span>
          </div>
        ))}
      </div>

      {status.data && !enabled ? (
        <div className="banner tone-neutral" role="status"><Icon name="info" />
          Die Benutzerverwaltung ist nicht aktiv. Setzen Sie <span className="mono">KEYCLOAK_ADMIN_API_SECRET</span> (siehe Betriebskonzept), dann können Rollen hier vergeben werden.
        </div>
      ) : null}

      {enabled ? (
        <>
          <div className="toolbar">
            <div className="search">
              <Icon name="search" />
              <label htmlFor="u-search" className="sr-only">Benutzer suchen</label>
              <input id="u-search" className="input" type="search" placeholder="Name, Benutzername oder E-Mail" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="icon-btn" aria-label="Aktualisieren" onClick={list.reload}><Icon name="refresh" /></button>
          </div>
          <ErrorBanner error={list.error ?? s.error} />
          {list.loading ? <ListSkeleton /> : list.data && list.data.items.length > 0 ? (
            <>
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Person</th><th>Benutzername</th><th>Status</th><th>Rolle im Portal</th><th /></tr></thead>
                <tbody>{list.data.items.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong>{u.id === me.sub ? <span className="chip tone-secondary chip-inline">Sie</span> : null}<br />
                      <span className="body-s muted">{u.email ?? '–'}{u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86_400_000 ? ' · neu registriert' : ''}</span></td>
                    <td className="mono">{u.username}</td>
                    <td>{u.enabled ? <span className="chip tone-success">aktiv</span> : <span className="chip tone-error">gesperrt</span>}</td>
                    <td>
                      <div className="segmented segmented-sm" role="group" aria-label={`Rolle für ${u.name}`}>
                        {ROLE_OPTIONS.map((r) => (
                          <button key={r.value} type="button" aria-pressed={u.role === r.value} disabled={s.busy}
                            onClick={() => { if (u.role !== r.value) { setReason(''); setPending({ user: u, role: r.value }); } }}>
                            {u.role === r.value ? <Icon name="check" size={16} /> : null}{r.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className={`btn small ${u.enabled ? 'outlined' : 'tonal'}`} disabled={s.busy || u.id === me.sub}
                        onClick={() => { setReason(''); setPending({ user: u, enable: !u.enabled }); }}>
                        <Icon name={u.enabled ? 'lock' : 'check'} size={16} />{u.enabled ? 'Sperren' : 'Entsperren'}
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
            </>
          ) : <EmptyState icon="group" title="Keine Benutzer gefunden" />}
        </>
      ) : null}

      <Dialog open={!!pending} title={pending?.role ? 'Rolle ändern' : pending?.enable ? 'Konto entsperren' : 'Konto sperren'} onClose={() => setPending(null)}
        actions={<>
          <button className="btn text" onClick={() => setPending(null)}>Abbrechen</button>
          <button className={`btn ${pending?.enable === false || pending?.role === 'user' ? 'danger' : 'filled'}`} disabled={s.busy} onClick={confirm}>Bestätigen</button>
        </>}>
        {pending ? (
          <>
            <ErrorBanner error={s.error} />
            <p>
              {pending.role
                ? <><strong>{pending.user.name}</strong>: {ROLE_LABEL[pending.user.role]} → <strong>{ROLE_LABEL[pending.role]}</strong></>
                : <><strong>{pending.user.name}</strong> wird {pending.enable ? 'entsperrt' : 'gesperrt'}.</>}
            </p>
            {(pending.role && ROLE_OPTIONS.findIndex((r) => r.value === pending.role) < ROLE_OPTIONS.findIndex((r) => r.value === pending.user.role)) || pending.enable === false
              ? <p className="body-m muted">Bestehende Sitzungen der Person werden sofort beendet.</p>
              : <p className="body-m muted">Die neue Rolle wird bei der nächsten Anmeldung bzw. spätestens nach 5 Minuten wirksam.</p>}
            {pending.role === 'admin' ? <div className="banner tone-warning"><Icon name="warning" />Administratoren haben Zugriff auf Audit-Log, Katalog, Workflow und Benutzerverwaltung. Zwei-Faktor-Authentisierung ist Pflicht.</div> : null}
            <div className="field">
              <label htmlFor="r-reason">Begründung / Ticketnummer (wird im Audit-Log gespeichert)</label>
              <input id="r-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. SR-001234, Wechsel ins UHD-Team" />
            </div>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

/* =============================================================== Audit */
interface AuditRow {
  id: string; ts: string; request_id: string | null; actor_sub: string | null; actor_name: string | null; actor_roles: string[];
  action: string; entity_type: string; entity_id: string | null; outcome: string; client_ip: string | null; details: unknown;
}
function AuditAdmin() {
  const [f, setF] = useState({ action: '', actor: '', entity: '', outcome: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const list = useApi(() => api.get<Paged<AuditRow>>('/api/admin/audit', { ...applied, page, pageSize: 25 }), [applied, page]);
  const [verify, setVerify] = useState<{ checked: number; intact: boolean; firstBrokenId: number | null } | null>(null);
  const s = useSaver();
  return (
    <div className="stack">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }}>
        <label className="sr-only" htmlFor="a-act">Aktion</label>
        <input id="a-act" className="input" placeholder="Aktion (z. B. ticket.status)" value={f.action} maxLength={64} onChange={(e) => setF({ ...f, action: e.target.value.replace(/[^a-z_.]/g, '') })} />
        <label className="sr-only" htmlFor="a-actor">Akteur</label>
        <input id="a-actor" className="input" placeholder="Person" value={f.actor} maxLength={100} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <label className="sr-only" htmlFor="a-ent">Objekt</label>
        <input id="a-ent" className="input" placeholder="Objekt-ID (z. B. SR-001000)" value={f.entity} maxLength={100} onChange={(e) => setF({ ...f, entity: e.target.value })} />
        <label className="sr-only" htmlFor="a-out">Ergebnis</label>
        <select id="a-out" className="select" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
          <option value="">Alle Ergebnisse</option><option value="success">Erfolg</option><option value="denied">Verweigert</option><option value="failure">Fehler</option>
        </select>
        <button className="btn filled" type="submit"><Icon name="filter" /> Filtern</button>
        <button className="btn outlined" type="button" disabled={s.busy}
          onClick={() => void s.save(async () => setVerify(await api.get<{ checked: number; intact: boolean; firstBrokenId: number | null }>('/api/admin/audit/verify')), 'Integritätsprüfung abgeschlossen')}>
          <Icon name="verified" /> Integrität prüfen
        </button>
      </form>
      {verify ? (
        <div className={`banner ${verify.intact ? 'tone-success' : 'tone-error'}`} role="status">
          <Icon name={verify.intact ? 'verified' : 'warning'} />
          {verify.intact ? `Hash-Kette intakt – ${verify.checked} Einträge geprüft.` : `Manipulationsverdacht ab Eintrag #${verify.firstBrokenId}! Sicherheitsvorfall gemäß Notfallprozess melden.`}
        </div>
      ) : null}
      <ErrorBanner error={list.error ?? s.error} />
      {list.loading ? <ListSkeleton /> : (
        <>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Zeit</th><th>Akteur</th><th>Aktion</th><th>Objekt</th><th>Ergebnis</th><th>Details</th></tr></thead>
            <tbody>{list.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.ts)}<br /><span className="body-s muted mono">{r.client_ip ?? ''}</span></td>
                <td>{r.actor_name ?? 'System'}<br /><span className="body-s muted">{r.actor_roles.join(', ')}</span></td>
                <td className="mono">{r.action}</td>
                <td>{r.entity_type}<br /><span className="mono">{r.entity_id}</span></td>
                <td><span className={`chip ${r.outcome === 'success' ? 'tone-success' : r.outcome === 'denied' ? 'tone-warning' : 'tone-error'}`}>{r.outcome}</span></td>
                <td><pre className="json">{JSON.stringify(r.details, null, 1)}</pre></td>
              </tr>
            ))}</tbody>
          </table></div>
          {list.data ? <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
        </>
      )}
    </div>
  );
}

/* =============================================================== Rahmen */
const TABS = [
  { to: '/admin', label: 'Übersicht', icon: 'dns', end: true },
  { to: '/admin/katalog', label: 'Katalog & Formulare', icon: 'category' },
  { to: '/admin/workflow', label: 'Status & Workflow', icon: 'history' },
  { to: '/admin/sla', label: 'SLA', icon: 'schedule' },
  { to: '/admin/loesungen', label: 'Standardlösungen', icon: 'lightbulb' },
  { to: '/admin/rollen', label: 'Benutzer & Rollen', icon: 'group' },
  { to: '/admin/audit', label: 'Audit-Log', icon: 'verified' },
];

export default function Admin() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display-s">Administration</h1>
          <p className="muted body-l">Katalog, Workflows, SLA, Benutzer & Rollen und Audit – alle Änderungen werden revisionssicher protokolliert.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Admin-Bereiche">
        {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className="tab"><Icon name={t.icon} size={18} />{t.label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="katalog" element={<CatalogAdmin />} />
        <Route path="workflow" element={<WorkflowAdmin />} />
        <Route path="sla" element={<SlaAdmin />} />
        <Route path="loesungen" element={<SolutionsAdmin />} />
        <Route path="rollen" element={<UsersAdmin />} />
        <Route path="audit" element={<AuditAdmin />} />
      </Routes>
    </>
  );
}
