import type { ReactNode } from 'react';
import { FLOOR_H, FLOOR_W, type Site } from '@fleet/shared/sites';
import { ChargingIcon } from './Icons';
import css from './SitePlan.module.css';

export const px = (x: number) => `${((x / FLOOR_W) * 100).toFixed(3)}%`;
export const py = (y: number) => `${((y / FLOOR_H) * 100).toFixed(3)}%`;
const box = (r: [number, number, number, number]) => ({ left: px(r[0]), top: py(r[1]), width: px(r[2]), height: py(r[3]) });

/** Grey top-down outline of a site. Markers go in `children`, positioned with px()/py(). */
export function SitePlan({
  site, variant = 'normal', detail, emptyNote, children, className, style,
}: {
  site: Site;
  variant?: 'normal' | 'stage' | 'mini';
  /** Charging bays and aisle labels, for the big floor plan. */
  detail?: boolean;
  emptyNote?: string;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const c = site.charge;
  const bw = (c[2] - 2) / 4;
  return (
    <div className={[css.plan, variant !== 'normal' && css[variant], className].filter(Boolean).join(' ')} style={style}>
      {site.zones.map((z) => (
        <div key={z[4]} className={css.zone} style={box([z[0], z[1], z[2], z[3]])}>
          {variant !== 'mini' && <span className={css.zlabel}>{z[4]}</span>}
        </div>
      ))}
      {detail && [0, 1, 2, 3].map((i) => (
        <div key={i} className={css.bay} aria-hidden="true" style={box([c[0] + 1 + i * bw + 0.3, c[1] + c[3] - 3.6, bw - 0.6, 2.6])}>
          <ChargingIcon size={11} stroke={1.5} />
        </div>
      ))}
      {site.racks.map((k, i) => <div key={i} className={css.rack} style={box(k)} />)}
      {detail && site.aisles.map((a, i) => {
        const horiz = a[1] === a[3];
        return (
          <span key={i} className={css.alabel} aria-hidden="true" style={{ left: px(horiz ? a[0] - 1.5 : a[0]), top: py(horiz ? a[1] : a[1] - 1.3) }}>
            {site.prefix}{i + 1}
          </span>
        );
      })}
      {children}
      {emptyNote && <span className={css.empty}>{emptyNote}</span>}
    </div>
  );
}
