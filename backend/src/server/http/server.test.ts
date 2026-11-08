import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ServerMessage, type RobotInfo } from '@fleet/shared/protocol';
import { FleetDomain } from '../domain/fleet';
import type { Log } from '../log';
import type { Repo } from '../repo/pg';
import { encodeCursor } from '../repo/pg';
import { Fanout } from './fanout';
import { createHttpServer, type HttpDeps } from './server';

const info = (id: string, siteKey: string): RobotInfo => ({ id, siteKey, model: 'm', modelFull: 'm', firmware: 'f', network: 'n', registeredAt: 0, lastCharge: null });
const T = Date.now();

function fakeRepo() {
  return {
    history: vi.fn(async (id: string) => ({ id, battery: [], trail: [], events: [] })),
    telemetry: vi.fn(async () => ({ bucketMs: 1000, points: [] })),
    events: vi.fn(async (id: string, _from: number, _to: number, _cursor: string | null) => ({ events: [{ id, eventId: 'e7', t: T, kind: 'info' as const, code: 'other' as const, text: 'x', seq: 7 }], next: 'n' })),
  };
}

let srv: ReturnType<typeof createHttpServer> | undefined;
let base = '';
let repo: ReturnType<typeof fakeRepo>;
let log: { error: ReturnType<typeof vi.fn> };
let fanout: Fanout;

async function start(o: Partial<HttpDeps> = {}) {
  const domain = new FleetDomain([info('R-001', 'hh'), info('R-002', 'le')]);
  domain.setLink(true, T - 5000);
  domain.poll(T);
  domain.accept({ id: 'R-001', siteId: 'hh', boot: 1, seq: 1, robotTs: T, battery: 80, x: 1, y: 1, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0 }, T);
  domain.accept({ id: 'R-002', siteId: 'le', boot: 1, seq: 1, robotTs: T, battery: 80, x: 1, y: 1, state: 'ok', task: 'Idle', taskKind: 'idle', since: 0 }, T);
  repo = fakeRepo();
  log = { error: vi.fn() };
  fanout = new Fanout();
  srv = createHttpServer({
    domain, repo: repo as unknown as Repo, fanout, log: log as unknown as Log,
    ready: () => ({ ok: true, checks: { database: true } }), dbOk: () => true, ...o,
  });
  await new Promise<void>((r) => srv!.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  return { domain };
}

afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const get = (p: string, init?: RequestInit) => fetch(base + p, init);
const json = async (r: Response): Promise<any> => r.json();

function ws(p: string, headers: Record<string, string> = {}) {
  return new Promise<{ sock: WebSocket; first: ServerMessage }>((resolve, reject) => {
    const sock = new WebSocket(base.replace('http', 'ws') + p, { headers });
    // Validated, not cast: the snapshot must match the protocol the browser checks it against.
    sock.once('message', (d) => {
      try {
        resolve({ sock, first: ServerMessage.parse(JSON.parse(String(d))) });
      } catch (e) {
        sock.close();
        reject(e);
      }
    });
    sock.once('unexpected-response', (_q, r) => reject(Object.assign(new Error('refused'), { status: r.statusCode })));
    sock.once('error', reject);
  });
}

describe('HTTP API', () => {
  beforeEach(async () => {
    await start();
  });

  it('answers health, readiness and metrics', async () => {
    expect(await json(await get('/healthz'))).toEqual({ status: 'ok' });
    const r = await get('/readyz');
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ status: 'ready', checks: { database: true } });
    const m = await get('/metrics');
    expect(m.status).toBe(200);
    expect(await m.text()).toMatch(/ws_clients/);
  });

  it('answers /api/health, with security headers', async () => {
    const health = await get('/api/health');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await json(health)).toEqual({ ok: true, robots: 2, clients: 0, ingest: { state: 'live', frozenAt: null } });
  });

  it('serves history and events, without the internal sequence number', async () => {
    expect((await get('/api/robots/R-001/history')).status).toBe(200);
    expect(repo.history).toHaveBeenCalledWith('R-001', expect.any(Number), expect.any(Number));
    const ev = await json(await get(`/api/robots/R-001/events?cursor=${encodeCursor(1, 2)}`));
    expect(ev).toEqual({ id: 'R-001', events: [{ id: 'R-001', eventId: 'e7', t: T, kind: 'info', code: 'other', text: 'x' }], next: 'n' });
    expect(repo.events.mock.calls[0][3]).toBe(encodeCursor(1, 2));
  });

  it('parses telemetry ranges as epoch ms or ISO 8601, with defaults', async () => {
    const r = await json(await get('/api/robots/R-001/telemetry?from=2026-01-01T00:00:00Z&to=1767229200000'));
    expect(r).toEqual({ id: 'R-001', from: Date.parse('2026-01-01T00:00:00Z'), to: 1767229200000, bucketMs: 1000, points: [] });
    await get('/api/robots/R-001/telemetry?from=&to=');
    const [, from, to] = repo.telemetry.mock.calls[1] as unknown as [string, number, number];
    expect(to - from).toBe(15 * 60_000);
  });

  it('refuses bad requests with problem+json', async () => {
    const cases: [string, number, string][] = [
      ['/api/robots/R-001/telemetry?from=yesterday', 400, 'from is not a time'],
      ['/api/robots/R-001/telemetry?from=2000&to=1000', 400, 'from must be before to'],
      [`/api/robots/R-001/telemetry?from=0&to=${8 * 86_400_000}`, 400, 'The range can be at most 7 days'],
      ['/api/robots/R-001/events?cursor=bad', 400, 'Invalid cursor'],
      ['/api/robots/R-404/history', 404, 'R-404'],
      ['/api/me', 404, undefined as unknown as string],
      ['/api/robots/R-001/nope', 404, undefined as unknown as string],
      ['/nope', 404, undefined as unknown as string],
    ];
    for (const [p, status, detail] of cases) {
      const r = await get(p);
      expect(r.status, p).toBe(status);
      expect(r.headers.get('content-type')).toBe('application/problem+json');
      const body = await json(r);
      expect(body).toMatchObject({ type: 'about:blank', status, instance: p.split('?')[0] });
      expect(body.detail).toBe(detail);
    }
    const post = await get('/api/robots/R-001/history', { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('answers 500 and logs when a handler fails unexpectedly', async () => {
    repo.history.mockRejectedValueOnce(new Error('boom'));
    const r = await get('/api/robots/R-001/history');
    expect(r.status).toBe(500);
    expect((await json(r)).title).toBe('Internal error');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/robots/R-001/history' }), 'request failed');
  });

  it('streams a snapshot over the WebSocket and refuses other upgrade paths', async () => {
    const { sock, first } = await ws('/ws');
    expect(first.type === 'hello' && first.robots.map((r) => r.id)).toEqual(['R-001', 'R-002']);
    expect(fanout.size).toBe(1);
    const closed = new Promise((r) => sock.once('close', r));
    sock.close();
    await closed;
    await vi.waitFor(() => expect(fanout.size).toBe(0));
    await expect(ws('/other')).rejects.toMatchObject({ status: 404 });
  });

  it('cuts sockets on shutdown', async () => {
    const { sock } = await ws('/ws');
    const closed = new Promise((r) => sock.once('close', r));
    await srv!.close();
    srv = undefined;
    await closed;
  });
});

describe('HTTP API with options', () => {
  it('turns history off while the database is down, and readiness red', async () => {
    await start({ dbOk: () => false, ready: () => ({ ok: false, checks: { database: false } }) });
    const r = await get('/api/robots/R-001/history');
    expect(r.status).toBe(503);
    expect((await json(r)).detail).toMatch(/live view continues/);
    const ready = await get('/readyz');
    expect(ready.status).toBe(503);
    expect((await json(ready)).status).toBe('not ready');
  });

  it('serves the built client for GET, with its CSP, and 404 for other methods', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><script>1</script></html>');
    try {
      await start({ staticDir: dir });
      const r = await get('/robots/R-001');
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('<html>');
      expect(r.headers.get('content-security-policy')).toMatch(/sha256-/);
      expect((await get('/robots/R-001', { method: 'POST' })).status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a static dir without index.html still answers 404', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-empty-'));
    try {
      await start({ staticDir: dir });
      expect((await get('/robots/R-001')).status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

