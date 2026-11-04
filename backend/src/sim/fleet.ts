/**
 * Robot fleet model. Deterministic (seeded) robots that work along aisles, drain battery, return to
 * dock and charge, plus scripted incidents. Used by:
 *   - demo/simulator.ts   the Part A in-process backend (`npm run dev`)
 *   - sim/mqtt-robots.ts  real MQTT clients, one per robot, for the Part B ingest server
 *
 * Events carry an origin, from their code. `robot` events (task, charging, fault, Wi-Fi) are things a robot
 * knows and would publish itself. `server` events (battery low, back above 22 %, went offline) are status
 * transitions, which in production the ingest server derives with the shared status rules; only the demo
 * backend emits them from here.
 */
import { SITE_BY_KEY, type Line, type Site } from '@fleet/shared/sites';
import { isRobotEventCode, type EventCode, type Report, type RobotEvent, type RobotInfo, type TaskKind } from '@fleet/shared/protocol';
import { nextLow } from '@fleet/shared/status';

const S = 1000;
const MIN = 60 * S;
export const BACKFILL_S = 15 * 60;

export type Mode = 'work' | 'idle' | 'charge' | 'travel' | 'wait' | 'fault' | 'gone' | 'never';
export type EventOrigin = 'robot' | 'server';
export const originOf = (code: EventCode): EventOrigin => (isRobotEventCode(code) ? 'robot' : 'server');

export interface SimRobot {
  info: RobotInfo;
  site: Site;
  mode: Mode;
  battery: number;
  drain: number; // % per second while not charging
  x: number;
  y: number;
  aisle: Line | null;
  u: number; // 0..2 ping-pong along the aisle
  speed: number; // m/s while working
  /** Display text, as reported. */
  task: string;
  taskKind: TaskKind;
  order: number | null;
  taskEnds: number;
  idleEnds: number;
  waypoints: [number, number][];
  travelSpeed: number;
  then: 'charge' | 'work';
  fault?: string;
  since: number;
  returnBelow: number;
  goneAt?: number;
  /** How the robot goes away at `goneAt`: `crash` drops the network link (MQTT LWT), `silent` stays connected and sends nothing. */
  goneHow?: 'crash' | 'silent';
  waitUntil?: number;
  chargeFrom?: number;
  /** Offset inside each second at which this robot reports, like real radios. */
  phase: number;
  /** Battery hysteresis latch, the same rule the status model uses. */
  low?: boolean;
  last: Report | null;
  battHist: [number, number][];
  trail: [number, number, number][];
  events: RobotEvent[];
}

export interface FleetOptions {
  /** Server time the live run starts at. The model simulates the 15 minutes before it. */
  start?: number;
  /**
   * `demo`: incidents happened before start, so the dashboard opens with them (Part A).
   * `live`: incidents happen shortly after start, so a fresh ingest server and database see them happen.
   */
  incidents?: 'demo' | 'live';
  /** Robots that report. 50 by default; more for load tests. R-051 (never reports) is always added. */
  count?: number;
  onEvent?: (e: RobotEvent, origin: EventOrigin) => void;
}

export interface Fleet {
  start: number;
  robots: SimRobot[];
  byId: (id: string) => SimRobot | undefined;
  /** Advance every robot to second `t` (epoch ms, whole second). */
  tick: (t: number) => void;
  registry: () => RobotInfo[];
}

const MODELS: [string, string][] = [
  ['Tote picker', 'Tote picker AMR-2'],
  ['Tote picker', 'Tote picker AMR-2'],
  ['Pallet mover', 'Pallet mover PM-4'],
  ['Sorter shuttle', 'Sorter shuttle SS-1'],
];
const SITE_CODE: Record<string, string> = { hh: 'HAM', le: 'LEI', mu: 'MUN', be: 'BER' };

const pp = (u: number) => (u < 1 ? u : 2 - u);
const len = (a: Line) => Math.hypot(a[2] - a[0], a[3] - a[1]);
const onAisle = (a: Line, f: number): [number, number] => [a[0] + (a[2] - a[0]) * f, a[1] + (a[3] - a[1]) * f];
const aisleName = (site: Site, a: Line) => `${site.prefix}${site.aisles.indexOf(a) + 1}`;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** u at time t0 so that the robot is at fraction f, moving forward, after `seconds` of work. */
function u0For(a: Line, f: number, speed: number, seconds: number) {
  const du = speed / len(a);
  let u = (f - du * seconds) % 2;
  if (u < 0) u += 2;
  return u;
}

export function createFleet(opts: FleetOptions = {}): Fleet {
  const START = opts.start ?? Math.floor(Date.now() / 1000) * 1000;
  const live = opts.incidents === 'live';
  const count = opts.count ?? 50;
  const T0 = START - BACKFILL_S * S;

  // ---------- deterministic randomness ----------
  let seed = 20261104;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  let nextOrder = 4510;

  function chargeSpot(site: Site): [number, number] {
    const c = site.charge;
    return [c[0] + 1.5 + rnd() * (c[2] - 3), c[1] + 2 + rnd() * (c[3] - 3)];
  }

  /** Aisle end nearest the charge zone, then a corridor point, then a bay. */
  function pathToCharge(r: SimRobot): [number, number][] {
    const spot = chargeSpot(r.site);
    if (!r.aisle) return [spot];
    const a = r.aisle;
    const ends: [number, number][] = [[a[0], a[1]], [a[2], a[3]]];
    const end = ends.sort((p, q) => Math.hypot(p[0] - spot[0], p[1] - spot[1]) - Math.hypot(q[0] - spot[0], q[1] - spot[1]))[0];
    const horiz = a[1] === a[3];
    const corridor: [number, number] = horiz ? [end[0], spot[1]] : [spot[0], end[1]];
    return [end, corridor, spot];
  }

  let eventSeq = 0;
  const ev = (id: string, t: number, kind: RobotEvent['kind'], code: EventCode, text: string, sub?: string, bay?: number): RobotEvent => ({
    id, eventId: `sim-${++eventSeq}`, t, kind, code, text, ...(sub !== undefined ? { sub } : {}), ...(bay !== undefined ? { bay } : {}),
  });

  function doing(r: SimRobot, taskKind: TaskKind, task: string) {
    r.taskKind = taskKind;
    r.task = task;
  }

  function log(r: SimRobot, t: number, kind: RobotEvent['kind'], code: EventCode, text: string, sub?: string, bay?: number) {
    const e = ev(r.info.id, t, kind, code, text, sub, bay);
    r.events.unshift(e);
    if (r.events.length > 80) r.events.pop();
    if (t >= START) opts.onEvent?.(e, originOf(code));
  }

  function startOrder(r: SimRobot, t: number) {
    r.order = nextOrder++;
    doing(r, 'picking', `Pick order #${r.order}`);
    r.taskEnds = t + (150 + rnd() * 270) * S;
    const dest = r.site.zones.find((z) => z[4] !== 'Charging' && z[4] !== 'Inbound')?.[4] ?? 'Out';
    log(r, t, 'info', 'task_started', `Task started: ${r.task}`, `Aisle ${r.aisle ? aisleName(r.site, r.aisle) : '—'} → ${dest}`);
  }

  function travel(r: SimRobot, t: number, points: [number, number][], then: 'charge' | 'work', speed = 0.6) {
    r.mode = 'travel';
    r.waypoints = points;
    r.travelSpeed = speed;
    r.then = then;
    if (then === 'charge') {
      if (r.order) log(r, t, 'info', 'task_paused', `Task paused: Pick order #${r.order}`, 'Returning to dock');
      doing(r, 'returning_to_dock', 'Returning to dock');
      r.order = null;
    }
  }

  function step(r: SimRobot, t: number) {
    if (r.goneAt !== undefined && t >= r.goneAt && r.mode !== 'gone') r.mode = 'gone';
    switch (r.mode) {
      case 'work': {
        const a = r.aisle!;
        r.u = (r.u + r.speed / len(a)) % 2;
        [r.x, r.y] = onAisle(a, pp(r.u));
        r.battery -= r.drain;
        if (r.battery < r.returnBelow) {
          travel(r, t, pathToCharge(r), 'charge');
        } else if (t >= r.taskEnds) {
          log(r, t, 'info', 'task_completed', `Task completed: Pick order #${r.order}`, `${4 + Math.floor(rnd() * 14)} totes`);
          if (rnd() < 0.35) {
            r.aisle = pick(r.site.aisles);
            r.u = 0;
            [r.x, r.y] = onAisle(r.aisle, 0);
          }
          startOrder(r, t);
        }
        break;
      }
      case 'travel': {
        r.battery -= r.drain;
        let budget = r.travelSpeed;
        while (budget > 0 && r.waypoints.length) {
          const [wx, wy] = r.waypoints[0];
          const d = Math.hypot(wx - r.x, wy - r.y);
          if (d <= budget) {
            r.x = wx;
            r.y = wy;
            budget -= d;
            r.waypoints.shift();
          } else {
            r.x += ((wx - r.x) / d) * budget;
            r.y += ((wy - r.y) / d) * budget;
            budget = 0;
          }
        }
        if (!r.waypoints.length) {
          if (r.then === 'charge') {
            r.mode = 'charge';
            doing(r, 'charging', 'Charging');
            r.chargeFrom = t;
            r.aisle = null;
            log(r, t, 'info', 'charging_started', 'Charging started', `Battery ${Math.floor(r.battery)}%`);
          } else {
            r.mode = 'work';
            startOrder(r, t);
          }
        }
        break;
      }
      case 'charge': {
        r.battery = Math.min(100, r.battery + 1 / 45);
        if (r.battery >= 95) {
          r.info.lastCharge = [r.chargeFrom ?? t - 40 * MIN, t];
          log(r, t, 'info', 'charging_finished', 'Charging finished', `Battery ${Math.floor(r.battery)}%`);
          // Scripted robots never return to dock on their own (returnBelow −1). After their first
          // charge they behave like the rest of the fleet, so long runs do not end at 0 %.
          if (r.returnBelow < 0) {
            r.returnBelow = 25;
            r.drain = 1 / 95;
          }
          r.aisle = pick(r.site.aisles);
          r.u = 0;
          doing(r, 'idle', 'Idle');
          travel(r, t, [onAisle(r.aisle, 0)], 'work');
        }
        break;
      }
      case 'idle': {
        r.battery -= r.drain / 4;
        if (t >= r.idleEnds && r.aisle) {
          r.mode = 'work';
          r.u = r.u || 0;
          startOrder(r, t);
        }
        break;
      }
      case 'wait': {
        r.battery = Math.max(1, r.battery - r.drain / 3);
        if (r.waitUntil !== undefined && t >= r.waitUntil) {
          log(r, t, 'info', 'bay_assigned', 'Charging bay assigned', 'A dock is free');
          travel(r, t, pathToCharge(r), 'charge', 0.3);
        }
        break;
      }
      case 'fault':
      case 'gone':
      case 'never':
        break;
    }
    r.battery = clamp(r.battery, 0, 100);
    const now = Math.floor(r.battery);

    if (r.mode !== 'gone' && r.mode !== 'never') {
      // Battery threshold events, with the same hysteresis as the status model.
      const wasLow = r.low;
      r.low = nextLow(now, wasLow ?? false);
      if (wasLow === false && r.low) log(r, t, 'low', 'battery_low', 'Battery below 20%', 'Low-battery threshold reached');
      if (wasLow === true && !r.low) log(r, t, 'ok', 'battery_recovered', 'Battery back above 22%', 'Charging');
    }

    // Server-side offline detection, for the event log.
    if (r.mode === 'gone' && r.last && t - r.last.t >= 10 * S && t - r.last.t < 11 * S) {
      log(r, t, 'off', 'went_offline', 'Went offline', 'No report for 10 s');
    }

    if (r.mode !== 'gone' && r.mode !== 'never') {
      r.last = {
        id: r.info.id,
        t,
        battery: now,
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        state: r.mode === 'fault' ? 'error' : 'ok',
        fault: r.fault,
        task: r.task,
        taskKind: r.taskKind,
        since: r.since,
      };
      if (t % (5 * S) === 0) r.battHist.push([t, Math.round(r.battery * 10) / 10]);
      if (t % (2 * S) === 0) r.trail.push([t, r.last.x, r.last.y]);
    }
    while (r.battHist.length && r.battHist[0][0] < t - BACKFILL_S * S) r.battHist.shift();
    while (r.trail.length && r.trail[0][0] < t - 4 * MIN) r.trail.shift();
  }

  // ---------- build the fleet ----------
  const SITE_ROTA = [SITE_BY_KEY.hh, SITE_BY_KEY.le, SITE_BY_KEY.mu];
  const SITE_OF = (i: number) => (i <= 18 ? SITE_BY_KEY.hh : i <= 35 ? SITE_BY_KEY.le : i <= 50 ? SITE_BY_KEY.mu : SITE_ROTA[i % 3]);

  function makeRobot(i: number): SimRobot {
    const id = 'R-' + String(i).padStart(3, '0');
    const site = SITE_OF(i);
    const roll = rnd();
    const [model, modelFull] = pick(MODELS);
    const since = START - (300 + Math.floor(rnd() * 150)) * MIN; // online for 5 to 7.5 h
    const r: SimRobot = {
      info: {
        id, model, modelFull, siteKey: site.key,
        firmware: rnd() < 0.8 ? '4.12.1' : '4.11.3',
        network: `AP ${SITE_CODE[site.key]}-${String.fromCharCode(65 + Math.floor(rnd() * 4))}${1 + Math.floor(rnd() * 5)}-0${1 + Math.floor(rnd() * 4)}`,
        registeredAt: START - 40 * 24 * 60 * MIN,
        lastCharge: null,
      },
      site, mode: 'work', battery: 50, drain: 1 / 95, x: 0, y: 0, aisle: null, u: 0,
      speed: 0.3 + rnd() * 0.5, task: 'Idle', taskKind: 'idle', order: null, taskEnds: 0, idleEnds: 0,
      waypoints: [], travelSpeed: 0.6, then: 'work', since: Math.round(since / S) * S, returnBelow: 25,
      phase: Math.floor(rnd() * 900), last: null, battHist: [], trail: [], events: [],
    };
    r.info.lastCharge = [r.since - 41 * MIN, r.since - 3 * MIN];

    if (roll < 0.15) {
      r.mode = 'charge';
      doing(r, 'charging', 'Charging');
      [r.x, r.y] = chargeSpot(site);
      r.battery = 30 + rnd() * 50;
    } else {
      r.aisle = pick(site.aisles);
      r.u = rnd() * 2;
      [r.x, r.y] = onAisle(r.aisle, pp(r.u));
      r.battery = 36 + rnd() * 60;
      if (roll < 0.3) {
        r.mode = 'idle';
        r.idleEnds = T0 + (300 + rnd() * 1200) * S;
      } else if (roll < 0.36) {
        r.battery = 25 + rnd() * 3;
        r.mode = 'work';
        r.order = nextOrder++;
        doing(r, 'picking', `Pick order #${r.order}`);
        r.taskEnds = T0 + 9999 * S;
      } else {
        r.mode = 'work';
        r.order = nextOrder++;
        doing(r, 'picking', `Pick order #${r.order}`);
        r.taskEnds = T0 + rnd() * 400 * S;
      }
    }
    r.events.push(ev(id, r.since, 'info', 'came_online', 'Came online', `Battery ${96 + Math.floor(rnd() * 5)}%`));
    return r;
  }

  const robots: SimRobot[] = [];
  for (let i = 1; i <= Math.min(count, 50); i++) robots.push(makeRobot(i));
  const index = new Map<string, SimRobot>();
  const byId = (id: string) => index.get(id) ?? robots.find((r) => r.info.id === id);
  const must = (id: string) => byId(id)!;

  // ---------- scripted incidents ----------
  interface Script { id: string; at: number; run: (r: SimRobot, t: number) => void; done?: boolean }
  const SCRIPTS: Script[] = [];
  const rel = (seconds: number) => START + seconds * S;
  const seedEvent = (r: SimRobot, seconds: number, kind: RobotEvent['kind'], code: EventCode, text: string, sub?: string) =>
    r.events.push(ev(r.info.id, rel(seconds), kind, code, text, sub));
  const sortEvents = (r: SimRobot) => r.events.sort((a, b) => b.t - a.t);
  const has = (id: string) => robots.some((r) => r.info.id === id);

  if (has('R-017')) {
    // Hamburg · low battery, on its way to charge, slow in power-save mode.
    const r = must('R-017');
    const a = SITE_BY_KEY.hh.aisles[1];
    Object.assign(r, { mode: 'work', aisle: a, speed: 0.5, battery: 26.05, drain: 0.8 / 60, returnBelow: -1, order: 4459, task: 'Pick order #4459', taskKind: 'picking', taskEnds: Infinity });
    r.u = u0For(a, (19 - 3) / 38, 0.5, 630);
    [r.x, r.y] = onAisle(a, pp(r.u));
    r.since = rel(-(6 * 3600 + 12 * 60));
    r.info.model = 'Tote picker'; r.info.modelFull = 'Tote picker AMR-2'; r.info.network = 'AP HAM-X-01'; r.info.firmware = '4.12.1';
    r.info.lastCharge = [r.since - 39 * MIN, r.since - 2 * MIN];
    r.events = [ev(r.info.id, r.since, 'info', 'came_online', 'Came online', 'Battery 98%')];
    seedEvent(r, -1453, 'info', 'task_completed', 'Task completed: Pick order #4452', '9 totes');
    seedEvent(r, -1438, 'info', 'task_started', 'Task started: Pick order #4459', 'Aisle A2 → Pack-out');
    sortEvents(r);
    SCRIPTS.push({ id: r.info.id, at: rel(-270), run: (r, t) => {
      r.aisle = a;
      travel(r, t, [[44, 11.1], [44, 6.6], [50.5, 6.6]], 'charge', 0.1);
    } });
    SCRIPTS.push({ id: r.info.id, at: rel(live ? 5 : -30), run: (r, t) => {
      if (!r.waypoints.length) return;
      let d = Math.hypot(r.waypoints[0][0] - r.x, r.waypoints[0][1] - r.y);
      for (let k = 1; k < r.waypoints.length; k++) d += Math.hypot(r.waypoints[k][0] - r.waypoints[k - 1][0], r.waypoints[k][1] - r.waypoints[k - 1][1]);
      const s = Math.round(d / r.travelSpeed / 10) * 10;
      log(r, t, 'info', 'bay_assigned', 'Charging bay 3 assigned', `Arrives in about ${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`, 3);
    } });
  }
  if (has('R-024')) {
    // Leipzig · motor overcurrent, stopped in aisle B3. Demo: 6 min before start. Live: 8 s after.
    const r = must('R-024');
    const a = SITE_BY_KEY.le.aisles[2];
    Object.assign(r, { mode: 'work', aisle: a, speed: 0.45, battery: 71.05 + 540 / 95, order: 4481, task: 'Pick order #4481', taskKind: 'picking', taskEnds: Infinity, returnBelow: -1 });
    r.u = u0For(a, (12.4 - 3) / 22, 0.45, 540);
    [r.x, r.y] = onAisle(a, pp(r.u));
    seedEvent(r, -1210, 'info', 'task_started', 'Task started: Pick order #4481', 'Aisle B3 → Out');
    sortEvents(r);
    SCRIPTS.push({ id: r.info.id, at: rel(live ? 8 : -360), run: (r, t) => {
      r.mode = 'fault';
      r.fault = 'Motor overcurrent';
      log(r, t, 'error', 'fault', 'Motor overcurrent', `Stopped in aisle B3 · drive motor 2`);
    } });
  }
  if (has('R-028')) {
    // Leipzig · drops below 20 % about 7 s after start. Demonstrates the status-change highlight.
    const r = must('R-028');
    const a = SITE_BY_KEY.le.aisles[4];
    Object.assign(r, { mode: 'work', aisle: a, speed: 0.4, battery: 20.07 + 900 / 95, drain: 1 / 95, returnBelow: 20, order: 4490, task: 'Pick order #4490', taskKind: 'picking', taskEnds: Infinity });
    r.u = u0For(a, (7.8 - 3) / 22, 0.4, 900);
    [r.x, r.y] = onAisle(a, pp(r.u));
  }
  if (has('R-032')) {
    // Leipzig · 9 %, idle, every charging bay busy. A dock frees up after 10 min.
    const r = must('R-032');
    const a = SITE_BY_KEY.le.aisles[6];
    Object.assign(r, { mode: 'wait', aisle: a, battery: 12.05, drain: 1 / 100, x: 38, y: 20.4, task: 'Idle — waiting for dock', taskKind: 'waiting_for_dock', order: null, waitUntil: rel(600) });
    seedEvent(r, -1860, 'low', 'battery_low', 'Battery below 20%', 'Low-battery threshold reached');
    seedEvent(r, -1090, 'info', 'task_completed', 'Task completed: Pick order #4447', '11 totes');
    seedEvent(r, -1080, 'warn', 'waiting_for_bay', 'Waiting for a charging bay', 'All 4 bays at Leipzig Hub are busy');
    sortEvents(r);
  }
  if (has('R-009')) {
    // Hamburg · stops reporting but stays connected. Demo: 34 s before start. Live: 35 s after.
    const r = must('R-009');
    const a = SITE_BY_KEY.hh.aisles[2];
    Object.assign(r, { mode: 'work', aisle: a, speed: 0.4, battery: 58.05 + 866 / 95, order: 4468, task: 'Pick order #4468', taskKind: 'picking', taskEnds: Infinity, goneAt: rel(live ? 35 : -33), goneHow: 'silent', returnBelow: -1 });
    r.u = u0For(a, (22.6 - 3) / 38, 0.4, 866);
    seedEvent(r, -1300, 'info', 'task_started', 'Task started: Pick order #4468', 'Aisle A3 → Pack-out');
    sortEvents(r);
  }
  if (has('R-041')) {
    // Munich · weak Wi-Fi in aisle C5, then the link drops. Demo: 3 min 4 s before start. Live: 45 s after.
    const r = must('R-041');
    const a = SITE_BY_KEY.mu.aisles[4];
    Object.assign(r, { mode: 'work', aisle: a, speed: 0.35, battery: 63.6 + 716 / 400, drain: 1 / 400, order: 4502, task: 'Pick order #4502', taskKind: 'picking', taskEnds: Infinity, goneAt: rel(live ? 45 : -183), goneHow: 'crash', returnBelow: -1 });
    r.u = u0For(a, (48.2 - 35) / 26, 0.35, 716);
    r.since = rel(-(4 * 3600 + 49 * 60 + 50));
    r.info.network = 'AP MUN-C5-03';
    r.events = [ev(r.info.id, r.since, 'info', 'came_online', 'Came online', 'Battery 100%')];
    seedEvent(r, -775, 'info', 'task_completed', 'Task completed: Pick order #4497', '14 totes');
    seedEvent(r, -772, 'info', 'task_started', 'Task started: Pick order #4502', 'Aisle C5 → Staging');
    sortEvents(r);
    SCRIPTS.push({ id: r.info.id, at: rel(live ? 20 : -370), run: (r, t) => log(r, t, 'warn', 'wifi_weak', 'Wi-Fi signal weak', '−82 dBm in aisle C5') });
  }
  {
    // R-051 · Munich · registered, never reported.
    const r: SimRobot = { ...makeRobot(51), site: SITE_BY_KEY.mu, mode: 'never', events: [], last: null };
    r.info = { ...r.info, id: 'R-051', siteKey: 'mu', registeredAt: rel(-43 * 60), lastCharge: null, network: '—', firmware: '4.12.1' };
    r.events = [ev('R-051', r.info.registeredAt, 'info', 'registered', 'Registered', 'Waiting for first report')];
    robots.push(r);
  }
  // Load-test robots beyond the scripted 50.
  for (let i = 52; i <= count + 1; i++) robots.push(makeRobot(i));
  for (const r of robots) index.set(r.info.id, r);

  function runScripts(t: number) {
    for (const sc of SCRIPTS) {
      if (!sc.done && sc.at <= t) {
        sc.done = true;
        sc.run(must(sc.id), t);
      }
    }
  }

  // ---------- backfill ----------
  for (let t = T0; t < START; t += S) {
    runScripts(t);
    for (const r of robots) step(r, t);
  }

  return {
    start: START,
    robots,
    byId,
    tick(t: number) {
      runScripts(t);
      for (const r of robots) step(r, t);
    },
    registry: () => robots.map((r) => r.info),
  };
}
