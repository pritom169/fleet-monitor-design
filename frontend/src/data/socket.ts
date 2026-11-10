import { SERVER_MESSAGE_TYPES, ServerMessage, type Report } from '@fleet/shared/protocol';
import { actions, fleet } from './store';

export const BACKOFF_MS = [1000, 2000, 5000, 10000];
const FLUSH_MS = 250;
const STALL_MS = 5000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let buffer: Report[] = [];
let lastRecv = 0;
let attempt = 0;
let started = false;

function url() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  actions.reports(batch);
}

const warned = new Set<string>();

export function parseServerMessage(data: string): ServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    warnOnce('(not JSON)', 'not JSON');
    return null;
  }
  const res = ServerMessage.safeParse(json);
  if (res.success) return res.data;
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !SERVER_MESSAGE_TYPES.has(type)) return null;
  warnOnce(type, res.error.issues[0] ? `${res.error.issues[0].path.join('.')}: ${res.error.issues[0].message}` : 'schema');
  return null;
}

function warnOnce(key: string, why: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fleet] dropped invalid "${key}" message from the server (${why}); further ones are dropped silently`);
}

function onMessage(ev: MessageEvent<string>) {
  lastRecv = Date.now();
  const msg = parseServerMessage(ev.data);
  if (!msg) return;
  if (msg.type === 'hello') {
    buffer = [];
    attempt = 0;
    actions.hello(msg);
  } else if (msg.type === 'report') {
    buffer.push(msg.r);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  } else if (msg.type === 'event') {
    actions.event(msg.e);
  } else if (msg.type === 'ingest') {
    flush();
    actions.ingest(msg.ingest);
  } else if (msg.type === 'heartbeat') {
    actions.heartbeat(msg.serverTime);
  }
}

function drop() {
  if (!ws) return;
  const s = ws;
  ws = null;
  s.onopen = s.onmessage = s.onclose = s.onerror = null;
  try {
    s.close();
  } catch {}
  flush();
  actions.lost();
  scheduleRetry();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  actions.retrying(attempt, Date.now() + delay);
  retryTimer = setTimeout(open, delay);
}

function open() {
  clearTimeout(retryTimer);
  if (ws) return;
  const s = new WebSocket(url());
  ws = s;
  lastRecv = Date.now();
  s.onmessage = onMessage;
  s.onclose = drop;
  s.onerror = drop;
}

export function startFleet() {
  if (started) return;
  started = true;
  open();
  const tick = () => {
    if (ws && fleet.get().connection === 'live' && Date.now() - lastRecv > STALL_MS) drop();
    actions.tick();
  };
  setTimeout(() => {
    tick();
    setInterval(tick, 1000);
  }, 1000 - (Date.now() % 1000));
}

export function retryNow() {
  open();
}
