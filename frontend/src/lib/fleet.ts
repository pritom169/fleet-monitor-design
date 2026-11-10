import { SITE_BY_KEY, SITES } from '@fleet/shared/sites';
import type { Ingest, ReportedRobot, Robot, Status } from '../data/types';
import { STATUS_LABEL, isProblem } from './status';
import { ago, clock } from './time';

export type Filter = 'all' | Status;
export type Counts = Record<Filter, number>;

export function countBy(rs: Robot[]): Counts {
  const n: Counts = { all: rs.length, ok: 0, low: 0, error: 0, offline: 0, never: 0 };
  for (const r of rs) n[r.status]++;
  return n;
}

export const attention = (n: Counts) => n.low + n.error + n.offline;

export const siteName = (key: string) => SITE_BY_KEY[key]?.name ?? key;

export function matches(r: Robot, q: string): boolean {
  if (!q) return true;
  const s = q.trim().toLowerCase();
  const hay = [r.id, r.info.model, r.report?.task, r.report?.fault, siteName(r.info.siteKey)].join(' ').toLowerCase();
  return hay.includes(s) || r.id.toLowerCase().replace('-', '').includes(s.replace('-', ''));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function overviewHeadline(o: {
  ready: boolean; connection: string; ingest?: Ingest; attempt: number; lastMessageAt: number | null;
  site: string; n: Counts; sitesWithRobots: number;
}): [string, string] {
  const { n } = o;
  if (!o.ready) {
    return ['Connecting to your fleet.', o.attempt > 0 ? 'The fleet server is not answering yet.' : 'Waiting for the first report.'];
  }
  const where = o.site === 'all' ? `across ${plural(o.sitesWithRobots, 'site', 'sites')}` : `at ${siteName(o.site)}`;
  if (n.all === 0) return [`No robots at ${siteName(o.site)} yet.`, 'A robot appears here after its first report.'];
  const att = attention(n);
  if (o.connection === 'lost') {
    return ['Live updates paused.', `Showing the fleet as of ${o.lastMessageAt ? clock(o.lastMessageAt) : '—'}. ${plural(att, 'robot', 'robots')} needed attention then.`];
  }
  if (o.ingest?.state === 'paused') {
    const at = o.ingest.frozenAt;
    return ['Robot data paused.', `Showing the fleet as of ${at ? clock(at) : '—'}. ${plural(att, 'robot', 'robots')} needed attention then.`];
  }
  if (att === 0) return ['All robots are running normally.', `${plural(n.all, 'robot', 'robots')} ${where}.`];
  return [`${plural(att, 'robot needs', 'robots need')} your attention.`, `${n.ok} of ${n.all} are running normally ${where}.`];
}

export function reason(r: Robot, now: number): string {
  switch (r.status) {
    case 'low': return `${r.report.battery}% battery`;
    case 'error': return r.report.fault ?? 'Error';
    case 'offline': return `Last seen ${ago(now - r.report.t)}`;
    case 'never': return 'Waiting for first report';
    default: return r.report.task;
  }
}

export function aria(r: Robot, now: number): string {
  return `${r.id}, ${STATUS_LABEL[r.status]}, ${r.status === 'offline' ? reason(r, now) : r.report?.fault ?? r.report?.task ?? ''}`;
}

export const needsAttention = (r: Robot): r is ReportedRobot => isProblem(r.status);

export const sitesWithRobots = (rs: Robot[]) => new Set(rs.map((r) => r.info.siteKey)).size;
export const SITE_KEYS = SITES.map((s) => s.key);
export { isProblem };
