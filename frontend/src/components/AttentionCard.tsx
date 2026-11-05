import { Link, useNavigate } from 'react-router';
import { actions } from '../data/store';
import type { ReportedRobot } from '../data/types';
import { reason, siteName } from '../lib/fleet';
import { TONE } from '../lib/status';
import { StatusPill } from './StatusPill';
import css from './AttentionCard.module.css';

const RISE_MS = 4000;

/** One card per robot that needs you. Anatomy: capsule, ID, the reason, context, one action. */
export function AttentionCard({ robot: r, now, hovered, stale }: { robot: ReportedRobot; now: number; hovered: boolean; stale: boolean }) {
  const navigate = useNavigate();
  const rep = r.report;
  const site = siteName(r.info.siteKey);
  const meta =
    r.status === 'low' ? `${rep.task} · ${site}` : r.status === 'error' ? `Stopped · ${site}` : `Last task: ${rep.task} · ${site}`;
  const rise = r.changedAt !== null && now - r.changedAt < RISE_MS;
  return (
    <article
      className={[css.card, hovered && css.hl, rise && css.rise, stale && css.stale].filter(Boolean).join(' ')}
      onMouseEnter={() => actions.hover(r.id, 'card')}
      onMouseLeave={() => actions.hover(null)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a')) navigate(`/robots/${r.id}`);
      }}
    >
      <span><StatusPill status={r.status} solid /></span>
      <h2 className={css.id}>{r.id}</h2>
      <span className={css.reason} style={{ color: r.status === 'offline' ? 'var(--ink)' : TONE[r.status] }}>{reason(r, now)}</span>
      <span className={css.meta}>{meta}</span>
      <Link className="more" to={`/robots/${r.id}`} aria-label={`View details for ${r.id}`}>
        View details <span aria-hidden="true">›</span>
      </Link>
    </article>
  );
}

const MAX_CARDS = 8;

export function AttentionCards({ robots, now, hoveredId, stale }: { robots: ReportedRobot[]; now: number; hoveredId: string | null; stale: boolean }) {
  if (!robots.length) return null;
  const shown = robots.length > MAX_CARDS ? robots.slice(0, MAX_CARDS - 1) : robots;
  const rest = robots.length - shown.length;
  return (
    <section className={css.grid} aria-label="Robots that need attention">
      {shown.map((r) => <AttentionCard key={r.id} robot={r} now={now} hovered={hoveredId === r.id} stale={stale} />)}
      {rest > 0 && (
        <div className={`${css.card} ${css.moreCard}`}>
          <span className={css.moreN}>+{rest} more</span>
          <span className={css.meta}>They are at the top of the table, most urgent first.</span>
        </div>
      )}
    </section>
  );
}
