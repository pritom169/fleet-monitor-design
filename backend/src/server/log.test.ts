import { afterEach, describe, expect, it, vi } from 'vitest';
import { errText, sampled } from './log';

afterEach(() => vi.useRealTimers());

describe('sampled', () => {
  it('logs the first lines of a window, counts the rest, and reports the count in the next window', () => {
    vi.useFakeTimers({ now: 0 });
    const s = sampled(1000, 2);
    const calls: [string, number][] = [];
    const log = (key: string) => s(key, (skipped) => void calls.push([key, skipped]));
    log('a');
    log('a');
    log('a');
    log('a');
    log('b');
    expect(calls).toEqual([['a', 0], ['a', 0], ['b', 0]]);
    vi.setSystemTime(1001);
    log('a');
    expect(calls.at(-1)).toEqual(['a', 2]);
  });

  it('has sensible defaults', () => {
    const s = sampled();
    let n = 0;
    for (let i = 0; i < 10; i++) s('k', () => n++);
    expect(n).toBe(5);
  });
});

describe('errText', () => {
  it('joins code and message', () => {
    expect(errText(Object.assign(new Error('boom'), { code: 'E1' }))).toBe('E1 boom');
    expect(errText(new Error('boom'))).toBe('boom');
  });

  it('reads the first inner error of an AggregateError with an empty message', () => {
    const agg = new AggregateError([Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })], '');
    expect(errText(agg)).toBe('ECONNREFUSED connect ECONNREFUSED');
  });

  it('falls back to String() for anything else', () => {
    expect(errText('plain')).toBe('plain');
    expect(errText(null)).toBe('null');
    expect(errText({})).toBe('[object Object]');
  });
});
