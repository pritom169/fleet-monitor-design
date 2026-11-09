import { freshnessClock, type Status } from '@fleet/shared/status';
import type { FleetState } from '../data/types';

export * from '@fleet/shared/status';

export function statusClock(s: Pick<FleetState, 'connection' | 'now' | 'lastMessageAt' | 'ingest'>): number {
  return freshnessClock(
    s.now,
    s.connection === 'live' ? null : s.lastMessageAt,
    s.ingest.state === 'paused' ? s.ingest.frozenAt : null,
  );
}

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
