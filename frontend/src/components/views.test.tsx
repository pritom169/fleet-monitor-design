import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actions, fleet } from '../data/store';
import type { Robot } from '../data/types';
import { fleetState, load, rep, reported, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { BatteryChart } from './BatteryChart';
import { FleetMap, MapLegend } from './FleetMap';
import { MapMarker } from './MapMarker';
import { RobotTable, SkeletonRows, TableEmpty } from './RobotTable';
import { BannerView, ConnectionBanner, ConnectionIndicator, IngestBannerView, TopBar } from './TopBar';

const s = fleetState();
const r = (id: string) => s.robots[id];
const rr = (id: string) => reported(s, id);
const all = s.ids.map((id) => s.robots[id]);
const loc = () => screen.getByTestId('location').textContent;
const setMedia = (q: string, v: boolean) => (window as unknown as { setMedia: (q: string, v: boolean) => void }).setMedia(q, v);

describe('MapMarker', () => {
  it('has no marker for a robot that never reported', () => {
    const { container } = render(<MapMarker robot={r('R-005')} now={T} />);
    expect(container.innerHTML).toBe('');
  });

  it('stands problems up as tagged pins, and keeps healthy robots flat', () => {
    const { container } = render(<><MapMarker robot={r('R-003')} now={T} /><MapMarker robot={r('R-001')} now={T} label /><MapMarker robot={r('R-010')} now={T} /></>);
    expect(screen.getByText('R-003')).toBeTruthy();
    expect(screen.getByText('R-001')).toBeTruthy(); // label layer
    expect(screen.queryByText('R-010')).toBeNull();
    const [pin, dot] = [...container.children] as HTMLElement[];
    expect(pin.style.zIndex).toBe('8');
    expect(dot.style.zIndex).toBe('1');
    expect(pin.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a popover when highlighted, on the side with room, with the fault for errors', () => {
    render(<><MapMarker robot={r('R-003')} now={T} highlighted popover /><MapMarker robot={r('R-004')} now={T} highlighted popover showTag={false} /></>);
    expect(screen.getByText('Fault')).toBeTruthy();
    expect(screen.getByText('Motor overcurrent')).toBeTruthy();
    expect(screen.getByText('Tote picker · 3 min 4 s ago')).toBeTruthy();
    expect(screen.getByText('Task')).toBeTruthy();
  });

  it('is a labelled button when clickable, and rings the selected robot', () => {
    const onClick = vi.fn();
    const onEnter = vi.fn();
    const { container } = render(<MapMarker robot={r('R-002')} now={T} selected dimmed={0.2} onClick={onClick} onEnter={onEnter} onLeave={() => {}} />);
    const b = screen.getByRole('button', { name: 'R-002, Low Battery, Returning to dock' });
    fireEvent.click(b);
    fireEvent.focus(b);
    expect(onClick).toHaveBeenCalled();
    expect(onEnter).toHaveBeenCalled();
    expect(b.style.zIndex).toBe('12');
    expect(b.style.opacity).toBe('0.2');
    expect(container.querySelectorAll('button > span').length).toBeGreaterThan(3);
  });
});

describe('FleetMap', () => {
  it('shows one plan per site with counts, an empty note, and links to the floor plan', () => {
    renderAt(<FleetMap siteKeys={['hh', 'le', 'be']} robots={all} visible={new Set(['R-001'])} now={T} hoveredId="R-003" />);
    expect(screen.getByText('3 need attention')).toBeTruthy();
    expect(screen.getByText('All OK')).toBeTruthy();
    expect(screen.getByText('No robots on this floor yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/floor-plan');
    expect(screen.getByRole('link', { name: 'Leipzig Hub' }).getAttribute('href')).toBe('/floor-plan?site=le');
  });

  it('links straight to the one site shown, and says "needs" for one problem', () => {
    renderAt(<FleetMap siteKeys={['mu']} robots={all} visible={new Set()} now={T} hoveredId={null} />);
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/floor-plan?site=mu');
    expect(screen.getByText('1 needs attention')).toBeTruthy();
  });

  it('shows dashes while loading, and reports hover to the store', () => {
    const { container } = renderAt(<FleetMap siteKeys={['hh']} robots={all} visible={new Set()} now={T} hoveredId={null} loading />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('No robots on this floor yet.')).toBeNull();
    const marker = container.querySelector('figure [style*="z-index"]')!;
    fireEvent.mouseEnter(marker);
    expect(fleet.get().hover).toEqual({ id: expect.any(String), from: 'map' });
    fireEvent.mouseLeave(marker);
    expect(fleet.get().hover).toBeNull();
  });

  it('has a legend', () => {
    const { container } = render(<MapLegend className="x" />);
    expect(container.firstElementChild!.className).toBe('x');
  });
});

describe('BatteryChart', () => {
  const label = () => screen.getByRole('img').getAttribute('aria-label');

  it('scales the axis to the data', () => {
    const { rerender } = render(<BatteryChart points={[[T - 60_000, 30]]} now={T} status="low" lastReport={T} />);
    expect(screen.getByText('40')).toBeTruthy();
    rerender(<BatteryChart points={[[T - 60_000, 50]]} now={T} status="ok" lastReport={T} />);
    expect(screen.getByText('60')).toBeTruthy();
    rerender(<BatteryChart points={[[T - 60_000, 90]]} now={T} status="ok" lastReport={T} />);
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('breaks the line over gaps, drops points older than 15 minutes, and describes the data', () => {
    const { container } = render(<BatteryChart points={[[T - 20 * 60_000, 99], [T - 600_000, 40], [T - 590_000, 39], [T - 60_000, 18]]} now={T} status="low" lastReport={T} />);
    expect(container.querySelectorAll('g').length).toBe(2);
    expect(label()).toBe('Battery over the last 15 minutes, from 40% to 18%.');
    expect(screen.getByText('Now')).toBeTruthy();
  });

  it('hatches the unknown stretch for an offline robot, and says when there is no data', () => {
    const { rerender } = render(<BatteryChart points={[[T - 300_000, 60]]} now={T} status="offline" lastReport={T - 300_000} />);
    expect(screen.getByText('No data since 10:25:00')).toBeTruthy();
    expect(label()).toMatch(/no data since 10:25:00\.$/);
    rerender(<BatteryChart points={[[T - 300_000, 60]]} now={T} status="offline" lastReport={null} />);
    expect(label()).toMatch(/no data since start\.$/);
    rerender(<BatteryChart points={[]} now={T} status="never" lastReport={null} />);
    expect(screen.getByText('No reports yet')).toBeTruthy();
    expect(label()).toBe('No battery data in the last 15 minutes.');
  });
});

describe('RobotTable', () => {
  it('shows skeleton rows while loading, with a note', () => {
    renderAt(<RobotTable robots={[]} now={T} stale={false} hover={null} loading connecting="Retrying (attempt 2)…" />);
    expect(screen.getByText('Retrying (attempt 2)…')).toBeTruthy();
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    render(<SkeletonRows count={2} />);
    expect(screen.getByText('Connecting to fleet…')).toBeTruthy();
  });

  it('shows the empty state it is given', () => {
    renderAt(<RobotTable robots={[]} now={T} stale={false} hover={null} empty={<TableEmpty title="No matching robots." detail="Try again." action={<button type="button">Clear</button>} />} />);
    expect(screen.getByText('No matching robots.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('renders every kind of row, and opens a robot on click', () => {
    const charging = { ...rr('R-001'), id: 'R-099', report: rep('R-099', { task: 'Charging', taskKind: 'charging' }), changedAt: T - 500 };
    renderAt(<RobotTable robots={[...all, charging]} now={T} stale hover={{ id: 'R-001', from: 'table' }} />);
    const row = (id: string) => screen.getByRole('link', { name: id }).closest('[role=row]') as HTMLElement;
    expect(within(row('R-005')).getByText(/waiting for first report/)).toBeTruthy();
    expect(within(row('R-005')).getByText('Never')).toBeTruthy();
    expect(within(row('R-003')).getByText('Motor overcurrent')).toBeTruthy();
    expect(within(row('R-004')).getByText('3 min 4 s ago')).toBeTruthy();
    expect(within(row('R-002')).getByText('14%')).toBeTruthy();
    expect(within(row('R-099')).getByText('Charging')).toBeTruthy();
    expect(within(row('R-001')).getByText('10.0, 6.1 m')).toBeTruthy();
    fireEvent.mouseEnter(row('R-002'));
    expect(fleet.get().hover).toEqual({ id: 'R-002', from: 'table' });
    fireEvent.mouseLeave(row('R-002'));
    fireEvent.click(within(row('R-004')).getByText('Hamburg DC', { selector: '[role=cell]' }));
    expect(loc()).toBe('/robots/R-004');
    fireEvent.click(screen.getByRole('link', { name: 'R-002' }));
    expect(loc()).toBe('/robots/R-002');
  });

  it('scrolls the table, not the page, to a robot hovered on the map', () => {
    const robots = [r('R-001'), r('R-002')];
    const { rerender } = renderAt(<RobotTable robots={robots} now={T} stale={false} hover={null} />);
    const box = document.querySelector('[data-scroll]') as HTMLElement;
    const rows = screen.getAllByRole('row').filter((x) => x.querySelector('a'));
    Object.defineProperty(box, 'clientHeight', { value: 100, configurable: true });
    box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    rows[0].getBoundingClientRect = () => ({ top: 10 }) as DOMRect;
    rows[1].getBoundingClientRect = () => ({ top: 400 }) as DOMRect;
    Object.defineProperty(rows[1], 'offsetHeight', { value: 40 });
    box.scrollTop = 200;
    const scroll = box.scrollTo as unknown as ReturnType<typeof vi.fn>;
    scroll.mockClear();
    const wrap = (hover: { id: string; from: string } | null) => <RobotTable robots={robots} now={T} stale={false} hover={hover} />;
    rerender(wrap({ id: 'R-001', from: 'map' })); // above the view: scroll up
    expect(scroll).toHaveBeenLastCalledWith({ top: 170, behavior: 'smooth' });
    rerender(wrap({ id: 'R-002', from: 'map' })); // below: scroll down
    expect(scroll).toHaveBeenLastCalledWith({ top: 548, behavior: 'smooth' });
    scroll.mockClear();
    box.scrollTop = 560;
    rows[1].getBoundingClientRect = () => ({ top: 50 }) as DOMRect; // 610 px into the list: inside 560–660
    rerender(wrap({ id: 'R-001', from: 'table' })); // hovered in the table itself: no scroll
    rerender(wrap({ id: 'R-002', from: 'map' })); // already in view
    expect(scroll).not.toHaveBeenCalled();
  });

  it('slides rows to their new place when the order changes, unless motion is reduced', () => {
    const a = [r('R-001'), r('R-002')];
    const { rerender } = renderAt(<RobotTable robots={a} now={T} stale={false} hover={null} />);
    const animate = Element.prototype.animate as unknown as ReturnType<typeof vi.fn>;
    animate.mockClear();
    /** Lay the rows out in the given order, 40 px apart, as the browser would. */
    const layout = (order: string[]) => screen.getAllByRole('link').forEach((l) => {
      const row = l.closest('[role=row]') as HTMLElement;
      Object.defineProperty(row, 'offsetTop', { value: order.indexOf(l.textContent!) * 40, configurable: true });
    });
    const show = (rs: typeof a) => {
      layout(rs.map((x) => x.id));
      rerender(<RobotTable robots={rs} now={T} stale={false} hover={null} />);
    };
    show([a[1], a[0]]); // first reorder: positions before it were all 0 in jsdom, so one row moves
    expect(animate).toHaveBeenCalledTimes(1);
    show(a); // both rows swap places
    expect(animate).toHaveBeenCalledTimes(3);
    expect(animate.mock.calls[1][0]).toEqual([{ transform: 'translateY(40px)' }, { transform: 'none' }]);
    show(a); // same order again: nothing moves
    expect(animate).toHaveBeenCalledTimes(3);
    setMedia('(prefers-reduced-motion: reduce)', true);
    show([a[1], a[0]]);
    expect(animate).toHaveBeenCalledTimes(3);
    rerender(<RobotTable robots={[r('R-003')]} now={T} stale={false} hover={null} />); // a different set: no slide
    expect(animate).toHaveBeenCalledTimes(3);
  });
});

describe('TopBar', () => {
  it('shows the connection state', () => {
    load();
    const { rerender } = renderAt(<ConnectionIndicator />);
    expect(screen.getByRole('status').textContent).toBe('Live 10:30:00');
    act(() => actions.ingest({ state: 'paused', frozenAt: T }));
    rerender(<ConnectionIndicator />);
    expect(screen.getByRole('status').textContent).toBe(' Robot data paused');
    act(() => actions.lost());
    expect(screen.getByRole('status').textContent).toBe(' Reconnecting…');
    act(() => fleet.set({ ...fleet.get(), connection: 'connecting' }));
    expect(screen.getByRole('status').textContent).toBe(' Connecting…');
  });

  it('shows a banner only when something is wrong', () => {
    load();
    const { container } = renderAt(<ConnectionBanner />);
    expect(container.querySelector('[role=status]')).toBeNull();
    act(() => actions.ingest({ state: 'paused', frozenAt: T - 12_000 }));
    expect(screen.getByText(/The fleet server lost its link to the robots/)).toBeTruthy();
    expect(screen.getByText('Last robot data 10:29:48 · 12 s ago')).toBeTruthy();
    act(() => {
      actions.ingest({ state: 'live', frozenAt: null });
      actions.lost();
      actions.retrying(3, T + 5000); // client time; the fixture's server offset is 0
    });
    expect(screen.getByText(/Live updates paused/)).toBeTruthy();
    expect(screen.getByText('Attempt 3 · next try in 5 s')).toBeTruthy();
  });

  it('says it cannot reach the server on a failing first connection, and offers a retry', () => {
    const onRetry = vi.fn();
    render(<BannerView connection="connecting" attempt={2} now={T} last={null} retryInMs={200} onRetry={onRetry} inline />);
    expect(screen.getByText('Cannot reach the fleet server.')).toBeTruthy();
    expect(screen.getByText('Attempt 2 · trying now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry now/ }));
    expect(onRetry).toHaveBeenCalled();
    render(<BannerView connection="lost" attempt={1} now={T} last={null} retryInMs={0} onRetry={onRetry} />);
    expect(screen.queryByText(/Last update/)).toBeNull();
    render(<IngestBannerView now={T} frozenAt={null} />);
  });

  it('hides the banner while the very first connection is being made', () => {
    fleet.set({ ...fleetState(), connection: 'connecting', attempt: 0 });
    const { container } = renderAt(<ConnectionBanner />);
    expect(container.querySelector('[role=status]')).toBeNull();
    act(() => fleet.set({ ...fleet.get(), attempt: 1, nextRetryAt: null }));
    expect(screen.getByText('Cannot reach the fleet server.')).toBeTruthy();
  });

  it('switches the theme', () => {
    load();
    renderAt(<TopBar><span>slot</span></TopBar>);
    expect(screen.getByText('slot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Floor Plan' }));
    expect(loc()).toBe('/floor-plan');
  });
});

export type { Robot };
