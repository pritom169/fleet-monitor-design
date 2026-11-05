import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { actions, fleet } from '../data/store';
import type { Robot } from '../data/types';
import { fleetState, load, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { BannerView, ConnectionBanner, ConnectionIndicator, IngestBannerView, TopBar } from './TopBar';

const loc = () => screen.getByTestId('location').textContent;

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
