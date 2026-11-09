import { describe, expect, it } from 'vitest';
import type { RobotInfo } from '@fleet/shared/protocol';
import type { Telemetry } from '@fleet/shared/telemetry';
import { FleetDomain, SETTLE_MS, STALL_MS, transitionEvent, type RobotState } from './fleet';
import { SeqWindow, WINDOW } from './seqWindow';

const T = 1_800_000_000_000;
const info = (id: string, siteKey = 'hh'): RobotInfo => ({ id, model: 'm', modelFull: 'm', siteKey, firmware: '', network: '', registeredAt: 0, lastCharge: null });
const tel = (seq: number, extra: Partial<Telemetry> = {}): Telemetry => ({
  id: 'R-001', siteId: 'hh', boot: 1, seq, robotTs: T, battery: 80, x: 1, y: 2, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0, ...extra,
});

/** A domain whose broker link is up and past the settle window. */
function liveDomain(ids = ['R-001']) {
  const d = new FleetDomain(ids.map((id) => info(id)));
  d.setLink(true, T - SETTLE_MS);
  d.poll(T);
  return d;
}

describe('SeqWindow', () => {
  it('accepts increasing seq, drops duplicates, flags reordered samples', () => {
    const w = new SeqWindow();
    expect(w.check(1, 0)).toBe('newest');
    expect(w.check(1, 1)).toBe('newest');
    expect(w.check(1, 3)).toBe('newest');
    expect(w.check(1, 3)).toBe('duplicate');
    expect(w.check(1, 2)).toBe('older'); // late, not seen before: history only
    expect(w.check(1, 2)).toBe('duplicate');
    expect(w.check(1, 1)).toBe('duplicate');
  });

  it('resets on a greater boot and treats a smaller boot as older', () => {
    const w = new SeqWindow();
    w.check(5, 900);
    expect(w.check(6, 0)).toBe('newest');
    expect(w.check(6, 0)).toBe('duplicate');
    expect(w.check(5, 901)).toBe('older');
  });

  it('forgets bits that slide out of the window', () => {
    const w = new SeqWindow();
    w.check(1, 10);
    w.check(1, 10 + WINDOW); // same slot modulo WINDOW, so the slot must be cleared and reused
    expect(w.check(1, 10 + WINDOW)).toBe('duplicate');
    expect(w.check(1, 10)).toBe('older'); // too far behind to tell
    w.check(1, 10 + WINDOW + 2);
    expect(w.check(1, 10 + WINDOW + 1)).toBe('older'); // the gap was cleared, not left from an old lap
  });

  it('restores from stored (boot, seq) after a restart', () => {
    const w = SeqWindow.from(3, 40);
    expect(w.check(3, 40)).toBe('duplicate');
    expect(w.check(3, 39)).toBe('older');
    expect(w.check(3, 41)).toBe('newest');
  });
});

describe('FleetDomain.accept', () => {
  it('updates current state only from the newest sample', () => {
    const d = liveDomain();
    expect(d.accept(tel(1, { battery: 80 }), T).result).toBe('accepted');
    expect(d.accept(tel(3, { battery: 78 }), T + 1000).result).toBe('accepted');
    const late = d.accept(tel(2, { battery: 79 }), T + 1100);
    expect(late.result).toBe('out_of_order');
    expect(late.row?.battery).toBe(79); // still goes to history
    expect(late.report).toBeUndefined(); // never to the live view
    expect(d.robots.get('R-001')!.report!.battery).toBe(78);
    expect(d.accept(tel(3), T + 1200).result).toBe('duplicate');
  });

  it('stamps reports with server time, not the robot clock', () => {
    const d = liveDomain();
    const a = d.accept(tel(1, { robotTs: T - 3_600_000 }), T);
    expect(a.report!.t).toBe(T);
    expect(a.row!.robotTs).toBe(T - 3_600_000);
  });

  it('drops unknown robots and robots that publish for the wrong site', () => {
    const d = liveDomain();
    expect(d.accept(tel(1, { id: 'R-999' }), T).result).toBe('unknown');
    expect(d.accept(tel(1, { siteId: 'mu' }), T).result).toBe('unknown');
  });

  it('accepts a rebooted robot whose seq starts again at 0', () => {
    const d = liveDomain();
    d.accept(tel(500, { boot: 1 }), T);
    expect(d.accept(tel(0, { boot: 2, battery: 99 }), T + 1000).result).toBe('accepted');
    expect(d.robots.get('R-001')!.report!.battery).toBe(99);
  });
});

describe('status and events', () => {
  it('applies battery hysteresis: low below 20, ok again only at 22', () => {
    const d = liveDomain();
    const seq = [21, 19, 20, 21, 20, 21, 22, 21, 19];
    const want = ['ok', 'low', 'low', 'low', 'low', 'low', 'ok', 'ok', 'low'];
    const kinds: string[] = [];
    seq.forEach((b, i) => {
      const a = d.accept(tel(i, { battery: b }), T + i * 1000);
      kinds.push(...a.events.map((e) => e.kind));
      expect(d.robots.get('R-001')!.status).toBe(want[i]);
    });
    // First report, then exactly one low, one ok and one low: no flapping.
    expect(kinds).toEqual(['info', 'low', 'ok', 'low']);
  });

  it('marks a robot offline after more than 10 s of silence, once', () => {
    const d = liveDomain();
    d.accept(tel(1), T);
    expect(d.tick(T + 10_000)).toEqual([]);
    const ev = d.tick(T + 10_001);
    expect(ev.map((e) => e.text)).toEqual(['Went offline']);
    expect(d.tick(T + 20_000)).toEqual([]);
    const back = d.accept(tel(2), T + 21_000);
    expect(back.events.map((e) => e.text)).toEqual(['Back online']);
  });

  it('freezes freshness while the broker link is down: no false offline events', () => {
    const d = liveDomain(['R-001', 'R-002']);
    d.accept(tel(1), T);
    d.accept(tel(1, { id: 'R-002' }), T + 500);
    expect(d.setLink(false, T + 1000)).toBe(true); // browsers must be told
    expect(d.ingest()).toEqual({ state: 'paused', frozenAt: T + 500 });
    // Five minutes of broker outage.
    for (let t = T + 2000; t <= T + 300_000; t += 1000) expect(d.tick(t)).toEqual([]);
    expect(d.counts().offline).toBe(0);

    // The link comes back. During the settle window statuses stay frozen while robots report again.
    d.setLink(true, T + 300_000);
    expect(d.ingest().state).toBe('paused');
    d.accept(tel(2), T + 300_400); // R-001 reports; R-002 does not (it died during the outage)
    expect(d.tick(T + 301_000)).toEqual([]);
    expect(d.poll(T + 300_000 + SETTLE_MS)).toBe(true);
    expect(d.ingest().state).toBe('live');
    const ev = d.tick(T + 300_000 + SETTLE_MS);
    expect(ev.map((e) => `${e.id} ${e.text}`)).toEqual(['R-002 Went offline']);
  });

  it('starts frozen at the newest stored report after a restart', () => {
    const d = new FleetDomain([info('R-001')]);
    d.load([{ robotId: 'R-001', report: { id: 'R-001', t: T, battery: 21, x: 0, y: 0, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0 }, boot: 1, seq: 9, status: 'low' }]);
    expect(d.tick(T + 600_000)).toEqual([]); // broker not connected yet: nothing goes offline
    expect(d.robots.get('R-001')!.status).toBe('low'); // latch restored: 21 % is still low
    expect(d.accept(tel(9), T + 600_100).result).toBe('duplicate'); // ordering survives the restart
  });
});

describe('stall watchdog', () => {
  it('treats fleet-wide silence on an open link as our problem, not the robots', () => {
    const d = liveDomain(['R-001', 'R-002']);
    d.accept(tel(1), T);
    d.accept(tel(1, { id: 'R-002' }), T);
    // The process is suspended (laptop asleep) for an hour. On wake the ticker runs before MQTT notices.
    const wake = T + 3_600_000;
    expect(d.poll(wake)).toBe(true); // → paused
    expect(d.ingest()).toEqual({ state: 'paused', frozenAt: T });
    expect(d.tick(wake)).toEqual([]);
    expect(d.counts().offline).toBe(0);
    // R-001 reports again; R-002 does not. After the settle window only R-002 goes offline.
    d.accept(tel(2), wake + 500);
    expect(d.tick(wake + 1000)).toEqual([]);
    expect(d.poll(wake + 500 + SETTLE_MS)).toBe(true);
    expect(d.tick(wake + 500 + SETTLE_MS).map((e) => e.id)).toEqual(['R-002']);
  });

  it('still marks one silent robot offline while the others report', () => {
    const d = liveDomain(['R-001', 'R-002']);
    d.accept(tel(1), T);
    let ev: string[] = [];
    for (let i = 1; i <= 12; i++) {
      d.accept(tel(i, { id: 'R-002' }), T + i * 1000);
      d.poll(T + i * 1000);
      ev = ev.concat(d.tick(T + i * 1000).map((e) => `${e.id} ${e.text}`));
    }
    expect(d.ingest().state).toBe('live');
    expect(ev).toEqual(['R-001 Went offline']);
  });
});

describe('registry and skew', () => {
  it('adds, removes and updates robots from a re-read registry', () => {
    const d = liveDomain(['R-001', 'R-002']);
    d.accept(tel(1), T);
    const r = d.register([info('R-001'), { ...info('R-003'), firmware: '5.0' }]);
    expect(r).toEqual({ added: ['R-003'], removed: ['R-002'], changed: [] });
    expect(d.robots.get('R-003')!.status).toBe('never');
    expect(d.robots.get('R-001')!.report).not.toBeNull(); // existing state is kept
    expect(d.register([{ ...info('R-001'), firmware: '5.1' }, { ...info('R-003'), firmware: '5.0' }]).changed).toEqual(['R-001']);
  });

  it('smooths robot clock skew and puts it on the report', () => {
    const d = liveDomain();
    expect(d.accept(tel(1, { robotTs: T - 2000 }), T).report!.skew).toBe(2000); // robot 2 s behind
    const a = d.accept(tel(2, { robotTs: T + 1000 - 1000 }), T + 1000); // one 1 s sample barely moves it
    expect(a.report!.skew).toBe(1900);
  });
});

describe('link state edges', () => {
  it('stays paused when the settle window ends on a silent fleet, and goes live once data resumes', () => {
    const d = new FleetDomain([info('R-001')]);
    d.accept(tel(1), T);
    d.setLink(true, T + 10_000);
    expect(d.linkState).toBe('settling');
    expect(d.poll(T + 10_000 + SETTLE_MS)).toBe(false); // connected, but nothing for > STALL_MS
    expect(d.linkState).toBe('stalled');
    d.heard(T + 20_000);
    expect(d.linkState).toBe('settling');
    expect(d.poll(T + 20_000 + SETTLE_MS - 1)).toBe(false);
    d.heard(T + 20_000 + SETTLE_MS - 1);
    expect(d.poll(T + 20_000 + SETTLE_MS)).toBe(true);
    expect(d.linkState).toBe('up');
  });

  it('ignores repeated link changes, and freezes at "now" when no message was ever received', () => {
    const d = new FleetDomain([info('R-001')]);
    expect(d.setLink(false, T)).toBe(false); // already down
    d.setLink(true, T);
    expect(d.setLink(true, T + 1)).toBe(false); // already settling
    expect(d.setLink(false, T + 2)).toBe(false); // was not up yet: browsers already see "paused"
    d.setLink(true, T + 3);
    d.poll(T + 3 + SETTLE_MS);
    expect(d.linkState).toBe('up');
    expect(d.setLink(false, T + 10_000)).toBe(true);
    expect(d.ingest()).toEqual({ state: 'paused', frozenAt: T + 10_000 });
  });

  it('does not count an old message as newer evidence', () => {
    const d = liveDomain();
    d.heard(T + 1000);
    d.heard(T + 500);
    expect(d.poll(T + 1000 + STALL_MS)).toBe(false);
    expect(d.poll(T + 1001 + STALL_MS)).toBe(true);
  });
});

describe('restore, events and views', () => {
  const report = (battery: number, extra = {}) => ({ id: 'R-001', t: T, battery, x: 0, y: 0, state: 'ok' as const, task: 'Idle', taskKind: 'idle' as const, since: 0, ...extra });

  it('restores the low latch from the stored status, skips unknown robots, and keeps the newest time', () => {
    const d = new FleetDomain([info('R-001'), info('R-002')]);
    d.load([
      { robotId: 'R-001', report: report(21), boot: 1, seq: 1, status: 'ok' }, // ok at 21: not latched
      { robotId: 'R-002', report: { ...report(15), id: 'R-002', t: T - 5000, skew: 40 }, boot: 1, seq: 1, status: 'ok' },
      { robotId: 'R-404', report: report(50), boot: 1, seq: 1, status: 'ok' },
    ]);
    expect(d.robots.get('R-001')!.low).toBe(false);
    expect(d.robots.get('R-002')!.low).toBe(true);
    expect(d.robots.get('R-002')!.skew).toBe(40);
    expect(d.robots.has('R-404')).toBe(false);
    expect(d.ingest()).toEqual({ state: 'paused', frozenAt: T });
  });

  it('does not freeze freshness on load once the link is up', () => {
    const d = liveDomain();
    d.load([{ robotId: 'R-001', report: report(50), boot: 1, seq: 1, status: 'ok' }]);
    expect(d.ingest().state).toBe('live');
  });

  it('stamps robot events with server time and drops unknown robots', () => {
    const d = liveDomain();
    expect(d.robotEvent({ id: 'R-001', robotTs: 1, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak', sub: 'AP 3' }, T)).toEqual({ id: 'R-001', t: T, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak', sub: 'AP 3' });
    expect(d.robotEvent({ id: 'R-001', robotTs: 1, kind: 'info', code: 'task_completed', text: 'Task done' }, T)).toEqual({ id: 'R-001', t: T, kind: 'info', code: 'task_completed', text: 'Task done' });
    expect(d.robotEvent({ id: 'R-001', robotTs: 1, kind: 'info', code: 'bay_assigned', text: 'Charging bay 3 assigned', bay: 3 }, T)).toMatchObject({ code: 'bay_assigned', bay: 3 });
    expect(d.robotEvent({ id: 'R-404', robotTs: 1, kind: 'info', code: 'other', text: 'x' }, T)).toBeNull();
  });

  it('carries the task kind onto the report, separately from the display text', () => {
    const d = liveDomain();
    const a = d.accept(tel(1, { task: 'Laden', taskKind: 'charging' }), T);
    expect(a.report).toMatchObject({ task: 'Laden', taskKind: 'charging' });
  });

  it('puts the fault on the report, and logs "Fault cleared" when it goes away', () => {
    const d = liveDomain();
    d.accept(tel(1), T);
    const a = d.accept(tel(2, { state: 'error', fault: 'Motor overcurrent' }), T + 1000);
    expect(a.report!.fault).toBe('Motor overcurrent');
    expect(a.events).toEqual([]); // the robot sends its own fault event
    const b = d.accept(tel(3, { task: 'Pick order' }), T + 2000);
    expect(b.events).toEqual([{ id: 'R-001', t: T + 2000, kind: 'ok', code: 'fault_cleared', text: 'Fault cleared', sub: 'Pick order' }]);
  });

  it('returns no state row for a robot without a report or an unknown one, and counts by status', () => {
    const d = liveDomain(['R-001', 'R-002']);
    d.accept(tel(4), T);
    expect(d.stateRow('R-001')).toEqual({ robotId: 'R-001', report: d.robots.get('R-001')!.report, boot: 1, seq: 4, status: 'ok' });
    expect(d.stateRow('R-002')).toBeNull();
    expect(d.stateRow('R-404')).toBeNull();
    expect(d.counts()).toEqual({ ok: 1, low: 0, error: 0, offline: 0, never: 1 });
    expect(d.isKnown('R-001')).toBe(true);
    expect(d.isKnown('R-001', 'mu')).toBe(false);
    expect(d.snapshot().reports.map((r) => r.id)).toEqual(['R-001']);
  });

  it('transitionEvent covers every transition, and none for ok → error', () => {
    const r = { info: info('R-001'), report: null } as unknown as RobotState;
    expect(transitionEvent(r, 'never', 'ok', T)).toEqual({ id: 'R-001', t: T, kind: 'info', code: 'first_report', text: 'First report', sub: undefined });
    expect(transitionEvent(r, 'ok', 'error', T)).toBeNull();
    expect(transitionEvent(r, 'error', 'ok', T)!.sub).toBeUndefined();
    expect(transitionEvent(r, 'low', 'error', T)).toBeNull();
  });
});
