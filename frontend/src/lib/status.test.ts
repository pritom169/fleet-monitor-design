import { describe, expect, it } from 'vitest';
import type { Report, RobotInfo } from '@fleet/shared/protocol';
import { applyHeartbeat, applyHello, applyIngest, applyLost, applyReports, applyTick, initialState } from '../data/store';
import { deriveStatus } from './status';
import { ago, skewText, span } from './time';

const T = 1_800_000_000_000;
const rep = (t: number, battery: number, state: 'ok' | 'error' = 'ok'): Report => ({ id: 'R-001', t, battery, x: 0, y: 0, state, task: 'Idle', taskKind: 'idle', since: 0 });
const info: RobotInfo = { id: 'R-001', model: 'm', modelFull: 'm', siteKey: 'hh', firmware: '', network: '', registeredAt: 0, lastCharge: null };

describe('deriveStatus', () => {
  it('follows the status model', () => {
    expect(deriveStatus(null, T)).toBe('never');
    expect(deriveStatus(rep(T, 50), T)).toBe('ok');
    expect(deriveStatus(rep(T, 20), T)).toBe('ok');
    expect(deriveStatus(rep(T, 19), T)).toBe('low');
    expect(deriveStatus(rep(T, 50, 'error'), T)).toBe('error');
    expect(deriveStatus(rep(T, 9, 'error'), T)).toBe('error');
    expect(deriveStatus(rep(T - 10_001, 9, 'error'), T)).toBe('offline');
  });
});

describe('connection lost', () => {
  it('never marks robots offline because our own connection dropped', () => {
    let s = applyHello(initialState(T), { serverTime: T, robots: [info], reports: [rep(T, 80)] }, T);
    s = applyLost(s);
    expect(s.connection).toBe('lost');
    s = applyTick(s, T + 60_000);
    expect(s.robots['R-001'].status).toBe('ok');
    expect(s.now - s.robots['R-001'].report!.t).toBe(60_000);
  });
});

describe('time', () => {
  it('formats relative time', () => {
    expect(ago(0)).toBe('1 s ago');
    expect(ago(34_000)).toBe('34 s ago');
    expect(ago(184_000)).toBe('3 min 4 s ago');
    expect(span(2 * 3600_000 + 5 * 60_000)).toBe('2 h 5 min');
  });

  it('describes robot clock skew', () => {
    expect(skewText(120)).toBe('In sync with the server');
    expect(skewText(1430)).toBe('1.4 s behind the server');
    expect(skewText(-2500)).toBe('2.5 s ahead of the server');
    expect(skewText(95_000)).toBe('95 s behind the server');
  });
});

describe('battery hysteresis', () => {
  it('enters low below 20 % and leaves it only at 22 % or more', () => {
    let s = applyHello(initialState(T), { serverTime: T, robots: [info], reports: [rep(T, 20)] }, T);
    expect(s.robots['R-001'].status).toBe('ok');
    const seq = [19, 20, 21, 20, 21, 22, 21];
    const want = ['low', 'low', 'low', 'low', 'low', 'ok', 'ok'];
    seq.forEach((b, i) => {
      s = applyReports(s, [rep(T + (i + 1) * 1000, b)]);
      expect(s.robots['R-001'].status).toBe(want[i]);
    });
  });
});

describe('ingest paused', () => {
  it('freezes freshness at the last robot message the server received', () => {
    let s = applyHello(initialState(T), { serverTime: T, robots: [info], reports: [rep(T, 80)] }, T);
    s = applyIngest(s, { state: 'paused', frozenAt: T + 2000 });
    s = applyHeartbeat(s, T + 60_000);
    s = applyTick(s, T + 60_000);
    expect(s.connection).toBe('live');
    expect(s.robots['R-001'].status).toBe('ok');
    expect(s.now - s.robots['R-001'].report!.t).toBe(60_000);
    s = applyIngest(s, { state: 'live', frozenAt: null });
    expect(s.robots['R-001'].status).toBe('offline');
  });

  it('starts paused when hello says so', () => {
    const s = applyHello(initialState(T), { serverTime: T + 30_000, robots: [info], reports: [rep(T, 80)], ingest: { state: 'paused', frozenAt: T } }, T + 30_000);
    expect(s.robots['R-001'].status).toBe('ok');
  });
});
