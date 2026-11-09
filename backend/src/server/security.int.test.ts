/**
 * Production security (SYSTEM_DESIGN.md §16) against real containers:
 *   - Mosquitto with TLS only, a client certificate per robot, and the ACL generated from the registry
 *   - HTTPS/WSS for the browser, and a bearer token on /metrics
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';
import { initPki, robotPki } from '../ops/pki';
import { createApp, type App } from './app';
import { Repo } from './repo/pg';
import {
  connect, freePort, openSocket, publishTel, readCert, request, robot, sleep, startMosquitto, startPostgres, tel, testConfig, until,
} from '../test/harness';

const ROBOTS = [robot('R-001', 'hh'), robot('R-002', 'le'), robot('R-003', 'mu')];
const METRICS_TOKEN = 'metrics-test-token';

let dir: string;
let ca: Buffer;
let pg: StartedPostgreSqlContainer;
let mq: { c: StartedTestContainer; url: string };
let app: App;
let appUrl: string;
const clients: MqttClient[] = [];
let beat: ReturnType<typeof setInterval> | undefined;

const robotTls = (id: string) => ({ ca, ...readCert(path.join(dir, 'robots'), id), rejectUnauthorized: true });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-pki-'));
  initPki(dir);
  robotPki(dir, ROBOTS);
  ca = fs.readFileSync(path.join(dir, 'ca.crt'));
  const conf = fs.readFileSync(path.resolve(__dirname, '../../../deploy/mosquitto.secure.conf'), 'utf8');

  [pg, mq] = await Promise.all([startPostgres(), startMosquitto({ conf, certsDir: dir })]);
  const repo = new Repo(pg.getConnectionUri());
  await repo.migrate();
  await repo.upsertRegistry(ROBOTS);
  await repo.close();

  const appPort = await freePort();
  appUrl = `https://localhost:${appPort}`;

  app = await createApp(testConfig({
    port: appPort,
    databaseUrl: pg.getConnectionUri(),
    mqttUrl: mq.url,
    mqttTls: { ca, ...readCert(dir, 'ingest') },
    https: readCert(dir, 'web'),
    metricsToken: METRICS_TOKEN,
  }));
  await until(async () => (await request(`${appUrl}/readyz`, { ca })).status === 200, 20_000);

  // R-003 keeps reporting so the fleet is never silent (stall watchdog).
  const r3 = await connect(mq.url, { clientId: 'robot-R-003', ...robotTls('R-003') });
  clients.push(r3);
  let seq = 0;
  beat = setInterval(() => void publishTel(r3, tel('R-003', 'mu', seq++)), 500);
  await until(() => app.domain.ingest().state === 'live', 10_000);
});

afterAll(async () => {
  clearInterval(beat);
  for (const c of clients) c.end(true);
  await app?.stop();
  await Promise.all([pg?.stop(), mq?.c.stop()]);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('MQTT: TLS, client certificates, ACL from the registry', () => {
  it('refuses a client without a certificate', async () => {
    await expect(connect(mq.url, { ca, rejectUnauthorized: true })).rejects.toThrow();
  });

  it('refuses a client whose certificate is not from our CA', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-other-'));
    try {
      initPki(other);
      robotPki(other, [robot('R-001', 'hh')]);
      await expect(connect(mq.url, { ca, ...readCert(path.join(other, 'robots'), 'R-001'), rejectUnauthorized: true })).rejects.toThrow();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('lets a robot publish to its own topics only', async () => {
    const c = await connect(mq.url, { clientId: 'robot-R-001', ...robotTls('R-001') });
    clients.push(c);
    await publishTel(c, tel('R-001', 'hh', 0, { battery: 66 }));
    await until(() => app.domain.robots.get('R-001')?.report?.battery === 66);
    // R-001 tries to speak for R-002: the broker drops it, so the server never hears it.
    await publishTel(c, tel('R-002', 'le', 0, { battery: 5 }));
    await sleep(1500);
    expect(app.domain.robots.get('R-002')!.report).toBeNull();
  });
});

describe('HTTPS', () => {
  it('serves the API over HTTPS with HSTS, and has no sign-in routes', async () => {
    const health = await request(`${appUrl}/api/health`, { ca });
    expect(health.status).toBe(200);
    expect(health.headers['strict-transport-security']).toBeDefined();
    expect((await request(`${appUrl}/api/robots/R-001/history`, { ca })).status).toBe(200);
    expect((await request(`${appUrl}/api/me`, { ca })).status).toBe(404);
    expect((await request(`${appUrl}/auth/login`, { ca })).status).toBe(404);
  });

  it('streams every robot over WSS', async () => {
    const sock = await openSocket(`${appUrl.replace('https', 'wss')}/ws`, { ca });
    const hello = await sock.next((m) => m.type === 'hello');
    expect(hello.type === 'hello' && hello.robots.map((r) => r.id).sort()).toEqual(['R-001', 'R-002', 'R-003']);
    // R-003 keeps reporting, and its reports reach the browser.
    await sock.next((m) => m.type === 'report' && m.r.id === 'R-003');
    sock.close();
  });

  it('protects /metrics with a bearer token', async () => {
    expect((await request(`${appUrl}/metrics`, { ca })).status).toBe(401);
    const ok = await request(`${appUrl}/metrics`, { ca, headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatch(/ingest_messages_total/);
  });
});
