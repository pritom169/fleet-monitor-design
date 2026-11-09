import type { Report, RobotEvent, RobotInfo } from '@fleet/shared/protocol';
import { applyHello, fleet, initialState } from '../data/store';
import type { FleetState, ReportedRobot } from '../data/types';

export const T = new Date(2027, 0, 15, 10, 30, 0).getTime();

export const info = (id: string, siteKey = 'hh', extra: Partial<RobotInfo> = {}): RobotInfo => ({
  id, siteKey, model: 'Tote picker', modelFull: 'Tote picker AMR-2', firmware: '4.12.1', network: 'AP 3', registeredAt: T - 3600_000, lastCharge: null, ...extra,
});

export const rep = (id: string, extra: Partial<Report> = {}): Report => ({
  id, t: T, battery: 80, x: 10, y: 6.1, state: 'ok', task: 'Pick order #4433', taskKind: 'picking', since: T - 6 * 3600_000, ...extra,
});

export const event = (id: string, t: number, text: string, extra: Partial<RobotEvent> = {}): RobotEvent => ({
  id, eventId: `${id}|${t}|${text}`, t, kind: 'info', code: 'other', text, ...extra,
});

export function reported(s: FleetState, id: string): ReportedRobot {
  const r = s.robots[id];
  if (r.report === null) throw new Error(`${id} has never reported`);
  return r;
}

export function fleetState(o: { robots?: RobotInfo[]; reports?: Report[]; now?: number } = {}): FleetState {
  const robots = o.robots ?? [info('R-001'), info('R-002'), info('R-003'), info('R-004'), info('R-005'), info('R-010', 'le'), info('R-020', 'mu')];
  const reports = o.reports ?? [
    rep('R-001'),
    rep('R-002', { battery: 14, task: 'Returning to dock', taskKind: 'returning_to_dock', x: 44, y: 9.2 }),
    rep('R-003', { state: 'error', fault: 'Motor overcurrent', x: 17.3, y: 12.4 }),
    rep('R-004', { t: T - 184_000, battery: 63, x: 50, y: 5 }),
    rep('R-010', { task: 'Charging', taskKind: 'charging', x: 45, y: 20 }),
    rep('R-020', { t: T - 60_000, x: 10, y: 21.5 }),
  ];
  const s = applyHello(initialState(T), { serverTime: T, robots, reports }, T);
  return { ...s, now: o.now ?? T };
}

export const load = (s: FleetState = fleetState()) => fleet.set(s);
