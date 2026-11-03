/**
 * The status model (SYSTEM_DESIGN.md §4). One module, used by the ingest server and the browser,
 * so server events and client pills follow the same rules.
 */
import type { Report } from './protocol';

export type Status = 'ok' | 'low' | 'error' | 'offline' | 'never';
/** Every status a robot can have once it has sent a report. */
export type ReportedStatus = Exclude<Status, 'never'>;

export const OFFLINE_AFTER_MS = 10_000;
/** A robot enters `low` below this value. The dashed line on the battery chart is drawn here. */
export const LOW_BATTERY = 20;
/** A robot leaves `low` at this value or more. Stops 1 Hz flapping around 20 %. */
export const LOW_BATTERY_EXIT = 22;

export const SEVERITY: Record<Status, number> = { offline: 0, error: 1, low: 2, never: 3, ok: 4 };
export const STATUS_LABEL: Record<Status, string> = {
  ok: 'OK',
  low: 'Low Battery',
  error: 'Error',
  offline: 'Offline',
  never: 'Never reported',
};
/** Statuses that make a robot "need attention". Never-reported is unknown but expected, so it does not. */
export const PROBLEMS: Status[] = ['offline', 'error', 'low'];
export const isProblem = (s: Status) => s === 'offline' || s === 'error' || s === 'low';

/** Battery band with hysteresis: enter below 20 %, leave at 22 % or more. */
export function nextLow(battery: number, wasLow: boolean): boolean {
  return wasLow ? battery < LOW_BATTERY_EXIT : battery < LOW_BATTERY;
}

/**
 * First match wins: never → offline → error → low → ok.
 * `at` is the time to judge freshness against (see `freshnessClock`).
 * `low` is the hysteresis latch the caller keeps with `nextLow`; without one, the plain 20 % rule applies.
 */
export function deriveStatus(report: Report | null, at: number, low = report ? report.battery < LOW_BATTERY : false): Status {
  return report ? reportedStatus(report, at, low) : 'never';
}

/** `deriveStatus` for a robot that has reported, typed so the result can never be `never`. */
export function reportedStatus(report: Report, at: number, low = report.battery < LOW_BATTERY): ReportedStatus {
  if (at - report.t > OFFLINE_AFTER_MS) return 'offline';
  if (report.state === 'error') return 'error';
  if (low) return 'low';
  return 'ok';
}

/**
 * The time we judge freshness against. While every link between the robots and the viewer is up,
 * it is `now`. When one of our own links is down, it is frozen at the last evidence we had, so a robot
 * is never marked offline because *we* lost the link. `frozenAt` values that are null are ignored.
 */
export function freshnessClock(now: number, ...frozenAt: (number | null | undefined)[]): number {
  let at = now;
  for (const f of frozenAt) if (f != null && f < at) at = f;
  return at;
}
