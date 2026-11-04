import { useRef, useSyncExternalStore } from 'react';
import type { Ingest, Report, RobotEvent, RobotInfo } from '@fleet/shared/protocol';
import type { FleetState, HoverSource, Judged, Robot, Status } from './types';
import { LOW_BATTERY, deriveStatus, nextLow, reportedStatus, statusClock } from '../lib/status';

// ---------- pure reducers (unit-tested) ----------

export function initialState(clientNow = Date.now()): FleetState {
  return {
    ready: false,
    connection: 'connecting',
    attempt: 0,
    nextRetryAt: null,
    lastMessageAt: null,
    ingest: LIVE,
    offset: 0,
    now: clientNow,
    ids: [],
    robots: {},
    hover: null,
    liveEvents: [],
  };
}

const GHOSTS = 6;
const LIVE: Ingest = { state: 'live', frozenAt: null };

/** Status and report, built together so a robot can never hold one without the other. */
function judge(report: Report | null, at: number, low: boolean): Judged {
  return report ? { status: reportedStatus(report, at, low), report } : { status: 'never', report: null };
}

/** Re-derive status for the given robots. A changed status gets a new object and a changedAt stamp. */
function recompute(s: FleetState, robots: Record<string, Robot>, ids: Iterable<string>): Record<string, Robot> {
  const at = statusClock(s);
  let out = robots;
  for (const id of ids) {
    const r = out[id];
    if (!r) continue;
    const j = judge(r.report, at, r.low);
    if (j.status !== r.status) {
      if (out === robots) out = { ...robots };
      out[id] = { ...r, ...j, changedAt: s.now };
    }
  }
  return out;
}

export function applyHello(s: FleetState, msg: { serverTime: number; robots: RobotInfo[]; reports: Report[]; ingest?: Ingest }, clientNow: number): FleetState {
  const offset = msg.serverTime - clientNow;
  const byId = new Map(msg.reports.map((r) => [r.id, r]));
  const next: FleetState = {
    ...s,
    ready: true,
    connection: 'live',
    attempt: 0,
    nextRetryAt: null,
    offset,
    now: msg.serverTime,
    lastMessageAt: msg.serverTime,
    ingest: msg.ingest ?? LIVE,
    ids: msg.robots.map((r) => r.id),
  };
  const at = statusClock(next);
  const robots: Record<string, Robot> = {};
  for (const info of msg.robots) {
    const prev = s.robots[info.id];
    const report = byId.get(info.id) ?? null;
    const low = report ? (prev ? nextLow(report.battery, prev.low) : report.battery < LOW_BATTERY) : false;
    const j = judge(report, at, low);
    // Compare with the previous status so a change during an outage is highlighted after reconnect.
    const before: Status = prev ? prev.status : deriveStatus(report, msg.serverTime, low);
    robots[info.id] = {
      id: info.id,
      info,
      ...j,
      low,
      changedAt: s.ready && j.status !== before ? next.now : (prev?.changedAt ?? null),
      ghosts: prev && report ? [...prev.ghosts, [report.x, report.y] as [number, number]].slice(-GHOSTS) : report ? [[report.x, report.y]] : [],
    };
  }
  next.robots = robots;
  return next;
}

export function applyReports(s: FleetState, reports: Report[]): FleetState {
  if (!reports.length) return s;
  let newest = s.lastMessageAt ?? 0;
  for (const rep of reports) if (s.robots[rep.id] && rep.t > newest) newest = rep.t;
  const next = { ...s, lastMessageAt: newest };
  const at = statusClock(next);
  const robots = { ...s.robots };
  for (const rep of reports) {
    const r = robots[rep.id];
    if (!r) continue;
    const moved = !r.report || r.report.x !== rep.x || r.report.y !== rep.y;
    const low = nextLow(rep.battery, r.low);
    const j = judge(rep, at, low);
    robots[rep.id] = {
      ...r,
      ...j,
      low,
      // Against the status before this batch, so a change that reverses within one batch is not marked.
      changedAt: j.status !== s.robots[rep.id].status ? s.now : s.robots[rep.id].changedAt,
      ghosts: moved ? [...r.ghosts, [rep.x, rep.y] as [number, number]].slice(-GHOSTS) : r.ghosts,
    };
  }
  next.robots = robots;
  return next;
}

export function applyTick(s: FleetState, clientNow: number): FleetState {
  const next = { ...s, now: clientNow + s.offset };
  // Offline is a function of time, so every robot is checked on each tick.
  next.robots = recompute(next, s.robots, s.ids);
  return next;
}

export function applyLost(s: FleetState): FleetState {
  if (!s.ready) return { ...s, connection: 'connecting' };
  return { ...s, connection: 'lost' };
}

/** The server lost or regained its link to the robots. Freshness freezes at `frozenAt` while paused. */
export function applyIngest(s: FleetState, ingest: Ingest): FleetState {
  const next = { ...s, ingest };
  next.robots = recompute(next, s.robots, s.ids);
  return next;
}

/** Proof that our link is alive while no reports flow. */
export function applyHeartbeat(s: FleetState, serverTime: number): FleetState {
  return serverTime > (s.lastMessageAt ?? 0) ? { ...s, lastMessageAt: serverTime } : s;
}

export function applyEvent(s: FleetState, e: RobotEvent): FleetState {
  return { ...s, liveEvents: [e, ...s.liveEvents].slice(0, 300) };
}

// ---------- tiny store ----------

type Listener = () => void;
let state = initialState();
const listeners = new Set<Listener>();

export const fleet = {
  get: () => state,
  set(next: FleetState) {
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export const actions = {
  hello: (msg: Parameters<typeof applyHello>[1]) => fleet.set(applyHello(state, msg, Date.now())),
  reports: (rs: Report[]) => fleet.set(applyReports(state, rs)),
  event: (e: RobotEvent) => fleet.set(applyEvent(state, e)),
  ingest: (i: Ingest) => fleet.set(applyIngest(state, i)),
  heartbeat: (t: number) => fleet.set(applyHeartbeat(state, t)),
  tick: () => fleet.set(applyTick(state, Date.now())),
  lost: () => fleet.set(applyLost(state)),
  retrying: (attempt: number, nextRetryAt: number) => fleet.set({ ...state, attempt, nextRetryAt }),
  hover(id: string | null, from: HoverSource = 'table') {
    const cur = state.hover;
    if (id === null ? cur === null : cur?.id === id && cur.from === from) return;
    fleet.set({ ...state, hover: id ? { id, from } : null });
  },
};

/**
 * Subscribe to a slice of the store. Re-renders only when the selected value changes
 * (by `eq`, default Object.is).
 */
export function useFleet<T>(select: (s: FleetState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ s?: FleetState; sel?: unknown; v?: T }>({});
  const get = () => {
    const c = cache.current;
    if (c.s === state && c.sel === select) return c.v as T;
    const v = select(state);
    const keep = c.s !== undefined && eq(c.v as T, v);
    c.s = state;
    c.sel = select;
    if (!keep) c.v = v;
    return c.v as T;
  };
  return useSyncExternalStore(fleet.subscribe, get, get);
}

export const shallow = <T extends unknown[]>(a: T, b: T) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
