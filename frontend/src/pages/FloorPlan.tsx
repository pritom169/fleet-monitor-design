import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SITE_BY_KEY, SITES } from '@fleet/shared/sites';
import { actions, useFleet } from '../data/store';
import type { Robot } from '../data/types';
import { BatteryGlyph } from '../components/BatteryGlyph';
import { ChargingIcon, ChevronLeft, ErrorIcon, FitIcon, LabelIcon, LowIcon, MinusIcon, OfflineIcon, PlusIcon, SearchIcon, TrailIcon } from '../components/Icons';
import { MapMarker } from '../components/MapMarker';
import { SitePlan, px, py } from '../components/SitePlan';
import { StatusPill } from '../components/StatusPill';
import { TopBar } from '../components/TopBar';
import { matches, siteName } from '../lib/fleet';
import { TINT, TONE, isProblem } from '../lib/status';
import { sortRobots } from '../lib/sort';
import { ago, span } from '../lib/time';
import css from './FloorPlan.module.css';

const ZMIN = 1;
const ZMAX = 3;

export function FloorPlan() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('site') ?? '';
  const siteKey = SITE_BY_KEY[asked] ? asked : SITES[0].key;
  const site = SITE_BY_KEY[siteKey];
  const selId = params.get('robot');
  const setParam = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v) n.set(k, v);
        else n.delete(k);
      }
      return n;
    }, { replace: true });

  const [zoom, setZoom] = useState(selId ? 1.6 : 1);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [labels, setLabels] = useState(false);
  const [trails, setTrails] = useState(true);

  const ready = useFleet((s) => s.ready);
  const now = useFleet((s) => s.now);
  const robotsById = useFleet((s) => s.robots);
  const ids = useFleet((s) => s.ids);
  const hover = useFleet((s) => s.hover);

  const all = useMemo(() => ids.map((id) => robotsById[id]), [ids, robotsById]);
  const here = useMemo(() => all.filter((r) => r.info.siteKey === siteKey), [all, siteKey]);
  const att = useMemo(() => sortRobots(here.filter((r) => isProblem(r.status))), [here]);
  const rest = useMemo(() => here.filter((r) => !isProblem(r.status)).sort((a, b) => (a.id < b.id ? -1 : 1)), [here]);
  const sel = selId ? here.find((r) => r.id === selId) ?? null : null;
  const focus = hover?.id ?? sel?.id ?? null;

  const pickSite = (k: string) => {
    setParam({ site: k, robot: null });
    setZoom(1);
    setQ('');
  };
  const select = (id: string | null) => {
    setParam({ robot: id });
    if (id) setZoom((z) => Math.max(z, 1.6));
    else setZoom(1);
  };

  const nAtt = att.length;
  const headB = !ready
    ? 'Connecting to your fleet…'
    : here.length === 0
      ? 'No robots on this floor yet.'
      : `${here.length} robots on the floor. ${nAtt ? `${nAtt} ${nAtt === 1 ? 'needs' : 'need'} your attention.` : 'All are running normally.'}`;

  const origin = sel?.report ? `${px(sel.report.x)} ${py(sel.report.y)}` : '50% 50%';
  const canvasStyle = { '--inv': (1 / zoom).toFixed(3), transform: `translateY(-50%) scale(${zoom})`, transformOrigin: origin } as CSSProperties;
  const attList = att.filter((r) => matches(r, q));
  const okList = only ? [] : rest.filter((r) => matches(r, q));

  return (
    <>
      <TopBar />
      <main className={`wrap ${css.main}`}>
        <section aria-label="Summary" className={css.summary}>
          <h1 className={`headline ${css.h1}`} aria-live="polite">{site.name}. <span className="ctx">{headB}</span></h1>
          <nav className={css.seg} aria-label="Site">
            {SITES.map((s) => (
              <button key={s.key} type="button" aria-pressed={s.key === siteKey} onClick={() => pickSite(s.key)}>{s.name}</button>
            ))}
          </nav>
        </section>

        <section className={css.stage} aria-label={`Floor plan of ${site.name}`}>
          <div className={css.dots} aria-hidden="true" />
          <div className={css.canvas} style={canvasStyle}>
            <SitePlan site={site} variant="stage" detail emptyNote={ready && here.length === 0 ? 'No robots assigned to this floor yet.' : undefined}>
              {trails && rest.flatMap((r) =>
                r.ghosts.slice(0, -1).slice(-4).map((g, i, arr) => (
                  <span key={`${r.id}-${i}`} className={css.ghost} style={{ left: px(g[0]), top: py(g[1]), opacity: only ? 0 : 0.06 + (0.16 * (i + 1)) / arr.length }} />
                )),
              )}
              {[...rest, ...att].map((r) => (
                <MapMarker
                  key={r.id}
                  robot={r}
                  now={now}
                  big
                  label={labels}
                  highlighted={hover?.id === r.id}
                  selected={focus === r.id}
                  dimmed={isProblem(r.status) ? 1 : only ? 0.14 : matches(r, q) ? 1 : 0.2}
                  onEnter={() => actions.hover(r.id, 'map')}
                  onLeave={() => actions.hover(null)}
                  onClick={() => select(r.id)}
                />
              ))}
            </SitePlan>
            <div className={css.scaleBar} aria-hidden="true"><span /><span>10 m</span></div>
          </div>

          <aside className={css.panel} aria-label="Robots on this floor">
            {sel ? (
              <Selected robot={sel} now={now} onBack={() => select(null)} />
            ) : (
              <>
                <div className={css.panelHead}>
                  <span className={css.panelTitle}><strong>{site.name}</strong><span>{here.length} robots</span></span>
                  <span className={css.find}>
                    <SearchIcon size={14} />
                    <input type="search" aria-label="Find a robot on this floor" placeholder="Find a robot" value={q} onChange={(e) => setQ(e.target.value)} />
                  </span>
                  <span className={css.switchRow}>
                    <span id="fp-only">Only robots that need attention</span>
                    <button type="button" className={css.switch} role="switch" aria-checked={only} aria-labelledby="fp-only" onClick={() => setOnly((v) => !v)}><span /></button>
                  </span>
                </div>
                <div className={css.list}>
                  {attList.length > 0 && <span className={css.group}>Needs attention</span>}
                  {attList.map((r) => <Item key={r.id} robot={r} now={now} onPick={() => select(r.id)} />)}
                  {okList.length > 0 && <span className={css.group}>Running normally</span>}
                  {okList.map((r) => <Item key={r.id} robot={r} now={now} onPick={() => select(r.id)} />)}
                  {ready && !attList.length && !okList.length && (
                    <div className={css.listEmpty}>
                      <strong>{here.length ? 'No matching robots' : 'No robots here yet'}</strong>
                      <span>{here.length ? (only ? 'Nothing needs attention on this floor.' : 'Try another name or ID.') : 'A robot appears after its first report.'}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>

          <div className={css.ctrl} role="group" aria-label="Zoom" style={{ top: 16 }}>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(ZMAX, Math.round((z + 0.4) * 10) / 10))}><PlusIcon /></button>
            <hr />
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(ZMIN, Math.round((z - 0.4) * 10) / 10))}><MinusIcon /></button>
            <hr />
            <button type="button" aria-label="Fit floor to view" onClick={() => select(null)}><FitIcon /></button>
          </div>
          <div className={css.ctrl} role="group" aria-label="Map layers" style={{ top: 172 }}>
            <button type="button" aria-label="Show robot labels" aria-pressed={labels} onClick={() => setLabels((v) => !v)}><LabelIcon /></button>
            <hr />
            <button type="button" aria-label="Show movement trails" aria-pressed={trails} onClick={() => setTrails((v) => !v)}><TrailIcon /></button>
          </div>

          <div className={css.legend} aria-hidden="true">
            <span><i style={{ width: 8, height: 8, background: 'var(--dotok)' }} />OK</span>
            <span><i style={{ background: 'var(--amb)' }} />Low battery</span>
            <span><i style={{ background: 'var(--err)' }} />Error</span>
            <span><i style={{ background: 'var(--raise)', boxShadow: 'inset 0 0 0 1.5px var(--off)' }} />Offline</span>
            <b />
            <span>{Math.round(zoom * 100)}%</span>
          </div>
        </section>

        <section aria-label="Sites" className={css.sites}>
          {SITES.map((s) => {
            const rs = all.filter((r) => r.info.siteKey === s.key);
            const a = rs.filter((r) => isProblem(r.status)).length;
            return (
              <button key={s.key} type="button" className={css.site} aria-pressed={s.key === siteKey} onClick={() => pickSite(s.key)}>
                <span className={css.siteHead}><strong>{s.name}</strong><span>{rs.length} robots</span></span>
                <SitePlan site={s} variant="mini">
                  {rs.map((r) => r.report && (
                    <span key={r.id} className={`${css.mini} ${css[`mini_${r.status}`]}`} style={{ left: px(r.report.x), top: py(r.report.y) }} />
                  ))}
                </SitePlan>
                <span className={css.siteAtt} style={{ color: a ? 'var(--ink)' : 'var(--ink2)' }}>
                  {!ready ? '—' : rs.length === 0 ? 'No robots yet' : a ? `${a} ${a === 1 ? 'needs' : 'need'} attention` : 'All running normally'}
                </span>
              </button>
            );
          })}
        </section>
      </main>
    </>
  );
}

function Item({ robot: r, now, onPick }: { robot: Robot; now: number; onPick: () => void }) {
  const rep = r.report;
  const problem = isProblem(r.status);
  const sub = r.status === 'never' ? 'Never reported' : r.status === 'offline' ? `Last seen ${ago(now - r.report.t)}` : r.status === 'error' ? r.report.fault : r.report.task;
  return (
    <button
      type="button"
      className={css.item}
      onClick={onPick}
      onMouseEnter={() => actions.hover(r.id, 'list')}
      onMouseLeave={() => actions.hover(null)}
    >
      <span className={css.ico} style={{ background: TINT[r.status], color: problem ? TONE[r.status] : 'var(--ink2)' }} aria-hidden="true">
        {r.status === 'low' ? <LowIcon size={16} stroke={1.5} /> : r.status === 'error' ? <ErrorIcon size={14} /> : r.status === 'offline' ? <OfflineIcon size={15} stroke={1.5} /> : rep?.taskKind === 'charging' ? <ChargingIcon size={14} stroke={1.5} /> : <i className={css.okDot} />}
      </span>
      <span className={css.itemText}>
        <strong>{r.id}</strong>
        <span style={{ color: r.status === 'error' ? 'var(--err-text)' : undefined }}>{sub}</span>
      </span>
      <span className={css.itemBatt} style={{ color: r.status === 'low' ? 'var(--amb-text)' : undefined }}>{rep ? `${rep.battery}%` : '—'}</span>
    </button>
  );
}

function Selected({ robot: r, now, onBack }: { robot: Robot; now: number; onBack: () => void }) {
  const { status: st, report: rep } = r;
  const why =
    st === 'never' ? 'Waiting for its first report.'
      : st === 'low' ? `${rep.battery}% battery. ${rep.task}.`
        : st === 'error' ? `${rep.fault}. The robot has stopped.`
          : st === 'offline' ? `No report for ${span(now - rep.t)}.`
            : rep.taskKind === 'charging' ? 'Charging in the dock.' : 'Running normally.';
  return (
    <div className={css.sel}>
      <button type="button" className="more" onClick={onBack} style={{ alignSelf: 'flex-start', padding: '4px 0', gap: 4 }}>
        <ChevronLeft size={12} />{siteName(r.info.siteKey)}
      </button>
      <span style={{ marginTop: 10 }}><StatusPill status={st} solid /></span>
      <strong className={css.selId}>{r.id}</strong>
      <span className={css.selMeta}>{r.info.model} · {rep ? `Last seen ${ago(now - rep.t)}` : 'Never seen'}</span>
      <span className={css.selWhy} style={{ color: st === 'ok' ? 'var(--ink)' : TONE[st] }}>{why}</span>
      <dl className={css.selDl}>
        <div><dt>Battery</dt><dd style={{ color: st === 'low' ? 'var(--amb-text)' : st === 'offline' ? 'var(--off-text)' : undefined }}>{rep && <BatteryGlyph value={rep.battery} status={st} />}{rep ? `${rep.battery}%` : '—'}</dd></div>
        <div><dt>Task</dt><dd>{rep?.task ?? '—'}</dd></div>
        <div><dt>Position</dt><dd>{rep ? `${rep.x.toFixed(1)}, ${rep.y.toFixed(1)} m` : '—'}</dd></div>
        <div><dt>Site</dt><dd>{siteName(r.info.siteKey)}</dd></div>
      </dl>
      <Link className="more" to={`/robots/${r.id}`} style={{ marginTop: 18 }}>View robot details <span aria-hidden="true">›</span></Link>
    </div>
  );
}
