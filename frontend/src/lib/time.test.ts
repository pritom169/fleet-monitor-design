import { describe, expect, it } from 'vitest';
import { clock, duration, hm, span } from './time';

describe('time formats', () => {
  it('formats spans, never below 1 s', () => {
    expect(span(-5)).toBe('1 s');
    expect(span(59_999)).toBe('59 s');
    expect(span(60_000)).toBe('1 min 0 s');
  });

  it('formats durations for uptime', () => {
    expect(duration(14 * 60_000 + 59_000)).toBe('14 min');
    expect(duration(6 * 3600_000 + 12 * 60_000)).toBe('6 h 12 min');
  });

  it('formats wall-clock times with leading zeros', () => {
    const t = new Date(2027, 0, 1, 7, 5, 3).getTime();
    expect(clock(t)).toBe('07:05:03');
    expect(hm(t)).toBe('07:05');
  });
});
