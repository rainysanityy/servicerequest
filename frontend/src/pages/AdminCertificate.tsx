import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api/client';
import { Icon } from '../components/Icon';
import { Dialog, ErrorBanner, ListSkeleton, useApi, useSnackbar } from '../components/ui';
import { fmtDateTime } from '../util/format';

/* TLS-Serverzertifikat per PKCS#12 (.p12/.pfx) austauschen – nur Administration. */

interface CertInfo {
  subject: string; issuer: string; subjectAltName: string | null; serialNumber: string;
  validFrom: string; validTo: string; daysRemaining: number; fingerprint256: string; key: string; selfSigned: boolean;
  chain: { subject: string; issuer: string; validTo: string }[];
}
interface TlsStatus {
  hostname: string | null; enabled: boolean; active: CertInfo | null;
  uploaded: { fingerprint256: string; uploadedAt: string; uploadedBy: string; info: CertInfo } | null;
  activeSource: 'uploaded' | 'server' | null;
}
interface CheckResult { ok: boolean; errors: string[]; warnings: string[]; info: CertInfo | null; installed: boolean }

const MAX_BYTES = 64 * 1024;
const cn = (dn: string) => /CN=([^,]+)/.exec(dn)?.[1] ?? dn;

function Expiry({ days }: { days: number }) {
  const [tone, icon, text] = days < 0 ? ['tone-error', 'warning', 'abgelaufen']
    : days < 14 ? ['tone-error', 'warning', `noch ${days} Tage`]
    : days < 30 ? ['tone-warning', 'warning', `noch ${days} Tage`]
    : ['tone-success', 'check', `noch ${days} Tage`];
  return <span className={`chip ${tone}`}><Icon name={icon} size={16} />{text}</span>;
}

function CertDetails({ c }: { c: CertInfo }) {
  return (
    <dl className="kv">
      <div className="kv-row"><dt>Ausgestellt für</dt><dd>{cn(c.subject)}</dd></div>
      <div className="kv-row"><dt>Alternative Namen</dt><dd>{c.subjectAltName?.replace(/DNS:/g, '') ?? '–'}</dd></div>
      <div className="kv-row"><dt>Aussteller</dt><dd>{c.selfSigned ? 'selbstsigniert' : cn(c.issuer)}</dd></div>
      <div className="kv-row"><dt>Gültig</dt><dd>{fmtDateTime(c.validFrom)} – {fmtDateTime(c.validTo)} <Expiry days={c.daysRemaining} /></dd></div>
      <div className="kv-row"><dt>Schlüssel</dt><dd>{c.key}</dd></div>
      {c.chain.length > 0 ? <div className="kv-row"><dt>Zwischenzertifikate</dt><dd>{c.chain.map((x) => cn(x.subject)).join(' → ')}</dd></div> : null}
      <div className="kv-row"><dt>SHA-256</dt><dd className="mono body-s break">{c.fingerprint256}</dd></div>
    </dl>
  );
}

export function CertificateAdmin() {
  const snack = useSnackbar();
  const status = useApi(() => api.get<TlsStatus>('/api/admin/tls'), []);
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<'install' | 'revert' | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null); // erwarteter Fingerabdruck nach Installation
  const input = useRef<HTMLInputElement>(null);

  // Nach dem Aktivieren: Status pollen, bis der Proxy das neue Zertifikat ausliefert
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      void api.get<TlsStatus>('/api/admin/tls').then((s) => {
        status.setData(s);
        const done = waiting === 'server' ? s.activeSource !== 'uploaded' : s.active?.fingerprint256 === waiting;
        if (done) { setWaiting(null); snack('Neues Zertifikat ist aktiv'); }
      }).catch(() => undefined);
      if (n >= 24) { setWaiting(null); setError(new Error('timeout')); }
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const reset = () => {
    setFile(null); setPassword(''); setReason(''); setResult(null);
    if (input.current) input.current.value = '';
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setResult(null); setError(null);
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setFile(null); setError(new Error('size')); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      setFile({ name: f.name, b64: s.slice(s.indexOf(',') + 1) });
    };
    reader.readAsDataURL(f);
  };

  const submit = async (install: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await api.post<CheckResult>('/api/admin/tls', { p12: file.b64, password, install, reason });
      setResult(r);
      if (install && r.installed && r.info) {
        snack('Zertifikat gespeichert – der Proxy übernimmt es in wenigen Sekunden');
        setWaiting(r.info.fingerprint256);
        reset();
        setResult(r);
      }
    } catch (e) { setError(e); } finally { setBusy(false); setConfirm(null); }
  };

  const revert = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/api/admin/tls/revert', { reason });
      snack('Hochgeladenes Zertifikat entfernt – Server-Zertifikat wird wieder verwendet');
      setWaiting('server');
      reset();
    } catch (e) { setError(e); } finally { setBusy(false); setConfirm(null); }
  };

  if (status.loading && !status.data) return <ListSkeleton rows={3} />;
  const s = status.data;
  const localError = error instanceof Error && !(error as { status?: number }).status
    ? (error.message === 'size' ? 'Die Datei ist größer als 64 KB – ist das wirklich eine .p12-Datei?'
      : error.message === 'timeout' ? 'Der Proxy hat das Zertifikat noch nicht übernommen. Logs prüfen: docker compose logs proxy' : null)
    : null;

  return (
    <div className="stack">
      <ErrorBanner error={status.error} />
      <div className="grid cols-2">
        <section className="card stack" aria-labelledby="tls-active">
          <div className="row between">
            <h2 id="tls-active" className="title-l row"><Icon name="lock" /> Aktives Zertifikat</h2>
            {s?.activeSource === 'uploaded'
              ? <span className="chip tone-primary"><Icon name="verified" size={16} />hochgeladen</span>
              : s?.activeSource === 'server' ? <span className="chip tone-neutral"><Icon name="dns" size={16} />Server-Datei</span> : null}
          </div>
          {s?.active ? <CertDetails c={s.active} /> : <p className="muted">Das ausgelieferte Zertifikat konnte nicht abgefragt werden.</p>}
          {s?.uploaded ? (
            <p className="body-s muted">
              Hochgeladen am {fmtDateTime(s.uploaded.uploadedAt)} von {s.uploaded.uploadedBy}
              {s.activeSource !== 'uploaded' ? ' – wird gerade übernommen …' : ''}
            </p>
          ) : <p className="body-s muted">Quelle: <span className="mono">proxy/certs/tls.crt</span> auf dem Server.</p>}
          {waiting ? <div className="banner tone-info" role="status"><Icon name="refresh" />Warte auf Übernahme durch den Proxy …</div> : null}
          {s?.uploaded ? (
            <div className="row">
              <button className="btn outlined" disabled={busy || Boolean(waiting)} onClick={() => setConfirm('revert')}>
                <Icon name="undo" /> Server-Zertifikat wiederherstellen
              </button>
            </div>
          ) : null}
        </section>

        <section className="card stack" aria-labelledby="tls-upload">
          <h2 id="tls-upload" className="title-l row"><Icon name="upload" /> Neues Zertifikat (.p12 / .pfx)</h2>
          {s && !s.enabled ? (
            <div className="banner tone-warning"><Icon name="warning" />Upload nicht verfügbar: Volume „tls“ fehlt oder PUBLIC_ORIGIN ist nicht gesetzt.</div>
          ) : null}
          <p className="body-m muted">
            PKCS#12-Datei mit Serverzertifikat, privatem Schlüssel und Zwischenzertifikaten für
            <strong> {s?.hostname ?? '–'}</strong>. Die Datei wird geprüft und erst nach Bestätigung aktiviert.
          </p>
          <div className="field">
            <label htmlFor="p12-file">Datei</label>
            <input id="p12-file" ref={input} className="input" type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={onFile} disabled={busy || !s?.enabled} />
          </div>
          <div className="field">
            <label htmlFor="p12-pw">Passwort der Datei</label>
            <input id="p12-pw" className="input" type="password" autoComplete="new-password" maxLength={256}
              value={password} onChange={(e) => { setPassword(e.target.value); setResult(null); }} disabled={busy || !s?.enabled} />
          </div>
          <div className="field">
            <label htmlFor="p12-reason">Begründung / Change-Nummer (Audit-Log)</label>
            <input id="p12-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. CHG-2026-118, Zertifikatserneuerung" />
          </div>
          {localError ? <div className="banner tone-error" role="alert"><Icon name="warning" />{localError}</div> : <ErrorBanner error={error instanceof Error && 'status' in error ? error : null} />}
          <div className="row">
            <button className="btn filled" disabled={!file || busy || !s?.enabled} onClick={() => void submit(false)}>
              <Icon name="verified" /> Prüfen
            </button>
            {result?.ok && !result.installed ? (
              <button className="btn tonal" disabled={busy || Boolean(waiting)} onClick={() => setConfirm('install')}>
                <Icon name="check" /> Zertifikat aktivieren
              </button>
            ) : null}
          </div>
          {result ? (
            <div className="stack">
              <div className={`banner ${result.ok ? 'tone-success' : 'tone-error'}`} role="status">
                <Icon name={result.ok ? 'check' : 'warning'} />
                {result.installed ? 'Zertifikat gespeichert.' : result.ok ? 'Prüfung bestanden.' : 'Prüfung nicht bestanden.'}
              </div>
              {result.errors.length > 0 ? <ul className="issues">{result.errors.map((e) => <li key={e} className="tone-error"><Icon name="close" size={16} />{e}</li>)}</ul> : null}
              {result.warnings.length > 0 ? <ul className="issues">{result.warnings.map((w) => <li key={w} className="tone-warning"><Icon name="warning" size={16} />{w}</li>)}</ul> : null}
              {result.info ? <CertDetails c={result.info} /> : null}
            </div>
          ) : null}
          <details className="body-s muted">
            <summary>Datei erzeugen</summary>
            <p>OpenSSL: <span className="mono">openssl pkcs12 -export -in server.crt -inkey server.key -certfile kette.pem -out portal.p12</span></p>
            <p>Windows (Zertifikatsverwaltung): Exportieren → „Ja, privaten Schlüssel exportieren“ → „Alle Zertifikate im Zertifizierungspfad einbeziehen“ → Verschlüsselung „AES256-SHA256“.</p>
          </details>
        </section>
      </div>

      <Dialog open={confirm !== null} title={confirm === 'revert' ? 'Server-Zertifikat wiederherstellen?' : 'Zertifikat aktivieren?'}
        onClose={() => setConfirm(null)}
        actions={<>
          <button className="btn text" onClick={() => setConfirm(null)}>Abbrechen</button>
          <button className="btn filled" disabled={busy} onClick={() => void (confirm === 'revert' ? revert() : submit(true))}>
            {confirm === 'revert' ? 'Wiederherstellen' : 'Aktivieren'}
          </button>
        </>}>
        {confirm === 'install' && result?.info ? (
          <>
            <p>Das Portal verwendet danach dieses Zertifikat für <strong>{s?.hostname}</strong>:</p>
            <p className="mono body-s break">{cn(result.info.subject)} · gültig bis {fmtDateTime(result.info.validTo)}</p>
            {result.warnings.length > 0 ? <div className="banner tone-warning"><Icon name="warning" />{result.warnings.length} Warnung(en) – bitte oben prüfen.</div> : null}
            <p className="body-m muted">Der Proxy übernimmt es ohne Unterbrechung. Ist es fehlerhaft, bleibt das bisherige Zertifikat aktiv.</p>
          </>
        ) : (
          <p>Das hochgeladene Zertifikat wird gelöscht; der Proxy verwendet wieder <span className="mono">proxy/certs/tls.crt</span> vom Server.</p>
        )}
      </Dialog>
    </div>
  );
}
