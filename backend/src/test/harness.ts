/**
 * Integration-test harness: real Postgres and Mosquitto in containers (Testcontainers), the app started
 * in process, and small HTTP / WebSocket / MQTT helpers that can trust a test CA.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import WebSocket from 'ws';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { z } from 'zod';
import { ServerMessage, type RobotInfo } from '@fleet/shared/protocol';
import type { Telemetry } from '@fleet/shared/telemetry';
import type { AppConfig } from '../server/config';

export const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2.0.20';

export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine').withDatabase('fleet').withUsername('fleet').withPassword('fleet').start();
}

/** Plain broker on 1883, or a TLS broker (8883) with the given conf and a directory of certs + ACL. */
export async function startMosquitto(o: { conf?: string; certsDir?: string } = {}): Promise<{ c: StartedTestContainer; url: string }> {
  const tls = !!o.certsDir;
  const port = tls ? 8883 : 1883;
  let g = new GenericContainer(MOSQUITTO_IMAGE)
    .withExposedPorts(port)
    .withCopyContentToContainer([
      { content: o.conf ?? 'listener 1883\nallow_anonymous true\npersistence false\nlog_dest stdout\n', target: '/mosquitto/config/mosquitto.conf' },
    ])
    // The secure config logs no "running" banner (information level is off), so wait for the port there.
    .withWaitStrategy(o.certsDir ? Wait.forListeningPorts() : Wait.forLogMessage(/mosquitto version .* running/));
  if (o.certsDir) {
    const files = ['ca.crt', 'broker.crt', 'broker.key', 'acl'].map((f) => ({ source: path.join(o.certsDir!, f), target: `/mosquitto/certs/${f}`, mode: 0o644 }));
    g = g.withCopyFilesToContainer(files);
  }
  const c = await g.start();
  return { c, url: `${tls ? 'mqtts' : 'mqtt'}://localhost:${c.getMappedPort(port)}` };
}

/** Freeze a container's processes (the database "hangs") without closing its sockets. */
export const pause = (c: StartedTestContainer) => execFileSync('docker', ['pause', c.getId()]);
export const unpause = (c: StartedTestContainer) => execFileSync('docker', ['unpause', c.getId()]);

export function testConfig(o: Partial<AppConfig> & Pick<AppConfig, 'databaseUrl' | 'mqttUrl'>): AppConfig {
  return {
    port: 0,
    sites: [],
    migrate: true,
    registryRefreshMs: 500,
    queue: { telemetryCapacity: 50_000, batchSize: 1000, batchWaitMs: 100 },
    ...o,
  };
}

export const robot = (id: string, siteKey: string): RobotInfo => ({
  id, siteKey, model: 'Tote picker', modelFull: 'Tote picker AMR-2', firmware: '4.12.1', network: 'AP test', registeredAt: Date.now() - 86_400_000, lastCharge: null,
});

export const tel = (id: string, siteId: string, seq: number, extra: Partial<Telemetry> = {}): Telemetry => ({
  id, siteId, boot: 1, seq, robotTs: Date.now(), battery: 80, x: 10, y: 5, state: 'ok', task: 'Idle', taskKind: 'idle', since: Date.now() - 3600_000, ...extra,
});

export async function until<T>(fn: () => T | Promise<T>, timeoutMs = 10_000, everyMs = 100): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms${last ? `: ${(last as Error).message}` : ''}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

// ---------- MQTT ----------

export function connect(url: string, opts: IClientOptions = {}): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 5000, ...opts });
    c.once('connect', () => resolve(c));
    c.once('error', (e) => {
      c.end(true);
      reject(e);
    });
    c.once('close', () => reject(new Error('connection closed')));
  });
}

export const publishTel = (c: MqttClient, t: Telemetry) =>
  new Promise<void>((resolve, reject) => c.publish(`fleet/${t.siteId}/${t.id}/telemetry`, JSON.stringify(t), { qos: 0 }, (e) => (e ? reject(e) : resolve())));

// ---------- HTTP ----------

export interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json<T = any>(): T;
}

/** fetch-like, but never follows redirects and can trust a custom CA. */
export function request(url: string, o: { method?: string; headers?: Record<string, string>; body?: string; ca?: Buffer } = {}): Promise<Res> {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method: o.method ?? 'GET', headers: o.headers, ca: o.ca }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

// ---------- WebSocket ----------

export interface Socket {
  ws: WebSocket;
  /** Every frame so far, as the browser client would see it after validation. */
  messages: (ServerMessage & { at: number })[];
  /** Rejects as soon as the server sends a frame that breaks the protocol. */
  next(pred: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage & { at: number }>;
  /** Throws if the server sent a frame that breaks the protocol, so tests that only read `messages` fail too. */
  close(): void;
}

/**
 * Check a frame the way the browser does (frontend/src/data/socket.ts), but strictly: the client drops a
 * known type with a bad shape and ignores unknown types, and here both fail the test. An unknown type from
 * our own server means `ServerMessage` is missing a variant.
 */
function parseFrame(text: string): ServerMessage | Error {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Error(`server sent a WebSocket frame that is not JSON: ${text.slice(0, 200)}`);
  }
  const res = ServerMessage.safeParse(json);
  if (res.success) return res.data;
  return new Error(`server sent a WebSocket frame that does not match ServerMessage:\n${z.prettifyError(res.error)}\nframe: ${text.slice(0, 500)}`);
}

export function openSocket(url: string, o: { headers?: Record<string, string>; ca?: Buffer } = {}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: o.headers, ca: o.ca });
    const messages: Socket['messages'] = [];
    const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: Socket['messages'][number]) => void; reject: (e: Error) => void }[] = [];
    let invalid: Error | undefined;
    ws.on('message', (d) => {
      const parsed = parseFrame(String(d));
      if (parsed instanceof Error) {
        invalid ??= parsed;
        for (const w of waiters.splice(0)) w.reject(parsed);
        return;
      }
      const m = { ...parsed, at: Date.now() };
      messages.push(m);
      for (const w of [...waiters]) if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    });
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.once('error', reject);
    ws.once('open', () =>
      resolve({
        ws,
        messages,
        next: (pred, timeoutMs = 10_000) =>
          new Promise((res, rej) => {
            if (invalid) return rej(invalid);
            const hit = messages.find(pred);
            if (hit) return res(hit);
            const t = setTimeout(() => rej(new Error('timed out waiting for a WebSocket message')), timeoutMs);
            waiters.push({ pred, resolve: (m) => (clearTimeout(t), res(m)), reject: (e) => (clearTimeout(t), rej(e)) });
          }),
        close: () => {
          ws.close();
          if (invalid) throw invalid;
        },
      }),
    );
  });
}

export const readCert = (dir: string, name: string) => ({ cert: fs.readFileSync(path.join(dir, `${name}.crt`)), key: fs.readFileSync(path.join(dir, `${name}.key`)) });
