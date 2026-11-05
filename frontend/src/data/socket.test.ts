// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@fleet/shared/protocol';
import { info, rep, T } from '../test/fixtures';

class FakeSocket {
  static all: FakeSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  throwOnClose = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    if (this.throwOnClose) throw new Error('already closed');
  }
  send(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

let fetchMock: ReturnType<typeof vi.fn>;

async function boot(o: { protocol?: string } = {}) {
  vi.resetModules();
  FakeSocket.all = [];
  fetchMock = vi.fn();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { protocol: o.protocol ?? 'http:', host: 'fleet.test', pathname: '/robots/R-1', search: '?x=1' });
  const socket = await import('./socket');
  const { fleet } = await import('./store');
  socket.startFleet();
  await vi.advanceTimersByTimeAsync(0);
  return { ...socket, fleet };
}

const hello = (t = T): ServerMessage => ({ type: 'hello', serverTime: t, robots: [info('R-001'), info('R-002')], reports: [rep('R-001', { t })] });

beforeEach(() => vi.useFakeTimers({ now: T }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startFleet', () => {
  it('opens the socket on the same host, with no sign-in request first', async () => {
    const { startFleet } = await boot();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeSocket.all.map((s) => s.url)).toEqual(['ws://fleet.test/ws']);
    startFleet(); // only once
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all.length).toBe(1);
  });

  it('uses wss on https', async () => {
    await boot({ protocol: 'https:' });
    expect(last().url).toBe('wss://fleet.test/ws');
  });
});

describe('messages', () => {
  it('applies hello, batches reports, and passes events, ingest and heartbeats on', async () => {
    const { fleet } = await boot();
    const s = last();
    s.send(hello());
    expect(fleet.get()).toMatchObject({ ready: true, connection: 'live' });
    s.send({ type: 'report', r: rep('R-001', { t: T + 1000, battery: 70 }) });
    s.send({ type: 'report', r: rep('R-002', { t: T + 1000 }) });
    expect(fleet.get().robots['R-001'].report!.battery).toBe(80); // not yet: batched
    await vi.advanceTimersByTimeAsync(250);
    expect(fleet.get().robots['R-001'].report!.battery).toBe(70);
    expect(fleet.get().robots['R-002'].status).toBe('ok');

    s.send({ type: 'event', e: { id: 'R-001', eventId: 'ev-1', t: T, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak' } });
    expect(fleet.get().liveEvents[0].text).toBe('Wi-Fi weak');

    s.send({ type: 'report', r: rep('R-001', { t: T + 2000, battery: 60 }) });
    s.send({ type: 'ingest', ingest: { state: 'paused', frozenAt: T + 2000 } }); // flushes pending reports first
    expect(fleet.get().robots['R-001'].report!.battery).toBe(60);
    expect(fleet.get().ingest.state).toBe('paused');

    s.send({ type: 'heartbeat', serverTime: T + 9000 });
    expect(fleet.get().lastMessageAt).toBe(T + 9000);
    s.onmessage?.({ data: JSON.stringify({ type: 'future-thing' }) }); // ignored
  });

  it('drops reports buffered before a fresh hello', async () => {
    const { fleet } = await boot();
    last().send(hello());
    last().send({ type: 'report', r: rep('R-001', { t: T + 1000, battery: 5 }) });
    last().send(hello(T + 1500));
    await vi.advanceTimersByTimeAsync(300);
    expect(fleet.get().robots['R-001'].report!.battery).toBe(80);
  });
});

describe('validation', () => {
  /** A fresh module, so the warn-once memory does not leak between tests. */
  async function parser() {
    vi.resetModules();
    return (await import('./socket')).parseServerMessage;
  }
  const raw = (m: unknown) => JSON.stringify(m);
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('returns the parsed message, not the raw JSON', async () => {
    const parse = await parser();
    const { taskKind: _, ...noKind } = rep('R-001');
    const m = parse(raw({ type: 'report', r: { ...noKind, extra: 'from a newer server' } }));
    expect(m).toEqual({ type: 'report', r: { ...noKind, taskKind: 'other' } }); // defaults applied, unknown keys stripped
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops a frame that is not JSON, warning once', async () => {
    const parse = await parser();
    expect(parse('{"type":"report",')).toBeNull();
    expect(parse('not json')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('not JSON');
  });

  it('drops a known type with the wrong shape, warning once per type with the failing path', async () => {
    const parse = await parser();
    expect(parse(raw({ type: 'report', r: { ...rep('R-001'), battery: 'full' } }))).toBeNull();
    expect(parse(raw({ type: 'report', r: { ...rep('R-001'), state: 'offline' } }))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/"report".*r\.battery/);

    expect(parse(raw({ type: 'heartbeat' }))).toBeNull(); // another type gets its own warning
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toMatch(/"heartbeat".*serverTime/);
  });

  it('ignores unknown types and non-objects without warning', async () => {
    const parse = await parser();
    for (const f of [raw({ type: 'future-thing', x: 1 }), raw({ type: 42 }), raw({}), 'null', '5', '"hello"', '[]']) expect(parse(f)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps invalid frames out of the store, and the next valid one still applies', async () => {
    const { fleet } = await boot();
    const s = last();
    s.onmessage?.({ data: raw({ ...hello(), robots: 'R-001' }) });
    expect(fleet.get().ready).toBe(false);
    s.send(hello());
    expect(fleet.get().ready).toBe(true);

    s.onmessage?.({ data: raw({ type: 'report', r: { ...rep('R-001', { t: T + 1000 }), battery: null } }) });
    s.onmessage?.({ data: raw({ type: 'event', e: { id: 'R-001', t: T, kind: 'warn', text: 'no eventId' } }) });
    s.onmessage?.({ data: raw({ type: 'ingest', ingest: { state: 'stopped', frozenAt: null } }) });
    await vi.advanceTimersByTimeAsync(250);
    expect(fleet.get().robots['R-001'].report!.battery).toBe(80);
    expect(fleet.get().liveEvents).toEqual([]);
    expect(fleet.get().ingest.state).toBe('live');
  });
});

describe('reconnect', () => {
  it('backs off 1, 2, 5, then 10 s, keeping the data and marking it lost', async () => {
    const { fleet } = await boot();
    last().send(hello());
    last().send({ type: 'report', r: rep('R-001', { t: T + 100, battery: 50 }) });
    last().onclose?.();
    expect(fleet.get().connection).toBe('lost');
    expect(fleet.get().robots['R-001'].report!.battery).toBe(50); // pending reports are kept
    expect(fleet.get()).toMatchObject({ attempt: 1, nextRetryAt: T + 1000 });
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = FakeSocket.all.length;
      const at = fleet.get().nextRetryAt! - Date.now();
      delays.push(at);
      await vi.advanceTimersByTimeAsync(at);
      expect(FakeSocket.all.length).toBe(before + 1);
      last().onerror?.(); // fails again
    }
    expect(delays).toEqual([1000, 2000, 5000, 10000, 10000]);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    last().send(hello(Date.now()));
    expect(fleet.get()).toMatchObject({ connection: 'live', attempt: 0 });
  });

  it('drops a socket that went silent, but not before 5 s', async () => {
    const { fleet } = await boot();
    const s = last();
    s.send(hello());
    await vi.advanceTimersByTimeAsync(5000);
    expect(fleet.get().connection).toBe('live');
    s.throwOnClose = true; // closing an already dead socket must not break the reconnect
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.closed).toBe(true);
    expect(fleet.get().connection).toBe('lost');
    expect(s.onmessage).toBeNull();
  });

  it('"Retry now" reconnects at once, and does nothing while a socket is open', async () => {
    const { retryNow } = await boot();
    retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all.length).toBe(1);
    last().onclose?.();
    retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.all.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1000); // the scheduled retry was cancelled by the open socket
    expect(FakeSocket.all.length).toBe(2);
  });
});
