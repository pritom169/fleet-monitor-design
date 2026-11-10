import { describe, expect, it } from 'vitest';
import { ConnStatus, RobotEventMsg, Telemetry, parseTopic, topic } from './telemetry';
import { PROBLEMS, deriveStatus, freshnessClock, isProblem, nextLow } from './status';
import { Report, RobotEvent, isRobotEventCode } from './protocol';

describe('topics', () => {
  it('builds and parses fleet/{site}/{robot}/{kind}', () => {
    expect(topic('hh', 'R-001', 'telemetry')).toBe('fleet/hh/R-001/telemetry');
    expect(parseTopic('fleet/hh/R-001/event')).toEqual({ siteId: 'hh', robotId: 'R-001', kind: 'event' });
    expect(parseTopic('fleet/hh/R-001/cmd')).toBeNull();
    expect(parseTopic('fleet/hh/R-001/status/extra')).toBeNull();
  });
});

describe('payload schemas', () => {
  it('accepts a valid sample and rejects out-of-range values', () => {
    const ok = { id: 'R-1', siteId: 'hh', boot: 0, seq: 0, robotTs: 1, battery: 100, x: 0, y: 0, state: 'ok', task: 'Idle', since: 0 };
    expect(Telemetry.safeParse(ok).success).toBe(true);
    expect(Telemetry.safeParse({ ...ok, seq: -1 }).success).toBe(false);
    expect(Telemetry.safeParse({ ...ok, state: 'offline' }).success).toBe(false);
    expect(RobotEventMsg.safeParse({ id: 'R-1', robotTs: 1, kind: 'info', text: '' }).success).toBe(false);
    expect(ConnStatus.safeParse('online').success).toBe(true);
  });

  it('reads a missing or unknown task kind and event code as other, so the message is still accepted', () => {
    const ok = { id: 'R-1', siteId: 'hh', boot: 0, seq: 0, robotTs: 1, battery: 100, x: 0, y: 0, state: 'ok', task: 'Charging', since: 0 };
    expect(Telemetry.parse({ ...ok, taskKind: 'charging' }).taskKind).toBe('charging');
    expect(Telemetry.parse(ok).taskKind).toBe('other');
    expect(Telemetry.parse({ ...ok, taskKind: 'teleporting' }).taskKind).toBe('other');
    const ev = { id: 'R-1', robotTs: 1, kind: 'info', text: 'Charging bay 3 assigned' };
    expect(RobotEventMsg.parse({ ...ev, code: 'bay_assigned', bay: 3 })).toMatchObject({ code: 'bay_assigned', bay: 3 });
    expect(RobotEventMsg.parse(ev).code).toBe('other');
    expect(RobotEventMsg.parse({ ...ev, code: 'went_offline' }).code).toBe('other');
  });
});

describe('browser protocol', () => {
  it('defaults task kind and event code, and requires an event ID', () => {
    const rep = { id: 'R-1', t: 0, battery: 50, x: 0, y: 0, state: 'ok', task: 'Idle', since: 0 };
    expect(Report.parse(rep).taskKind).toBe('other');
    const e = { id: 'R-1', eventId: 'e1', t: 0, kind: 'info', text: 'x' };
    expect(RobotEvent.parse(e).code).toBe('other');
    expect(RobotEvent.safeParse({ ...e, eventId: undefined }).success).toBe(false);
  });

  it('splits event codes by who may send them', () => {
    expect(isRobotEventCode('bay_assigned')).toBe(true);
    expect(isRobotEventCode('other')).toBe(true);
    expect(isRobotEventCode('battery_low')).toBe(false);
  });
});

describe('status helpers', () => {
  it('names the problem statuses', () => {
    expect(PROBLEMS.every(isProblem)).toBe(true);
    expect(isProblem('ok')).toBe(false);
    expect(isProblem('never')).toBe(false);
  });

  it('latches low with hysteresis and derives status without a latch', () => {
    expect(nextLow(21, true)).toBe(true);
    expect(nextLow(21, false)).toBe(false);
    const rep = { id: 'R', t: 0, battery: 10, x: 0, y: 0, state: 'ok' as const, task: '', taskKind: 'idle' as const, since: 0 };
    expect(deriveStatus(rep, 0)).toBe('low');
    expect(deriveStatus(rep, 0, false)).toBe('ok');
  });

  it('freezes the clock at the earliest frozen time, ignoring nulls', () => {
    expect(freshnessClock(100)).toBe(100);
    expect(freshnessClock(100, null, undefined, 150)).toBe(100);
    expect(freshnessClock(100, 80, 90)).toBe(80);
  });
});
