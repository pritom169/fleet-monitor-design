import { describe, expect, it } from 'vitest';
import { BatchWriter } from './batchWriter';

/** A manual timer queue, so tests never sleep. */
function fakeTimers() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn, id: ++id });
      return id;
    },
    clearTimer: (h: unknown) => {
      timers = timers.filter((t) => t.id !== h);
    },
    /** Advance time, running due timers and letting their promises settle. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

describe('BatchWriter', () => {
  it('flushes at the batch size, or after the wait', async () => {
    const t = fakeTimers();
    const batches: number[][] = [];
    const w = new BatchWriter<number>({ name: 't', capacity: 100, maxBatch: 3, maxWaitMs: 500, write: async (b) => void batches.push(b), ...t });
    w.push(1);
    w.push(2);
    await t.advance(100);
    expect(batches).toEqual([]);
    w.push(3);
    await t.advance(0);
    expect(batches).toEqual([[1, 2, 3]]);
    w.push(4);
    await t.advance(499);
    expect(batches.length).toBe(1);
    await t.advance(1);
    expect(batches).toEqual([[1, 2, 3], [4]]);
  });

  it('drops the oldest items when full, and counts them', async () => {
    const t = fakeTimers();
    let dropped = 0;
    const batches: number[][] = [];
    const w = new BatchWriter<number>({
      name: 't', capacity: 5, maxBatch: 100, maxWaitMs: 500, write: async (b) => void batches.push(b), onDrop: (n) => (dropped += n), ...t,
    });
    for (let i = 1; i <= 8; i++) w.push(i);
    expect(w.depth).toBe(5);
    expect(dropped).toBe(3);
    await t.advance(500);
    expect(batches).toEqual([[4, 5, 6, 7, 8]]);
  });

  it('retries a failed batch with backoff, keeping order, and recovers', async () => {
    const t = fakeTimers();
    const batches: number[][] = [];
    let fail = 2;
    const attempts: number[] = [];
    const w = new BatchWriter<number>({
      name: 't', capacity: 100, maxBatch: 2, maxWaitMs: 0,
      write: async (b) => {
        if (fail-- > 0) throw new Error('db down');
        batches.push(b);
      },
      onError: (_e, a) => attempts.push(a),
      ...t,
    });
    w.push(1);
    w.push(2);
    w.push(3);
    await t.advance(0);
    expect(w.ok).toBe(false);
    await t.advance(99);
    expect(attempts).toEqual([1]);
    await t.advance(1); // 100 ms backoff
    expect(attempts).toEqual([1, 2]);
    await t.advance(200); // 200 ms backoff
    expect(w.ok).toBe(true);
    expect(batches).toEqual([[1, 2], [3]]);
  });

  it('runs one flush at a time', async () => {
    const t = fakeTimers();
    let running = 0;
    let max = 0;
    let release: () => void = () => {};
    const w = new BatchWriter<number>({
      name: 't', capacity: 100, maxBatch: 1, maxWaitMs: 0,
      write: () => {
        running++;
        max = Math.max(max, running);
        return new Promise<void>((r) => (release = () => { running--; r(); }));
      },
      ...t,
    });
    w.push(1);
    w.push(2);
    w.push(3);
    await t.advance(0);
    expect(running).toBe(1);
    release();
    await t.advance(0);
    release();
    await t.advance(0);
    release();
    await t.advance(0);
    expect(max).toBe(1);
  });
});

describe('BatchWriter poison batches', () => {
  it('drops a batch the database can never accept, and carries on', async () => {
    const t = fakeTimers();
    const batches: number[][] = [];
    let dropped = 0;
    const w = new BatchWriter<number>({
      name: 't', capacity: 100, maxBatch: 2, maxWaitMs: 0,
      write: async (b) => {
        if (b.includes(2)) throw Object.assign(new Error('bad row'), { code: '22P02' });
        batches.push(b);
      },
      isFatal: (e) => (e as { code?: string }).code === '22P02',
      onDrop: (n) => (dropped += n),
      ...t,
    });
    for (const i of [1, 2, 3, 4]) w.push(i);
    await t.advance(0);
    await t.advance(0);
    expect(dropped).toBe(2);
    expect(batches).toEqual([[3, 4]]);
    expect(w.ok).toBe(true);
  });
});

describe('BatchWriter shutdown and limits', () => {
  it('ignores pushes after close, and close resolves at once when idle', async () => {
    const t = fakeTimers();
    const batches: number[][] = [];
    const w = new BatchWriter<number>({ name: 't', capacity: 10, maxBatch: 10, maxWaitMs: 500, write: async (b) => void batches.push(b), ...t });
    await w.close();
    w.push(1);
    expect(w.depth).toBe(0);
    await t.advance(1000);
    expect(batches).toEqual([]);
  });

  it('on close, writes what is left at once, and gives up on a failing batch instead of hanging', async () => {
    const t = fakeTimers();
    let dropped = 0;
    const errors: number[] = [];
    const w = new BatchWriter<number>({
      name: 't', capacity: 100, maxBatch: 2, maxWaitMs: 10_000,
      write: async () => { throw new Error('db down'); },
      onDrop: (n) => (dropped += n),
      onError: (_e, a) => errors.push(a),
      ...t,
    });
    for (const i of [1, 2, 3]) w.push(i);
    let closed = false;
    const done = w.close().then(() => (closed = true));
    await t.advance(0);
    await t.advance(0);
    await done;
    expect(closed).toBe(true);
    expect(dropped).toBe(3);
    expect(errors).toEqual([1, 2]);
  });

  it('settles a close when the last batch is poison', async () => {
    const t = fakeTimers();
    let fatal = 0;
    const w = new BatchWriter<number>({
      name: 't', capacity: 100, maxBatch: 5, maxWaitMs: 10_000,
      write: async () => { throw Object.assign(new Error('bad'), { code: '23505' }); },
      isFatal: () => true,
      onFatal: (_e, n) => (fatal += n),
      ...t,
    });
    w.push(1);
    const done = w.close();
    await t.advance(0);
    await done;
    expect(fatal).toBe(1);
  });

  it('keeps capacity while retrying: items that arrived during the failed write push the oldest out', async () => {
    const t = fakeTimers();
    let dropped = 0;
    let fail: (e: Error) => void = () => {};
    let mode: 'hang' | 'ok' = 'hang';
    const batches: number[][] = [];
    const w = new BatchWriter<number>({
      name: 't', capacity: 3, maxBatch: 3, maxWaitMs: 0,
      write: (b) => {
        if (mode === 'hang') return new Promise<void>((_, reject) => (fail = reject));
        batches.push(b);
        return Promise.resolve();
      },
      onDrop: (n) => (dropped += n),
      ...t,
    });
    for (const i of [1, 2, 3]) w.push(i);
    await t.advance(0); // 1-2-3 in flight
    w.push(4);
    w.push(5);
    expect(dropped).toBe(0); // the queue itself holds two: under capacity
    fail(new Error('db down'));
    await t.advance(0); // 1-2-3 go back in front of 4-5: five items, capacity three
    expect(w.depth).toBe(3);
    expect(dropped).toBe(2);
    mode = 'ok';
    await t.advance(100);
    expect(batches).toEqual([[3, 4, 5]]);
  });

  it('reclaims the consumed part of its buffer', async () => {
    const t = fakeTimers();
    let dropped = 0;
    const w = new BatchWriter<number>({ name: 't', capacity: 10, maxBatch: 100_000, maxWaitMs: 1000, write: async () => {}, onDrop: (n) => (dropped += n), ...t });
    for (let i = 0; i < 10_000; i++) w.push(i);
    expect(w.depth).toBe(10);
    expect(dropped).toBe(9_990);
    expect((w as unknown as { buf: number[] }).buf.length).toBeLessThan(5000);
  });

  it('reports the write duration, and uses real timers by default', async () => {
    const written: number[] = [];
    const w = new BatchWriter<number>({ name: 't', capacity: 10, maxBatch: 1, maxWaitMs: 0, write: async () => {}, onWritten: (n, s) => { written.push(n); expect(s).toBeGreaterThanOrEqual(0); } });
    w.push(1);
    await new Promise((r) => setTimeout(r, 10));
    w.push(2);
    w.push(3); // waits: the timer for 2 is already the earliest
    await w.close();
    expect(written).toEqual([1, 1, 1]);
  });
});
