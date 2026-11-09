import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { actions, fleet, initialState } from '../data/store';
import { load, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { Overview } from './Overview';

const loc = () => screen.getByTestId('location').textContent;
const headline = () => screen.getByRole('heading', { level: 1 }).textContent;
const tableRows = () => within(screen.getByRole('table')).queryAllByRole('link').map((l) => l.textContent);

describe('Overview', () => {
  it('shows that it is connecting, then the answer', () => {
    fleet.set({ ...initialState(T), attempt: 2 });
    renderAt(<Overview />);
    expect(headline()).toBe('Connecting to your fleet. The fleet server is not answering yet.');
    expect(screen.getByText('Cannot reach the fleet server. Retrying (attempt 2)…')).toBeTruthy();
    expect(screen.getByText('Waiting for data')).toBeTruthy();
    act(() => load());
    expect(headline()).toBe('4 robots need your attention. 2 of 7 are running normally across 3 sites.');
    expect(screen.getAllByRole('article').length).toBe(4);
    expect(tableRows()).toEqual(['R-004', 'R-020', 'R-003', 'R-002', 'R-005', 'R-001', 'R-010']);
    expect(screen.getByText('7 of 7 robots · most urgent first')).toBeTruthy();
    expect(screen.getAllByRole('figure').length).toBe(3);
  });

  it('shows "Connecting to fleet…" on the first try', () => {
    renderAt(<Overview />);
    expect(screen.getByText('Connecting to fleet…')).toBeTruthy();
  });

  it('keeps filter, site and search in the URL', () => {
    load();
    renderAt(<Overview />, '/');
    fireEvent.click(screen.getByRole('button', { name: 'Offline 2' }));
    expect(loc()).toBe('/?status=offline');
    expect(tableRows()).toEqual(['R-004', 'R-020']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Munich North' })[0]);
    expect(loc()).toBe('/?status=offline&site=mu');
    expect(tableRows()).toEqual(['R-020']);
    expect(headline()).toBe('1 robot needs your attention. 0 of 1 are running normally at Munich North.');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'R-020' } });
    expect(loc()).toBe('/?status=offline&site=mu&q=R-020');
    fireEvent.click(screen.getByRole('button', { name: 'Offline 1' }));
    expect(loc()).toBe('/?site=mu&q=R-020');
  });

  it('explains an empty site, and offers all sites', () => {
    load();
    renderAt(<Overview />, '/?site=be');
    expect(headline()).toBe('No robots at Berlin South yet. A robot appears here after its first report.');
    expect(screen.getByText('Berlin South has no robots assigned. A robot appears after its first report.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show all sites/ }));
    expect(loc()).toBe('/');
  });

  it('explains when nothing matches, and clears every filter', () => {
    load();
    renderAt(<Overview />, '/?site=hh&status=error&q=zzz');
    expect(screen.getByText('Nothing matches “zzz” in Error at Hamburg DC.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(loc()).toBe('/');
    act(() => load());
  });

  it('says "all sites" when nothing matches across the fleet', () => {
    load();
    renderAt(<Overview />, '/?status=never&q=nothing');
    expect(screen.getByText('Nothing matches “nothing” in Never reported at all sites.')).toBeTruthy();
  });

  it('ignores an unknown site or filter', () => {
    load();
    renderAt(<Overview />, '/?site=xx&status=bogus');
    expect(screen.getByRole('button', { name: 'All 7' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('figure').map((f) => f.querySelector('figcaption a')!.textContent)).toEqual(['Hamburg DC', 'Leipzig Hub', 'Munich North']);
  });

  it('marks values stale while our connection is lost, and says so', () => {
    load();
    renderAt(<Overview />);
    act(() => actions.lost());
    expect(headline()).toBe('Live updates paused. Showing the fleet as of 10:30:00. 4 robots needed attention then.');
    expect(screen.getByText(/Live updates paused. Reconnecting/)).toBeTruthy();
  });

  it('highlights the robot hovered elsewhere', () => {
    load();
    renderAt(<Overview />);
    act(() => actions.hover('R-003', 'map'));
    expect(fleet.get().hover).toEqual({ id: 'R-003', from: 'map' });
    fireEvent.click(screen.getByRole('link', { name: /Component sheet/ }));
    expect(loc()).toBe('/dev/components');
  });
});
