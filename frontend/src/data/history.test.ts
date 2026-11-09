import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RobotHistory } from '@fleet/shared/protocol';
import { event, fleetState, load, rep, T } from '../test/fixtures';
import { batteryRate, lastCrossing, useRobotHistory } from './history';
import { actions } from './store';

const body = (o: Partial<RobotHistory> = {}): RobotHistory => ({
  id: 'R-001', battery: [[T - 60_000, 81], [T, 80]], trail: [[T - 2000, 9, 6.1], [T, 10, 6.1]], events: [event('R-001', T - 5000, 'First report')], ...o,
});
const ok = (b: RobotHistory) => ({ ok: true, status: 200, json: async () => b });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRobotHistory', () => {
  it('waits for a live connection, then loads, and refreshes every 10 s', async () => {
    vi.useFakeTimers({ now: T, shouldAdvanceTime: true });
    const fetch = vi.fn(async () => ok(body()));
    vi.stubGlobal('fetch', fetch);
    load({ ...fleetState(), connection: 'lost' });
    const { result } = renderHook(() => useRobotHistory('R-001'));
    expect(result.current.state).toBe('loading');
    expect(fetch).not.toHaveBeenCalled();
    act(() => load(fleetState()));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(fetch).toHaveBeenCalledWith('/api/robots/R-001/history');
    expect(result.current.battery).toEqual(body().battery);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats a response that fails the schema as an error, not as data', async () => {
    const legacy = { ...body(), events: [{ id: 'R-001', t: T, kind: 'info', text: 'First report' }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => legacy })));
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.events).toEqual([]);
  });

  it('shows an error only if nothing was loaded yet', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetch);
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('keeps loaded data when a refresh fails, and ignores answers after unmount', async () => {
    vi.useFakeTimers({ now: T, shouldAdvanceTime: true });
    let fail = false;
    const fetch = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return ok(body());
    });
    vi.stubGlobal('fetch', fetch);
    load();
    const { result, unmount } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    fail = true;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current.state).toBe('ready');
    fail = false;
    let resolve: (v: ReturnType<typeof ok>) => void = () => {};
    fetch.mockImplementationOnce(() => new Promise<ReturnType<typeof ok>>((r) => (resolve = r)));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    unmount();
    resolve(ok(body({ battery: [] })));
    fail = true;
    const late = renderHook(() => useRobotHistory('R-001'));
    late.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10));
  });

  it('extends the trail from live reports every 2 s, keeping 4 minutes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(body({ trail: [[T - 300_000, 1, 1], [T, 10, 6.1]] }))));
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => actions.reports([rep('R-001', { t: T + 1000, x: 11 })]));
    expect(result.current.trail.length).toBe(2);
    act(() => actions.reports([rep('R-001', { t: T + 2000, x: 12 })]));
    expect(result.current.trail).toEqual([[T, 10, 6.1], [T + 2000, 12, 6.1]]);
  });

  it('starts a trail from live reports when history had none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(body({ trail: [] }))));
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => actions.reports([rep('R-001', { t: T + 1000, x: 11 })]));
    expect(result.current.trail).toEqual([[T + 1000, 11, 6.1]]);
  });

  it('merges live events for this robot, newest first, without duplicates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(body())));
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => {
      actions.event(event('R-001', T - 5000, 'First report'));
      actions.event(event('R-002', T, 'Other robot'));
      actions.event(event('R-001', T + 1000, 'Battery below 20%', { kind: 'low' }));
    });
    expect(result.current.events.map((e) => e.text)).toEqual(['Battery below 20%', 'First report']);
  });

  it('dedupes on eventId, not on time and text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(body())));
    load();
    const { result } = renderHook(() => useRobotHistory('R-001'));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => {
      actions.event(event('R-001', T - 5000, 'First report', { eventId: 'another-event' }));
      actions.event({ ...event('R-001', T - 5000, 'First report'), text: 'Reported for the first time' });
    });
    expect(result.current.events.map((e) => e.eventId)).toEqual(['another-event', `R-001|${T - 5000}|First report`]);
  });
});

describe('battery maths', () => {
  it('gives the rate over the last minutes, or null without enough data', () => {
    expect(batteryRate([])).toBeNull();
    expect(batteryRate([[0, 50], [30_000, 49]])).toBeNull();
    expect(batteryRate([[0, 60], [60_000, 58], [120_000, 56]])).toBe(-2);
    expect(batteryRate([[0, 10], [600_000, 20], [660_000, 22]], 1)).toBeCloseTo(2);
    expect(batteryRate([[0, 10], [400_000, 50]], 1)).toBeNull();
  });

  it('finds the last crossing below the threshold', () => {
    expect(lastCrossing([[0, 25], [1, 19], [2, 23], [3, 18]])).toBe(3);
    expect(lastCrossing([[0, 19], [1, 18]])).toBeNull();
    expect(lastCrossing([])).toBeNull();
  });
});
