import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { fleet, initialState } from '../data/store';

if (typeof window !== 'undefined') {
  const media = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  window.matchMedia = vi.fn((query: string) => {
    const m = media.get(query) ?? { matches: false, listeners: new Set<() => void>() };
    media.set(query, m);
    return {
      get matches() {
        return m.matches;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => m.listeners.add(l),
      removeEventListener: (_: string, l: () => void) => m.listeners.delete(l),
    } as unknown as MediaQueryList;
  });
  (window as unknown as { setMedia: (q: string, v: boolean) => void }).setMedia = (q, v) => {
    const m = media.get(q) ?? { matches: v, listeners: new Set<() => void>() };
    m.matches = v;
    media.set(q, m);
    m.listeners.forEach((l) => l());
  };
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.animate = vi.fn() as unknown as typeof Element.prototype.animate;

  afterEach(() => {
    cleanup();
    fleet.set(initialState());
    delete document.documentElement.dataset.theme;
    localStorage.clear();
    for (const [q] of media) (window as unknown as { setMedia: (q: string, v: boolean) => void }).setMedia(q, false);
  });
}
