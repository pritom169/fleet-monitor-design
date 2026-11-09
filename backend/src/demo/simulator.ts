import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { SITES } from '@fleet/shared/sites';
import type { RobotHistory, ServerMessage } from '@fleet/shared/protocol';
import { clamp, createFleet } from '../sim/fleet';
import { serveStatic } from '../server/http/static';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR;
const S = 1000;

const clients = new Set<WebSocket>();
let outageUntil = 0;

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

const ROBOTS = Number(process.env.ROBOTS ?? 50);
const fleet = createFleet({ incidents: 'demo', count: ROBOTS, onEvent: (e) => broadcast({ type: 'event', e }) });
const { robots } = fleet;

let lastTick = fleet.start - S;
function tick() {
  const t = Math.floor(Date.now() / 1000) * 1000;
  if (t <= lastTick) return;
  lastTick = t;
  fleet.tick(t);
  for (const r of robots) {
    if (r.mode === 'gone' || r.mode === 'never' || !r.last) continue;
    const rep = r.last;
    setTimeout(() => broadcast({ type: 'report', r: { ...rep, t: Date.now() } }), r.phase);
  }
  if (t % (2 * S) === 0) broadcast({ type: 'heartbeat', serverTime: Date.now() });
}
setTimeout(() => {
  tick();
  setInterval(tick, 1000);
}, 1000 - (Date.now() % 1000));

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const hist = url.pathname.match(/^\/api\/robots\/([A-Z0-9-]+)\/history$/);
  if (hist && req.method === 'GET') {
    const r = fleet.byId(hist[1]);
    if (!r) return json(404, { error: 'unknown robot' });
    const body: RobotHistory = { id: r.info.id, battery: r.battHist, trail: r.trail, events: r.events.slice(0, 40) };
    return json(200, body);
  }
  if (url.pathname === '/api/health') return json(200, { ok: true, robots: robots.length, clients: clients.size });
  if (url.pathname === '/control/outage' && req.method === 'POST') {
    const seconds = clamp(Number(url.searchParams.get('seconds') ?? 20), 1, 600);
    outageUntil = Date.now() + seconds * S;
    for (const c of clients) c.terminate();
    console.log(`[sim] outage for ${seconds} s`);
    return json(200, { outageFor: seconds });
  }
  if (STATIC_DIR && req.method === 'GET' && serveStatic(STATIC_DIR, url.pathname, res)) return;
  json(404, { error: 'not found' });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws') || Date.now() < outageUntil) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    const hello: ServerMessage = {
      type: 'hello',
      serverTime: Date.now(),
      robots: fleet.registry(),
      reports: robots.flatMap((r) => (r.last ? [r.last] : [])),
      ingest: { state: 'live', frozenAt: null },
    };
    ws.send(JSON.stringify(hello));
  });
});

server.listen(PORT, () => {
  const sites = SITES.map((s) => `${s.name} (${robots.filter((r) => r.site.key === s.key).length})`).join(', ');
  console.log(`[sim] demo fleet server on http://localhost:${PORT} · ${robots.length} robots · ${sites}`);
});
