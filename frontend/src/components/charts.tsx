/**
 * Schlanke, barrierearme SVG/HTML-Diagramme (keine Fremdbibliothek, CSP-konform).
 * Regeln: dünne Marken (Balken ≤ 24px, 4px gerundetes Datenende, eckig an der Basislinie),
 * 2px-Linien, 2px Flächen-Abstand, dezentes Raster, Hover-Tooltip, Legende ab 2 Serien,
 * Tabellenansicht für jede Grafik. Farben über CSS-Variablen (--series-*, --ord-*).
 */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? '–' : nf.format(v));
export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '–';
  if (h >= 48) return `${nf.format(h / 24)} Tage`;
  return `${nf.format(h)} h`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Tooltip, positioniert relativ zum Diagramm-Container. */
function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.left = `${x}px`;
    ref.current.style.top = `${y}px`;
  }, [x, y]);
  return <div ref={ref} className="viz-tip" role="status">{children}</div>;
}

/* ------------------------------------------------------------------ Karte */
export interface TableSpec { columns: string[]; rows: (string | number)[][] }

export function ChartCard({ title, subtitle, table, children, wide }: {
  title: string; subtitle?: string; table: TableSpec; children: ReactNode; wide?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card viz ${wide ? 'viz-wide' : ''}`} aria-label={title}>
      <header className="viz-head">
        <div>
          <h3 className="title-m mt-0 mb-0">{title}</h3>
          {subtitle ? <p className="body-s muted mt-0 mb-0">{subtitle}</p> : null}
        </div>
        <button type="button" className="btn text small" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          <Icon name={asTable ? 'chart' : 'list'} size={16} />{asTable ? 'Grafik' : 'Tabelle'}
        </button>
      </header>
      {asTable ? (
        <div className="table-wrap"><table className="data">
          <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      ) : children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="viz-legend">
      {items.map((i) => (
        <li key={i.label}><span className={`viz-key ${i.color}`} aria-hidden="true" />{i.label}</li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Säulen */
export function BarChart({ data, color = 'c1', format = fmtNum, height = 220, label }: {
  data: { label: string; value: number }[]; color?: string; format?: (v: number) => string; height?: number; label: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const L = 36, R = 8, T = 12, B = 26;
  const pw = w - L - R, ph = height - T - B;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const band = pw / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.62);
  const every = Math.max(1, Math.ceil((data.length * 44) / pw));
  const y = (v: number) => T + ph - (v / max) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const hv = hover !== null ? data[hover] : undefined;
  return (
    <div ref={ref} className="viz-plot" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-gridline'} />
            <text x={L - 6} y={y(t) + 4} className="viz-tick" textAnchor="end">{fmtNum(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * band + (band - bw) / 2;
          const top = y(d.value), h = T + ph - top, r = Math.min(4, h);
          return (
            <g key={d.label + i}>
              {hover === i ? <rect x={L + i * band} y={T} width={band} height={ph} className="viz-hoverband" /> : null}
              {d.value > 0 ? (
                <path className={`viz-fill ${color}`}
                  d={`M${x},${T + ph} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + ph} Z`} />
              ) : null}
              {i % every === 0 ? <text x={x + bw / 2} y={height - 8} className="viz-tick" textAnchor="middle">{d.label}</text> : null}
              <rect x={L + i * band} y={T} width={band} height={ph + B} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
            </g>
          );
        })}
      </svg>
      {hv && hover !== null ? (
        <Tip x={L + hover * band + band / 2} y={y(hv.value) - 8}><strong>{hv.label}</strong><br />{format(hv.value)}</Tip>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Linien */
export function LineChart({ labels, series, height = 240, label }: {
  labels: string[]; series: { name: string; values: number[]; color: string }[]; height?: number; label: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const L = 36, R = 90, T = 12, B = 26;
  const pw = w - L - R, ph = height - T - B;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => L + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => T + ph - (v / max) * ph;
  const every = Math.max(1, Math.ceil((n * 44) / pw));
  // Endbeschriftungen mit einfacher Kollisionsvermeidung
  const ends = series.map((s) => ({ s, y: y(s.values[n - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;
  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const bx = (e.currentTarget.ownerSVGElement?.getBoundingClientRect().left ?? 0);
    const i = Math.round(((e.clientX - bx - L) / pw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div ref={ref} className="viz-plot" onMouseLeave={() => setHover(null)}>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <svg width={w} height={height} role="img" aria-label={label}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={L + pw} y1={y(f * max)} y2={y(f * max)} className={f === 0 ? 'viz-base' : 'viz-gridline'} />
            <text x={L - 6} y={y(f * max) + 4} className="viz-tick" textAnchor="end">{fmtNum(f * max)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 ? <text key={l + i} x={x(i)} y={height - 8} className="viz-tick" textAnchor="middle">{l}</text> : null))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ph} className="viz-cross" /> : null}
        {series.map((s) => (
          <polyline key={s.name} className={`viz-line ${s.color}`} fill="none"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {hover !== null ? series.map((s) => (
          <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} className={`viz-dot ${s.color}`} />
        )) : null}
        {ends.map(({ s, y: ey }) => (
          <text key={s.name} x={L + pw + 8} y={ey + 4} className="viz-endlabel">{s.name}</text>
        ))}
        <rect x={L} y={T} width={pw} height={ph} fill="transparent" onMouseMove={onMove} />
      </svg>
      {hover !== null ? (
        <Tip x={x(hover)} y={T + 4}>
          <strong>{labels[hover]}</strong>
          {series.map((s) => <div key={s.name}><span className={`viz-key ${s.color}`} aria-hidden="true" />{s.name}: {fmtNum(s.values[hover] ?? 0)}</div>)}
        </Tip>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Liegende Balken */
export function HBarChart({ data, color = 'c1', format = fmtNum, label }: {
  data: { label: string; value: number; hint?: string }[]; color?: string; format?: (v: number) => string; label: string;
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <ul className="viz-hbars" aria-label={label}>
      {data.map((d, i) => (
        <li key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'is-hover' : ''}>
          <span className="viz-hlabel" title={d.label}>{d.label}</span>
          <span className="viz-htrack"><HBar pct={(d.value / max) * 100} color={color} /></span>
          <span className="viz-hval">{format(d.value)}{d.hint ? <span className="muted"> · {d.hint}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}
function HBar({ pct, color }: { pct: number; color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current) ref.current.style.width = `${Math.max(0, Math.min(100, pct))}%`; }, [pct]);
  return <span ref={ref} className={`viz-hbar ${color}`} />;
}

/* ------------------------------------------------------------------ Segmentierter Balken (Anteile) */
export function SegmentedBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="viz-seg-wrap">
      {total === 0 ? <p className="muted body-m">Keine Daten im Zeitraum.</p> : (
        <div className="viz-seg" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
          {shown.map((p, i) => (
            <Seg key={p.label} grow={p.value} color={p.color} onEnter={() => setHover(i)} onLeave={() => setHover(null)}
              text={p.value / total >= 0.1 ? `${Math.round((p.value / total) * 100)} %` : ''} active={hover === i} />
          ))}
        </div>
      )}
      <ul className="viz-legend viz-legend-values">
        {parts.map((p) => (
          <li key={p.label}><span className={`viz-key ${p.color}`} aria-hidden="true" />{p.label}
            <strong>{fmtNum(p.value)}</strong>{total > 0 ? <span className="muted">({Math.round((p.value / total) * 100)} %)</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
function Seg({ grow, color, text, onEnter, onLeave, active }: {
  grow: number; color: string; text: string; onEnter: () => void; onLeave: () => void; active: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current) ref.current.style.flexGrow = String(grow); }, [grow]);
  return <span ref={ref} className={`viz-seg-part ${color} ${active ? 'is-active' : ''}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>{text}</span>;
}

/* ------------------------------------------------------------------ Kennzahl */
export function StatTile({ label, value, hint, status }: {
  label: string; value: string; hint?: string; status?: 'good' | 'warning' | 'critical';
}) {
  return (
    <div className="viz-stat">
      <span className="label-l muted">{label}</span>
      <span className="viz-stat-value">{value}</span>
      {status ? (
        <span className={`viz-status ${status}`}>
          <Icon name={status === 'good' ? 'check' : 'warning'} size={16} />
          {status === 'good' ? 'im Ziel' : status === 'warning' ? 'knapp unter Ziel' : 'unter Ziel'}
        </span>
      ) : hint ? <span className="body-s muted">{hint}</span> : null}
    </div>
  );
}
