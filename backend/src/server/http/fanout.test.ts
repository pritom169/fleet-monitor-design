import { describe, expect, it } from 'vitest';
import type { Report } from '@fleet/shared/protocol';
import { BUFFER_LIMIT, DRAIN_TIMEOUT_MS, Fanout, type Sink } from './fanout';

const rep = (id: string, t: number, battery = 50): Report => ({ id, t, battery, x: 0, y: 0, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0 });

function sink() {
  const s = { sent: [] as unknown[], bufferedAmount: 0, terminated: null as string | null };
  const api: Sink = {
    send: (d) => void s.sent.push(JSON.parse(d)),
    get bufferedAmount() {
      return s.bufferedAmount;
    },
    terminate: (reason) => void (s.terminated = reason),
  };
  return { s, api };
}

describe('Fanout', () => {
  it('sends hello first, then coalesces reports to one per robot per second', () => {
    let now = 0;
    const f = new Fanout(() => now);
    const { s, api } = sink();
    f.add(api, { type: 'hello', serverTime: 0, robots: [], reports: [] });
    f.report(rep('R-001', 0, 50));
    now = 300;
    f.report(rep('R-001', 300, 49));
    now = 600;
    f.report(rep('R-001', 600, 48));
    f.flush();
    expect(s.sent.length).toBe(2); // hello + first report
    now = 950;
    f.flush();
    expect(s.sent.length).toBe(3);
    expect((s.sent[2] as { r: Report }).r.battery).toBe(48); // newest wins
  });

  it('keeps only the newest report per robot for a slow client, then cuts it', () => {
    let now = 0;
    const f = new Fanout(() => now);
    const slow = sink();
    const fast = sink();
    f.add(slow.api, { type: 'hello', serverTime: 0, robots: [], reports: [] });
    f.add(fast.api, { type: 'hello', serverTime: 0, robots: [], reports: [] });
    slow.s.bufferedAmount = BUFFER_LIMIT + 1;
    for (let i = 0; i < 10; i++) {
      now = i * 1000;
      f.report(rep('R-001', now, 50 - i));
      f.flush();
    }
    expect(slow.s.sent.length).toBe(1); // only hello
    expect(fast.s.sent.length).toBe(11); // the fast client is not held back
    slow.s.bufferedAmount = 0;
    now += 1000;
    f.flush();
    expect(slow.s.sent.length).toBe(2);
    expect((slow.s.sent[1] as { r: Report }).r.battery).toBe(41);

    slow.s.bufferedAmount = BUFFER_LIMIT + 1;
    f.flush();
    now += DRAIN_TIMEOUT_MS + 1;
    f.flush();
    expect(slow.s.terminated).toBe('slow');
    expect(f.size).toBe(1);
  });
});
