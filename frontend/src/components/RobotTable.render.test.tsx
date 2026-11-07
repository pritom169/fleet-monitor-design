/**
 * Render cost (SYSTEM_DESIGN.md §7). At 1,000 robots, re-rendering every row on every store change is the
 * difference between ~1,000 and ~4,500 row renders a second. These tests count renders through StatusPill,
 * which every row renders exactly once.
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const pills = vi.hoisted(() => ({ n: 0 }));
vi.mock('./StatusPill', () => ({
  StatusPill: ({ status }: { status: string }) => {
    pills.n++;
    return <span>{status}</span>;
  },
}));

import { actions, applyReports, fleet, useFleet } from '../data/store';
import { fleetState, load, rep, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { RobotTable } from './RobotTable';

/** Reads the store the way Overview does, so updates arrive through the store, not by re-rendering the router. */
function Harness() {
  const ids = useFleet((s) => s.ids);
  const byId = useFleet((s) => s.robots);
  const hover = useFleet((s) => s.hover);
  useFleet((s) => s.now); // Overview re-renders on every tick too
  return <RobotTable robots={ids.map((id) => byId[id])} stale={false} hover={hover} />;
}

describe('RobotTable render cost', () => {
  it('re-renders only the rows whose props changed: a hover touches two rows, a tick none', () => {
    load(fleetState());
    renderAt(<Harness />);
    expect(pills.n).toBe(7);

    pills.n = 0;
    act(() => actions.hover('R-001'));
    expect(pills.n).toBe(1); // the hovered row only: the row ref callbacks stay stable across renders
    act(() => actions.hover('R-002'));
    expect(pills.n).toBe(3); // the one leaving, the one entering

    // The 1 Hz tick moves `now`. Rows do not re-render; only the "last seen" text follows the clock.
    pills.n = 0;
    expect(screen.getAllByText('3 min 4 s ago').length).toBe(1);
    act(() => fleet.set({ ...fleet.get(), now: T + 5000 }));
    expect(pills.n).toBe(0);
    expect(screen.getAllByText('3 min 9 s ago').length).toBe(1);
  });

  it('a report re-renders that robot’s row and no other', () => {
    load(fleetState());
    renderAt(<Harness />);
    pills.n = 0;
    act(() => fleet.set(applyReports(fleet.get(), [rep('R-001', { battery: 79 })])));
    expect(pills.n).toBe(1);
  });
});
