import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTheme } from './theme';

const setMedia = (v: boolean) => (window as unknown as { setMedia: (q: string, v: boolean) => void }).setMedia('(prefers-color-scheme: dark)', v);

describe('useTheme', () => {
  it('follows the system setting until the user picks', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('light');
    act(() => setMedia(true));
    expect(result.current[0]).toBe('dark');
  });

  it('remembers the pick, and the pick wins over the system', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('fm-theme')).toBe('dark');
    act(() => setMedia(false));
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
  });

  it('starts from a theme set before paint, and survives storage being unavailable', () => {
    document.documentElement.dataset.theme = 'dark';
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    const { result, unmount } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
    spy.mockRestore();
    unmount();
  });
});
