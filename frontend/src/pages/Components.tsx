import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Report } from '@fleet/shared/protocol';
import { SITE_BY_KEY } from '@fleet/shared/sites';
import { fleet, useFleet } from '../data/store';
import type { ReportedRobot, ReportedStatus, Robot, Status } from '../data/types';
import { AttentionCard } from '../components/AttentionCard';
import { FilterPills } from '../components/FilterPills';
import {
  ChargingIcon, ChevronLeft, ErrorIcon, FitIcon, LabelIcon, LowIcon, NeverIcon, OfflineIcon, OkIcon, PlusIcon, SearchIcon, TrailIcon,
} from '../components/Icons';
import { MapMarker } from '../components/MapMarker';
import { RobotRow, SkeletonRows, TableEmpty, TableHeader, clearButtonClass } from '../components/RobotTable';
import { SitePlan } from '../components/SitePlan';
import { StatusPill } from '../components/StatusPill';
import { BannerView, ConnectionIndicatorView, IngestBannerView, TopBar } from '../components/TopBar';
import type { Filter } from '../lib/fleet';
import css from './Components.module.css';

/** Sample robots, so every variant is shown with the real components. */
function sample(now: number, flashAt: number) {
  const info = (id: string, model: string, site: string) => ({ id, model, modelFull: model, siteKey: site, firmware: '4.12.1', network: 'AP', registeredAt: now - 43 * 60_000, lastCharge: null });
  const mk = (id: string, status: ReportedStatus, rep: Partial<Report>, model = 'Tote picker', site = 'hh', changedAt: number | null = null): ReportedRobot => ({
    id,
    status,
    changedAt,
    low: status === 'low',
    ghosts: [],
    info: info(id, model, site),
    report: { id, t: now - 1000, battery: 78, x: 12, y: 11.1, state: 'ok', task: 'Idle', taskKind: 'idle', since: now - 6 * 3600_000, ...rep },
  });
  const never: Robot = { id: 'R-051', status: 'never', report: null, changedAt: null, low: false, ghosts: [], info: info('R-051', 'Sorter shuttle', 'mu') };
  return {
    ok: mk('R-003', 'ok', { battery: 78, task: 'Pick order #4433', taskKind: 'picking', x: 23.4, y: 9.8 }),
    hover: mk('R-004', 'ok', { battery: 55, task: 'Charging', taskKind: 'charging', x: 52.1, y: 6.2 }),
    low: mk('R-017', 'low', { battery: 14, task: 'Returning to dock', taskKind: 'returning_to_dock', x: 44, y: 9.2 }),
    error: mk('R-024', 'error', { battery: 71, state: 'error', fault: 'Motor overcurrent', task: 'Pick order #4481', taskKind: 'picking', x: 17.3, y: 12.4 }, 'Tote picker', 'le'),
    offline: mk('R-041', 'offline', { t: now - 184_000, battery: 63, task: 'Pick order #4502', taskKind: 'picking', x: 48.2, y: 9.8 }, 'Tote picker', 'mu'),
    changed: mk('R-028', 'low', { battery: 19, task: 'Returning to dock', taskKind: 'returning_to_dock', x: 27.3, y: 7.8 }, 'Pallet mover', 'le', flashAt),
    never,
    stale: mk('R-003', 'ok', { t: now - 27_000, battery: 78, task: 'Pick order #4433', taskKind: 'picking', x: 23.4, y: 9.8 }),
  };
}

function Sec({ n, title, ctx, note, children }: { n: string; title: string; ctx: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={css.sec} aria-label={title}>
      <div className={css.h}>
        <span className={css.num}>{n}</span>
        <h2>{title} <span>{ctx}</span></h2>
        {note && <p>{note}</p>}
      </div>
      <div className={css.body}>{children}</div>
    </section>
  );
}

const SCREENS: [string, string, string][] = [
  ['/', 'Fleet overview', 'The headline is the answer: it is computed from live data and says how many robots need attention before anything else. Cards appear only for problems, so on a calm day the screen is almost empty; colour is spent only where the eye should land.'],
  ['/?status=offline', 'Overview · Offline filter', 'Filters are URL state, so a shift lead can send a link to “all offline robots in Munich”. When the link drops, a non-blocking banner explains it, values turn grey and “last seen” keeps counting — we never mark robots offline because of our own outage.'],
  ['/robots/R-017', 'Robot detail · low battery', 'The page leads with a sentence, not a dashboard: “R-017 is low on battery. 14% left and falling.” The chart and the map exist to answer the follow-up questions — how fast, and where is it now.'],
  ['/robots/R-041', 'Robot detail · offline', 'Offline is treated as “unknown”, not “broken”: dashed outlines, grey last-known values, and a hatched gap in the chart instead of an invented line. The manager sees what we last knew and how old it is.'],
  ['/floor-plan?site=hh', 'Floor plan', 'Problems stand up as pins with a glyph; healthy robots stay as flat dots. A pin keeps its screen size when you zoom, and selecting a robot zooms around it, so finding the robot on the real floor is one click.'],
];

export function Components() {
  const now = useFleet((s) => s.now);
  const [flashAt, setFlashAt] = useState(now);
  const [filter, setFilter] = useState<Filter>('all');
  // Replay the status-change highlight every 4 s so it can be inspected.
  useEffect(() => {
    const t = setInterval(() => setFlashAt(Date.now() + fleet.get().offset), 4000);
    return () => clearInterval(t);
  }, []);
  const s = sample(now, flashAt);
  const counts = { all: 51, ok: 45, low: 2, error: 1, offline: 2, never: 1 };

  return (
    <>
      <TopBar />
      <main className={`wrap ${css.main}`}>
        <header className={css.top}>
          <Link className="more" to="/" style={{ fontSize: 13, gap: 4 }}><ChevronLeft size={11} /> Fleet overview</Link>
          <h1 className="headline">Components. <span className="ctx">Calm when everything is fine. Clear the moment something is not.</span></h1>
        </header>

        <Sec n="01" title="Status." ctx="Icon, label and colour. Never colour alone." note="OK is not a capsule, so a healthy fleet reads as quiet text. Offline is an outline: it means “we do not know”, which is different from Error, “something broke”.">
          <div className={`tile ${css.pad} ${css.wrapRow}`}>
            {(['ok', 'low', 'error', 'offline', 'never'] as Status[]).map((st) => <StatusPill key={st} status={st} />)}
          </div>
          <div className={`tile ${css.pad} ${css.wrapRow}`}>
            {(['ok', 'low', 'error', 'offline', 'never'] as Status[]).map((st) => <StatusPill key={st} status={st} size="lg" />)}
            <StatusPill status="error" solid />
            <span className={css.cap}>Large · detail header. Solid error · cards (tinted in dark, so it does not glare).</span>
          </div>
        </Sec>

        <Sec n="02" title="Table rows." ctx="Dense, but never crowded." note="Rows re-order only when a status changes; then the row slides to its new place and fills with the new status tint for 1.8 s. Battery and time update in place, and tabular numerals keep each column still.">
          <div className={`tile ${css.table}`}>
            <TableHeader />
            {([
              ['ok', 'OK'], ['hover', 'Hover (also: hovered on the map)'], ['low', 'Low battery'], ['error', 'Error'], ['offline', 'Offline — last seen emphasised'],
              ['changed', 'Just changed — replays every 4 s'], ['never', 'Never reported'], ['stale', 'Connection lost — values grey, last seen amber'],
            ] as [keyof typeof s, string][]).map(([k, label]) => (
              <div key={k}>
                <span className={css.rowLabel}>{label}</span>
                <RobotRow robot={s[k]} now={now} stale={k === 'stale'} hovered={k === 'hover'} scrollTo={false} />
              </div>
            ))}
          </div>
        </Sec>

        <Sec n="03" title="Filters and connection." ctx="Small, quiet, always there." note="The selected filter is a solid ink capsule, because selection is neutral. A count turns amber or red only when it is above zero.">
          <FilterPills counts={counts} value={filter} onChange={setFilter} showing="Interactive" />
          <div className={`tile ${css.pad} ${css.wrapRow}`} style={{ gap: 32 }}>
            <ConnectionIndicatorView connection="live" now={now} />
            <ConnectionIndicatorView connection="connecting" now={now} />
            <ConnectionIndicatorView connection="lost" now={now} />
            <ConnectionIndicatorView connection="live" paused now={now} />
          </div>
          <BannerView inline connection="lost" attempt={3} now={now} last={now - 27_000} retryInMs={5000} onRetry={() => {}} />
          <BannerView inline connection="connecting" attempt={2} now={now} last={null} retryInMs={2000} onRetry={() => {}} />
          <IngestBannerView inline now={now} frozenAt={now - 12_000} />
        </Sec>

        <Sec n="04" title="Attention cards." ctx="One per robot that needs you." note="Most urgent first. A new problem rises in over 0.9 s. Hover lifts the card and highlights the same robot in the table and on the map.">
          <div className={css.cards}>
            <AttentionCard robot={s.offline} now={now} hovered={false} stale={false} />
            <AttentionCard robot={s.error} now={now} hovered={false} stale={false} />
            <AttentionCard robot={s.low} now={now} hovered stale={false} />
          </div>
        </Sec>

        <Sec n="05" title="Map." ctx="Problems stand up. The rest stays flat." note="Hover a marker for the popover. Error pins breathe a red halo — the only repeating motion in the app.">
          <div className={`tile ${css.pad}`}>
            <SitePlan site={SITE_BY_KEY.hh}>
              {[s.ok, s.hover, s.low, { ...s.error, info: { ...s.error.info, siteKey: 'hh' } }, s.offline].map((r) => (
                <MapMarker key={r.id} robot={r} now={now} highlighted={r.id === 'R-024'} popover />
              ))}
            </SitePlan>
          </div>
        </Sec>

        <Sec n="06" title="States." ctx="Honest about what we know.">
          <div className={css.states}>
            <div className="tile"><SkeletonRows count={4} /></div>
            <div className="tile"><TableEmpty title="No robots here yet." detail="Berlin South has no robots assigned. A robot appears after its first report." action={<span className="more">Show all sites ›</span>} /></div>
            <div className="tile"><TableEmpty title="No matching robots." detail="Nothing matches “R-09” in Error at Hamburg DC." action={<button type="button" className={clearButtonClass}>Clear filters</button>} /></div>
          </div>
        </Sec>

        <Sec n="07" title="Icons." ctx="One grid, one stroke." note="16 px grid, 1.5 px stroke, round caps. Only Error is filled, so the worst state carries the most ink.">
          <div className={css.icons}>
            {([
              [<OkIcon size={28} stroke={1.25} />, 'OK', 'var(--ink2)'], [<LowIcon size={28} stroke={1.25} />, 'Low battery', 'var(--amb-text)'],
              [<ErrorIcon size={28} />, 'Error', 'var(--err-text)'], [<OfflineIcon size={28} stroke={1.25} />, 'Offline', 'var(--off-text)'],
              [<NeverIcon size={28} stroke={1.25} />, 'Never reported', 'var(--off-text)'], [<ChargingIcon size={28} stroke={1.25} />, 'Charging', 'var(--ink2)'],
              [<SearchIcon size={28} />, 'Search', 'var(--ink)'], [<PlusIcon size={28} />, 'Zoom in', 'var(--ink)'], [<FitIcon size={28} />, 'Fit', 'var(--ink)'],
              [<LabelIcon size={28} />, 'Labels', 'var(--ink)'], [<TrailIcon size={28} />, 'Trails', 'var(--ink)'], [<ChevronLeft size={28} />, 'Back', 'var(--accent)'],
            ] as [ReactNode, string, string][]).map(([icon, label, color]) => (
              <div key={label} className={`tile ${css.icon}`} style={{ color }}>{icon}<span>{label}</span></div>
            ))}
          </div>
        </Sec>

        <Sec n="08" title="Screens." ctx="One decision each, and why.">
          <div className={css.screens}>
            {SCREENS.map(([to, name, note]) => (
              <Link key={to} to={to} className={`tile ${css.screen}`}>
                <strong>{name}</strong>
                <p>{note}</p>
                <span className="more">Open <span aria-hidden="true">›</span></span>
              </Link>
            ))}
          </div>
        </Sec>
      </main>
    </>
  );
}
