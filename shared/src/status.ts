import type { Report } from './protocol';

export type Status = 'ok' | 'low' | 'error' | 'offline' | 'never';
export type ReportedStatus = Exclude<Status, 'never'>;

export const OFFLINE_AFTER_MS = 10_000;
export const LOW_BATTERY = 20;
export const LOW_BATTERY_EXIT = 22;

export const SEVERITY: Record<Status, number> = { offline: 0, error: 1, low: 2, never: 3, ok: 4 };
export const STATUS_LABEL: Record<Status, string> = {
  ok: 'OK',
  low: 'Low Battery',
  error: 'Error',
  offline: 'Offline',
  never: 'Never reported',
};
export const PROBLEMS: Status[] = ['offline', 'error', 'low'];
export const isProblem = (s: Status) => s === 'offline' || s === 'error' || s === 'low';

export function nextLow(battery: number, wasLow: boolean): boolean {
  return wasLow ? battery < LOW_BATTERY_EXIT : battery < LOW_BATTERY;
}

export function deriveStatus(report: Report | null, at: number, low = report ? report.battery < LOW_BATTERY : false): Status {
  return report ? reportedStatus(report, at, low) : 'never';
}

export function reportedStatus(report: Report, at: number, low = report.battery < LOW_BATTERY): ReportedStatus {
  if (at - report.t > OFFLINE_AFTER_MS) return 'offline';
  if (report.state === 'error') return 'error';
  if (low) return 'low';
  return 'ok';
}

export function freshnessClock(now: number, ...frozenAt: (number | null | undefined)[]): number {
  let at = now;
  for (const f of frozenAt) if (f != null && f < at) at = f;
  return at;
}
