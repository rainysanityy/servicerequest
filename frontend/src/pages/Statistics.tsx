import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { BarChart, ChartCard, fmtHours, fmtNum, HBarChart, LineChart, SegmentedBar, StatTile } from '../components/charts';
import { Icon } from '../components/Icon';
import { ErrorBanner, Segmented, Skeleton, useApi } from '../components/ui';
import { PRIORITY_LABEL } from '../util/format';

type Row = { label: string; value: number };
interface Stats {
  scope: 'user' | 'support' | 'admin';
  days: number;
  general: {
    openNow: number | null; resolved: number | null; slaPct: number | null;
    avgResolutionHours: number | null; medianFirstResponseHours: number | null;
    resolvedWeekly: Row[]; resolutionByCategory: (Row & { n: number })[];
    mine: { code: string; label: string; value: number }[];
  };
  support?: {
    openByStatus: { code: string; label: string; value: number }[];
    openByPriority: { code: string; value: number }[];
    flow: { label: string; created: number; resolved: number }[];
    aging: Row[]; categoryVolume: Row[];
    slaByPriority: { code: string; resolved: number; sla_pct: number | null; median_first_response_h: number | null }[];
    unassigned: number; overdue: number; waitingForUser: number;
  };
  admin?: {
    topItems: Row[];
    outcomes: { code: string; label: string; value: number }[];
    usersWeekly: Row[];
    users: { total: number; active_30d: number; admins: number; uhd: number; users: number };
    deniedFlow: Row[];
    topActions: Row[];
  };
}

// Feste Farbzuordnung je Status (Farbe folgt der Entität, nicht dem Rang)
const STATUS_SLOT: Record<string, string> = {
  new: 'c1', in_progress: 'c2', waiting_for_user: 'c3', waiting_for_approval: 'c4',
  resolved: 'c5', closed: 'c6', rejected: 'c7', withdrawn: 'c8',
};
const PRIO_SLOT: Record<string, string> = { low: 'o1', medium: 'o2', high: 'o3', critical: 'o4' };
const RANGES = [
  { value: '7', label: '7 Tage' }, { value: '30', label: '30 Tage' },
  { value: '90', label: '90 Tage' }, { value: '365', label: '12 Monate' },
] as const;

function slaStatus(p: number | null): 'good' | 'warning' | 'critical' | undefined {
  if (p === null) return undefined;
  return p >= 90 ? 'good' : p >= 75 ? 'warning' : 'critical';
}
const tbl = (rows: Row[], col: string, fmt: (v: number) => string = fmtNum) => ({ columns: [col, 'Wert'], rows: rows.map((r) => [r.label, fmt(r.value)]) });

export default function Statistics() {
  const { hasRole } = useAuth();
  const [days, setDays] = useState<'7' | '30' | '90' | '365'>('30');
  const { data, error, loading } = useApi(() => api.get<Stats>('/api/stats', { days }), [days]);
  const g = data?.general, s = data?.support, a = data?.admin;
  const rangeLabel = RANGES.find((r) => r.value === days)!.label;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display-s">Statistik</h1>
          <p className="muted body-l">
            {hasRole('admin') ? 'Alle Kennzahlen: Service, Support-Betrieb, Katalog, Benutzer und Sicherheit.'
              : hasRole('first-level') ? 'Service- und Support-Kennzahlen für den UHD.'
                : 'Allgemeine Service-Kennzahlen und Ihre eigenen Anfragen.'}
          </p>
        </div>
        <Segmented label="Zeitraum" value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      </div>
      <div className="banner tone-neutral viz-note"><Icon name="lock" />Alle Werte sind aggregiert. Es gibt keine Auswertungen einzelner Bearbeitender (Datenschutzkonzept).</div>
      <ErrorBanner error={error} />

      {loading && !data ? (
        <div className="viz-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={280} radius={28} />)}</div>
      ) : g ? (
        <>
          <h2 className="headline-s section-h">Service-Überblick</h2>
          <div className="viz-stats">
            <StatTile label={`Gelöst (${rangeLabel})`} value={fmtNum(g.resolved)} />
            <StatTile label="SLA-Erfüllung" value={g.slaPct === null ? '–' : `${fmtNum(g.slaPct)} %`} status={slaStatus(g.slaPct)} />
            <StatTile label="Ø Lösungszeit" value={fmtHours(g.avgResolutionHours)} hint="Erstellung bis Lösung" />
            <StatTile label="Median Erstreaktion" value={fmtHours(g.medianFirstResponseHours)} hint="bis zur ersten Antwort" />
            <StatTile label="Offene Tickets (gesamt)" value={fmtNum(g.openNow)} hint="aktueller Stand" />
          </div>
          <div className="viz-grid">
            <ChartCard title="Gelöste Tickets pro Woche" subtitle="letzte 12 Wochen, Wochenbeginn" table={tbl(g.resolvedWeekly, 'Woche ab')}>
              <BarChart data={g.resolvedWeekly} label="Gelöste Tickets pro Woche" />
            </ChartCard>
            <ChartCard title="Ø Lösungszeit nach Kategorie" subtitle={`${rangeLabel} · nur Kategorien mit ≥ 3 Tickets`}
              table={{ columns: ['Kategorie', 'Ø Lösungszeit', 'Tickets'], rows: g.resolutionByCategory.map((r) => [r.label, fmtHours(r.value), r.n]) }}>
              {g.resolutionByCategory.length ? (
                <HBarChart data={g.resolutionByCategory.map((r) => ({ label: r.label, value: r.value, hint: `${r.n} Tickets` }))} format={fmtHours} label="Ø Lösungszeit nach Kategorie" />
              ) : <p className="muted body-m">Zu wenige Daten im Zeitraum.</p>}
            </ChartCard>
            <ChartCard title="Meine Anfragen nach Status" subtitle="alle eigenen Tickets" table={{ columns: ['Status', 'Anzahl'], rows: g.mine.map((m) => [m.label, m.value]) }} wide>
              <SegmentedBar label="Meine Anfragen" parts={g.mine.filter((m) => m.value > 0).map((m) => ({ label: m.label, value: m.value, color: STATUS_SLOT[m.code] ?? 'c1' }))} />
            </ChartCard>
          </div>

          {s ? (
            <>
              <h2 className="headline-s section-h">Support-Betrieb</h2>
              <div className="viz-stats">
                <StatTile label="Nicht zugewiesen" value={fmtNum(s.unassigned)} hint="offene Tickets" />
                <StatTile label="SLA überschritten" value={fmtNum(s.overdue)} hint="offen, Lösungsfrist abgelaufen" />
                <StatTile label="Warten auf Rückmeldung" value={fmtNum(s.waitingForUser)} hint="Status Rückfrage" />
              </div>
              <div className="viz-grid">
                <ChartCard title="Eingang und Erledigung" subtitle={`${rangeLabel} · ${Number(days) <= 90 ? 'pro Tag' : 'pro Woche'}`} wide
                  table={{ columns: ['Zeitraum', 'Neu', 'Gelöst'], rows: s.flow.map((f) => [f.label, f.created, f.resolved]) }}>
                  <LineChart label="Eingang und Erledigung" labels={s.flow.map((f) => f.label)}
                    series={[{ name: 'Neu eingegangen', values: s.flow.map((f) => f.created), color: 'c1' }, { name: 'Gelöst', values: s.flow.map((f) => f.resolved), color: 'c2' }]} />
                </ChartCard>
                <ChartCard title="Offene Tickets nach Status" table={{ columns: ['Status', 'Anzahl'], rows: s.openByStatus.map((m) => [m.label, m.value]) }}>
                  <SegmentedBar label="Offene Tickets nach Status" parts={s.openByStatus.map((m) => ({ label: m.label, value: m.value, color: STATUS_SLOT[m.code] ?? 'c1' }))} />
                </ChartCard>
                <ChartCard title="Offene Tickets nach Priorität" table={{ columns: ['Priorität', 'Anzahl'], rows: s.openByPriority.map((p) => [PRIORITY_LABEL[p.code] ?? p.code, p.value]) }}>
                  <SegmentedBar label="Offene Tickets nach Priorität" parts={s.openByPriority.map((p) => ({ label: PRIORITY_LABEL[p.code] ?? p.code, value: p.value, color: PRIO_SLOT[p.code] ?? 'o2' }))} />
                </ChartCard>
                <ChartCard title="Alter offener Tickets" subtitle="seit Erstellung" table={tbl(s.aging, 'Alter')}>
                  <BarChart data={s.aging} label="Alter offener Tickets" />
                </ChartCard>
                <ChartCard title="Neue Tickets nach Kategorie" subtitle={rangeLabel} table={tbl(s.categoryVolume, 'Kategorie')}>
                  <HBarChart data={s.categoryVolume} label="Neue Tickets nach Kategorie" />
                </ChartCard>
                <ChartCard title="SLA-Erfüllung nach Priorität" subtitle={`${rangeLabel} · gelöste Tickets`} wide
                  table={{ columns: ['Priorität', 'SLA-Erfüllung', 'Gelöst', 'Median Erstreaktion'], rows: s.slaByPriority.map((p) => [PRIORITY_LABEL[p.code] ?? p.code, p.sla_pct === null ? '–' : `${fmtNum(p.sla_pct)} %`, p.resolved, fmtHours(p.median_first_response_h)]) }}>
                  <HBarChart label="SLA-Erfüllung nach Priorität" format={(v) => `${fmtNum(v)} %`}
                    data={s.slaByPriority.map((p) => ({ label: PRIORITY_LABEL[p.code] ?? p.code, value: p.sla_pct ?? 0, hint: `${p.resolved} gelöst · Erstreaktion ${fmtHours(p.median_first_response_h)}` }))} />
                </ChartCard>
              </div>
            </>
          ) : null}

          {a ? (
            <>
              <h2 className="headline-s section-h">Administration</h2>
              <div className="viz-stats">
                <StatTile label="Benutzer gesamt" value={fmtNum(a.users.total)} hint="mit Portal-Anmeldung" />
                <StatTile label="Aktiv (30 Tage)" value={fmtNum(a.users.active_30d)} />
                <StatTile label="UHD" value={fmtNum(a.users.uhd)} />
                <StatTile label="Administratoren" value={fmtNum(a.users.admins)} />
              </div>
              <div className="viz-grid">
                <ChartCard title="Top 10 Katalogeinträge" subtitle={rangeLabel} table={tbl(a.topItems, 'Katalogeintrag')}>
                  {a.topItems.length ? <HBarChart data={a.topItems} label="Top 10 Katalogeinträge" /> : <p className="muted body-m">Keine Tickets im Zeitraum.</p>}
                </ChartCard>
                <ChartCard title="Abschlüsse nach Ergebnis" subtitle={rangeLabel} table={{ columns: ['Ergebnis', 'Anzahl'], rows: a.outcomes.map((o) => [o.label, o.value]) }}>
                  <SegmentedBar label="Abschlüsse" parts={a.outcomes.map((o) => ({ label: o.label, value: o.value, color: STATUS_SLOT[o.code] ?? 'c6' }))} />
                </ChartCard>
                <ChartCard title="Neue Benutzer pro Woche" subtitle="erste Anmeldung · letzte 12 Wochen" table={tbl(a.usersWeekly, 'Woche ab')}>
                  <BarChart data={a.usersWeekly} label="Neue Benutzer pro Woche" />
                </ChartCard>
                <ChartCard title="Rollenverteilung" table={{ columns: ['Rolle', 'Anzahl'], rows: [['Mitarbeitende', a.users.users], ['UHD', a.users.uhd], ['Administration', a.users.admins]] }}>
                  <SegmentedBar label="Rollenverteilung" parts={[
                    { label: 'Mitarbeitende', value: a.users.users, color: 'c1' },
                    { label: 'UHD', value: a.users.uhd, color: 'c2' },
                    { label: 'Administration', value: a.users.admins, color: 'c3' }]} />
                </ChartCard>
                <ChartCard title="Verweigerte Zugriffe" subtitle={`${rangeLabel} · Audit-Ergebnis „verweigert“`} table={tbl(a.deniedFlow, 'Zeitraum')}>
                  <BarChart data={a.deniedFlow} label="Verweigerte Zugriffe" />
                </ChartCard>
                <ChartCard title="Häufigste Audit-Aktionen" subtitle={rangeLabel} table={tbl(a.topActions, 'Aktion')}>
                  <HBarChart data={a.topActions} label="Häufigste Audit-Aktionen" />
                </ChartCard>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
