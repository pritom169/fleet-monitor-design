/**
 * HTTP + WebSocket API (SYSTEM_DESIGN.md §14). The only module that knows about HTTP.
 * The browser contract is the same as the demo backend's; production adds range queries.
 * Errors use application/problem+json (RFC 9457).
 */
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { ServerMessage } from '@fleet/shared/protocol';
import type { FleetDomain } from '../domain/fleet';
import { MAX_RANGE_MS, decodeCursor, type Repo } from '../repo/pg';
import { registry, wsClients, wsDisconnects } from '../metrics';
import type { Log } from '../log';
import type { Fanout } from './fanout';
import { serveStatic, shellCsp } from './static';

export interface Readiness {
  ok: boolean;
  checks: Record<string, boolean>;
}

export interface HttpDeps {
  domain: FleetDomain;
  repo: Repo;
  fanout: Fanout;
  ready: () => Readiness;
  /** False while the database is failing: history endpoints return 503. */
  dbOk: () => boolean;
  staticDir?: string;
  log: Log;
}

const ID = '([A-Za-z0-9_-]{1,64})';
const ROUTES = {
  history: new RegExp(`^/api/robots/${ID}/history$`),
  telemetry: new RegExp(`^/api/robots/${ID}/telemetry$`),
  events: new RegExp(`^/api/robots/${ID}/events$`),
};

class Problem extends Error {
  constructor(readonly status: number, readonly title: string, readonly detail?: string) {
    super(title);
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function sendProblem(res: http.ServerResponse, p: Problem, instance: string) {
  sendJson(res, p.status, { type: 'about:blank', title: p.title, status: p.status, detail: p.detail, instance }, 'application/problem+json');
}

/** Epoch ms or an ISO 8601 string. */
function parseTime(v: string | null, name: string, fallback: number): number {
  if (v === null || v === '') return fallback;
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(n)) throw new Problem(400, 'Bad request', `${name} is not a time`);
  return n;
}

const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);

export function createHttpServer(d: HttpDeps) {
  const csp = d.staticDir ? shellCsp(d.staticDir) : undefined;

  const hello = (): ServerMessage => {
    const snap = d.domain.snapshot();
    return { type: 'hello', serverTime: Date.now(), robots: snap.robots, reports: snap.reports, ingest: d.domain.ingest() };
  };

  const route = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const p = url.pathname;
    if (p === '/healthz') return sendJson(res, 200, { status: 'ok' });
    if (p === '/readyz') {
      const r = d.ready();
      return sendJson(res, r.ok ? 200 : 503, { status: r.ok ? 'ready' : 'not ready', checks: r.checks });
    }
    if (p === '/metrics') {
      res.writeHead(200, { 'content-type': registry.contentType });
      return res.end(await registry.metrics());
    }
    if (p.startsWith('/api/')) {
      if (p === '/api/health') {
        return sendJson(res, 200, { ok: true, robots: d.domain.robots.size, clients: d.fanout.size, ingest: d.domain.ingest() });
      }

      const robotRoute = (re: RegExp) => {
        const m = re.exec(p);
        if (!m) return null;
        if (req.method !== 'GET') throw new Problem(405, 'Method not allowed');
        const r = d.domain.robots.get(m[1]);
        if (!r) throw new Problem(404, 'Unknown robot', m[1]);
        if (!d.dbOk()) throw new Problem(503, 'History unavailable', 'The database is not reachable. The live view continues.');
        return m[1];
      };

      let id = robotRoute(ROUTES.history);
      if (id) {
        const now = Date.now();
        return sendJson(res, 200, await d.repo.history(id, now, startOfDay(now)));
      }
      id = robotRoute(ROUTES.telemetry);
      if (id) {
        const now = Date.now();
        const to = parseTime(url.searchParams.get('to'), 'to', now);
        const from = parseTime(url.searchParams.get('from'), 'from', to - 15 * 60_000);
        if (from >= to) throw new Problem(400, 'Bad request', 'from must be before to');
        if (to - from > MAX_RANGE_MS) throw new Problem(400, 'Bad request', 'The range can be at most 7 days');
        const r = await d.repo.telemetry(id, from, to);
        return sendJson(res, 200, { id, from, to, ...r });
      }
      id = robotRoute(ROUTES.events);
      if (id) {
        const now = Date.now();
        const to = parseTime(url.searchParams.get('to'), 'to', now + 60_000);
        const from = parseTime(url.searchParams.get('from'), 'from', startOfDay(now));
        const cursor = url.searchParams.get('cursor');
        if (cursor && !decodeCursor(cursor)) throw new Problem(400, 'Bad request', 'Invalid cursor');
        const page = await d.repo.events(id, from, to, cursor);
        return sendJson(res, 200, { id, events: page.events.map(({ seq: _s, ...e }) => e), next: page.next });
      }
      throw new Problem(404, 'Not found');
    }

    if (d.staticDir && req.method === 'GET' && serveStatic(d.staticDir, p, res, csp)) return;
    throw new Problem(404, 'Not found');
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    route(req, res, url).catch((err) => {
      if (err instanceof Problem) return sendProblem(res, err, url.pathname);
      d.log.error({ err, path: url.pathname }, 'request failed');
      if (!res.headersSent) sendProblem(res, new Problem(500, 'Internal error'), url.pathname);
    });
  };

  const server = http.createServer(handler);

  const refuse = (socket: Duplex, status: number, reason: string) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return refuse(socket, 404, 'Not Found');
    wss.handleUpgrade(req, socket, head, (ws) => {
      let cut: string | null = null;
      const remove = d.fanout.add(
        {
          send: (data) => ws.send(data),
          get bufferedAmount() {
            return ws.bufferedAmount;
          },
          terminate: (reason) => {
            cut = reason;
            ws.terminate();
          },
        },
        hello(),
      );
      wsClients.set(d.fanout.size);
      let gone = false;
      const done = (why: string) => {
        if (gone) return;
        gone = true;
        const reason = cut ?? why;
        remove();
        wsClients.set(d.fanout.size);
        wsDisconnects.inc({ reason });
      };
      ws.on('close', () => done('close'));
      ws.on('error', () => done('error'));
    });
  });

  return {
    server,
    hello,
    close: () =>
      new Promise<void>((resolve) => {
        d.fanout.closeAll();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
