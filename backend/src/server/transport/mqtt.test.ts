import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Telemetry } from '@fleet/shared/telemetry';

/** A stand-in for mqtt.js: the test emits broker events and decides how subscribe answers. */
class FakeClient extends EventEmitter {
  subscribeError: Error | null = null;
  subscribed: Record<string, unknown> | null = null;
  ended: unknown[] | null = null;
  subscribe(filters: Record<string, unknown>, cb: (err: Error | null) => void) {
    this.subscribed = filters;
    cb(this.subscribeError);
  }
  end(...args: unknown[]) {
    this.ended = args;
    const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
  }
}
const h = vi.hoisted(() => ({ client: null as unknown, url: '', opts: {} as Record<string, unknown> }));
vi.mock('mqtt', () => ({
  default: {
    connect: (url: string, opts: Record<string, unknown>) => {
      h.url = url;
      h.opts = opts;
      return h.client;
    },
  },
}));

const { connectMqtt } = await import('./mqtt');

const tel = (extra: Partial<Telemetry> = {}): Telemetry => ({
  id: 'R-001', siteId: 'hh', boot: 1, seq: 0, robotTs: 1, battery: 50, x: 1, y: 2, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0, ...extra,
});

function setup(o: Partial<Parameters<typeof connectMqtt>[0]> = {}) {
  const client = new FakeClient();
  h.client = client;
  const calls: unknown[][] = [];
  const handlers = {
    telemetry: vi.fn((...a: unknown[]) => calls.push(['telemetry', ...a])),
    event: vi.fn((...a: unknown[]) => calls.push(['event', ...a])),
    status: vi.fn((...a: unknown[]) => calls.push(['status', ...a])),
    invalid: vi.fn((...a: unknown[]) => calls.push(['invalid', ...a])),
    link: vi.fn((...a: unknown[]) => calls.push(['link', ...a])),
  };
  const conn = connectMqtt({ url: 'mqtt://broker', ...o }, handlers);
  const msg = (topic: string, payload: unknown, retain = false) =>
    client.emit('message', topic, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)), { retain });
  return { client, handlers, conn, calls, msg };
}

beforeEach(() => vi.useRealTimers());

describe('connectMqtt', () => {
  it('subscribes to every site with QoS 1 and reports the link once per change', () => {
    const { client, conn, handlers } = setup();
    expect(h.url).toBe('mqtt://broker');
    expect(h.opts).toMatchObject({ clean: true, keepalive: 10, clientId: `fleet-ingest-${process.pid}` });
    expect(h.opts.cert).toBeUndefined();
    expect(conn.connected).toBe(false);
    client.emit('connect');
    expect(client.subscribed).toEqual({ 'fleet/+/+/#': { qos: 1 } });
    expect(conn.connected).toBe(true);
    client.emit('connect'); // a reconnect while already up: no second "link up"
    client.emit('offline');
    client.emit('close');
    client.emit('error', new Error('x'));
    expect(handlers.link.mock.calls).toEqual([[true], [false]]);
  });

  it('subscribes to its own sites only, with a client certificate', () => {
    const tls = { ca: Buffer.from('ca'), cert: Buffer.from('c'), key: Buffer.from('k') };
    const { client } = setup({ sites: ['hh', 'le'], clientId: 'ingest-1', tls });
    expect(h.opts).toMatchObject({ clientId: 'ingest-1', ca: tls.ca, cert: tls.cert, key: tls.key, rejectUnauthorized: true });
    client.emit('connect');
    expect(client.subscribed).toEqual({ 'fleet/hh/#': { qos: 1 }, 'fleet/le/#': { qos: 1 } });
  });

  it('gives up the connection when the broker refuses the subscription', () => {
    const { client, conn, handlers } = setup();
    client.subscribeError = new Error('not authorized');
    client.emit('connect');
    expect(handlers.invalid).toHaveBeenCalledWith('subscribe failed: not authorized', 'fleet/+/+/#');
    expect(client.ended).toEqual([true]);
    expect(conn.connected).toBe(false);
  });

  it('passes valid telemetry, events and status on, stamped with the receive time', () => {
    vi.useFakeTimers({ now: 1234 });
    const { msg, calls } = setup();
    msg('fleet/hh/R-001/telemetry', tel());
    msg('fleet/hh/R-001/event', { id: 'R-001', robotTs: 1, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak' });
    msg('fleet/hh/R-001/event', { id: 'R-001', robotTs: 1, kind: 'info', text: 'Older firmware, no code' });
    msg('fleet/hh/R-001/status', 'offline', true);
    expect(calls).toEqual([
      ['telemetry', tel(), 1234],
      ['event', { id: 'R-001', robotTs: 1, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak' }, 1234],
      ['event', { id: 'R-001', robotTs: 1, kind: 'info', code: 'other', text: 'Older firmware, no code' }, 1234],
      ['status', 'R-001', 'hh', 'offline', true, 1234],
    ]);
  });

  it('ignores topics that are not ours, and reports every kind of bad message', () => {
    const { msg, calls, handlers } = setup();
    msg('fleet/hh/R-001/cmd', 'x');
    msg('other/topic', 'x');
    expect(calls).toEqual([]);
    msg('fleet/hh/R-001/status', 'maybe');
    msg('fleet/hh/R-001/telemetry', '{not json');
    msg('fleet/hh/R-001/telemetry', { ...tel(), battery: 101 });
    msg('fleet/hh/R-001/telemetry', tel({ id: 'R-002' }));
    msg('fleet/le/R-001/telemetry', tel());
    msg('fleet/hh/R-001/event', { id: 'R-001', robotTs: 1, kind: 'nope', text: 'x' });
    msg('fleet/hh/R-001/event', { id: 'R-002', robotTs: 1, kind: 'info', text: 'x' });
    msg('fleet/hh/R-001/event', 'null');
    expect(handlers.invalid.mock.calls.map((c) => c[0])).toEqual([
      'status payload',
      'not JSON',
      'Too big: expected number to be <=100',
      'topic does not match payload',
      'topic does not match payload',
      expect.stringMatching(/^Invalid option/),
      'topic does not match payload',
      'Invalid input: expected object, received null',
    ]);
    expect(handlers.telemetry).not.toHaveBeenCalled();
    expect(handlers.event).not.toHaveBeenCalled();
  });

  it('closes cleanly', async () => {
    const { conn, client } = setup();
    await conn.close();
    expect(client.ended?.slice(0, 2)).toEqual([false, {}]);
  });
});
