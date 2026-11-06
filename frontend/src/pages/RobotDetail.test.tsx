import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RobotHistory, TaskKind } from '@fleet/shared/protocol';
import { actions, fleet, initialState } from '../data/store';
import { event, fleetState, info, load, rep, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { RobotDetail } from './RobotDetail';

const headline = () => screen.getByRole('heading', { level: 1 }).textContent;
/** The first region with this name. Two are called "Position": the metric tile, then the map. */
const tile = (name: string) => within(screen.getAllByRole('region', { name })[0]);
const MIN = 60_000;

/** Battery samples every 30 s over the last `minutes`, moving linearly from `from` to `to`. */
const battery = (from: number, to: number, minutes = 10): [number, number][] =>
  Array.from({ length: minutes * 2 + 1 }, (_, i) => [T - minutes * MIN + i * 30_000, Math.round((from + ((to - from) * i) / (minutes * 2)) * 10) / 10]);

function stubHistory(h: Partial<RobotHistory> | 'pending' | 'error') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (h === 'pending') return new Promise(() => {});
    if (h === 'error') return { ok: false, status: 503, json: async () => ({}) };
    const id = decodeURIComponent(url.split('/')[3]);
    return { ok: true, status: 200, json: async () => ({ id, battery: [], trail: [], events: [], ...h }) };
  }));
}

async function show(id: string, h: Partial<RobotHistory> | 'pending' | 'error' = {}, s = fleetState()) {
  stubHistory(h);
  load(s);
  const r = renderAt(<RobotDetail />, `/robots/${id}`, '/robots/:id');
  if (h !== 'pending' && h !== 'error') await waitFor(() => expect(document.querySelector('[class*=chartSkel]')).toBeNull());
  return r;
}

afterEach(() => vi.unstubAllGlobals());

describe('RobotDetail', () => {
  it('waits for the fleet, and says when a robot does not exist', async () => {
    fleet.set(initialState(T));
    const { unmount } = renderAt(<RobotDetail />, '/robots/R-001', '/robots/:id');
    expect(headline()).toBe('R-001. Connecting to your fleet…');
    unmount();
    await show('R-999');
    expect(headline()).toBe('There is no robot called R-999. Check the ID, or find it in the fleet list.');
  });

  it('describes a healthy robot: steady battery, place, uptime, clock skew and last charge', async () => {
    const s = fleetState({ robots: [info('R-001', 'hh', { lastCharge: [T - 3 * 3600_000, T - 2 * 3600_000] }), info('R-002')], reports: [rep('R-001', { skew: 1430 }), rep('R-002')] });
    await show('R-001', { battery: battery(80, 80), trail: [[T - 4000, 10, 6.1], [T - 2000, 10.02, 6.1]] }, s); // 2 cm: not moving
    expect(headline()).toBe('R-001 is running normally. Pick order #4433. Battery 80%.');
    expect(tile('Battery').getByText('Steady over the last 5 minutes.')).toBeTruthy();
    expect(tile('Battery trend').getByText('Lowest 80% · highest 80%')).toBeTruthy();
    expect(tile('Current task').getByText('Aisle A1')).toBeTruthy();
    expect(tile('Uptime').getByText('6 h 0 min')).toBeTruthy();
    expect(tile('Uptime').getByText('Online since 04:30')).toBeTruthy();
    expect(tile('Position').getByText('Aisle A1 · not moving')).toBeTruthy();
    expect(tile('Details').getByText('1.4 s behind the server')).toBeTruthy();
    expect(tile('Details').getByText('07:30 → 08:30')).toBeTruthy();
    expect(screen.getByText('Trail, last 4 min')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^Battery over the last 15 minutes/);
  });

  it('shows a rising battery, a moving robot and the open floor', async () => {
    const s = fleetState({ reports: [rep('R-001', { x: 30, y: 2 }), rep('R-002')] });
    await show('R-001', { battery: battery(60, 70), trail: [[T - 2000, 25, 2], [T, 30, 2]] }, s);
    expect(tile('Battery').getByText('Charging, 1.0% per minute. Full in about 20 min.')).toBeTruthy();
    expect(tile('Position').getByText('Open floor · moving')).toBeTruthy();
    expect(tile('Current task').getByText('On the floor')).toBeTruthy();
  });

  it('shows a falling battery with time left, and "not enough data" without history', async () => {
    const { unmount } = await show('R-001', { battery: battery(90, 80) });
    expect(tile('Battery').getByText('Falling 1.0% per minute. About 80 minutes left at this rate.')).toBeTruthy();
    unmount();
    await show('R-001', {});
    expect(tile('Battery').getByText('Not enough data for a trend yet.')).toBeTruthy();
    expect(tile('Battery trend').queryByText(/Lowest/)).toBeNull();
  });

  it('explains a low robot: trend, plan, when it crossed 20 %, and which bay it is heading to', async () => {
    const h = { battery: [...battery(25, 14)], events: [event('R-002', T - 2 * MIN, 'Charging bay 3 assigned', { code: 'bay_assigned', bay: 3, sub: 'Charging zone' })] };
    await show('R-002', h);
    expect(headline()).toBe('R-002 is low on battery. 14% left and falling. It is on its way to charge.');
    expect(tile('Battery trend').getByText(/^Below 20% since 10:2\d:\d\d$/)).toBeTruthy();
    expect(tile('Current task').getByText('Charging bay 3 · charging zone')).toBeTruthy();
  });

  it('knows whether a low robot is charging, waiting, or has not been sent', async () => {
    // The display text is deliberately unhelpful: the plan must come from `taskKind`, never from the words.
    const low = (taskKind: TaskKind) => fleetState({ robots: [info('R-002')], reports: [rep('R-002', { battery: 15, task: 'Task text', taskKind })] });
    const cases: [TaskKind, Partial<RobotHistory>, string][] = [
      ['charging', { battery: battery(12, 15) }, 'R-002 is low on battery. 15% left and rising. It is charging.'],
      ['waiting_for_dock', { battery: battery(15, 15) }, 'R-002 is low on battery. 15% left. It is waiting for a free dock.'],
      ['picking', {}, 'R-002 is low on battery. 15% left. It has not been sent to charge.'],
      ['returning_to_dock', {}, 'R-002 is low on battery. 15% left. It is on its way to charge.'],
    ];
    for (const [taskKind, h, want] of cases) {
      const { unmount } = await show('R-002', h, low(taskKind));
      expect(headline()).toBe(want);
      unmount();
    }
    await show('R-002', { battery: battery(15, 15) }, low('returning_to_dock'));
    expect(tile('Battery trend').getByText('Below 20% for the whole window')).toBeTruthy();
    expect(tile('Current task').getByText('Heading to Charging')).toBeTruthy();
  });

  it('shows an error robot as stopped, with its fault', async () => {
    const s = fleetState({ reports: [rep('R-003', { state: 'error', fault: 'Motor overcurrent', x: 20, y: 6.1 })] });
    await show('R-003', {}, s);
    expect(headline()).toBe('R-003 has stopped. Motor overcurrent. It needs someone on the floor.');
    expect(tile('Current task').getByText('Stopped')).toBeTruthy();
    expect(tile('Current task').getByText('Motor overcurrent. Stopped in aisle A1')).toBeTruthy();
    const off = fleetState({ reports: [rep('R-003', { state: 'error', fault: 'Bump', x: 30, y: 2 })] });
    act(() => load(off));
    expect(tile('Current task').getByText('Bump. Stopped')).toBeTruthy(); // no aisle there
  });

  it('treats an offline robot as unknown: last known values, grey, no invented data', async () => {
    await show('R-004', { battery: battery(70, 63, 5).map(([t, b]) => [t - 4 * MIN, b] as [number, number]) });
    expect(headline()).toBe('R-004 is offline. No report for 3 min 4 s. We do not know its state.');
    expect(tile('Battery').getByText('Battery · last known')).toBeTruthy();
    expect(tile('Battery').getByText('Last known value, reported at 10:26:56. The real level is unknown.')).toBeTruthy();
    expect(tile('Battery trend').getAllByText('No data since 10:26:56').length).toBe(2); // the note, and the chart's gap label
    expect(tile('Current task').getByText('Last known. Current state unknown.')).toBeTruthy();
    expect(tile('Uptime').getByText('Until the last report at 10:26:56')).toBeTruthy();
    expect(tile('Position').getByText('Last known · Charging zone')).toBeTruthy();
    expect(screen.getByText('Trail before 10:26:56')).toBeTruthy();
    expect(screen.getByText(/· last known 10:26:56/)).toBeTruthy();
  });

  it('says only "Last known" when an offline robot was not in a named place', async () => {
    await show('R-004', {}, fleetState({ reports: [rep('R-004', { t: T - 60_000, x: 30, y: 2 })] }));
    expect(tile('Position').getByText('Last known')).toBeTruthy();
  });

  it('shows a robot that never reported', async () => {
    await show('R-005', {});
    expect(headline()).toMatch(/^R-005 has never reported\. Registered at 09:30\./);
    expect(tile('Battery').getByText('No report yet.')).toBeTruthy();
    expect(tile('Battery trend').getByText('No data yet')).toBeTruthy();
    expect(tile('Uptime').getByText('Registered 09:30')).toBeTruthy();
    expect(screen.getByText('No position yet')).toBeTruthy();
    expect(screen.getByText('Position unknown until the first report.')).toBeTruthy();
    expect(screen.getByText('No reports yet')).toBeTruthy();
  });

  it('shows the loading and error states of the history', async () => {
    const { unmount, container } = await show('R-001', 'pending');
    expect(container.querySelectorAll('[class*=chartSkel]').length).toBe(2);
    unmount();
    await show('R-001', 'error');
    await waitFor(() => expect(screen.getByText(/The battery history could not be loaded/)).toBeTruthy());
  });

  it('lists today’s activity with an icon per kind, folded after 7', async () => {
    const kinds = ['info', 'ok', 'low', 'warn', 'error', 'off', 'info', 'info', 'info'] as const;
    const events = kinds.map((kind, i) => event('R-001', T - i * MIN, `Event ${i}`, { kind, sub: i === 0 ? 'with a sub-line' : undefined }));
    await show('R-001', { events });
    const log = tile('Activity');
    expect(log.getAllByRole('listitem').length).toBe(7);
    expect(log.getByText('with a sub-line')).toBeTruthy();
    fireEvent.click(log.getByRole('button', { name: 'Show all 9' }));
    expect(log.getAllByRole('listitem').length).toBe(9);
    fireEvent.click(log.getByRole('button', { name: 'Show fewer' }));
    expect(log.getAllByRole('listitem').length).toBe(7);
  });

  it('marks values stale while the connection is lost, and draws the other robots of the site', async () => {
    const { container } = await show('R-001', {});
    act(() => actions.lost());
    expect(screen.getByText('1 s ago').getAttribute('style')).toMatch(/amb-text/);
    expect(container.querySelectorAll('[class*=ctx][style*=left]').length).toBe(3); // R-002, R-003, R-004
    expect(screen.getByRole('link', { name: /Open floor plan/ }).getAttribute('href')).toBe('/floor-plan?site=hh&robot=R-001');
  });
});
