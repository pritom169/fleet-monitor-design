import { useId } from 'react';
import type { Status } from '../data/types';
import { LOW_BATTERY } from '../lib/status';
import { clock, hm } from '../lib/time';
import css from './BatteryChart.module.css';

const W = 600;
const H = 200;
const WINDOW = 15 * 60_000;
const BREAK_MS = 20_000;

function scale(max: number) {
  if (max <= 32) return { yMax: 40, rules: [0, 10, 30, 40] };
  if (max <= 52) return { yMax: 60, rules: [0, 40, 60] };
  return { yMax: 100, rules: [0, 50, 75, 100] };
}

export function BatteryChart({ points, now, status, lastReport }: {
  points: [number, number][];
  now: number;
  status: Status;
  lastReport: number | null;
}) {
  const uid = useId().replace(/:/g, '');
  const from = now - WINDOW;
  const pts = points.filter((p) => p[0] >= from);
  const { yMax, rules } = scale(Math.max(LOW_BATTERY, ...pts.map((p) => p[1])));
  const X = (t: number) => ((t - from) / WINDOW) * W;
  const Y = (v: number) => H * (1 - v / yMax);
  const pct = (v: number) => `${(100 * (1 - v / yMax)).toFixed(2)}%`;

  const segs: [number, number][][] = [];
  for (const p of pts) {
    const cur = segs[segs.length - 1];
    if (!cur || p[0] - cur[cur.length - 1][0] > BREAK_MS) segs.push([p]);
    else cur.push(p);
  }
  const poly = (s: [number, number][]) => s.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const thrY = Y(LOW_BATTERY);
  const unknown = status === 'offline' || status === 'never';
  const gapFrom = unknown ? (lastReport ? Math.max(0, X(lastReport)) : 0) : null;
  const end = pts[pts.length - 1];
  const ticks = [-15, -12, -9, -6, -3, 0].map((m) => ({ m, t: now + m * 60_000 }));

  const label = pts.length
    ? `Battery over the last 15 minutes, from ${pts[0][1]}% to ${end[1]}%${unknown ? `, no data since ${lastReport ? clock(lastReport) : 'start'}` : ''}.`
    : 'No battery data in the last 15 minutes.';

  return (
    <div className={css.chart}>
      {rules.map((v) => (
        <div key={v}>
          <div className={css.rule} style={{ top: pct(v) }} />
          <span className={css.yl} style={{ top: pct(v) }}>{v}</span>
        </div>
      ))}
      {gapFrom !== null && (
        <>
          <div className={css.gap} style={{ left: `${(gapFrom / W) * 100}%` }} />
          <span className={css.gapNote} style={{ left: `${Math.min((gapFrom / W) * 100, 62)}%` }}>
            {lastReport ? `No data since ${clock(lastReport)}` : 'No reports yet'}
          </span>
        </>
      )}
      <div className={css.thr} style={{ top: pct(LOW_BATTERY) }} />
      <span className={`${css.yl} ${css.thrV}`} style={{ top: pct(LOW_BATTERY) }}>20</span>
      <span className={css.thrLabel} style={{ top: pct(LOW_BATTERY) }}>Low-battery threshold</span>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={css.svg}>
        <defs>
          <clipPath id={`${uid}a`}><rect x="0" y="-10" width={W} height={thrY + 10} /></clipPath>
          <clipPath id={`${uid}b`}><rect x="0" y={thrY} width={W} height={H - thrY + 10} /></clipPath>
        </defs>
        {segs.map((s, i) => (
          <g key={i}>
            <polyline points={poly(s)} className={css.line} style={{ stroke: unknown ? 'var(--off)' : 'var(--ink)' }} clipPath={`url(#${uid}a)`} />
            <polyline points={poly(s)} className={`${css.line} ${css.lowLine}`} style={{ stroke: unknown ? 'var(--off)' : 'var(--amb)' }} clipPath={`url(#${uid}b)`} />
          </g>
        ))}
      </svg>
      {end && (
        <div
          className={`${css.end} ${unknown ? css.endOff : end[1] < LOW_BATTERY ? css.endLow : ''}`}
          style={{ left: `${(X(end[0]) / W) * 100}%`, top: pct(end[1]) }}
        />
      )}
      {ticks.map(({ m, t }, i) => (
        <span key={m} className={css.xl} style={{ left: `${((m + 15) / 15) * 100}%`, transform: `translateX(${i === 0 ? '0' : i === ticks.length - 1 ? '-100%' : '-50%'})` }}>
          {m === 0 ? 'Now' : hm(t)}
        </span>
      ))}
    </div>
  );
}
