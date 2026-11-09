import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fleetState, load } from '../test/fixtures';
import { renderAt } from '../test/render';
import { Components } from './Components';

afterEach(() => vi.useRealTimers());

describe('Components sheet', () => {
  it('shows every component variant, with an interactive filter and a replaying highlight', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    load(fleetState());
    const { unmount } = renderAt(<Components />, '/dev/components');
    for (const title of ['Status.', 'Table rows.', 'Filters and connection.', 'Attention cards.', 'Map.', 'States.', 'Icons.', 'Screens.']) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    expect(screen.getAllByRole('link', { name: /Open/ }).length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Error 1' }));
    expect(screen.getByRole('button', { name: 'Error 1' }).getAttribute('aria-pressed')).toBe('true');
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('Just changed — replays every 4 s')).toBeTruthy();
    for (const b of screen.getAllByRole('button', { name: /Retry now/ })) fireEvent.click(b);
    unmount();
  });
});
