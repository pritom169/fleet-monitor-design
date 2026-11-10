import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { AppErrorBoundary, CrashView } from './ErrorScreen';

function Boom(): never {
  throw new Error('Cannot read properties of undefined (reading "battery")');
}

describe('error screen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the crash screen, not a blank page, when a page throws', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [{ element, errorElement }] = routes;
    const router = createMemoryRouter([{ element, errorElement, children: [{ path: '/', element: <Boom /> }] }], { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^This view stopped working\./);
    expect(screen.getByText(/reading "battery"/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fleet overview/ }).getAttribute('href')).toBe('/');
    expect(logged.mock.calls.some((c) => c[0] === '[fleet] a view crashed')).toBe(true);
  });

  it('catches what the router does not, and logs it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(logged.mock.calls.some((c) => c[0] === '[fleet] the app crashed')).toBe(true);
  });

  it('renders children while nothing has failed', () => {
    render(<AppErrorBoundary><p>fine</p></AppErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('reloads on request, and shows thrown values that are not errors', () => {
    const reload = vi.fn();
    render(<CrashView error="socket closed" onReload={reload} />);
    expect(screen.getByText('socket closed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
