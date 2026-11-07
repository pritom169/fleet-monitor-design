import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { retryNow } from '../data/socket';
import { useFleet } from '../data/store';
import type { Connection } from '../data/types';
import { ago, clock, span } from '../lib/time';
import { useTheme } from '../lib/theme';
import { Logo, MoonIcon, SpinnerIcon, SunIcon } from './Icons';
import css from './TopBar.module.css';

/** The frosted bar. Pages put their own controls (site picker, search) in `children`. */
export function TopBar({ children }: { children?: ReactNode }) {
  const [theme, toggle] = useTheme();
  return (
    <header className={css.bar}>
      <div className={`wrap ${css.row}`}>
        <Link to="/" className={css.brand} aria-label="Fleet Monitor, overview">
          <Logo />
          <span>Fleet Monitor</span>
        </Link>
        <nav className={css.sections} aria-label="Sections">
          <NavLink to="/" end className={css.tab}>Overview</NavLink>
          <NavLink to="/floor-plan" className={css.tab}>Floor Plan</NavLink>
        </nav>
        <div className={css.slot}>{children}</div>
        <ConnectionIndicator />
        <button
          type="button"
          className={css.theme}
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      <ConnectionBanner />
    </header>
  );
}

export function ConnectionIndicator() {
  const connection = useFleet((s) => s.connection);
  const paused = useFleet((s) => s.ingest.state === 'paused');
  const now = useFleet((s) => s.now);
  return <ConnectionIndicatorView connection={connection} paused={paused} now={now} />;
}

export function ConnectionIndicatorView({ connection, paused, now }: { connection: Connection; paused?: boolean; now: number }) {
  if (connection === 'live' && paused) {
    return (
      <span className={`${css.conn} ${css.lost}`} role="status">
        <SpinnerIcon /> Robot data paused
      </span>
    );
  }
  if (connection === 'live') {
    return (
      <span className={css.conn} role="status">
        <span className="live-dot" aria-hidden="true" />
        Live <span className={css.time} aria-hidden="true">{clock(now)}</span>
      </span>
    );
  }
  if (connection === 'lost') {
    return (
      <span className={`${css.conn} ${css.lost}`} role="status">
        <SpinnerIcon /> Reconnecting…
      </span>
    );
  }
  return (
    <span className={`${css.conn} ${css.connecting}`} role="status">
      <SpinnerIcon /> Connecting…
    </span>
  );
}

/** Non-blocking. The page underneath stays usable; values stay visible but are marked stale. */
export function ConnectionBanner() {
  const connection = useFleet((s) => s.connection);
  const attempt = useFleet((s) => s.attempt);
  const now = useFleet((s) => s.now);
  const offset = useFleet((s) => s.offset);
  const nextRetryAt = useFleet((s) => s.nextRetryAt);
  const last = useFleet((s) => s.lastMessageAt);
  const ingest = useFleet((s) => s.ingest);
  if (connection === 'live' && ingest.state === 'paused') return <IngestBannerView now={now} frozenAt={ingest.frozenAt} />;
  if (connection === 'live' || (connection === 'connecting' && attempt === 0)) return null;
  const inMs = nextRetryAt ? nextRetryAt - (now - offset) : 0;
  return <BannerView connection={connection} attempt={attempt} now={now} last={last} retryInMs={inMs} onRetry={retryNow} />;
}

export function BannerView({ connection, attempt, now, last, retryInMs, onRetry, inline }: {
  connection: Connection; attempt: number; now: number; last: number | null; retryInMs: number; onRetry: () => void; inline?: boolean;
}) {
  const next = retryInMs > 500 ? `next try in ${span(retryInMs)}` : 'trying now';
  return (
    <div className={`${css.banner} ${inline ? css.inline : ''}`}>
      <div className={`${inline ? '' : 'wrap'} ${css.bannerRow}`}>
        {connection === 'lost' ? (
          <>
            <span className={css.bannerMain} role="status">Live updates paused. Reconnecting… Data shown may be outdated.</span>
            {last && <span className={css.bannerMeta}>Last update {clock(last)} · {ago(now - last)}</span>}
          </>
        ) : (
          <span className={css.bannerMain} role="status">Cannot reach the fleet server.</span>
        )}
        <span className={css.bannerMeta}>Attempt {attempt} · {next}</span>
        <button type="button" className="more" onClick={onRetry}>Retry now <span aria-hidden="true">›</span></button>
      </div>
    </div>
  );
}

/**
 * Our link to the server is fine, but the server lost its link to the robots (the MQTT broker).
 * Same banner, same rules: statuses frozen, "last seen" keeps counting. Nothing to retry from here.
 */
export function IngestBannerView({ now, frozenAt, inline }: { now: number; frozenAt: number | null; inline?: boolean }) {
  return (
    <div className={`${css.banner} ${inline ? css.inline : ''}`}>
      <div className={`${inline ? '' : 'wrap'} ${css.bannerRow}`}>
        <span className={css.bannerMain} role="status">Robot data paused. The fleet server lost its link to the robots. Statuses are frozen.</span>
        {frozenAt && <span className={css.bannerMeta}>Last robot data {clock(frozenAt)} · {ago(now - frozenAt)}</span>}
      </div>
    </div>
  );
}
