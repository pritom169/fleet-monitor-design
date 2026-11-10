import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SITE_BY_KEY, SITES } from '@fleet/shared/sites';
import { useFleet } from '../data/store';
import type { Status } from '../data/types';
import { AttentionCards } from '../components/AttentionCard';
import { FilterPills } from '../components/FilterPills';
import { FleetMap } from '../components/FleetMap';
import { RobotTable, TableEmpty, clearButtonClass } from '../components/RobotTable';
import { SearchBox, SiteSelector } from '../components/SiteSelector';
import { TopBar } from '../components/TopBar';
import { countBy, matches, needsAttention, overviewHeadline, siteName, sitesWithRobots, type Filter } from '../lib/fleet';
import { isStale } from '../lib/status';
import { sortRobots } from '../lib/sort';
import css from './Overview.module.css';

const FILTERS: Filter[] = ['all', 'ok', 'low', 'error', 'offline', 'never'];
const FILTER_NAME: Record<Filter, string> = { all: 'all robots', ok: 'OK', low: 'Low battery', error: 'Error', offline: 'Offline', never: 'Never reported' };

function useOverviewParams() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('site') ?? '';
  const site = SITE_BY_KEY[asked] ? asked : 'all';
  const f = params.get('status') as Filter | null;
  const filter: Filter = f && FILTERS.includes(f) ? f : 'all';
  const q = params.get('q') ?? '';
  const set = (patch: Record<string, string>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (!v || v === 'all') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  return { site, filter, q, set };
}

export function Overview() {
  const { site, filter, q, set } = useOverviewParams();
  const ready = useFleet((s) => s.ready);
  const connection = useFleet((s) => s.connection);
  const attempt = useFleet((s) => s.attempt);
  const lastMessageAt = useFleet((s) => s.lastMessageAt);
  const ingest = useFleet((s) => s.ingest);
  const now = useFleet((s) => s.now);
  const ids = useFleet((s) => s.ids);
  const robotsById = useFleet((s) => s.robots);
  const hover = useFleet((s) => s.hover);

  const all = useMemo(() => ids.map((id) => robotsById[id]), [ids, robotsById]);
  const inSite = useMemo(() => (site === 'all' ? all : all.filter((r) => r.info.siteKey === site)), [all, site]);
  const n = useMemo(() => countBy(inSite), [inSite]);
  const list = useMemo(
    () => sortRobots(inSite.filter((r) => (filter === 'all' || r.status === filter) && matches(r, q))),
    [inSite, filter, q],
  );
  const visible = useMemo(() => new Set(list.map((r) => r.id)), [list]);
  const problems = useMemo(() => sortRobots(inSite.filter(needsAttention)), [inSite]);

  const stale = isStale({ connection, ingest });
  const loading = !ready;
  const [headA, headB] = overviewHeadline({ ready, connection, ingest, attempt, lastMessageAt, site, n, sitesWithRobots: sitesWithRobots(all) });

  const mapSites = site === 'all'
    ? SITES.filter((s) => !ready || all.some((r) => r.info.siteKey === s.key)).map((s) => s.key)
    : [site];

  const clear = () => set({ q: '', status: 'all', site: 'all' });
  const where = site === 'all' ? 'all sites' : siteName(site);
  let empty: React.ReactNode = null;
  if (!loading && inSite.length === 0) {
    empty = (
      <TableEmpty
        title="No robots here yet."
        detail={`${siteName(site)} has no robots assigned. A robot appears after its first report.`}
        action={<button type="button" className="more" onClick={() => set({ site: 'all' })}>Show all sites <span aria-hidden="true">›</span></button>}
      />
    );
  } else if (!loading && list.length === 0) {
    empty = (
      <TableEmpty
        title="No matching robots."
        detail={`Nothing matches ${q ? `“${q}” in ` : ''}${FILTER_NAME[filter]} at ${where}.`}
        action={<button type="button" className={clearButtonClass} onClick={clear}>Clear filters</button>}
      />
    );
  }

  const connectingNote = attempt > 0 ? `Cannot reach the fleet server. Retrying (attempt ${attempt})…` : 'Connecting to fleet…';

  return (
    <>
      <TopBar>
        <SiteSelector value={site} onChange={(k) => set({ site: k })} />
        <SearchBox value={q} onChange={(v) => set({ q: v })} />
      </TopBar>
      <main className={`wrap ${css.main}`}>
        <section aria-label="Summary" className={css.answer}>
          <h1 className={`headline ${css.h1}`} aria-live="polite">
            {headA} <span className="ctx">{headB}</span>
          </h1>
        </section>

        <AttentionCards robots={problems} now={now} hoveredId={hover?.id ?? null} stale={stale} />

        <FilterPills
          counts={loading ? null : n}
          loading={loading}
          value={filter}
          onChange={(f: Filter | Status) => set({ status: f })}
          showing={loading ? 'Waiting for data' : `${list.length} of ${n.all} robots · most urgent first`}
        />

        <div className={css.split}>
          <div className={css.tableCol}>
            <RobotTable robots={list} stale={stale} hover={hover} loading={loading} connecting={connectingNote} empty={empty} />
          </div>
          <div className={css.mapCol}>
            <FleetMap siteKeys={mapSites} robots={inSite} visible={visible} hoveredId={hover?.id ?? null} loading={loading} />
          </div>
        </div>

        <p className={css.foot}>
          Rows re-order only when a status changes. <Link className="more" to="/dev/components">Component sheet <span aria-hidden="true">›</span></Link>
        </p>
      </main>
    </>
  );
}
