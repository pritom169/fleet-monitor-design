import { describe, expect, it } from 'vitest';
import type { Report, RobotInfo } from '@fleet/shared/protocol';
import { applyHello, applyReports, applyTick, initialState } from '../data/store';
import { sortRobots } from './sort';

const T = 1_800_000_000_000;
const info = (id: string): RobotInfo => ({ id, model: 'Tote picker', modelFull: 'Tote picker AMR-2', siteKey: 'hh', firmware: '4.12.1', network: 'AP', registeredAt: 0, lastCharge: null });
const rep = (id: string, t: number, battery: number, extra: Partial<Report> = {}): Report => ({ id, t, battery, x: 10, y: 5, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0, ...extra });

function boot() {
  const ids = ['R-001', 'R-002', 'R-003', 'R-004', 'R-005', 'R-006'];
  return applyHello(initialState(T), {
    serverTime: T,
    robots: ids.map(info),
    reports: [
      rep('R-001', T, 80),
      rep('R-002', T, 15), // low
      rep('R-003', T - 30_000, 60), // offline
      rep('R-004', T, 70, { state: 'error', fault: 'Motor overcurrent' }),
      rep('R-005', T, 55),
      // R-006 never reported
    ],
  }, T);
}
const order = (s: ReturnType<typeof boot>) => sortRobots(s.ids.map((id) => s.robots[id])).map((r) => r.id);

describe('sort by severity', () => {
  it('puts offline, error, low, never, ok in that order, then by ID', () => {
    expect(order(boot())).toEqual(['R-003', 'R-004', 'R-002', 'R-006', 'R-001', 'R-005']);
  });

  it('does not move any row when battery or position changes but status does not', () => {
    let s = boot();
    const before = order(s);
    for (let i = 1; i <= 30; i++) {
      s = applyReports(s, [
        rep('R-001', T + i * 1000, 80 - i, { x: 10 + i, y: 5 + i / 2 }), // 80 → 50, still OK
        rep('R-005', T + i * 1000, 55 + i / 3, { x: 20 - i }), // rising, still OK
        rep('R-002', T + i * 1000, 15 - (i % 3)), // still low
        rep('R-004', T + i * 1000, 70, { state: 'error', fault: 'Motor overcurrent' }),
      ]);
      expect(order(s)).toEqual(before);
    }
  });

  it('moves a row only when its status changes', () => {
    let s = boot();
    s = applyReports(s, [rep('R-005', T + 1000, 19)]); // OK → low
    expect(order(s)).toEqual(['R-003', 'R-004', 'R-002', 'R-005', 'R-006', 'R-001']);
  });
});

describe('status changes', () => {
  it('stamps changedAt when a status changes, not on the first snapshot', () => {
    let s = boot();
    expect(Object.values(s.robots).every((r) => r.changedAt === null)).toBe(true);
    s = applyReports(s, [rep('R-005', T + 1000, 19)]);
    expect(s.robots['R-005'].status).toBe('low');
    expect(s.robots['R-005'].changedAt).toBe(s.now);
    expect(s.robots['R-001'].changedAt).toBeNull();
  });

  it('keeps object identity for robots whose status did not change on a tick', () => {
    const s = boot();
    const next = applyTick(s, T + 1000);
    expect(next.robots['R-001']).toBe(s.robots['R-001']);
  });

  it('marks a robot offline after 10 s without a report', () => {
    let s = boot();
    s = applyTick(s, T + 10_000);
    expect(s.robots['R-001'].status).toBe('ok');
    s = applyTick(s, T + 10_001);
    expect(s.robots['R-001'].status).toBe('offline');
  });
});
