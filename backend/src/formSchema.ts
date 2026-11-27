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
  .object({ fields: z.array(FieldDef).max(30) })
  .strict()
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    for (const f of schema.fields) {
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

function fieldValidator(f: FieldDef): z.ZodTypeAny {
  let v: z.ZodTypeAny;
  switch (f.type) {
    case 'text': {
      let s: z.ZodTypeAny = z.string().max(1000).transform(cleanLine).pipe(z.string().max(f.maxLength ?? 200));
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
  if (f.required) {
    if (f.type === 'checkbox') return v;
    return v.refine((x) => x !== '' && x !== undefined && x !== null, `${f.label} ist ein Pflichtfeld`);
  }
  return v.optional();
}

/** Baut aus der (bereits geprüften) Formulardefinition einen strikten Validator. */
export function buildFormValidator(schema: FormSchema) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of schema.fields) shape[f.name] = fieldValidator(f);
  return z.object(shape).strict();
}

export function parseFormData(schemaJson: unknown, data: unknown): Record<string, unknown> {
  const schema = FormSchema.parse(schemaJson);
  return buildFormValidator(schema).parse(data ?? {}) as Record<string, unknown>;
}
