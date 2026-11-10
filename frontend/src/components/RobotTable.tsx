import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { actions } from '../data/store';
import type { Robot } from '../data/types';
import { siteName } from '../lib/fleet';
import { TINT, isProblem } from '../lib/status';
import { hm } from '../lib/time';
import { BatteryGlyph } from './BatteryGlyph';
import { Ago, useWithin } from './Clock';
import { ChargingIcon, SpinnerIcon } from './Icons';
import { StatusPill } from './StatusPill';
import css from './RobotTable.module.css';

const FLASH_MS = 2000;
const ACCENT: Record<string, string> = { low: 'var(--amb)', error: 'var(--err)', offline: 'var(--off)' };

interface RowProps {
  robot: Robot;
  now?: number;
  stale: boolean;
  hovered: boolean;
  scrollTo: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
}

export const RobotRow = memo(function RobotRow({ robot: r, now, stale, hovered, scrollTo, rowRef }: RowProps) {
  const navigate = useNavigate();
  const el = useRef<HTMLDivElement | null>(null);
  const rep = r.report;
  const st = r.status;
  const flashing = useWithin(r.changedAt, FLASH_MS, now);

  useEffect(() => {
    const row = el.current;
    const box = row?.closest<HTMLElement>('[data-scroll]');
    if (!scrollTo || !row || !box) return;
    const rowTop = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const top = rowTop - 40;
    const bottom = rowTop + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTo({ top, behavior: 'smooth' });
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: bottom - box.clientHeight + 8, behavior: 'smooth' });
  }, [scrollTo]);

  const battColor = st === 'low' ? 'var(--amb-text)' : st === 'offline' ? 'var(--off-text)' : undefined;
  const agoStyle: CSSProperties =
    st === 'offline' ? { color: 'var(--ink)', fontWeight: 600 } : stale ? { color: 'var(--amb-text)', fontWeight: 600 } : { color: 'var(--ink2)' };

  let task: React.ReactNode;
  if (!rep) task = <span style={{ color: 'var(--off-text)' }}>Registered {hm(r.info.registeredAt)} · waiting for first report</span>;
  else if (st === 'error') task = <span style={{ color: 'var(--err-text)', fontWeight: 600 }}>{rep.fault}</span>;
  else if (st === 'offline') task = <span style={{ color: 'var(--off-text)' }}>{rep.task}</span>;
  else task = <>{rep.taskKind === 'charging' && <ChargingIcon className={css.chg} />}{rep.task}</>;

  return (
    <div
      ref={(n) => { el.current = n; rowRef?.(n); }}
      role="row"
      className={[css.cols, css.row, isProblem(st) && css.accent, css[st], hovered && css.hl, stale && css.stale].filter(Boolean).join(' ')}
      style={{ '--acc': ACCENT[st] } as CSSProperties}
      onMouseEnter={() => actions.hover(r.id, 'table')}
      onMouseLeave={() => actions.hover(null)}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/robots/${r.id}`); }}
    >
      {flashing && <span key={`${r.id}-${st}-${r.changedAt}`} className={css.flash} style={{ '--fl': st === 'ok' ? 'var(--sel)' : TINT[st] } as CSSProperties} aria-hidden="true" />}
      <span role="cell" className={css.robot}>
        <Link to={`/robots/${r.id}`}>{r.id}</Link>
        <span className={`${css.sub} ${css.wide}`}>{r.info.model}</span>
        <span className={`${css.sub} ${css.narrow}`}>{siteName(r.info.siteKey)}</span>
      </span>
      <span role="cell" className={`${css.clip} ${css.site}`}>{siteName(r.info.siteKey)}</span>
      <span role="cell"><StatusPill status={st} /></span>
      <span role="cell" className={css.batt}>
        {rep ? (
          <>
            <BatteryGlyph value={rep.battery} status={st} />
            <span style={{ color: battColor, fontWeight: st === 'low' ? 600 : 400 }}>{rep.battery}%</span>
          </>
        ) : <span style={{ color: 'var(--off-text)' }}>—</span>}
      </span>
      <span role="cell" style={rep ? agoStyle : { color: 'var(--off-text)' }}>{rep ? <Ago t={rep.t} now={now} /> : 'Never'}</span>
      <span role="cell" className={css.clip} title={rep?.fault ?? rep?.task}>{task}</span>
      <span role="cell" className={`${css.pos} ${css.posCol}`}>{rep ? `${rep.x.toFixed(1)}, ${rep.y.toFixed(1)} m` : '—'}</span>
    </div>
  );
});

export function TableHeader() {
  return (
    <div role="row" className={`${css.cols} ${css.th}`}>
      <span role="columnheader">Robot</span>
      <span role="columnheader" className={css.site}>Site</span>
      <span role="columnheader">Status</span>
      <span role="columnheader">Battery</span>
      <span role="columnheader">Last seen</span>
      <span role="columnheader">Current task</span>
      <span role="columnheader" className={`${css.right} ${css.posCol}`}>Position</span>
    </div>
  );
}

function useFlip(ids: string[]) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const prev = useRef<{ key: string; set: string; tops: Map<string, number> }>({ key: '', set: '', tops: new Map() });
  const key = ids.join(',');
  const set = [...ids].sort().join(',');
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    refs.current.forEach((el, id) => tops.set(id, el.offsetTop));
    const p = prev.current;
    const reorderOnly = p.key && p.key !== key && p.set === set;
    if (reorderOnly && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tops.forEach((top, id) => {
        const was = p.tops.get(id);
        const el = refs.current.get(id);
        if (was !== undefined && was !== top && el) {
          el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.32,.72,0,1)' });
        }
      });
    }
    prev.current = { key, set, tops };
  }, [key, set]);
  const callbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  useLayoutEffect(() => {
    const keep = new Set(set.split(','));
    for (const id of callbacks.current.keys()) if (!keep.has(id)) callbacks.current.delete(id);
  }, [set]);
  return (id: string) => {
    let cb = callbacks.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) refs.current.set(id, el);
        else refs.current.delete(id);
      };
      callbacks.current.set(id, cb);
    }
    return cb;
  };
}

export function RobotTable({ robots, now, stale, hover, loading, connecting, empty }: {
  robots: Robot[];
  now?: number;
  stale: boolean;
  hover: { id: string; from: string } | null;
  loading?: boolean;
  connecting?: string;
  empty?: React.ReactNode;
}) {
  const ref = useFlip(robots.map((r) => r.id));
  return (
    <section className={`tile ${css.panel}`} aria-label="Robots">
      <div className={css.title}>
        <h2>Robots</h2>
      </div>
      <div className={css.scroll} data-scroll>
        <div role="table" aria-label="Robots, most urgent first" aria-busy={loading || undefined}>
          <TableHeader />
          {loading ? (
            <SkeletonRows note={connecting} />
          ) : robots.length ? (
            robots.map((r) => (
              <RobotRow
                key={r.id}
                robot={r}
                now={now}
                stale={stale}
                hovered={hover?.id === r.id}
                scrollTo={hover?.id === r.id && hover.from === 'map'}
                rowRef={ref(r.id)}
              />
            ))
          ) : (
            empty
          )}
        </div>
      </div>
    </section>
  );
}

export function SkeletonRows({ note, count = 11 }: { note?: string; count?: number }) {
  const widths = [70, 52, 80, 46, 64, 58, 74, 49, 67, 55, 72, 61];
  return (
    <div role="row">
      <div role="cell" className={css.note}><SpinnerIcon size={13} />{note ?? 'Connecting to fleet…'}</div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${css.skelRow} shimmer`} style={{ animationDelay: `${i * 60}ms` }} aria-hidden="true">
          <span className="skel" />
          <span className="skel" style={{ width: `${widths[i % widths.length]}%` }} />
          <span className="skel" style={{ height: 20, borderRadius: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function TableEmpty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div role="row">
      <div role="cell" className={css.empty}>
        <strong>{title}</strong>
        <p>{detail}</p>
        {action}
      </div>
    </div>
  );
}

export const clearButtonClass = css.clear;
