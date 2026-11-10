import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { batteryRate, lastCrossing, useRobotHistory } from '../data/history';
import type { RobotEvent, TaskKind } from '@fleet/shared/protocol';
import { SITE_BY_KEY, placeName } from '@fleet/shared/sites';
import { useFleet } from '../data/store';
import type { ReportedRobot, Robot } from '../data/types';
import { BatteryChart } from '../components/BatteryChart';
import { ChevronLeft, ErrorIcon, LowIcon, OfflineIcon, OkIcon } from '../components/Icons';
import { SitePlan, px, py } from '../components/SitePlan';
import { StatusPill } from '../components/StatusPill';
import { TopBar } from '../components/TopBar';
import { siteName } from '../lib/fleet';
import { LOW_BATTERY, isStale } from '../lib/status';
import { ago, clock, duration, hm, skewText, span } from '../lib/time';
import css from './RobotDetail.module.css';

const fmt1 = (v: number) => (Math.round(Math.abs(v) * 10) / 10).toFixed(1);

const LOW_PLAN: Partial<Record<TaskKind, string>> = {
  charging: 'It is charging.',
  returning_to_dock: 'It is on its way to charge.',
  waiting_for_dock: 'It is waiting for a free dock.',
};

function headline(r: Robot, now: number, rate: number | null): [string, string] {
  if (r.status === 'never') {
    return [`${r.id} has never reported.`, `Registered at ${hm(r.info.registeredAt)}. Waiting for its first report.`];
  }
  const rep = r.report;
  switch (r.status) {
    case 'offline':
      return [`${r.id} is offline.`, `No report for ${span(now - rep.t)}. We do not know its state.`];
    case 'error':
      return [`${r.id} has stopped.`, `${rep.fault}. It needs someone on the floor.`];
    case 'low': {
      const trend = rate === null ? '' : rate < -0.05 ? ' and falling' : rate > 0.05 ? ' and rising' : '';
      const plan = LOW_PLAN[rep.taskKind] ?? 'It has not been sent to charge.';
      return [`${r.id} is low on battery.`, `${rep.battery}% left${trend}. ${plan}`];
    }
    default:
      return [`${r.id} is running normally.`, `${rep.task}. Battery ${rep.battery}%.`];
  }
}

function batterySub(r: Robot, rate: number | null): string {
  const rep = r.report;
  if (!rep) return 'No report yet.';
  if (r.status === 'offline') return `Last known value, reported at ${clock(rep.t)}. The real level is unknown.`;
  if (rate === null) return 'Not enough data for a trend yet.';
  if (rate > 0.05) {
    const left = Math.round((100 - rep.battery) / rate);
    return `Charging, ${fmt1(rate)}% per minute. Full in about ${left} min.`;
  }
  if (rate < -0.05) {
    const left = Math.round(rep.battery / -rate);
    return `Falling ${fmt1(rate)}% per minute. About ${left} minutes left at this rate.`;
  }
  return 'Steady over the last 5 minutes.';
}

const KIND_STYLE: Record<RobotEvent['kind'], { tint: string; color: string; text: string }> = {
  info: { tint: 'var(--fill)', color: 'var(--ink2)', text: 'var(--ink)' },
  ok: { tint: 'var(--fill)', color: 'var(--ink2)', text: 'var(--ink)' },
  low: { tint: 'var(--amb-tint)', color: 'var(--amb-text)', text: 'var(--amb-text)' },
  warn: { tint: 'var(--amb-tint)', color: 'var(--amb-text)', text: 'var(--amb-text)' },
  error: { tint: 'var(--err-tint)', color: 'var(--err-text)', text: 'var(--err-text)' },
  off: { tint: 'var(--off-tint)', color: 'var(--off-text)', text: 'var(--ink)' },
};

function EventIcon({ kind }: { kind: RobotEvent['kind'] }) {
  if (kind === 'low') return <LowIcon size={15} stroke={1.5} />;
  if (kind === 'warn' || kind === 'error') return <ErrorIcon size={13} />;
  if (kind === 'off') return <OfflineIcon size={14} />;
  if (kind === 'ok') return <OkIcon size={14} />;
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="2.5" fill="currentColor" /></svg>;
}

export function RobotDetail() {
  const { id = '' } = useParams();
  const robot = useFleet((s) => s.robots[id]);
  const ready = useFleet((s) => s.ready);
  const stale = useFleet(isStale);
  const now = useFleet((s) => s.now);

  if (!ready) {
    return (
      <>
        <TopBar />
        <main className={`wrap ${css.main}`} aria-busy="true">
          <BackLink />
          <h1 className={`headline ${css.h1}`}>{id}. <span className="ctx">Connecting to your fleet…</span></h1>
          <div className={css.grid} style={{ marginTop: 40 }}>
            {[4, 8, 4, 4, 4].map((span, i) => <div key={i} className={`tile shimmer ${css.skel}`} style={{ gridColumn: `span ${span}` }} />)}
          </div>
        </main>
      </>
    );
  }
  if (!robot) {
    return (
      <>
        <TopBar />
        <main className={`wrap ${css.main}`}>
          <BackLink />
          <h1 className={`headline ${css.h1}`}>There is no robot called {id}. <span className="ctx">Check the ID, or find it in the fleet list.</span></h1>
        </main>
      </>
    );
  }
  return <Detail key={robot.id} robot={robot} now={now} stale={stale} />;
}

function BackLink() {
  return <Link className={`more ${css.back}`} to="/"><ChevronLeft size={11} /> All robots</Link>;
}

function Detail({ robot: r, now, stale }: { robot: Robot; now: number; stale: boolean }) {
  const h = useRobotHistory(r.id);
  const others = useFleet((s) => s.robots);
  const [allEvents, setAllEvents] = useState(false);
  const rep = r.report;
  const site = SITE_BY_KEY[r.info.siteKey];
  const st = r.status;
  const off = st === 'offline' || st === 'never';

  const rate = useMemo(() => batteryRate(h.battery), [h.battery]);
  const cross = useMemo(() => lastCrossing(h.battery), [h.battery]);
  const [headA, headB] = headline(r, now, rate);

  const trail = h.trail.length ? h.trail : rep ? [[rep.t, rep.x, rep.y] as [number, number, number]] : [];
  const moving = trail.length >= 2 && Math.hypot(trail[trail.length - 1][1] - trail[trail.length - 2][1], trail[trail.length - 1][2] - trail[trail.length - 2][2]) > 0.05;
  const place = rep ? placeName(site, rep.x, rep.y) : null;
  const battColor = st === 'low' ? 'var(--amb-text)' : off ? 'var(--off-text)' : 'var(--ink)';

  let trendNote = '';
  if (st === 'offline') trendNote = rep ? `No data since ${clock(rep.t)}` : '';
  else if (st === 'never') trendNote = 'No data yet';
  else if (st === 'low') trendNote = cross ? `Below 20% since ${clock(cross)}` : 'Below 20% for the whole window';
  else if (h.battery.length) {
    const vs = h.battery.map((b) => b[1]);
    trendNote = `Lowest ${Math.min(...vs)}% · highest ${Math.max(...vs)}%`;
  }

  const metrics: { label: string; value: string; sub: string; color?: string }[] = [];
  if (rep) {
    const grey = off ? 'var(--off-text)' : undefined;
    let taskSub = place ? `${place[0].toUpperCase()}${place.slice(1)}` : 'On the floor';
    if (st === 'offline') taskSub = 'Last known. Current state unknown.';
    else if (st === 'error') taskSub = `${rep.fault}. Stopped ${place ? `in ${place}` : ''}`.trim();
    else if (rep.taskKind === 'returning_to_dock') {
      const bay = h.events.find((e) => e.code === 'bay_assigned' && rep.t - e.t < 10 * 60_000);
      const where = bay?.bay !== undefined ? `Charging bay ${bay.bay}` : 'Charging bay';
      taskSub = bay ? `${where}${bay.sub ? ` · ${bay.sub.toLowerCase()}` : ''}` : 'Heading to Charging';
    }
    metrics.push({ label: 'Current task', value: st === 'error' ? 'Stopped' : rep.task, sub: taskSub, color: st === 'error' ? 'var(--err-text)' : grey });
    metrics.push({
      label: 'Uptime',
      value: duration((off ? rep.t : now) - rep.since),
      sub: off ? `Until the last report at ${clock(rep.t)}` : `Online since ${hm(rep.since)}`,
      color: grey,
    });
    metrics.push({
      label: 'Position',
      value: `${rep.x.toFixed(1)}, ${rep.y.toFixed(1)} m`,
      sub: off ? `Last known${place ? ` · ${place}` : ''}` : `${place ? `${place[0].toUpperCase()}${place.slice(1)}` : 'Open floor'} · ${moving ? 'moving' : 'not moving'}`,
      color: grey,
    });
  } else {
    metrics.push({ label: 'Current task', value: '—', sub: 'Unknown until the first report', color: 'var(--off-text)' });
    metrics.push({ label: 'Uptime', value: '—', sub: `Registered ${hm(r.info.registeredAt)}`, color: 'var(--off-text)' });
    metrics.push({ label: 'Position', value: '—', sub: 'Unknown until the first report', color: 'var(--off-text)' });
  }

  const ctx = Object.values(others).filter((o): o is ReportedRobot => o.info.siteKey === r.info.siteKey && o.id !== r.id && o.report !== null);
  const segs = trail.slice(-25);
  const trailColor = off ? 'var(--off)' : st === 'low' ? 'var(--amb)' : st === 'error' ? 'var(--err)' : 'var(--ink)';
  const events = allEvents ? h.events : h.events.slice(0, 7);
  const lc = r.info.lastCharge;
  const facts: [string, string][] = [
    ['Model', r.info.modelFull],
    ['Site', siteName(r.info.siteKey)],
    ['Firmware', r.info.firmware],
    ['Last charge', lc ? `${hm(lc[0])} → ${hm(lc[1])}` : '—'],
    ['Network', r.info.network],
  ];
  if (rep?.skew !== undefined) facts.push(['Robot clock', skewText(rep.skew)]);

  return (
    <>
      <TopBar />
      <main className={`wrap ${css.main} ${stale ? css.stale : ''}`}>
        <section aria-label="Summary" className={`${css.summary} ${css.rise}`}>
          <BackLink />
          <div className={css.meta}>
            <StatusPill status={st} size="lg" />
            <span className={css.metaText}>
              {r.info.model} · {siteName(r.info.siteKey)} · Last seen{' '}
              <span style={st === 'offline' ? { color: 'var(--ink)', fontWeight: 600 } : stale ? { color: 'var(--amb-text)', fontWeight: 600 } : undefined}>
                {rep ? ago(now - rep.t) : 'never'}
              </span>
            </span>
          </div>
          <h1 className={`headline ${css.h1}`}>{headA} <span className="ctx">{headB}</span></h1>
        </section>

        <div className={css.grid}>
          <section className={`tile ${css.batt} ${css.wide} ${css.rise}`} aria-label="Battery" style={{ animationDelay: '60ms' }}>
            <span className="k">{st === 'offline' ? 'Battery · last known' : 'Battery'}</span>
            <span className={css.big} style={{ color: battColor }}>
              {rep ? rep.battery : '—'}{rep && <span className={css.bigPct}>%</span>}
            </span>
            <span className={css.bar} aria-hidden="true">
              <span className={css.barFill} style={{ width: `${rep?.battery ?? 0}%`, background: st === 'low' ? 'var(--amb)' : off ? 'var(--off)' : 'var(--ink)' }} />
              <span className={css.barMark} style={{ left: `${LOW_BATTERY}%` }} />
            </span>
            <span className={css.scale} aria-hidden="true"><span>0</span><span style={{ left: '20%', transform: 'translateX(-50%)' }}>20</span><span style={{ right: 0 }}>100</span></span>
            <span className={css.sub}>{batterySub(r, rate)}</span>
          </section>

          <section className={`tile ${css.trend} ${css.wide} ${css.rise}`} aria-label="Battery trend" style={{ animationDelay: '120ms' }}>
            <div className={css.tileHead}>
              <span className="k">Battery, last 15 minutes</span>
              <span className={css.note}>{trendNote}</span>
            </div>
            {h.state === 'loading' ? (
              <div className={`shimmer ${css.chartSkel}`} />
            ) : h.state === 'error' ? (
              <p className={css.chartMsg}>The battery history could not be loaded. It will load again when the connection is back.</p>
            ) : (
              <BatteryChart points={h.battery} now={now} status={st} lastReport={rep?.t ?? null} />
            )}
          </section>

          {metrics.map((m, i) => (
            <section key={m.label} className={`tile ${css.metric} ${css.m} ${css.rise}`} aria-label={m.label} style={{ animationDelay: `${180 + i * 30}ms` }}>
              <span className="k">{m.label}</span>
              <span className={css.mValue} style={{ color: m.color }}>{m.value}</span>
              <span className={css.sub}>{m.sub}</span>
            </section>
          ))}

          <section className={`tile ${css.pos} ${css.wide} ${css.rise}`} aria-label="Position" style={{ animationDelay: '240ms' }}>
            <div className={css.tileHead}>
              <span className="k">Position</span>
              <span className={css.note}>{rep ? (off ? `Trail before ${clock(rep.t)}` : 'Trail, last 4 min') : 'No position yet'}</span>
              <Link className="more" style={{ fontSize: 13, marginLeft: 14 }} to={`/floor-plan?site=${r.info.siteKey}&robot=${r.id}`}>Open floor plan <span aria-hidden="true">›</span></Link>
            </div>
            <SitePlan site={site} className={css.plan} emptyNote={rep ? undefined : 'Position unknown until the first report.'}>
              {ctx.map((o) => <span key={o.id} className={css.ctx} style={{ left: px(o.report.x), top: py(o.report.y) }} />)}
              <svg viewBox="0 0 64 28" preserveAspectRatio="none" aria-hidden="true" className={css.trail}>
                {segs.slice(1).map((p, i) => (
                  <line
                    key={p[0]}
                    x1={segs[i][1]} y1={segs[i][2]} x2={p[1]} y2={p[2]}
                    style={{ stroke: trailColor }}
                    strokeOpacity={0.06 + (0.84 * (i + 1)) / segs.length}
                    strokeWidth="3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {rep && (
                <div className={css.me} style={{ left: px(rep.x), top: py(rep.y) }}>
                  <span className={`${css.meDot} ${css[`me_${st}`]}`} />
                  <span className={css.meTag}>
                    {r.id}<span>{off ? ` · last known ${clock(rep.t)}` : ` · ${rep.battery}%`}</span>
                  </span>
                </div>
              )}
            </SitePlan>
            <span className={css.sub} style={{ marginTop: 12 }}>Grey dots are the other robots on this site.</span>
          </section>

          <section className={`tile ${css.log} ${css.wide} ${css.rise}`} aria-label="Activity" style={{ animationDelay: '300ms' }}>
            <div className={css.tileHead} style={{ padding: '0 12px 10px' }}>
              <span className="k">Activity today</span>
              <span className={css.note}>Newest first</span>
            </div>
            {h.state === 'loading' ? (
              <div className={`shimmer ${css.chartSkel}`} style={{ height: 300, margin: '0 12px' }} />
            ) : (
              <ol>
                {events.map((e) => {
                  const k = KIND_STYLE[e.kind];
                  return (
                    <li key={e.eventId} className={css.event}>
                      <span className={css.eIcon} style={{ background: k.tint, color: k.color }} aria-hidden="true"><EventIcon kind={e.kind} /></span>
                      <span className={css.eText}>
                        <span style={{ fontWeight: e.kind === 'info' ? 500 : 600, color: k.text }}>{e.text}</span>
                        {e.sub && <span className={css.eSub}>{e.sub}</span>}
                      </span>
                      <time className={css.eTime} dateTime={new Date(e.t).toISOString()}>{clock(e.t)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
            {h.events.length > 7 && (
              <button type="button" className={`more ${css.showAll}`} onClick={() => setAllEvents((v) => !v)}>
                {allEvents ? 'Show fewer' : `Show all ${h.events.length}`}
              </button>
            )}
          </section>

          <section className={`tile ${css.facts} ${css.rise}`} aria-label="Details" style={{ animationDelay: '360ms' }}>
            <span className="k">Details</span>
            <dl className={css.dl}>
              {facts.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </section>
        </div>
        <span className="sr-only" aria-live="polite">{`${r.id} status: ${st}`}</span>
      </main>
    </>
  );
}
