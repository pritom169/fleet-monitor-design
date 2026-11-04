/**
 * Client view of the status model. The rules live in @fleet/shared/status, the same module the ingest
 * server uses. This file adds what only the client needs: the store-shaped clock and colours.
 */
import { freshnessClock, type Status } from '@fleet/shared/status';
import type { FleetState } from '../data/types';

export * from '@fleet/shared/status';

/**
 * The time we judge freshness against. While our own connection is down we freeze it at the last
 * message we received. While the server has lost the robots (ingest paused) we freeze it at the last
 * robot message the server received. Either way, a robot is never marked offline because *we* lost a link.
 */
export function statusClock(s: Pick<FleetState, 'connection' | 'now' | 'lastMessageAt' | 'ingest'>): number {
  return freshnessClock(
    s.now,
    s.connection === 'live' ? null : s.lastMessageAt,
    s.ingest.state === 'paused' ? s.ingest.frozenAt : null,
  );
}

/** Values on screen may be outdated: our link is down, or the server's link to the robots is. */
export const isStale = (s: Pick<FleetState, 'connection' | 'ingest'>) => s.connection === 'lost' || s.ingest.state === 'paused';

export const TONE: Record<Status, string> = {
  ok: 'var(--ink)',
  low: 'var(--amb-text)',
  error: 'var(--err-text)',
  offline: 'var(--off-text)',
  never: 'var(--off-text)',
};
export const TINT: Record<Status, string> = {
  ok: 'var(--fill)',
  low: 'var(--amb-tint)',
  error: 'var(--err-tint)',
  offline: 'var(--off-tint)',
  never: 'var(--off-tint)',
};
