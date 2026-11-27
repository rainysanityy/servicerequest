import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  argbFromHex, hexFromArgb, Hct, MaterialDynamicColors, SchemeExpressive, SchemeTonalSpot, SchemeVibrant,
  type DynamicColor, type DynamicScheme,
} from '@material/material-color-utilities';

export type ThemeMode = 'system' | 'light' | 'dark';
export type SchemeVariant = 'vibrant' | 'expressive' | 'tonal';

export const SEEDS = [
  { id: 'violet', label: 'Violett', hex: '#6750A4' },
  { id: 'ocean', label: 'Ozean', hex: '#0061A4' },
  { id: 'forest', label: 'Wald', hex: '#386A20' },
  { id: 'coral', label: 'Koralle', hex: '#C2410C' },
  { id: 'magenta', label: 'Magenta', hex: '#9C27B0' },
] as const;

interface ThemeState {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  seed: string;
  variant: SchemeVariant;
  setMode: (m: ThemeMode) => void;
  setSeed: (hex: string) => void;
  setVariant: (v: SchemeVariant) => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'srp.theme.v1';

function readPrefs(): Partial<Pick<ThemeState, 'mode' | 'seed' | 'variant'>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      mode: p['mode'] === 'light' || p['mode'] === 'dark' || p['mode'] === 'system' ? p['mode'] : undefined,
      seed: typeof p['seed'] === 'string' && /^#[0-9a-fA-F]{6}$/.test(p['seed']) ? p['seed'] : undefined,
      variant: p['variant'] === 'vibrant' || p['variant'] === 'expressive' || p['variant'] === 'tonal' ? p['variant'] : undefined,
    };
  } catch {
    return {};
  }
}

function writePrefs(p: { mode: ThemeMode; seed: string; variant: SchemeVariant }) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* Speicher nicht verfügbar – Einstellungen gelten nur für die Sitzung */
  }
}

const TOKENS: [string, DynamicColor][] = [
  ['primary', MaterialDynamicColors.primary],
  ['on-primary', MaterialDynamicColors.onPrimary],
  ['primary-container', MaterialDynamicColors.primaryContainer],
  ['on-primary-container', MaterialDynamicColors.onPrimaryContainer],
  ['secondary', MaterialDynamicColors.secondary],
  ['on-secondary', MaterialDynamicColors.onSecondary],
  ['secondary-container', MaterialDynamicColors.secondaryContainer],
  ['on-secondary-container', MaterialDynamicColors.onSecondaryContainer],
  ['tertiary', MaterialDynamicColors.tertiary],
  ['on-tertiary', MaterialDynamicColors.onTertiary],
  ['tertiary-container', MaterialDynamicColors.tertiaryContainer],
  ['on-tertiary-container', MaterialDynamicColors.onTertiaryContainer],
  ['error', MaterialDynamicColors.error],
  ['on-error', MaterialDynamicColors.onError],
  ['error-container', MaterialDynamicColors.errorContainer],
  ['on-error-container', MaterialDynamicColors.onErrorContainer],
  ['surface', MaterialDynamicColors.surface],
  ['on-surface', MaterialDynamicColors.onSurface],
  ['surface-variant', MaterialDynamicColors.surfaceVariant],
  ['on-surface-variant', MaterialDynamicColors.onSurfaceVariant],
  ['surface-container-lowest', MaterialDynamicColors.surfaceContainerLowest],
  ['surface-container-low', MaterialDynamicColors.surfaceContainerLow],
  ['surface-container', MaterialDynamicColors.surfaceContainer],
  ['surface-container-high', MaterialDynamicColors.surfaceContainerHigh],
  ['surface-container-highest', MaterialDynamicColors.surfaceContainerHighest],
  ['outline', MaterialDynamicColors.outline],
  ['outline-variant', MaterialDynamicColors.outlineVariant],
  ['inverse-surface', MaterialDynamicColors.inverseSurface],
  ['inverse-on-surface', MaterialDynamicColors.inverseOnSurface],
  ['inverse-primary', MaterialDynamicColors.inversePrimary],
];

function buildScheme(seed: string, dark: boolean, variant: SchemeVariant): DynamicScheme {
  const hct = Hct.fromInt(argbFromHex(seed));
  // Kontrast 0.0 = Standard; WCAG-AA wird durch die M3-Tonalitätsabstände erreicht
  if (variant === 'expressive') return new SchemeExpressive(hct, dark, 0.0);
  if (variant === 'tonal') return new SchemeTonalSpot(hct, dark, 0.0);
  return new SchemeVibrant(hct, dark, 0.0);
}

/** Setzt die Farbtokens per CSSOM (CSP-konform, keine Inline-Styles im Markup). */
function applyScheme(seed: string, dark: boolean, variant: SchemeVariant) {
  const root = document.documentElement;
  try {
    const scheme = buildScheme(seed, dark, variant);
    for (const [name, color] of TOKENS) {
      root.style.setProperty(`--md-sys-color-${name}`, hexFromArgb(color.getArgb(scheme)));
    }
  } catch {
    // Fallback: statische Tokens aus tokens.css
    for (const [name] of TOKENS) root.style.removeProperty(`--md-sys-color-${name}`);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(readPrefs, []);
  const [mode, setModeState] = useState<ThemeMode>(initial.mode ?? 'system');
  const [seed, setSeedState] = useState<string>(initial.seed ?? SEEDS[0].hex);
  const [variant, setVariantState] = useState<SchemeVariant>(initial.variant ?? 'vibrant');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
    applyScheme(seed, resolved === 'dark', variant);
    const meta = document.querySelector('meta[name="theme-color"]') ?? document.head.appendChild(document.createElement('meta'));
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim());
    writePrefs({ mode, seed, variant });
  }, [resolved, seed, variant, mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const setSeed = useCallback((h: string) => setSeedState(h), []);
  const setVariant = useCallback((v: SchemeVariant) => setVariantState(v), []);

  const value = useMemo(
    () => ({ mode, resolved, seed, variant, setMode, setSeed, setVariant }),
    [mode, resolved, seed, variant, setMode, setSeed, setVariant],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('ThemeProvider fehlt');
  return ctx;
}
