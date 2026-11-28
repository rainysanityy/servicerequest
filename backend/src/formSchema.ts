import { z } from 'zod';
import { cleanLine, cleanText } from './util.js';

/**
 * Meta-Schema für Katalog-Formulare. Admins pflegen Formulare als JSON;
 * dieses Schema verhindert ungültige/gefährliche Definitionen (z. B. ReDoS-Muster).
 */
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const OPTION_VALUE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

// Heuristik gegen katastrophales Backtracking: verschachtelte Quantoren wie (a+)+ oder (.*)*
const NESTED_QUANTIFIER = /\([^)]*[+*}][^)]*\)\s*[+*{]/;

const safePattern = z
  .string()
  .max(200)
  .refine((p) => !NESTED_QUANTIFIER.test(p), 'Muster mit verschachtelten Quantoren sind nicht erlaubt')
  .refine((p) => {
    try {
      new RegExp(p, 'u');
      return true;
    } catch {
      return false;
    }
  }, 'Ungültiger regulärer Ausdruck');

const option = z.object({
  value: z.string().regex(OPTION_VALUE),
  label: z.string().min(1).max(120).transform(cleanLine),
});

const base = {
  name: z.string().regex(FIELD_NAME),
  label: z.string().min(1).max(120).transform(cleanLine),
  required: z.boolean().optional(),
  help: z.string().max(300).transform(cleanLine).optional(),
  // Bedingtes Feld: nur sichtbar/gültig (und ggf. Pflicht), wenn ein anderes Feld einen bestimmten Wert hat
  when: z.object({ field: z.string().regex(FIELD_NAME), equals: z.union([z.string().max(60), z.boolean()]) }).strict().optional(),
};

export const FieldDef = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), maxLength: z.number().int().min(1).max(500).optional(), pattern: safePattern.optional() }).strict(),
  z.object({ ...base, type: z.literal('textarea'), maxLength: z.number().int().min(1).max(5000).optional() }).strict(),
  z.object({ ...base, type: z.literal('email'), maxLength: z.number().int().min(6).max(254).optional() }).strict(),
  z.object({ ...base, type: z.literal('number'), min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
  z.object({ ...base, type: z.literal('date') }).strict(),
  z.object({ ...base, type: z.literal('checkbox') }).strict(),
  z.object({ ...base, type: z.literal('select'), options: z.array(option).min(1).max(50) }).strict(),
]);
export type FieldDef = z.infer<typeof FieldDef>;

export const FormSchema = z
  .object({
    fields: z.array(FieldDef).max(30),
    // Mindestens eines dieser Felder muss ausgefüllt sein (z. B. Positionen eines Bundles)
    requireOneOf: z.array(z.string().regex(FIELD_NAME)).min(2).max(30).optional(),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    const names = new Set(schema.fields.map((f) => f.name));
    for (const n of schema.requireOneOf ?? []) {
      if (!names.has(n)) ctx.addIssue({ code: 'custom', message: `requireOneOf: unbekanntes Feld ${n}` });
    }
    for (const f of schema.fields) {
      if (f.when && (!names.has(f.when.field) || f.when.field === f.name)) {
        ctx.addIssue({ code: 'custom', message: `when: ungültiges Bezugsfeld bei ${f.name}` });
      }
      if (seen.has(f.name)) ctx.addIssue({ code: 'custom', message: `Feldname doppelt: ${f.name}` });
      seen.add(f.name);
      if (f.type === 'number' && f.min !== undefined && f.max !== undefined && f.min > f.max) {
        ctx.addIssue({ code: 'custom', message: `min > max bei ${f.name}` });
      }
      if (f.type === 'select') {
        const vals = new Set(f.options.map((o) => o.value));
        if (vals.size !== f.options.length) ctx.addIssue({ code: 'custom', message: `Doppelte Optionen bei ${f.name}` });
      }
    }
  });
export type FormSchema = z.infer<typeof FormSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fieldValidator(f: FieldDef): z.ZodType {
  let v: z.ZodType;
  switch (f.type) {
    case 'text': {
      let s: z.ZodType = z.string().max(1000).transform(cleanLine).pipe(z.string().max(f.maxLength ?? 200));
      if (f.pattern) {
        const re = new RegExp(f.pattern, 'u');
        s = s.pipe(z.string().refine((x) => x === '' || re.test(x), `${f.label}: ungültiges Format`));
      }
      v = s;
      break;
    }
    case 'textarea':
      v = z.string().max(10_000).transform(cleanText).pipe(z.string().max(f.maxLength ?? 2000));
      break;
    case 'email':
      v = z
        .string()
        .max(254)
        .transform(cleanLine)
        .pipe(z.union([z.literal(''), z.string().email(`${f.label}: ungültige E-Mail-Adresse`).max(f.maxLength ?? 254)]));
      break;
    case 'number': {
      let n = z.number().finite();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      v = n;
      break;
    }
    case 'date':
      v = z.union([
        z.literal(''),
        z.string().regex(ISO_DATE).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), `${f.label}: ungültiges Datum`),
      ]);
      break;
    case 'checkbox':
      v = z.boolean();
      break;
    case 'select':
      v = z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
      break;
  }
  // Bedingte Felder: Pflicht wird erst im Formular-Kontext geprüft (siehe buildFormValidator)
  if (f.when) return v.optional();
  if (f.required) {
    if (f.type === 'checkbox') return z.literal(true, { message: `${f.label}: Bestätigung erforderlich` });
    return v.refine((x) => x !== '' && x !== undefined && x !== null, `${f.label} ist ein Pflichtfeld`);
  }
  return v.optional();
}

export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null || v === '' || v === false) return false;
  if (typeof v === 'number') return v > 0;
  return true;
}

/** Baut aus der (bereits geprüften) Formulardefinition einen strikten Validator. */
export function buildFormValidator(schema: FormSchema) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of schema.fields) shape[f.name] = fieldValidator(f);
  return z
    .object(shape)
    .strict()
    .transform((data, ctx) => {
      const out: Record<string, unknown> = { ...data };
      for (const f of schema.fields) {
        if (!f.when) continue;
        const active = out[f.when.field] === f.when.equals;
        if (!active) {
          delete out[f.name]; // Werte inaktiver Felder werden verworfen
        } else if (f.required && !isFilled(out[f.name])) {
          ctx.addIssue({ code: 'custom', path: [f.name], message: `${f.label} ist ein Pflichtfeld` });
        }
      }
      if (schema.requireOneOf && !schema.requireOneOf.some((n) => isFilled(out[n]))) {
        ctx.addIssue({ code: 'custom', path: [], message: 'Bitte mindestens eine Position angeben' });
      }
      return out;
    });
}

export function parseFormData(schemaJson: unknown, data: unknown): Record<string, unknown> {
  const schema = FormSchema.parse(schemaJson);
  return buildFormValidator(schema).parse(data ?? {}) as Record<string, unknown>;
}
