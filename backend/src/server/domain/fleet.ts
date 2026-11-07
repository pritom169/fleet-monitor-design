/**
 * Current state of the fleet, and the status rules applied to it. Pure: no I/O, no timers.
 * The caller passes the time in, so tests use a fake clock and never sleep.
 *
 * Uses the same status module as the browser (@fleet/shared/status), so server events and
 * client pills follow the same rules.
 */
import type { Ingest, Report, RobotEvent, RobotInfo } from '@fleet/shared/protocol';
import { LOW_BATTERY, LOW_BATTERY_EXIT, deriveStatus, freshnessClock, nextLow, type Status } from '@fleet/shared/status';
import type { RobotEventMsg, Telemetry } from '@fleet/shared/telemetry';
import { SeqWindow } from './seqWindow';

export interface RobotState {
  info: RobotInfo;
  report: Report | null;
  /** Robot clock of the current report. */
  robotTs: number | null;
  /** Smoothed receivedAt − robotTs, in ms. */
  skew: number | null;
  window: SeqWindow;
  low: boolean;
  status: Status;
}

export type IngestResult = 'accepted' | 'unknown' | 'duplicate' | 'out_of_order';

/**
 * An event before it has an ID. The domain stays deterministic; the app stamps `eventId` once, before the
 * event is both sent to browsers and stored, so the live copy and the history copy match.
 */
export type NewEvent = Omit<RobotEvent, 'eventId'>;

export interface Accepted {
  result: IngestResult;
  /** Set for accepted and out_of_order samples: what goes to history. */
  row?: TelemetryRow;
  /** Set for accepted samples: what goes to browsers. */
  report?: Report;
  /** Status transitions this sample caused. */
  events: NewEvent[];
}

export interface TelemetryRow {
  robotId: string;
  boot: number;
  seq: number;
  receivedAt: number;
  robotTs: number;
  battery: number;
  x: number;
  y: number;
  state: string;
  fault: string | null;
  task: string;
}

export interface StoredState {
  robotId: string;
  report: Report;
  boot: number;
  seq: number;
  status: Status;
}

/**
 * After the broker link comes back, freshness stays frozen this long, so every live robot has reported
 * at least twice before silence counts again. Without it, the first tick after a reconnect would see
 * every robot's last report as minutes old and mark the whole fleet offline for a second.
 */
export const SETTLE_MS = 3000;

/** Weight of a new sample in the smoothed clock skew. About 10 s of memory at 1 Hz. */
const SKEW_ALPHA = 0.1;

/**
 * If the broker link is "up" but no robot at all has sent anything for this long, the silence is
 * evidence about *our* path (a stalled TCP link the keepalive has not caught yet, or this process being
 * suspended, e.g. a laptop asleep), not about every robot at once. Same 5 s as the browser's watchdog.
 * Freshness freezes, and data resuming goes through the settle window.
 */
export const STALL_MS = 5000;

type Link = 'down' | 'settling' | 'up' | 'stalled';

export class FleetDomain {
  readonly robots = new Map<string, RobotState>();
  private link: Link = 'down';
  private liveFrom = 0;
  /** Server time of the last message received from the broker, of any kind. */
  private lastMessageAt: number | null = null;
  /** While the link is not `up`, freshness is judged against this time. */
  private frozenAt: number | null = null;

  constructor(registry: RobotInfo[]) {
    for (const info of registry) {
      this.robots.set(info.id, blank(info));
    }
  }

  /**
   * Apply a re-read registry: add new robots (status `never`), drop removed ones, refresh changed info.
   * Returns what changed, so browsers can be sent a fresh snapshot.
   */
  register(registry: RobotInfo[]): { added: string[]; removed: string[]; changed: string[] } {
    const added: string[] = [];
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const info of registry) {
      seen.add(info.id);
      const r = this.robots.get(info.id);
      if (!r) {
        this.robots.set(info.id, blank(info));
        added.push(info.id);
      } else if (JSON.stringify({ ...r.info, lastCharge: null }) !== JSON.stringify({ ...info, lastCharge: null })) {
        r.info = { ...info, lastCharge: r.info.lastCharge };
        changed.push(info.id);
      }
    }
    const removed = [...this.robots.keys()].filter((id) => !seen.has(id));
    for (const id of removed) this.robots.delete(id);
    return { added, removed, changed };
  }

  /** Restore current state after a restart (from `robot_state`). */
  load(rows: StoredState[]) {
    for (const row of rows) {
      const r = this.robots.get(row.robotId);
      if (!r) continue;
      r.report = row.report;
      r.window = SeqWindow.from(row.boot, row.seq);
      r.low = row.status === 'low' ? row.report.battery < LOW_BATTERY_EXIT : row.report.battery < LOW_BATTERY;
      r.status = row.status;
      r.skew = row.report.skew ?? null;
      if (this.lastMessageAt === null || row.report.t > this.lastMessageAt) this.lastMessageAt = row.report.t;
    }
    // Until the broker is connected, judge freshness at the newest evidence we have.
    if (this.link !== 'up') this.frozenAt = this.lastMessageAt;
  }

  // ---------- the ingest clock ----------

  /** Returns true when the ingest state seen by browsers changed. */
  setLink(up: boolean, now: number): boolean {
    if (up) {
      if (this.link !== 'down') return false;
      if (this.frozenAt === null) this.frozenAt = this.lastMessageAt;
      this.link = 'settling';
      this.liveFrom = now + SETTLE_MS;
      return false;
    }
    if (this.link === 'down') return false;
    const wasUp = this.link === 'up';
    if (wasUp) this.frozenAt = this.lastMessageAt ?? now;
    this.link = 'down';
    return wasUp;
  }

  /**
   * Call once a second, before `tick`. Returns true when the ingest state seen by browsers changed:
   * the settle window ended (live), or the link stalled (paused).
   */
  poll(now: number): boolean {
    const silent = this.lastMessageAt !== null && now - this.lastMessageAt > STALL_MS;
    if (this.link === 'settling' && now >= this.liveFrom) {
      if (silent) {
        this.link = 'stalled'; // connected, but nothing arrived: stay paused
        return false;
      }
      this.link = 'up';
      this.frozenAt = null;
      return true;
    }
    if (this.link === 'up' && silent) {
      this.link = 'stalled';
      this.frozenAt = this.lastMessageAt;
      return true;
    }
    return false;
  }

  /** Any message from the broker is evidence the link works. Data after a stall goes through the settle window. */
  heard(at: number) {
    if (this.lastMessageAt === null || at > this.lastMessageAt) this.lastMessageAt = at;
    if (this.link === 'stalled') {
      this.link = 'settling';
      this.liveFrom = at + SETTLE_MS;
    }
  }

  /** The time freshness is judged against. Same rule as the client's statusClock(). */
  clock(now: number): number {
    return this.link === 'up' ? now : freshnessClock(now, this.frozenAt);
  }

  ingest(): Ingest {
    return this.link === 'up' ? { state: 'live', frozenAt: null } : { state: 'paused', frozenAt: this.frozenAt };
  }

  get linkState(): Link {
    return this.link;
  }

  // ---------- messages ----------

  isKnown(robotId: string, siteId?: string): boolean {
    const r = this.robots.get(robotId);
    return !!r && (siteId === undefined || r.info.siteKey === siteId);
  }

  /** Steps 3–5 of the pipeline: registry check, dedupe, order check, current state and status. */
  accept(t: Telemetry, receivedAt: number): Accepted {
    this.heard(receivedAt);
    const r = this.robots.get(t.id);
    if (!r || r.info.siteKey !== t.siteId) return { result: 'unknown', events: [] };
    const order = r.window.check(t.boot, t.seq);
    if (order === 'duplicate') return { result: 'duplicate', events: [] };
    const row: TelemetryRow = {
      robotId: t.id, boot: t.boot, seq: t.seq, receivedAt, robotTs: t.robotTs,
      battery: t.battery, x: t.x, y: t.y, state: t.state, fault: t.fault ?? null, task: t.task,
    };
    if (order === 'older') return { result: 'out_of_order', row, events: [] };

    const sample = receivedAt - t.robotTs;
    r.skew = r.skew === null ? sample : r.skew + (sample - r.skew) * SKEW_ALPHA;
    const report: Report = {
      id: t.id, t: receivedAt, battery: t.battery, x: t.x, y: t.y, state: t.state, task: t.task, taskKind: t.taskKind, since: t.since,
      ...(t.fault ? { fault: t.fault } : {}),
      skew: Math.round(r.skew),
    };
    r.report = report;
    r.robotTs = t.robotTs;
    r.low = nextLow(t.battery, r.low);
    const events = this.rederive(r, this.clock(receivedAt));
    return { result: 'accepted', row, report, events };
  }

  /** A robot-side event (task, fault, Wi-Fi). Stamped with server time. */
  robotEvent(e: RobotEventMsg, receivedAt: number): NewEvent | null {
    this.heard(receivedAt);
    if (!this.robots.has(e.id)) return null;
    return {
      id: e.id, t: receivedAt, kind: e.kind, code: e.code, text: e.text,
      ...(e.sub ? { sub: e.sub } : {}), ...(e.bay !== undefined ? { bay: e.bay } : {}),
    };
  }

  /** Offline is a function of time, so every robot is re-checked once a second. */
  tick(now: number): NewEvent[] {
    const at = this.clock(now);
    const out: NewEvent[] = [];
    for (const r of this.robots.values()) out.push(...this.rederive(r, at));
    return out;
  }

  /** Re-derive status and return the event for the transition, if any. */
  private rederive(r: RobotState, at: number): NewEvent[] {
    const next = deriveStatus(r.report, at, r.low);
    const prev = r.status;
    if (next === prev) return [];
    r.status = next;
    const e = transitionEvent(r, prev, next, at);
    return e ? [e] : [];
  }

  // ---------- views ----------

  snapshot(): { robots: RobotInfo[]; reports: Report[] } {
    const robots: RobotInfo[] = [];
    const reports: Report[] = [];
    for (const r of this.robots.values()) {
      robots.push(r.info);
      if (r.report) reports.push(r.report);
    }
    return { robots, reports };
  }

  counts(): Record<Status, number> {
    const n: Record<Status, number> = { ok: 0, low: 0, error: 0, offline: 0, never: 0 };
    for (const r of this.robots.values()) n[r.status]++;
    return n;
  }

  stateRow(id: string): StoredState | null {
    const r = this.robots.get(id);
    if (!r?.report) return null;
    return { robotId: id, report: r.report, boot: r.window.boot, seq: r.window.top, status: r.status };
  }
}

const blank = (info: RobotInfo): RobotState => ({
  info, report: null, robotTs: null, skew: null, window: new SeqWindow(), low: false, status: 'never',
});

/**
 * The server's own events, from status transitions. Faults come from the robot itself
 * (an `event` message), so a transition into `error` adds nothing here.
 */
export function transitionEvent(r: RobotState, prev: Status, next: Status, at: number): NewEvent | null {
  const id = r.info.id;
  const b = r.report ? `Battery ${Math.floor(r.report.battery)}%` : undefined;
  if (next === 'offline') return { id, t: at, kind: 'off', code: 'went_offline', text: 'Went offline', sub: 'No report for 10 s' };
  if (prev === 'never') return { id, t: at, kind: 'info', code: 'first_report', text: 'First report', sub: b };
  if (prev === 'offline') return { id, t: at, kind: 'ok', code: 'back_online', text: 'Back online', sub: b };
  if (next === 'low') return { id, t: at, kind: 'low', code: 'battery_low', text: 'Battery below 20%', sub: 'Low-battery threshold reached' };
  if (prev === 'low' && next === 'ok') return { id, t: at, kind: 'ok', code: 'battery_recovered', text: 'Battery back above 22%', sub: b };
  if (prev === 'error' && next !== 'error') return { id, t: at, kind: 'ok', code: 'fault_cleared', text: 'Fault cleared', sub: r.report?.task };
  return null;
}
