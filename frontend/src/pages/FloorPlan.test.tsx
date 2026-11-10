import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actions, fleet, initialState } from '../data/store';
import { fleetState, info, load, rep, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { FloorPlan } from './FloorPlan';

const loc = () => screen.getByTestId('location').textContent;
const headline = () => screen.getByRole('heading', { level: 1 }).textContent;
const panel = () => within(screen.getByRole('complementary', { name: 'Robots on this floor' }));
const listed = () => panel().queryAllByRole('button').map((b) => b.querySelector('strong')?.textContent).filter(Boolean);
const zoom = () => document.querySelector('[class*=legend] > span:last-child')!.textContent;

describe('FloorPlan', () => {
  it('shows the first site, its problems first, and a mini plan per site', () => {
    load();
    renderAt(<FloorPlan />);
    expect(headline()).toBe('Hamburg DC. 5 robots on the floor. 3 need your attention.');
    expect(panel().getByText('Needs attention')).toBeTruthy();
    expect(listed()).toEqual(['R-004', 'R-003', 'R-002', 'R-001', 'R-005']);
    expect(panel().getByText('Last seen 3 min 4 s ago')).toBeTruthy();
    expect(panel().getByText('Never reported')).toBeTruthy();
    const sites = within(screen.getByRole('region', { name: 'Sites' }));
    expect(sites.getByText('3 need attention')).toBeTruthy();
    expect(sites.getByText('All running normally')).toBeTruthy();
    expect(sites.getByText('1 needs attention')).toBeTruthy();
    expect(sites.getByText('No robots yet')).toBeTruthy();
  });

  it('switches sites from the tabs and the mini plans', () => {
    load();
    renderAt(<FloorPlan />, '/floor-plan?site=le');
    expect(headline()).toBe('Leipzig Hub. 1 robots on the floor. All are running normally.');
    expect(panel().getByText('Charging')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Sites' })).getByRole('button', { name: /^Munich North/ }));
    expect(loc()).toBe('/floor-plan?site=mu');
    expect(headline()).toBe('Munich North. 1 robots on the floor. 1 needs your attention.');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Site' })).getByRole('button', { name: 'Berlin South' }));
    expect(headline()).toBe('Berlin South. No robots on this floor yet.');
    expect(panel().getByText('No robots here yet')).toBeTruthy();
  });

  it('selects a robot from the list or the map, zooms to it, and goes back', () => {
    load();
    renderAt(<FloorPlan />);
    fireEvent.click(panel().getByText('R-002').closest('button')!);
    expect(loc()).toBe('/?robot=R-002');
    expect(zoom()).toBe('160%');
    expect(panel().getByText('14% battery. Returning to dock.')).toBeTruthy();
    expect(panel().getByRole('link', { name: /View robot details/ }).getAttribute('href')).toBe('/robots/R-002');
    fireEvent.click(panel().getByRole('button', { name: /Hamburg DC/ }));
    expect(loc()).toBe('/');
    expect(zoom()).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'R-003, Error, Motor overcurrent' }));
    expect(panel().getByText('Motor overcurrent. The robot has stopped.')).toBeTruthy();
    fireEvent.click(panel().getByRole('button', { name: /Hamburg DC/ }));
    fireEvent.click(panel().getByText('R-001').closest('button')!);
    expect(loc()).toBe('/?robot=R-001');
  });

  it('describes every status in the selection panel', () => {
    const robots = [info('R-001'), info('R-002'), info('R-003'), info('R-004'), info('R-005')];
    load(fleetState({ robots, reports: [rep('R-001'), rep('R-002', { task: 'Charging', taskKind: 'charging' }), rep('R-004', { t: T - 30_000 })] }));
    const why = (id: string) => {
      const { unmount } = renderAt(<FloorPlan />, `/floor-plan?robot=${id}`);
      const text = document.querySelector('[class*=selWhy]')!.textContent;
      unmount();
      return text;
    };
    expect(why('R-001')).toBe('Running normally.');
    expect(why('R-002')).toBe('Charging in the dock.');
    expect(why('R-004')).toBe('No report for 30 s.');
    expect(why('R-005')).toBe('Waiting for its first report.');
    renderAt(<FloorPlan />, '/floor-plan?robot=R-005');
    expect(screen.getByText('Tote picker · Never seen')).toBeTruthy();
  });

  it('opens zoomed in when a robot is in the URL, and ignores one from another site', () => {
    load();
    renderAt(<FloorPlan />, '/floor-plan?robot=R-010');
    expect(zoom()).toBe('160%');
    expect(panel().getByText('Hamburg DC')).toBeTruthy();
  });

  it('zooms in and out within limits, and fits the floor', () => {
    load();
    renderAt(<FloorPlan />);
    const zin = screen.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 7; i++) fireEvent.click(zin);
    expect(zoom()).toBe('300%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom()).toBe('260%');
    fireEvent.click(screen.getByRole('button', { name: 'Fit floor to view' }));
    expect(zoom()).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom()).toBe('100%');
  });

  it('filters the list by search and by "only robots that need attention"', () => {
    load();
    renderAt(<FloorPlan />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a robot on this floor' }), { target: { value: 'R-001' } });
    expect(listed()).toEqual(['R-001']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(panel().getByText('Try another name or ID.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(listed()).toEqual(['R-004', 'R-003', 'R-002']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'R-001' } });
    expect(panel().getByText('Nothing needs attention on this floor.')).toBeTruthy();
  });

  it('toggles labels and trails, and draws ghosts behind moving robots', () => {
    let s = fleetState();
    for (let i = 1; i <= 4; i++) s = { ...s, robots: { ...s.robots, 'R-001': { ...s.robots['R-001'], ghosts: [...s.robots['R-001'].ghosts, [10 + i, 6.1]] } } };
    load(s);
    const { container } = renderAt(<FloorPlan />);
    const ghosts = () => container.querySelectorAll('[class*=ghost]').length;
    expect(ghosts()).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Show movement trails' }));
    expect(ghosts()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show robot labels' }));
    expect(screen.getByRole('button', { name: 'Show robot labels' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Show movement trails' }));
    fireEvent.click(screen.getByRole('switch'));
    expect(ghosts()).toBe(4);
  });

  it('tracks hover from the list and the map', () => {
    load();
    renderAt(<FloorPlan />);
    const item = panel().getByText('R-001').closest('button')!;
    fireEvent.mouseEnter(item);
    expect(fleet.get().hover).toEqual({ id: 'R-001', from: 'list' });
    fireEvent.mouseLeave(item);
    const marker = screen.getByRole('button', { name: 'R-002, Low Battery, Returning to dock' });
    fireEvent.mouseEnter(marker);
    expect(fleet.get().hover).toEqual({ id: 'R-002', from: 'map' });
    fireEvent.mouseLeave(marker);
    expect(fleet.get().hover).toBeNull();
    act(() => actions.hover('R-001', 'table'));
  });

  it('shows that it is connecting, and falls back to Hamburg for an unknown site', () => {
    fleet.set(initialState(T));
    renderAt(<FloorPlan />, '/floor-plan?site=xx');
    expect(headline()).toBe('Hamburg DC. Connecting to your fleet…');
  });

  it('shows dashes on the mini plans while connecting', () => {
    renderAt(<FloorPlan />);
    expect(within(screen.getByRole('region', { name: 'Sites' })).getAllByText('—').length).toBe(4);
  });
});
