import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BatteryGlyph } from './BatteryGlyph';
import { StatusPill } from './StatusPill';

describe('StatusPill and BatteryGlyph', () => {
  it('always shows a label with the icon', () => {
    for (const st of ['ok', 'low', 'error', 'offline', 'never'] as const) {
      const { container, unmount } = render(<><StatusPill status={st} /><StatusPill status={st} size="lg" solid /></>);
      expect(container.querySelectorAll('svg').length).toBe(2);
      unmount();
    }
    render(<StatusPill status="low" size="lg" />);
    expect(screen.getByText('Low Battery').querySelector('svg')!.getAttribute('width')).toBe('17');
  });

  it('clamps the battery fill', () => {
    const { container } = render(<><BatteryGlyph value={140} status="ok" /><BatteryGlyph value={-3} status="low" /><BatteryGlyph value={40} status="offline" /></>);
    const fills = [...container.querySelectorAll('[aria-hidden] > span:first-child')] as HTMLElement[];
    expect(fills.map((f) => f.style.width)).toEqual(['100%', '0%', '40%']);
  });
});
