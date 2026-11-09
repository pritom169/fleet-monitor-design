/**
 * The ingest pipeline against real Postgres 16 and Mosquitto 2 (SYSTEM_DESIGN.md §17, integration).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';
import type { Report } from '@fleet/shared/protocol';
import { createApp, type App } from './app';
import { Repo, partitionName } from './repo/pg';
import {
  connect, openSocket, pause, publishTel, request, robot, sleep, startMosquitto, startPostgres, tel, testConfig, unpause, until,
} from '../test/harness';

let pg: StartedPostgreSqlContainer;
let mq: { c: StartedTestContainer; url: string };
let repo: Repo;
let app: App;
const clients: MqttClient[] = [];

const count = async (sql: string, args: unknown[] = []) => Number((await repo.pool.query(sql, args)).rows[0].n);

/** One robot keeps reporting in the background, so the fleet is never silent (stall watchdog, §12). */
let heartbeat: ReturnType<typeof setInterval> | undefined;

beforeAll(async () => {
  [pg, mq] = await Promise.all([startPostgres(), startMosquitto()]);
  repo = new Repo(pg.getConnectionUri());
  await repo.migrate();
  await repo.upsertRegistry([robot('R-001', 'hh'), robot('R-002', 'hh'), robot('R-003', 'le'), robot('R-009', 'hh')]);
  app = await createApp(testConfig({ databaseUrl: pg.getConnectionUri(), mqttUrl: mq.url }));
  await until(async () => (await request(`${app.url}/readyz`)).status === 200, 20_000);

  const bg = await connect(mq.url, { clientId: 'robot-R-009' });
  clients.push(bg);
  let seq = 0;
  heartbeat = setInterval(() => void publishTel(bg, tel('R-009', 'hh', seq++)), 500);
  await until(() => app.domain.ingest().state === 'live', 10_000);
});

afterAll(async () => {
  clearInterval(heartbeat);
  for (const c of clients) c.end(true);
  await app?.stop();
  await repo?.close();
  await Promise.all([pg?.stop(), mq?.c.stop()]);
});

describe('ingest pipeline', () => {
  it('delivers a published sample to the browser within 1 s and stores it (G1)', async () => {
    const sock = await openSocket(`${app.url.replace('http', 'ws')}/ws`);
    const hello = await sock.next((m) => m.type === 'hello');
    expect(hello.type === 'hello' && hello.robots.map((r) => r.id).sort()).toEqual(['R-001', 'R-002', 'R-003', 'R-009']);

    const c = await connect(mq.url);
    clients.push(c);
    const sent = Date.now();
    await publishTel(c, tel('R-001', 'hh', 0, { battery: 77, robotTs: sent - 1500 }));
    const m = await sock.next((m) => m.type === 'report' && m.r.id === 'R-001');
    expect(m.at - sent).toBeLessThan(1000);
    const r = (m as { r: Report }).r;
    expect(r.battery).toBe(77);
    expect(r.t).toBeGreaterThanOrEqual(sent); // server time, not the robot's
    expect(r.skew).toBeGreaterThanOrEqual(1500); // robot clock 1.5 s behind (plus transit)
    sock.close();

    await until(() => count(`SELECT count(*) n FROM telemetry WHERE robot_id = 'R-001' AND seq = 0`), 3000);
    const row = (await repo.pool.query(`SELECT received_at, robot_ts FROM telemetry WHERE robot_id = 'R-001' AND seq = 0`)).rows[0];
    expect(row.received_at.getTime() - row.robot_ts.getTime()).toBeGreaterThanOrEqual(1500);
    await until(() => count(`SELECT count(*) n FROM robot_state WHERE robot_id = 'R-001'`), 3000);
  });

  it('drops duplicates, and keeps late samples out of the live view but in history', async () => {
    const c = await connect(mq.url);
    clients.push(c);
    await publishTel(c, tel('R-002', 'hh', 5, { battery: 60 }));
    await publishTel(c, tel('R-002', 'hh', 7, { battery: 58 }));
    await publishTel(c, tel('R-002', 'hh', 7, { battery: 58 })); // duplicate
    await publishTel(c, tel('R-002', 'hh', 6, { battery: 59 })); // late
    await until(() => app.domain.robots.get('R-002')?.report?.battery === 58);
    await sleep(300);
    expect(app.domain.robots.get('R-002')!.report!.battery).toBe(58);
    await until(async () => (await count(`SELECT count(*) n FROM telemetry WHERE robot_id = 'R-002'`)) === 3, 3000);
    const seqs = (await repo.pool.query(`SELECT seq FROM telemetry WHERE robot_id = 'R-002' ORDER BY seq`)).rows.map((r) => Number(r.seq));
    expect(seqs).toEqual([5, 6, 7]);
  });

  it('logs the last will and marks the robot offline by the 10 s rule', async () => {
    const c = await connect(mq.url, {
      clientId: 'robot-R-003',
      keepalive: 2, // the broker publishes the will after 1.5 × keepalive
      will: { topic: 'fleet/le/R-003/status', payload: Buffer.from('offline'), qos: 1, retain: true },
    });
    await publishTel(c, tel('R-003', 'le', 0));
    await until(() => app.domain.robots.get('R-003')?.status === 'ok');
    c.stream.destroy(); // pull the plug: no DISCONNECT
    await until(() => count(`SELECT count(*) n FROM robot_events WHERE robot_id = 'R-003' AND text = 'Connection to broker lost'`), 15_000, 250);
    expect(app.domain.robots.get('R-003')!.status).toBe('ok'); // the will is a hint, not proof
    await until(() => app.domain.robots.get('R-003')?.status === 'offline', 15_000, 250);
    await until(() => count(`SELECT count(*) n FROM robot_events WHERE robot_id = 'R-003' AND text = 'Went offline'`), 3000);
  });

  it('creates partitions ahead and drops them after the retention', async () => {
    const day = 86_400_000;
    const old = Date.now() - 10 * day;
    const made = await repo.maintainPartitions(old, 0);
    expect(made.created).toEqual([partitionName(new Date(Math.floor(old / day) * day))]);
    const r = await repo.maintainPartitions(Date.now());
    expect(r.dropped).toContain(made.created[0]);
    const names = (await repo.pool.query(`SELECT c.relname n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'telemetry'`)).rows.map((x) => x.n);
    expect(names).not.toContain(made.created[0]);
    expect(names).toContain(partitionName(new Date(Date.now() + 2 * day)));
  });

  it('downsamples history to at most 500 points, keeps the last position per bucket, and keeps gaps', async () => {
    const day = 86_400_000;
    const to = Math.floor(Date.now() / 1000) * 1000;
    const from = to - 2 * day;
    await repo.maintainPartitions(from, 3);
    const gapFrom = from + day;
    const gapTo = gapFrom + 2 * 3600_000;
    const rows = [];
    for (let t = from, i = 0; t < to; t += 30_000, i++) {
      if (t >= gapFrom && t < gapTo) continue;
      rows.push({ robotId: 'R-001', boot: 9, seq: i, receivedAt: t, robotTs: t, battery: 50 + (i % 10), x: i, y: 1, state: 'ok', fault: null, task: 'Idle' });
    }
    for (let k = 0; k < rows.length; k += 2000) await repo.insertTelemetry(rows.slice(k, k + 2000));

    const res = await request(`${app.url}/api/robots/R-001/telemetry?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const body = res.json<{ bucketMs: number; points: { t: number; x: number; batteryMin: number }[] }>();
    expect(body.points.length).toBeLessThanOrEqual(500);
    expect(body.points.length).toBeGreaterThan(400);
    // Last value per bucket: x grows with time, so the bucket's x is the largest index inside it.
    const p = body.points[10];
    const inBucket = rows.filter((r) => r.receivedAt >= p.t && r.receivedAt < p.t + body.bucketMs);
    expect(p.x).toBe(inBucket[inBucket.length - 1].x);
    expect(p.batteryMin).toBe(Math.min(...inBucket.map((r) => r.battery)));
    // Gaps stay gaps: no point is invented inside the two missing hours.
    expect(body.points.filter((q) => q.t >= gapFrom + body.bucketMs && q.t < gapTo - body.bucketMs)).toEqual([]);

    expect((await request(`${app.url}/api/robots/R-001/telemetry?from=${to - 8 * day}&to=${to}`)).status).toBe(400);
    const nf = await request(`${app.url}/api/robots/R-404/history`);
    expect(nf.status).toBe(404);
    expect(nf.headers['content-type']).toBe('application/problem+json');
  });

  it('paginates events with a cursor, newest first, without repeats', async () => {
    const t0 = Date.now() - 3600_000;
    await repo.insertEvents(Array.from({ length: 250 }, (_, i) => ({ id: 'R-009', eventId: `page-${i}`, t: t0 + i * 1000, kind: 'info' as const, code: 'other' as const, text: `e${i}` })));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      // Bounded window: R-009 also has the server's own events (its first report) from this test run.
      const q: string = `${app.url}/api/robots/R-009/events?from=${t0}&to=${t0 + 250_000}${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await request(q)).json<{ events: { text: string; t: number }[]; next: string | null }>();
      seen.push(...page.events.map((e) => e.text));
      cursor = page.next;
    } while (cursor);
    expect(seen.length).toBe(250);
    expect(new Set(seen).size).toBe(250);
    expect(seen[0]).toBe('e249');
    expect(seen[249]).toBe('e0');
  });

  it('sends browsers a fresh snapshot when the registry changes, without a restart', async () => {
    const sock = await openSocket(`${app.url.replace('http', 'ws')}/ws`);
    await sock.next((m) => m.type === 'hello');
    await repo.upsertRegistry([robot('R-004', 'mu')]);
    const again = await sock.next((m) => m.type === 'hello' && m.robots.some((r) => r.id === 'R-004'), 5000);
    expect(again.type).toBe('hello');
    sock.close();
  });

  it('survives a hung database: live view continues, readiness turns red, nothing queued is lost', async () => {
    const c = await connect(mq.url);
    clients.push(c);
    const sock = await openSocket(`${app.url.replace('http', 'ws')}/ws`);
    await sock.next((m) => m.type === 'hello');
    pause(pg);
    try {
      for (let i = 100; i < 110; i++) {
        await publishTel(c, tel('R-001', 'hh', 1000 + i, { boot: 10, battery: i - 60 }));
        await sleep(100);
      }
      // The live view does not wait for the database.
      await sock.next((m) => m.type === 'report' && m.r.id === 'R-001' && m.r.battery === 49, 3000);
      await until(async () => (await request(`${app.url}/readyz`)).status === 503, 30_000, 500);
      expect((await request(`${app.url}/api/robots/R-001/history`)).status).toBe(503);
    } finally {
      unpause(pg);
    }
    await until(async () => (await request(`${app.url}/readyz`)).status === 200, 40_000, 500);
    await until(async () => (await count(`SELECT count(*) n FROM telemetry WHERE robot_id = 'R-001' AND boot = 10`)) === 10, 20_000, 500);
    sock.close();
  }, 120_000);
});
