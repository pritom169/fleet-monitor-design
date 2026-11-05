import { Link } from 'react-router';
import { SITE_BY_KEY } from '@fleet/shared/sites';
import { actions } from '../data/store';
import type { Robot } from '../data/types';
import { isProblem } from '../lib/status';
import { MapMarker } from './MapMarker';
import { SitePlan } from './SitePlan';
import css from './FleetMap.module.css';

export function MapLegend({ className }: { className?: string }) {
  return (
    <span className={className ?? css.legend} aria-hidden="true">
      <span><span className={css.sw} style={{ width: 7, height: 7, background: 'var(--dotok)' }} />OK</span>
      <span><span className={css.sw} style={{ background: 'var(--amb)' }} />Low</span>
      <span><span className={css.sw} style={{ background: 'var(--err)' }} />Error</span>
      <span><span className={css.sw} style={{ border: '1.5px dashed var(--off)' }} />Offline</span>
    </span>
  );
}

const enter = (id: string) => actions.hover(id, 'map');
const leave = () => actions.hover(null);

/** Overview map: one small plan per site. Problems stand up as pins; healthy robots stay flat. */
export function FleetMap({ siteKeys, robots, visible, now, hoveredId, loading }: {
  siteKeys: string[];
  robots: Robot[];
  /** IDs that match the current filter; others are dimmed, not hidden, so the floor stays readable. */
  visible: Set<string>;
  /** Pins the clock (tests). The app omits it, so a tick does not re-render 1,000 markers. */
  now?: number;
  hoveredId: string | null;
  loading?: boolean;
}) {
  return (
    <section className={`tile ${css.panel}`} aria-label="Floor plans">
      <div className={css.head}>
        <h2>Floor plan</h2>
        <Link className="more" to={siteKeys.length === 1 ? `/floor-plan?site=${siteKeys[0]}` : '/floor-plan'}>Open <span aria-hidden="true">›</span></Link>
        <MapLegend />
      </div>
      <div className={css.body}>
        {siteKeys.map((key) => {
          const site = SITE_BY_KEY[key];
          const here = robots.filter((r) => r.info.siteKey === key);
          const att = here.filter((r) => isProblem(r.status)).length;
          return (
            <figure key={key} className={css.fig}>
              <figcaption className={css.cap}>
                <Link to={`/floor-plan?site=${key}`}>{site.name}</Link>
                <span className={css.meta}>{loading ? '—' : `${here.length} robots`}</span>
                {!loading && here.length > 0 && (
                  <span className={css.att} style={{ color: att ? 'var(--ink)' : 'var(--ink2)' }}>{att ? `${att} need${att === 1 ? 's' : ''} attention` : 'All OK'}</span>
                )}
              </figcaption>
              <SitePlan site={site} emptyNote={!loading && here.length === 0 ? 'No robots on this floor yet.' : undefined} className={loading ? 'shimmer' : undefined}>
                {here.map((r) => (
                  <MapMarker
                    key={r.id}
                    robot={r}
                    now={now}
                    highlighted={hoveredId === r.id}
                    dimmed={visible.has(r.id) ? 1 : 0.2}
                    popover
                    onEnter={enter}
                    onLeave={leave}
                  />
                ))}
              </SitePlan>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
