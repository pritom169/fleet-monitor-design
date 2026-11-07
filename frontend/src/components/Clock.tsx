/**
 * Leaves that read the one app clock themselves (SYSTEM_DESIGN.md §7, render cost).
 *
 * The 1 Hz tick changes `now`. If `now` were a prop of every row and map marker, each tick would re-render
 * 1,000 rows and 1,000 markers at the production target. These leaves subscribe to the clock on their own,
 * and re-render only when their own output changes: a tick updates a few text nodes, not whole rows.
 *
 * Pass `now` to pin the time (the component sheet, tests): the leaf then ignores the store clock.
 */
import { useFleet } from '../data/store';
import { ago } from '../lib/time';

/** "3 s ago" for a server time `t`. */
export function Ago({ t, now }: { t: number; now?: number }) {
  return <>{useFleet((s) => ago((now ?? s.now) - t))}</>;
}

/** True while less than `ms` has passed since `since`. Re-renders only when the answer flips. */
export function useWithin(since: number | null, ms: number, now?: number): boolean {
  return useFleet((s) => since !== null && (now ?? s.now) - since < ms);
}
