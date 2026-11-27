import type { FieldDef, FormSchema } from '../api/types';

export type FormValues = Record<string, string | number | boolean | undefined>;

/** Bedingtes Feld aktiv? (when: { field, equals }) */
export function isActive(f: FieldDef, values: FormValues): boolean {
  return !f.when || values[f.when.field] === f.when.equals;
}

function isFilled(v: FormValues[string]): boolean {
  if (v === undefined || v === '' || v === false) return false;
  if (typeof v === 'number') return !Number.isNaN(v) && v > 0;
  return true;
}

/** Clientseitige Vorprüfung (Komfort) – maßgeblich ist die serverseitige Validierung. */
export function validateField(f: FieldDef, v: FormValues[string]): string | null {
  const empty = v === undefined || v === '' || (f.type === 'number' && Number.isNaN(v));
  if (f.required && f.type === 'checkbox' && v !== true) return 'Bitte bestätigen';
  if (f.required && f.type !== 'checkbox' && empty) return `${f.label} ist ein Pflichtfeld`;
  if (empty) return null;
  if ((f.type === 'text' || f.type === 'textarea' || f.type === 'email') && typeof v === 'string') {
    if (f.maxLength && v.length > f.maxLength) return `Maximal ${f.maxLength} Zeichen`;
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Bitte eine gültige E-Mail-Adresse eingeben';
    if (f.pattern) {
      try {
        if (!new RegExp(f.pattern, 'u').test(v)) return 'Ungültiges Format';
      } catch {
        /* Muster wird serverseitig geprüft */
      }
    }
  }
  if (f.type === 'number' && typeof v === 'number') {
    if (f.min !== undefined && v < f.min) return `Mindestens ${f.min}`;
    if (f.max !== undefined && v > f.max) return `Höchstens ${f.max}`;
  }
  return null;
}

export function validateAll(schema: FormSchema, values: FormValues): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of schema.fields) {
    if (!isActive(f, values)) continue;
    const e = validateField(f, values[f.name]);
    if (e) errs[f.name] = e;
  }
  if (schema.requireOneOf && !schema.requireOneOf.some((n) => isFilled(values[n]))) {
    errs['__oneOf'] = 'Bitte mindestens eine Position angeben';
  }
  return errs;
}

/** Entfernt leere optionale Werte vor dem Senden. */
export function toPayload(schema: FormSchema, values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (!isActive(f, values)) continue;
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = v === true;
    else if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) out[f.name] = v;
  }
  return out;
}

export function DynamicForm({
  schema, values, errors, onChange,
}: {
  schema: FormSchema;
  values: FormValues;
  errors: Record<string, string>;
  onChange: (name: string, value: FormValues[string]) => void;
}) {
  return (
    <div className="form-grid">
      {schema.fields.filter((f) => isActive(f, values)).map((f) => {
        const id = `f-${f.name}`;
        const err = errors[f.name];
        const descId = err || f.help ? `${id}-desc` : undefined;
        const common = {
          id,
          name: f.name,
          'aria-invalid': err ? true : undefined,
          'aria-describedby': descId,
          'aria-required': f.required || undefined,
        };
        const wide = f.type === 'textarea' || f.type === 'checkbox';
        if (f.type === 'checkbox') {
          return (
            <div key={f.name} className={`field span-all ${err ? 'invalid' : ''}`}>
              <label className="checkbox" htmlFor={id}>
                <input type="checkbox" {...common} checked={values[f.name] === true} onChange={(e) => onChange(f.name, e.target.checked)} />
                <span>{f.label}</span>
              </label>
              {descId ? <span id={descId} className="supporting">{err ?? f.help}</span> : null}
            </div>
          );
        }
        return (
          <div key={f.name} className={`field ${wide ? 'span-all' : ''} ${err ? 'invalid' : ''}`}>
            <label htmlFor={id}>{f.label}{f.required ? <span className="req" aria-hidden="true"> *</span> : null}</label>
            {f.type === 'select' ? (
              <select className="select" {...common} value={String(values[f.name] ?? '')} onChange={(e) => onChange(f.name, e.target.value)}>
                <option value="">Bitte wählen …</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="textarea" {...common} maxLength={f.maxLength ?? 2000} value={String(values[f.name] ?? '')}
                onChange={(e) => onChange(f.name, e.target.value)} />
            ) : f.type === 'number' ? (
              <input className="input" type="number" inputMode="numeric" {...common} min={f.min} max={f.max}
                value={values[f.name] === undefined || Number.isNaN(values[f.name]) ? '' : String(values[f.name])}
                onChange={(e) => onChange(f.name, e.target.value === '' ? undefined : Number(e.target.value))} />
            ) : (
              <input className="input" type={f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'} {...common}
                maxLength={f.maxLength ?? (f.type === 'date' ? 10 : 200)}
                autoComplete={f.type === 'email' ? 'email' : 'off'}
                value={String(values[f.name] ?? '')} onChange={(e) => onChange(f.name, e.target.value)} />
            )}
            {descId ? <span id={descId} className="supporting">{err ?? f.help}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
