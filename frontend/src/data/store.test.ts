import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { event, fleetState, info, load, rep, T } from '../test/fixtures';
import { actions, applyEvent, applyHeartbeat, applyHello, applyLost, applyReports, fleet, initialState, shallow, useFleet } from './store';

describe('reducers', () => {
  it('stays "connecting" when the first connection fails', () => {
    expect(applyLost(initialState(T)).connection).toBe('connecting');
  });

  it('ignores an empty batch and reports for unknown robots, and keeps ghosts only on movement', () => {
    const s = fleetState();
    expect(applyReports(s, [])).toBe(s);
    const a = applyReports(s, [rep('R-999'), rep('R-001', { t: T + 1000, battery: 79 })]);
    expect(a.robots['R-999']).toBeUndefined();
    expect(a.robots['R-001'].ghosts).toBe(s.robots['R-001'].ghosts); // same position
    let b = a;
    for (let i = 1; i <= 8; i++) b = applyReports(b, [rep('R-001', { t: T + 1000 + i, x: 10 + i })]);
    expect(b.robots['R-001'].ghosts.length).toBe(6);
    expect(b.robots['R-001'].ghosts.at(-1)).toEqual([18, 6.1]);
    expect(applyReports(s, [rep('R-005', { t: T - 5 })]).lastMessageAt).toBe(T); // an older report does not move the clock back
  });

  it('keeps the previous status, latch and trail across a reconnect hello, so changes are highlighted', () => {
    const s = fleetState();
    const again = applyHello(s, { serverTime: T + 5000, robots: [info('R-001'), info('R-002'), info('R-006')], reports: [rep('R-001', { t: T + 5000, x: 30 }), rep('R-002', { t: T + 5000, battery: 21 })] }, T + 5000);
    expect(again.ids).toEqual(['R-001', 'R-002', 'R-006']);
    expect(again.robots['R-001'].ghosts).toEqual([[10, 6.1], [30, 6.1]]);
    expect(again.robots['R-002'].status).toBe('low'); // 21 % is still low with the latch
    expect(again.robots['R-006'].status).toBe('never');
    expect(again.robots['R-006'].ghosts).toEqual([]);
  });

  it('marks a change seen in a reconnect hello', () => {
    const s = fleetState();
    const again = applyHello(s, { serverTime: T + 5000, robots: [info('R-001')], reports: [rep('R-001', { t: T + 5000, state: 'error', fault: 'Bump' })] }, T + 5000);
    expect(again.robots['R-001'].status).toBe('error');
    expect(again.robots['R-001'].changedAt).toBe(T + 5000);
  });

  it('only moves the heartbeat clock forward, and keeps the newest 300 events', () => {
    const s = fleetState();
    expect(applyHeartbeat(s, T - 1)).toBe(s);
    expect(applyHeartbeat(s, T + 1).lastMessageAt).toBe(T + 1);
    let e = s;
    for (let i = 0; i < 305; i++) e = applyEvent(e, event('R-001', i, `e${i}`));
    expect(e.liveEvents.length).toBe(300);
    expect(e.liveEvents[0].text).toBe('e304');
  });
});

describe('store and actions', () => {
  it('notifies subscribers on change only, and unsubscribes', () => {
    const l = vi.fn();
    const off = fleet.subscribe(l);
    const s = fleet.get();
    fleet.set(s);
    expect(l).not.toHaveBeenCalled();
    actions.retrying(1, T);
    expect(l).toHaveBeenCalledTimes(1);
    off();
    actions.lost();
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('drives the state through every action', () => {
    vi.useFakeTimers({ now: T });
    actions.hello({ serverTime: T + 2000, robots: [info('R-001')], reports: [rep('R-001', { t: T + 2000 })] });
    expect(fleet.get().offset).toBe(2000);
    actions.reports([rep('R-001', { t: T + 3000, battery: 70 })]);
    actions.event(event('R-001', T, 'hi'));
    actions.ingest({ state: 'paused', frozenAt: T });
    actions.heartbeat(T + 9000);
    vi.setSystemTime(T + 1000);
    actions.tick();
    actions.retrying(2, T + 5000);
    const s = fleet.get();
    expect(s).toMatchObject({ now: T + 3000, attempt: 2, nextRetryAt: T + 5000, lastMessageAt: T + 9000, ingest: { state: 'paused' } });
    expect(s.robots['R-001'].report!.battery).toBe(70);
    expect(s.liveEvents.length).toBe(1);
    vi.useRealTimers();
  });

  it('changes hover only when the target or its source changes', () => {
    const l = vi.fn();
    const off = fleet.subscribe(l);
    actions.hover(null);
    actions.hover('R-001');
    actions.hover('R-001', 'table');
    actions.hover('R-001', 'map');
    actions.hover(null);
    actions.hover(null);
    off();
    expect(l).toHaveBeenCalledTimes(3);
    expect(fleet.get().hover).toBeNull();
  });
});

describe('useFleet', () => {
  it('re-renders only when the selected slice changes, by the given equality', () => {
    load(fleetState());
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useFleet((s) => s.ids.map((id) => s.robots[id].status), shallow);
    });
    const first = result.current;
    expect(first.length).toBe(7);
    act(() => actions.heartbeat(T + 1)); // ids and statuses unchanged: same array kept
    expect(result.current).toBe(first);
    act(() => actions.reports([rep('R-001', { t: T + 2, battery: 10 })]));
    expect(result.current).not.toBe(first);
    expect(result.current[0]).toBe('low');
    expect(renders).toBeGreaterThan(1);
  });

  it('compares arrays shallowly', () => {
    expect(shallow([1, 2], [1, 2])).toBe(true);
    expect(shallow([1, 2], [1, 3])).toBe(false);
    expect(shallow([1], [1, 2])).toBe(false);
  });
});
