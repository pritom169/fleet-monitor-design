import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RobotInfo, ServerMessage } from '@fleet/shared/protocol';
import type { Telemetry } from '@fleet/shared/telemetry';
import type { AppConfig } from './config';
import type { MqttHandlers } from './transport/mqtt';
import type { HttpDeps } from './http/server';

const h = vi.hoisted(() => ({
  repo: null as unknown as ReturnType<typeof makeRepo>,
  mqtt: null as unknown as MqttHandlers,
  mqttOpts: null as unknown,
  mqttUp: false,
  mqttClose: vi.fn(async () => {}),
  http: null as unknown as HttpDeps,
  httpClose: vi.fn(async () => {}),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

function makeRepo() {
  return {
    ping: vi.fn(async () => {}),
    migrate: vi.fn(async () => ['001_init.sql']),
    maintainPartitions: vi.fn(async () => ({ created: [] as string[], dropped: [] as string[] })),
    loadRegistry: vi.fn(async () => [robot('R-001'), robot('R-002')]),
    loadState: vi.fn(async () => []),
    insertTelemetry: vi.fn(async (_rows: { robotId: string; seq: number }[]) => {}),
    insertEvents: vi.fn(async (_events: unknown[]) => {}),
    upsertStates: vi.fn(async (_states: unknown[]) => {}),
    close: vi.fn(async () => {}),
  };
}
function robot(id: string, siteKey = 'hh'): RobotInfo {
  return { id, siteKey, model: 'm', modelFull: 'm', firmware: 'f', network: 'n', registeredAt: 0, lastCharge: null };
}

vi.mock('./repo/pg', () => ({ Repo: vi.fn(function () { return h.repo; }) }));
vi.mock('./transport/mqtt', () => ({
  connectMqtt: (opts: unknown, handlers: MqttHandlers) => {
    h.mqttOpts = opts;
    h.mqtt = handlers;
    return { get connected() { return h.mqttUp; }, close: h.mqttClose };
  },
}));
vi.mock('./http/server', () => ({
  createHttpServer: (deps: HttpDeps) => {
    h.http = deps;
    return {
      server: { listen: (_p: number, _h: string, cb: () => void) => cb(), address: () => ({ port: 4321 }) },
      hello: () => ({ type: 'hello', serverTime: 0, robots: [], reports: [] }),
      close: h.httpClose,
    };
  },
}));
vi.mock('./log', async (orig) => ({ ...(await orig<typeof import('./log')>()), log: h.log }));

const { createApp } = await import('./app');
const m = await import('./metrics');

const T0 = 1_800_000_000_000;
const cfg = (o: Partial<AppConfig> = {}): AppConfig => ({
  port: 0, databaseUrl: 'postgres://x', mqttUrl: 'mqtt://x', sites: [], migrate: true, registryRefreshMs: 15_000,
  queue: { telemetryCapacity: 100, batchSize: 1000, batchWaitMs: 100 }, ...o,
});
const tel = (id: string, seq: number, extra: Partial<Telemetry> = {}): Telemetry => ({
  id, siteId: 'hh', boot: 1, seq, robotTs: Date.now(), battery: 80, x: 1, y: 2, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0, ...extra,
});
const counter = async (c: { get(): Promise<{ values: { labels: Record<string, unknown>; value: number }[] }> }, labels: Record<string, string> = {}) =>
  (await c.get()).values.find((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))?.value ?? 0;

function browser() {
  const got: ServerMessage[] = [];
  h.http.fanout.add({ send: (d) => void got.push(JSON.parse(d)), bufferedAmount: 0, terminate: () => {} }, { type: 'hello', serverTime: 0, robots: [], reports: [] });
  got.length = 0;
  return got;
}

let apps: { stop(): Promise<void> }[] = [];
async function start(o: Partial<AppConfig> = {}) {
  const app = await createApp(cfg(o));
  apps.push(app);
  return app;
}
async function live(app: Awaited<ReturnType<typeof start>>) {
  h.mqttUp = true;
  h.mqtt.link(true);
  for (let i = 0; i < 4; i++) {
    h.mqtt.telemetry(tel('R-001', 100 + i), Date.now());
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(app.domain.ingest().state).toBe('live');
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  h.repo = makeRepo();
  h.mqttUp = false;
  apps = [];
  vi.clearAllMocks();
  m.registry.resetMetrics();
});
afterEach(async () => {
  const stopped = Promise.all(apps.map((a) => a.stop()));
  await vi.advanceTimersByTimeAsync(6000);
  await stopped;
  vi.useRealTimers();
});

describe('boot', () => {
  it('waits for the database, migrates, checks partitions, and loads the registry and state', async () => {
    h.repo.ping.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    h.repo.loadState.mockResolvedValue([{ robotId: 'R-001', report: { id: 'R-001', t: T0 - 1000, battery: 50, x: 0, y: 0, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0 }, boot: 1, seq: 5, status: 'ok' }] as never);
    const p = createApp(cfg());
    await vi.advanceTimersByTimeAsync(500 + 1000);
    const app = await p;
    apps.push(app);
    expect(h.repo.ping).toHaveBeenCalledTimes(3);
    expect(h.log.warn).toHaveBeenCalledWith({ attempt: 1, err: 'ECONNREFUSED' }, 'database not reachable, retrying');
    expect(h.log.info).toHaveBeenCalledWith({ applied: ['001_init.sql'] }, 'migrations applied');
    expect(app.domain.robots.get('R-001')!.report!.battery).toBe(50);
    expect(app).toMatchObject({ port: 4321, url: 'http://localhost:4321' });
    expect(h.mqttOpts).toEqual({ url: 'mqtt://x', sites: [], tls: undefined });
  });

  it('skips migrations when told to, warns about an empty registry, and passes the site list to MQTT', async () => {
    h.repo.loadRegistry.mockResolvedValue([]);
    h.repo.migrate.mockResolvedValue([]);
    await start({ migrate: false, sites: ['hh'] });
    expect(h.repo.migrate).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalledWith(expect.stringMatching(/registry is empty/));
    expect(h.mqttOpts).toMatchObject({ sites: ['hh'] });

    await start({ migrate: true });
    expect(h.log.info).not.toHaveBeenCalledWith(expect.anything(), 'migrations applied');
  });
});

describe('ingest', () => {
  it('sends accepted telemetry to browsers, history and current state', async () => {
    const app = await start();
    await live(app);
    const got = browser();
    h.mqtt.telemetry(tel('R-002', 1, { battery: 15, robotTs: Date.now() - 200 }), Date.now());
    h.mqtt.telemetry(tel('R-002', 0), Date.now());
    h.mqtt.telemetry(tel('R-002', 1), Date.now());
    h.mqtt.telemetry(tel('R-404', 0), Date.now());
    expect(got.map((g) => g.type)).toEqual(['report', 'event']);
    expect(got[1].type === 'event' && got[1].e.text).toBe('First report');
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.repo.insertTelemetry).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ robotId: 'R-002', seq: 0 }), expect.objectContaining({ robotId: 'R-002', seq: 1 })]));
    const sent = got[1].type === 'event' ? got[1].e : null;
    expect(sent?.eventId).toEqual(expect.any(String));
    expect(h.repo.insertEvents).toHaveBeenCalledWith([expect.objectContaining({ id: 'R-002', eventId: sent?.eventId, code: 'first_report' })]);
    expect(h.repo.upsertStates).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ robotId: 'R-002', seq: 1, status: 'low' })]));
    expect(await counter(m.ingestMessages, { result: 'out_of_order' })).toBe(1);
    expect(await counter(m.ingestMessages, { result: 'duplicate' })).toBe(1);
    expect(await counter(m.ingestMessages, { result: 'unknown' })).toBe(1);
  });

  it('passes robot events on, and drops unknown ones', async () => {
    await start();
    const got = browser();
    h.mqtt.event({ id: 'R-001', robotTs: 1, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak' }, T0);
    h.mqtt.event({ id: 'R-404', robotTs: 1, kind: 'warn', code: 'wifi_weak', text: 'x' }, T0);
    expect(got).toEqual([{ type: 'event', e: { id: 'R-001', eventId: expect.any(String), t: T0, kind: 'warn', code: 'wifi_weak', text: 'Wi-Fi weak' } }]);
    expect(await counter(m.ingestMessages, { result: 'unknown' })).toBe(1);
  });

  it('logs a live last will, but not a retained one or one for an unknown robot', async () => {
    await start();
    const got = browser();
    h.mqtt.status('R-001', 'hh', 'offline', false, T0);
    h.mqtt.status('R-001', 'hh', 'offline', true, T0);
    h.mqtt.status('R-001', 'hh', 'online', false, T0);
    h.mqtt.status('R-001', 'le', 'offline', false, T0);
    expect(got).toEqual([{ type: 'event', e: { id: 'R-001', eventId: expect.any(String), t: T0, kind: 'warn', code: 'broker_disconnect', text: 'Connection to broker lost', sub: 'Unclean disconnect (last will)' } }]);
    expect(await counter(m.mqttLwt)).toBe(1);
    expect(await counter(m.ingestMessages, { result: 'accepted' })).toBe(3);
  });

  it('counts invalid messages and logs a sample of them', async () => {
    await start();
    for (let i = 0; i < 7; i++) h.mqtt.invalid('not JSON', 'fleet/hh/R-001/telemetry');
    expect(await counter(m.ingestMessages, { result: 'invalid' })).toBe(7);
    expect(h.log.warn.mock.calls.filter((c) => c[1] === 'invalid message dropped').length).toBe(5);
  });

  it('tells browsers when the broker link drops, and when ingest is live again', async () => {
    const app = await start();
    await live(app);
    const got = browser();
    h.mqttUp = false;
    h.mqtt.link(false);
    expect(got).toEqual([{ type: 'ingest', ingest: { state: 'paused', frozenAt: expect.any(Number) } }]);
    expect(await counter(m.mqttConnected)).toBe(0);
    h.mqtt.link(false);
    expect(got.length).toBe(1);
    await live(app);
    expect(got.filter((g) => g.type === 'ingest').at(-1)).toEqual({ type: 'ingest', ingest: { state: 'live', frozenAt: null } });
    expect(h.log.info).toHaveBeenCalledWith('ingest live');
  });

  it('pauses ingest when the fleet goes silent on an open link, and sends heartbeats', async () => {
    const app = await start();
    await live(app);
    const got = browser();
    await vi.advanceTimersByTimeAsync(7000);
    expect(app.domain.ingest().state).toBe('paused');
    expect(h.log.warn).toHaveBeenCalledWith({ frozenAt: expect.any(Number) }, 'no robot data for 5 s on an open broker link; ingest paused');
    expect(got.some((g) => g.type === 'ingest' && g.ingest.state === 'paused')).toBe(true);
    expect(got.filter((g) => g.type === 'heartbeat').length).toBeGreaterThanOrEqual(3);
    expect(await counter(m.robotsByStatus, { status: 'never' })).toBe(1);
  });
});

describe('persistence', () => {
  it('creates a missing partition and retries the insert once', async () => {
    const app = await start();
    await live(app);
    h.repo.insertTelemetry.mockRejectedValueOnce(Object.assign(new Error('no partition'), { code: '23514' }));
    h.repo.maintainPartitions.mockResolvedValueOnce({ created: ['telemetry_20270115'], dropped: [] });
    h.mqtt.telemetry(tel('R-001', 200), Date.now());
    await vi.advanceTimersByTimeAsync(200);
    const tries = h.repo.insertTelemetry.mock.calls.filter(([rows]) => rows.some((r) => r.seq === 200));
    expect(tries.length).toBe(2);
    expect(h.log.warn).toHaveBeenCalledWith({ created: ['telemetry_20270115'], dropped: [] }, 'insert hit a missing partition; partitions created');
  });

  it('retries failing writes with a sampled warning, drops poison batches, and reports health', async () => {
    const app = await start({ queue: { telemetryCapacity: 1, batchSize: 1000, batchWaitMs: 100 } });
    h.repo.insertTelemetry.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));
    h.repo.insertEvents.mockRejectedValueOnce(Object.assign(new Error('bad'), { code: '22P02' })).mockRejectedValueOnce(new Error('down'));
    h.repo.upsertStates.mockRejectedValueOnce(new Error('down'));
    await live(app);
    h.mqtt.telemetry(tel('R-002', 0), Date.now());
    h.mqtt.telemetry(tel('R-002', 1), Date.now());
    await vi.advanceTimersByTimeAsync(500);
    expect(h.http.dbOk()).toBe(false);
    expect(h.http.ready()).toEqual({ ok: false, checks: { database: false, broker: true, state: true } });
    expect(await counter(m.ingestDropped, { queue: 'telemetry' })).toBeGreaterThanOrEqual(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ queue: 'telemetry', err: '08006 connection lost' }), 'database write failed, retrying');
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ queue: 'events', dropped: 1, err: '22P02 bad' }), 'rows rejected by the database; dropped');

    h.repo.insertTelemetry.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.http.dbOk()).toBe(true);
    expect(h.http.ready().ok).toBe(true);
  });

  it('watches database health and runs partition maintenance after an outage and every hour', async () => {
    await start();
    h.repo.ping.mockRejectedValue(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.log.warn.mock.calls.filter((c) => c[1] === 'database not reachable; live view continues, history paused').length).toBe(1);
    expect(h.http.ready().checks.database).toBe(false);

    h.repo.ping.mockResolvedValue(undefined);
    h.repo.maintainPartitions.mockResolvedValueOnce({ created: [], dropped: ['telemetry_20270101'] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.log.info).toHaveBeenCalledWith('database reachable again');
    expect(h.log.info).toHaveBeenCalledWith({ created: [], dropped: ['telemetry_20270101'] }, 'partitions maintained');

    h.repo.maintainPartitions.mockRejectedValueOnce(new Error('locked'));
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(h.log.error).toHaveBeenCalledWith({ err: 'locked' }, 'partition maintenance failed');
  });
});

describe('registry refresh', () => {
  it('sends browsers a fresh snapshot only when the registry changed', async () => {
    const app = await start({ registryRefreshMs: 1000 });
    const got = browser();
    await vi.advanceTimersByTimeAsync(1000);
    expect(got.filter((g) => g.type === 'hello')).toEqual([]);
    h.repo.loadRegistry.mockResolvedValue([robot('R-001'), robot('R-003')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.log.info).toHaveBeenCalledWith({ added: 1, removed: 1, changed: 0 }, 'registry changed');
    expect(got.filter((g) => g.type === 'hello').length).toBe(1);
    expect([...app.domain.robots.keys()]).toEqual(['R-001', 'R-003']);
    h.repo.loadRegistry.mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(1000);
  });
});

describe('shutdown', () => {
  it('stops once, closing the broker, HTTP, the queues and the pool, even if the broker close fails', async () => {
    const app = await start();
    h.mqttClose.mockRejectedValueOnce(new Error('already closed'));
    h.repo.close.mockRejectedValueOnce(new Error('already ended'));
    const a = app.stop();
    expect(app.stop()).toBe(a);
    await a;
    expect(h.httpClose).toHaveBeenCalledTimes(1);
    expect(h.repo.close).toHaveBeenCalledTimes(1);
    expect(h.log.info).toHaveBeenCalledWith({ dbOk: true }, 'stopped');
  });

  it('does not wait more than 5 s for a hung database', async () => {
    const app = await start();
    await live(app);
    h.repo.insertTelemetry.mockImplementation(() => new Promise(() => {}));
    h.mqtt.telemetry(tel('R-002', 0), Date.now());
    await vi.advanceTimersByTimeAsync(200);
    const done = app.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(h.repo.close).toHaveBeenCalled();
  });
});
