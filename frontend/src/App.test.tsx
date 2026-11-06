import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fleet } from './data/store';
import { fleetState, load } from './test/fixtures';

describe('App', () => {
  it('routes, shows a not-found page, and resets scroll and hover on navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => {}))); // robot detail history: never answers here
    window.history.pushState({}, '', '/no/such/page');
    const { App } = await import('./App'); // the browser router reads the URL when the module loads
    load(fleetState());
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page does not exist. Check the address, or go back to the fleet.');

    act(() => fleet.set({ ...fleet.get(), hover: { id: 'R-001', from: 'table' } }));
    const scroll = window.scrollTo as unknown as ReturnType<typeof vi.fn>;
    scroll.mockClear();
    fireEvent.click(screen.getByRole('link', { name: /Fleet overview/ }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^4 robots need your attention/);
    expect(scroll).toHaveBeenCalledWith(0, 0);
    expect(fleet.get().hover).toBeNull();

    fireEvent.click(screen.getAllByRole('link', { name: 'R-003' })[0]);
    expect(window.location.pathname).toBe('/robots/R-003');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^R-003 has stopped/);

    fireEvent.click(screen.getByRole('link', { name: 'Floor Plan' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Hamburg DC\./);

    act(() => window.history.back());
    vi.unstubAllGlobals();
  });
});
