import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { CatalogItemDetail } from '../api/types';
import { DynamicForm, toPayload, validateAll, type FormValues } from '../components/DynamicForm';
import { Icon } from '../components/Icon';
import { ErrorBanner, PageLoader, useApi, useSnackbar } from '../components/ui';
import { PRIORITY_LABEL } from '../util/format';

export default function RequestForm() {
  const { itemId = '' } = useParams();
  const navigate = useNavigate();
  const snack = useSnackbar();
  const { data: item, error, loading } = useApi(() => api.get<CatalogItemDetail>(`/api/catalog/items/${encodeURIComponent(itemId)}`), [itemId]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (error || !item) return <ErrorBanner error={error ?? new ApiError(404, 'Katalogeintrag nicht gefunden')} />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateAll(item.form_schema, values);
    if (title.trim().length < 3) errs['__title'] = 'Bitte eine Kurzbeschreibung mit mindestens 3 Zeichen angeben';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = Object.keys(errs)[0]!;
      const target = first === '__title' ? 'f-title' : first === '__oneOf' ? `f-${item.form_schema.requireOneOf?.[0] ?? ''}` : `f-${first}`;
      document.getElementById(target)?.focus();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await api.post<{ id: string; number: string }>('/api/tickets', {
        catalogItemId: item.id,
        title: title.trim(),
        description: description.trim(),
        formData: toPayload(item.form_schema, values),
      });
      snack(`Anfrage ${res.number} wurde erstellt`);
      navigate(`/tickets/${res.id}`, { replace: true });
    } catch (err) {
      setSubmitError(err);
      if (err instanceof ApiError) {
        const fieldErrs: Record<string, string> = {};
        for (const i of err.issues) fieldErrs[i.path.replace(/^formData\./, '') || '__oneOf'] = i.message;
        setErrors(fieldErrs);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Brotkrumen">
        <Link to="/katalog">Katalog</Link><Icon name="chevron" size={18} />
        <Link to={`/katalog/${item.category_id}`}>{item.category_name}</Link><Icon name="chevron" size={18} />
        <span aria-current="page">{item.name}</span>
      </nav>
      <div className="split">
        <form className="card stack" onSubmit={onSubmit} noValidate aria-labelledby="form-title">
          <h1 id="form-title" className="headline-l">{item.name}</h1>
          <p className="muted">{item.description}</p>
          <ErrorBanner error={submitError} />

          <div className="form-grid">
            <div className={`field span-all ${errors['__title'] ? 'invalid' : ''}`}>
              <label htmlFor="f-title">Kurzbeschreibung<span className="req" aria-hidden="true"> *</span></label>
              <input id="f-title" className="input" value={title} maxLength={160} required aria-required
                aria-invalid={errors['__title'] ? true : undefined} aria-describedby="f-title-desc"
                placeholder="z. B. Ersatz-Notebook für defektes Gerät" onChange={(e) => setTitle(e.target.value)} />
              <span id="f-title-desc" className="supporting">{errors['__title'] ?? 'Erscheint als Titel Ihres Tickets'}</span>
            </div>
          </div>

          {errors['__oneOf'] ? (
            <div className="banner tone-error" role="alert"><Icon name="warning" />{errors['__oneOf']}</div>
          ) : item.form_schema.requireOneOf ? (
            <div className="banner tone-neutral"><Icon name="info" />Geben Sie bei mindestens einer Position eine Anzahl an.</div>
          ) : null}
          <DynamicForm schema={item.form_schema} values={values} errors={errors}
            onChange={(n, v) => { setValues((s) => ({ ...s, [n]: v })); setErrors((s) => { const c = { ...s }; delete c[n]; delete c['__oneOf']; return c; }); }} />

          <div className="field">
            <label htmlFor="f-desc">Weitere Hinweise (optional)</label>
            <textarea id="f-desc" className="textarea" maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            <span className="supporting">Bitte keine Passwörter oder sonstigen Zugangsdaten angeben.</span>
          </div>

          <div className="row between">
            <Link to="/katalog" className="btn text">Abbrechen</Link>
            <button type="submit" className="btn filled large" disabled={busy}>
              <Icon name="send" /> {busy ? 'Wird gesendet …' : 'Anfrage absenden'}
            </button>
          </div>
        </form>

        <aside className="stack sticky-side" aria-label="Hinweise zur Anfrage">
          <div className="card filled stack">
            <span className="title-m row"><Icon name="info" /> So geht es weiter</span>
            <ol className="body-m">
              <li>Ihre Anfrage erhält eine Ticketnummer (SR-…).</li>
              {item.requires_approval ? <li>Die angegebene Freigabeperson wird um Zustimmung gebeten.</li> : null}
              <li>Der Service Desk bearbeitet das Ticket – Rückfragen sehen Sie unter „Meine Tickets“.</li>
              <li>Nach der Lösung bestätigen Sie den Abschluss oder öffnen das Ticket erneut.</li>
            </ol>
          </div>
          <div className="card outlined stack">
            <span className="row"><span className="label-l">Standardpriorität</span><span className={`prio ${item.default_priority}`}>{PRIORITY_LABEL[item.default_priority]}</span></span>
            {item.requires_approval ? <span className="chip tone-warning"><Icon name="verified" size={16} /> Freigabe erforderlich</span> : null}
          </div>
        </aside>
      </div>
    </>
  );
}
