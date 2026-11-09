/**
 * Load test for the ingest server (SYSTEM_DESIGN.md §17): msg/s, p99 ingest lag, browser fan-out delay,
 * queue depth, drops, CPU and memory, per step.
 *
 *   docker compose --profile load run --rm loadtest [--steps 1000x1,5000x1,5000x4] [--duration 60] [--warmup 15]
 *
 * Each step is <robots>x<Hz>. Robots are real MQTT connections (one per robot, like the fleet), spread over
 * worker processes so the generator is not the bottleneck. They are registered as L-00001… and removed again
 * at the end. Server-side numbers come from its /metrics; fan-out delay is measured by a WebSocket client
 * (receipt time − report.t, both on the same host clock).
 *
 * Env: MQTT_URL, SERVER (http://localhost:8787), DATABASE_URL, METRICS_TOKEN, OUT_DIR (write results JSON there).
 */
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import WebSocket from 'ws';
import type { RobotInfo, ServerMessage } from '@fleet/shared/protocol';
import type { Telemetry } from '@fleet/shared/telemetry';

const SITES = ['hh', 'le', 'mu'];
const env = process.env;
const MQTT_URL = env.MQTT_URL ?? 'mqtt://localhost:1883';

// =====================================================================================================
// Worker: owns a slice of the robots, publishes telemetry, reports counts to the parent once a second.
// =====================================================================================================

interface WorkerJob { ids: string[]; hz: number; url: string }
interface WorkerTick { connected: number; published: number; errors: number }

async function worker() {
  const job = await new Promise<WorkerJob>((resolve) => process.once('message', (m) => resolve(m as WorkerJob)));
  const boot = Math.floor(Date.now() / 1000);
  const stat: WorkerTick = { connected: 0, published: 0, errors: 0 };
  const clients: MqttClient[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const period = 1000 / job.hz;

  // Connect in small batches: thousands of simultaneous TCP handshakes would measure the SYN queue.
  for (let i = 0; i < job.ids.length; i += 50) {
    await Promise.all(job.ids.slice(i, i + 50).map((id) => new Promise<void>((resolve) => {
      const k = Number(id.slice(2));
      const siteId = SITES[k % SITES.length];
      const c = mqtt.connect(job.url, { clientId: `load-${id}`, clean: true, keepalive: 30, reconnectPeriod: 2000 });
      clients.push(c);
      c.on('error', () => stat.errors++);
      c.once('connect', () => {
        stat.connected++;
        let seq = 0;
        let x = 5 + (k % 50);
        let y = 3 + (k % 20);
        const since = Date.now();
        const send = () => {
          if (!c.connected) return;
          x = Math.max(1, Math.min(63, x + (Math.random() - 0.5)));
          y = Math.max(1, Math.min(27, y + (Math.random() - 0.5)));
          const t: Telemetry = {
            id, siteId, boot, seq: seq++, robotTs: Date.now(), battery: 40 + (k % 55), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
            state: 'ok', task: `Load order #${k}`, taskKind: 'picking', since,
          };
          c.publish(`fleet/${siteId}/${id}/telemetry`, JSON.stringify(t), { qos: 0 }, (e) => (e ? stat.errors++ : stat.published++));
        };
        // Each robot reports at its own offset inside the period, like real radios.
        setTimeout(() => {
          send();
          timers.push(setInterval(send, period));
        }, Math.random() * period);
        resolve();
      });
    })));
  }
  const report = setInterval(() => process.send?.({ ...stat }), 1000);
  process.on('message', (m) => {
    if (m !== 'stop') return;
    clearInterval(report);
    timers.forEach(clearInterval);
    let open = clients.length;
    if (!open) process.exit(0);
    for (const c of clients) c.end(false, {}, () => --open === 0 && process.exit(0)); // clean: no last will
    setTimeout(() => process.exit(0), 5000);
  });
}

// =====================================================================================================
// Orchestrator
// =====================================================================================================

type Metrics = Map<string, number>;

async function scrape(server: string): Promise<Metrics> {
  const res = await fetch(`${server}/metrics`, { headers: env.METRICS_TOKEN ? { authorization: `Bearer ${env.METRICS_TOKEN}` } : {} });
  const m: Metrics = new Map();
  for (const line of (await res.text()).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.lastIndexOf(' ');
    m.set(line.slice(0, i), Number(line.slice(i + 1)));
  }
  return m;
}

const get = (m: Metrics, key: string) => m.get(key) ?? 0;
const delta = (a: Metrics, b: Metrics, key: string) => get(b, key) - get(a, key);

/** Quantile from the difference of two cumulative Prometheus histograms, interpolated inside the bucket. */
function histQuantile(a: Metrics, b: Metrics, name: string, q: number, labels = ''): number | null {
  const buckets: [number, number][] = [];
  for (const key of b.keys()) {
    const m = key.match(new RegExp(`^${name}_bucket\\{(.*)\\}$`));
    if (!m) continue;
    // prom-client puts `le` first; match the other labels wherever they are.
    const le = /le="([^"]+)"/.exec(m[1])?.[1];
    if (!le || (labels && !m[1].split(',').includes(labels))) continue;
    buckets.push([le === '+Inf' ? Infinity : Number(le), delta(a, b, key)]);
  }
  buckets.sort((x, y) => x[0] - y[0]);
  const total = buckets.at(-1)?.[1] ?? 0;
  if (!total) return null;
  const rank = q * total;
  let prevLe = 0;
  let prevCount = 0;
  for (const [le, count] of buckets) {
    if (count >= rank) {
      if (le === Infinity) return prevLe;
      const inBucket = count - prevCount;
      return prevLe + (le - prevLe) * (inBucket ? (rank - prevCount) / inBucket : 0);
    }
    prevLe = le;
    prevCount = count;
  }
  return prevLe;
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

interface StepResult {
  robots: number;
  hz: number;
  target: number;
  published: number;
  accepted: number;
  ingestLagP50Ms: number | null;
  ingestLagP99Ms: number | null;
  fanoutP50Ms: number | null;
  fanoutP99Ms: number | null;
  wsReportsPerS: number;
  queueMax: number;
  dropped: number;
  dbBatchP99Ms: number | null;
  serverCpuPct: number;
  serverRssMb: number;
  eventLoopP99Ms: number;
  series: { t: number; accepted: number; queue: number; dropped: number }[];
}

async function runStep(o: { robots: number; hz: number; warmup: number; duration: number; server: string; workers: number }): Promise<StepResult> {
  const ids = Array.from({ length: o.robots }, (_, i) => `L-${String(i + 1).padStart(5, '0')}`);
  const n = Math.min(o.workers, Math.max(1, Math.ceil(o.robots / 500)));
  const kids: ChildProcess[] = [];
  const ticks: WorkerTick[] = Array.from({ length: n }, () => ({ connected: 0, published: 0, errors: 0 }));
  for (let w = 0; w < n; w++) {
    const k = fork(process.argv[1], ['--worker'], { stdio: 'inherit' });
    k.on('message', (m) => (ticks[w] = m as WorkerTick));
    k.send({ ids: ids.filter((_, i) => i % n === w), hz: o.hz, url: MQTT_URL } satisfies WorkerJob);
    kids.push(k);
  }
  const sum = () => ticks.reduce((s, t) => ({ connected: s.connected + t.connected, published: s.published + t.published, errors: s.errors + t.errors }), { connected: 0, published: 0, errors: 0 });

  const t0 = Date.now();
  while (sum().connected < o.robots && Date.now() - t0 < 120_000) await sleep(500);
  log(`  ${sum().connected}/${o.robots} connected in ${((Date.now() - t0) / 1000).toFixed(1)} s over ${n} workers; warming up ${o.warmup} s`);
  await sleep(o.warmup * 1000);

  // Browser probe.
  const delays: number[] = [];
  let wsReports = 0;
  const ws = new WebSocket(`${o.server.replace(/^http/, 'ws')}/ws`);
  ws.on('message', (d) => {
    const now = Date.now();
    const m = JSON.parse(String(d)) as ServerMessage;
    if (m.type === 'report' && m.r.id.startsWith('L-')) {
      wsReports++;
      delays.push(now - m.r.t);
    }
  });
  await new Promise((r) => ws.once('open', r));

  const a = await scrape(o.server);
  const pubA = sum().published;
  const series: StepResult['series'] = [];
  let queueMax = 0;
  let rssMax = 0;
  let loopMax = 0;
  let prev = a;
  const end = Date.now() + o.duration * 1000;
  while (Date.now() < end) {
    await sleep(2000);
    const m = await scrape(o.server);
    const accepted = (delta(prev, m, 'ingest_messages_total{result="accepted"}')) / 2;
    const queue = get(m, 'ingest_queue_depth{queue="telemetry"}');
    queueMax = Math.max(queueMax, queue);
    rssMax = Math.max(rssMax, get(m, 'process_resident_memory_bytes'));
    loopMax = Math.max(loopMax, get(m, 'nodejs_eventloop_lag_p99_seconds'));
    series.push({ t: Math.round((Date.now() - (end - o.duration * 1000)) / 1000), accepted: Math.round(accepted), queue, dropped: get(m, 'ingest_dropped_total{queue="telemetry"}') - get(a, 'ingest_dropped_total{queue="telemetry"}') });
    prev = m;
  }
  const b = await scrape(o.server);
  const pubB = sum().published;
  ws.close();
  for (const k of kids) k.send('stop');
  await Promise.all(kids.map((k) => new Promise((r) => k.once('exit', r))));

  const secs = o.duration;
  const ms = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10);
  return {
    robots: o.robots,
    hz: o.hz,
    target: o.robots * o.hz,
    published: Math.round((pubB - pubA) / secs),
    accepted: Math.round(delta(a, b, 'ingest_messages_total{result="accepted"}') / secs),
    ingestLagP50Ms: ms(histQuantile(a, b, 'ingest_lag_seconds', 0.5)),
    ingestLagP99Ms: ms(histQuantile(a, b, 'ingest_lag_seconds', 0.99)),
    fanoutP50Ms: pct(delays, 0.5),
    fanoutP99Ms: pct(delays, 0.99),
    wsReportsPerS: Math.round(wsReports / secs),
    queueMax,
    dropped: delta(a, b, 'ingest_dropped_total{queue="telemetry"}'),
    dbBatchP99Ms: ms(histQuantile(a, b, 'db_batch_write_seconds', 0.99, 'queue="telemetry"')),
    serverCpuPct: Math.round((delta(a, b, 'process_cpu_seconds_total') / secs) * 100),
    serverRssMb: Math.round(rssMax / 1e6),
    eventLoopP99Ms: Math.round(loopMax * 10000) / 10,
    series,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(`[load] ${s}`);

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, def: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const steps = arg('steps', '1000x1,2000x1,5000x1').split(',').map((s) => s.split('x').map(Number) as [number, number]);
  const duration = Number(arg('duration', '60'));
  const warmup = Number(arg('warmup', '15'));
  const workers = Number(arg('workers', String(Math.max(1, os.cpus().length - 2))));
  const server = env.SERVER ?? 'http://localhost:8787';
  const max = Math.max(...steps.map((s) => s[0]));

  const { Repo } = await import('../server/repo/pg');
  const repo = new Repo(env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/fleet');
  const health = async () => ((await (await fetch(`${server}/api/health`)).json()) as { robots: number }).robots;
  const base = await health();
  const fleet: RobotInfo[] = Array.from({ length: max }, (_, i) => ({
    id: `L-${String(i + 1).padStart(5, '0')}`, siteKey: SITES[(i + 1) % SITES.length], model: 'Load robot', modelFull: 'Load robot LR-1',
    firmware: '0.0.0', network: 'load', registeredAt: Date.now(), lastCharge: null,
  }));
  await repo.upsertRegistry(fleet);
  log(`registered ${max} load robots; waiting for the server's registry refresh`);
  const t0 = Date.now();
  while ((await health()) < base + max) {
    if (Date.now() - t0 > 90_000) throw new Error('the server did not pick up the load robots');
    await sleep(1000);
  }

  const results: StepResult[] = [];
  try {
    for (const [robots, hz] of steps) {
      log(`step ${robots} robots × ${hz} Hz = ${robots * hz} msg/s, ${duration} s`);
      const r = await runStep({ robots, hz, warmup, duration, server, workers });
      results.push(r);
      log(`  published ${r.published}/s, accepted ${r.accepted}/s, ingest lag p99 ${r.ingestLagP99Ms} ms, fan-out p99 ${r.fanoutP99Ms} ms, queue max ${r.queueMax}, dropped ${r.dropped}, CPU ${r.serverCpuPct}%`);
      await sleep(12_000); // let the stopped robots go offline before the next step
    }
  } finally {
    // Remove the load robots from the registry again (state first: robot_state references robots).
    await repo.pool.query(`DELETE FROM robot_state WHERE robot_id LIKE 'L-%'`);
    await repo.pool.query(`DELETE FROM robots WHERE id LIKE 'L-%'`);
    const size = (await repo.pool.query(`
      SELECT sum(pg_total_relation_size(c.oid))::bigint AS bytes, (SELECT count(*) FROM telemetry) AS rows
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'telemetry'`)).rows[0];
    await repo.close();
    const perRow = Number(size.rows) ? Math.round(Number(size.bytes) / Number(size.rows)) : null;
    log(`telemetry: ${size.rows} rows, ${(Number(size.bytes) / 1e6).toFixed(1)} MB with indexes, ${perRow} B/row`);
    const out = { at: new Date().toISOString(), host: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 1e9) }, steps: results, storage: { rows: Number(size.rows), bytes: Number(size.bytes), bytesPerRow: perRow } };
    if (env.OUT_DIR) {
      fs.mkdirSync(env.OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(env.OUT_DIR, `load-${Date.now()}.json`), JSON.stringify(out, null, 2));
    }
    console.log('\n| Robots × Hz | Target msg/s | Published/s | Accepted/s | Ingest lag p50 / p99 | Fan-out p50 / p99 | Queue max | Dropped | DB batch p99 | Server CPU | RSS | Event-loop p99 |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.robots} × ${r.hz} | ${r.target} | ${r.published} | ${r.accepted} | ${r.ingestLagP50Ms} / ${r.ingestLagP99Ms} ms | ${r.fanoutP50Ms} / ${r.fanoutP99Ms} ms | ${r.queueMax} | ${r.dropped} | ${r.dbBatchP99Ms} ms | ${r.serverCpuPct} % | ${r.serverRssMb} MB | ${r.eventLoopP99Ms} ms |`);
    }
  }
}

if (process.argv.includes('--worker')) void worker();
else main().catch((err) => {
  console.error(err);
  process.exit(1);
});
