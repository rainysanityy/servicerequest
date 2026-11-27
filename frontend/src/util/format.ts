const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

export const fmtDateTime = (iso?: string | null) => (iso ? dtf.format(new Date(iso)) : '–');
export const fmtDate = (iso?: string | null) => (iso ? df.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '–');

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '–';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return df.format(new Date(iso));
}

export const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Kritisch',
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
};

export const ROLE_LABEL: Record<string, string> = {
  user: 'Mitarbeitende',
  'first-level': 'First-Level-Support',
  admin: 'Administration',
  system: 'System',
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const TONES = ['tone-primary', 'tone-secondary', 'tone-tertiary'];
export function toneFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export const CATEGORY_TONE: Record<string, string> = {
  hardware: 'tone-primary',
  software: 'tone-tertiary',
  telephony: 'tone-success',
  access: 'tone-secondary',
  accounts: 'tone-warning',
  vm: 'tone-primary',
  certificates: 'tone-tertiary',
  general: 'tone-neutral',
};

export const CATEGORY_ICON: Record<string, string> = {
  hardware: 'laptop',
  software: 'apps',
  telephony: 'call',
  access: 'key',
  accounts: 'person_add',
  vm: 'dns',
  certificates: 'verified',
  general: 'help',
};
