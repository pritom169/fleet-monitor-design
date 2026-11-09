/**
 * Ingest + API server (SYSTEM_DESIGN.md Part B), as a function so tests can start and stop it.
 *
 *   MQTT → validate → registry → dedupe → order → current state + status + events → browsers
 *                                                                               ↘ persistence queue → Postgres
 *
 * Current state is updated before the persistence queue: a slow database can create gaps in history,
 * never a wrong live view.
 */
import { randomUUID } from 'node:crypto';
import type { RobotEvent } from '@fleet/shared/protocol';
import type { AppConfig } from './config';
import { FleetDomain, type NewEvent, type StoredState, type TelemetryRow } from './domain/fleet';
import { Fanout } from './http/fanout';
import { createHttpServer } from './http/server';
import { errText, log, sampled } from './log';
import * as m from './metrics';
import { BatchWriter } from './persist/batchWriter';
import { Repo } from './repo/pg';
import { connectMqtt } from './transport/mqtt';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface App {
  /** The port actually listened on (useful with port 0). */
  port: number;
  url: string;
  domain: FleetDomain;
  repo: Repo;
  stop(): Promise<void>;
}

async function boot(config: AppConfig) {
  const repo = new Repo(config.databaseUrl);

  // The registry and the last state must be loaded before we accept telemetry. Wait for the database.
  for (let attempt = 1; ; attempt++) {
    try {
      await repo.ping();
      break;
    } catch (err) {
      log.warn({ attempt, err: (err as Error).message }, 'database not reachable, retrying');
      await sleep(Math.min(5000, 250 * 2 ** attempt));
    }
  }
  if (config.migrate) {
    const applied = await repo.migrate();
    if (applied.length) log.info({ applied }, 'migrations applied');
  }
  const parts = await repo.maintainPartitions();
  log.info(parts, 'partitions checked');

  const registry = await repo.loadRegistry();
  const domain = new FleetDomain(registry);
  domain.load(await repo.loadState());
  log.info({ robots: registry.length, withState: [...domain.robots.values()].filter((r) => r.report).length }, 'state loaded');
  if (!registry.length) log.warn('the registry is empty: every message will be dropped as unknown. Run `npm run seed`.');

  return { repo, domain };
}

export async function createApp(config: AppConfig): Promise<App> {
  const { repo, domain } = await boot(config);
  const fanout = new Fanout();
  let dbOk = true;
  let lastDbCheck = true;

  // ---------- persistence ----------
  // A failing database retries every few seconds; log about once a minute per queue, with a count.
  const warnSample = sampled(60_000, 1);
  /** SQLSTATE classes that a retry cannot fix: cardinality, data, integrity, syntax/undefined object. */
  const isFatal = (err: unknown) => /^(21|22|23|42)/.test(String((err as { code?: string }).code ?? ''));
  const onFatal = (queue: string) => (err: unknown, n: number) => log.error({ queue, dropped: n, err: errText(err) }, 'batch rejected by the database; dropped');
  function warnDb(queue: string, err: unknown, attempt: number) {
    warnSample(`db:${queue}`, (skipped) => log.warn({ queue, attempt, skipped, err: errText(err) }, 'database write failed, retrying'));
  }

  const telemetryQ = new BatchWriter<TelemetryRow>({
    name: 'telemetry',
    capacity: config.queue.telemetryCapacity,
    maxBatch: config.queue.batchSize,
    maxWaitMs: config.queue.batchWaitMs,
    write: (b) => withPartitions(() => repo.insertTelemetry(b)),
    onDrop: (n) => m.ingestDropped.inc({ queue: 'telemetry' }, n),
    onWritten: (_n, s) => m.dbBatchWrite.observe({ queue: 'telemetry' }, s),
    onError: (err, attempt) => warnDb('telemetry', err, attempt),
    isFatal,
    onFatal: onFatal('telemetry'),
  });
  const eventsQ = new BatchWriter<RobotEvent>({
    name: 'events',
    capacity: 10_000,
    maxBatch: 500,
    maxWaitMs: 0, // events are inserted immediately
    write: (b) => repo.insertEvents(b),
    onDrop: (n) => m.ingestDropped.inc({ queue: 'events' }, n),
    onWritten: (_n, s) => m.dbBatchWrite.observe({ queue: 'events' }, s),
    onError: (err, attempt) => warnDb('events', err, attempt),
    isFatal,
    onFatal: onFatal('events'),
  });
  const stateQ = new BatchWriter<StoredState>({
    name: 'state',
    capacity: 20_000,
    maxBatch: 2000,
    maxWaitMs: 0,
    write: (b) => repo.upsertStates(b),
    onWritten: (_n, s) => m.dbBatchWrite.observe({ queue: 'state' }, s),
    onError: (err, attempt) => warnDb('state', err, attempt),
    isFatal,
    onFatal: onFatal('state'),
  });
  /**
   * A row for a day with no partition fails with 23514. That happens when the hourly job could not run
   * (database down at midnight). Create the partitions and try once more, so one missing day cannot
   * block the queue until the next hourly run.
   */
  async function withPartitions(write: () => Promise<void>) {
    try {
      await write();
    } catch (err) {
      if ((err as { code?: string }).code !== '23514') throw err;
      const r = await repo.maintainPartitions();
      log.warn(r, 'insert hit a missing partition; partitions created');
      await write();
    }
  }
  const maintain = () =>
    repo.maintainPartitions().then(
      (r) => (r.created.length || r.dropped.length) && log.info(r, 'partitions maintained'),
      (err) => log.error({ err: errText(err) }, 'partition maintenance failed'),
    );

  /** robot_state is upserted at most once per second per robot (§12). */
  const dirty = new Set<string>();

  /** Stamp the ID here, once, so the copy browsers get live and the copy they later fetch from history match. */
  const emit = (events: NewEvent[]) => {
    for (const n of events) {
      const e: RobotEvent = { ...n, eventId: randomUUID() };
      fanout.broadcast({ type: 'event', e });
      eventsQ.push(e);
    }
  };

  // ---------- ingest ----------
  const invalidSample = sampled();
  const mqtt = connectMqtt(
    { url: config.mqttUrl, sites: config.sites, tls: config.mqttTls },
    {
      telemetry(t, receivedAt) {
        const a = domain.accept(t, receivedAt);
        m.ingestMessages.inc({ result: a.result });
        if (a.result === 'accepted' || a.result === 'out_of_order') m.ingestLag.observe(Math.max(0, receivedAt - t.robotTs) / 1000);
        if (a.report) {
          fanout.report(a.report);
          dirty.add(t.id);
        }
        emit(a.events);
        if (a.row) telemetryQ.push(a.row);
      },
      event(e, receivedAt) {
        const ev = domain.robotEvent(e, receivedAt);
        m.ingestMessages.inc({ result: ev ? 'accepted' : 'unknown' });
        if (ev) emit([ev]);
      },
      status(robotId, siteId, s, retained, receivedAt) {
        domain.heard(receivedAt);
        if (!domain.isKnown(robotId, siteId)) return void m.ingestMessages.inc({ result: 'unknown' });
        m.ingestMessages.inc({ result: 'accepted' });
        // The LWT is a hint, not proof: the 10 s rule stays the source of truth. A live (not retained)
        // LWT goes into the event log, because it explains *why* a robot went quiet.
        if (s === 'offline' && !retained) {
          m.mqttLwt.inc();
          emit([{ id: robotId, t: receivedAt, kind: 'warn', code: 'broker_disconnect', text: 'Connection to broker lost', sub: 'Unclean disconnect (last will)' }]);
        }
      },
      invalid(reason, topic) {
        m.ingestMessages.inc({ result: 'invalid' });
        invalidSample(`invalid:${reason}`, (skipped) => log.warn({ topic, reason, skipped }, 'invalid message dropped'));
      },
      link(up) {
        m.mqttConnected.set(up ? 1 : 0);
        log.info({ up }, up ? 'broker connected' : 'broker link lost, ingest paused');
        if (domain.setLink(up, Date.now())) fanout.broadcast({ type: 'ingest', ingest: domain.ingest() });
      },
    },
  );

  // ---------- the 1 s ticker ----------
  const tick = () => {
    const now = Date.now();
    if (domain.poll(now)) {
      const ingest = domain.ingest();
      if (ingest.state === 'live') log.info('ingest live');
      else log.warn({ frozenAt: ingest.frozenAt }, 'no robot data for 5 s on an open broker link; ingest paused');
      fanout.broadcast({ type: 'ingest', ingest });
    }
    const events = domain.tick(now);
    for (const e of events) dirty.add(e.id);
    emit(events);
    for (const id of dirty) {
      const row = domain.stateRow(id);
      if (row) stateQ.push(row);
    }
    dirty.clear();
    for (const [status, n] of Object.entries(domain.counts())) m.robotsByStatus.set({ status }, n);
    m.ingestQueueDepth.set({ queue: 'telemetry' }, telemetryQ.depth);
    m.ingestQueueDepth.set({ queue: 'events' }, eventsQ.depth);
    if (now % 2000 < 1000) fanout.broadcast({ type: 'heartbeat', serverTime: now });
  };
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const align = setTimeout(() => {
    tick();
    tickTimer = setInterval(tick, 1000);
  }, 1000 - (Date.now() % 1000));
  const flushTimer = setInterval(() => fanout.flush(), 250);

  // ---------- database health and partitions ----------
  const dbTimer = setInterval(() => {
    repo.ping().then(
      () => {
        if (!lastDbCheck) {
          log.info('database reachable again');
          void maintain(); // the hourly job may have failed while it was down
        }
        lastDbCheck = true;
      },
      (err) => {
        if (lastDbCheck) log.warn({ err: errText(err) }, 'database not reachable; live view continues, history paused');
        lastDbCheck = false;
      },
    );
  }, 5000);
  const partTimer = setInterval(() => void maintain(), 3600_000);

  // ---------- registry refresh ----------
  // Robots provisioned (or retired) while the server runs appear without a restart. Browsers get a fresh snapshot.
  const regTimer = setInterval(() => {
    repo.loadRegistry().then(
      (list) => {
        const r = domain.register(list);
        if (!r.added.length && !r.removed.length && !r.changed.length) return;
        log.info({ added: r.added.length, removed: r.removed.length, changed: r.changed.length }, 'registry changed');
        fanout.resync(http.hello());
      },
      () => {}, // the database check reports this
    );
  }, config.registryRefreshMs);
  const isDbOk = () => (dbOk = lastDbCheck && telemetryQ.ok && eventsQ.ok && stateQ.ok);

  // ---------- HTTP ----------
  const http = createHttpServer({
    domain,
    repo,
    fanout,
    log,
    staticDir: config.staticDir,
    https: config.https,
    metricsToken: config.metricsToken,
    dbOk: isDbOk,
    ready: () => {
      const checks = { database: isDbOk(), broker: mqtt.connected, state: true };
      return { ok: Object.values(checks).every(Boolean), checks };
    },
  });
  await new Promise<void>((resolve) => http.server.listen(config.port, config.host, resolve));
  const addr = http.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `${config.https ? 'https' : 'http'}://localhost:${port}`;
  log.info({ url, mqtt: config.mqttUrl, tls: { http: !!config.https, mqtt: !!config.mqttTls }, sites: config.sites.length ? config.sites : 'all' }, 'fleet ingest server listening');

  // ---------- shutdown ----------
  let stopping: Promise<void> | null = null;
  const stop = () => (stopping ??= (async () => {
    log.info('shutting down');
    clearTimeout(align);
    clearInterval(regTimer);
    clearInterval(tickTimer);
    clearInterval(flushTimer);
    clearInterval(dbTimer);
    clearInterval(partTimer);
    await mqtt.close().catch(() => {});
    await http.close();
    const flushed = Promise.all([telemetryQ.close(), eventsQ.close(), stateQ.close()]);
    await Promise.race([flushed, sleep(5000)]);
    await repo.close().catch(() => {});
    log.info({ dbOk }, 'stopped');
  })());

  return { port, url, domain, repo, stop };
}
