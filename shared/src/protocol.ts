/**
 * Wire protocol between the fleet server and the client.
 * All timestamps are server epoch milliseconds.
 *
 * Each type is a zod schema plus the type inferred from it, so the client can validate what it receives
 * (the server's messages are untrusted input to the browser) against the same definition the server
 * compiles against. Objects are not strict: unknown keys are dropped, so a newer server can add fields.
 */
import { z } from 'zod';

/** Static registry entry. Sent once per connection. */
export const RobotInfo = z.object({
  id: z.string(),
  model: z.string(),
  modelFull: z.string(),
  siteKey: z.string(),
  firmware: z.string(),
  network: z.string(),
  registeredAt: z.number(),
  /** [start, end] */
  lastCharge: z.tuple([z.number(), z.number()]).nullable(),
});
export type RobotInfo = z.infer<typeof RobotInfo>;

/**
 * What a robot is doing, for logic. `Report.task` is the matching display text ("Pick order #4459") and
 * may change wording at any time; code branches on `taskKind`, never on `task`.
 * An unknown value (a newer robot or server) reads as `other` everywhere it is parsed.
 */
export const TASK_KINDS = ['picking', 'returning_to_dock', 'waiting_for_dock', 'charging', 'idle', 'other'] as const;
export const TaskKind = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKind>;

/** Events a robot publishes about itself (MQTT `…/event`). */
export const ROBOT_EVENT_CODES = [
  'came_online',
  'task_started',
  'task_paused',
  'task_completed',
  'charging_started',
  'charging_finished',
  'bay_assigned',
  'waiting_for_bay',
  'wifi_weak',
  'fault',
  'other',
] as const;
export type RobotEventCode = (typeof ROBOT_EVENT_CODES)[number];

/** Events the server derives: status transitions, the broker's last will, registration. */
export const SERVER_EVENT_CODES = [
  'registered',
  'first_report',
  'went_offline',
  'back_online',
  'battery_low',
  'battery_recovered',
  'fault_cleared',
  'broker_disconnect',
] as const;
export type ServerEventCode = (typeof SERVER_EVENT_CODES)[number];

/** What an event means, for logic. `RobotEvent.text` and `sub` are display text only. */
export const EVENT_CODES = [...ROBOT_EVENT_CODES, ...SERVER_EVENT_CODES] as const;
export const EventCode = z.enum(EVENT_CODES);
export type EventCode = z.infer<typeof EventCode>;

const SERVER_CODES: ReadonlySet<EventCode> = new Set(SERVER_EVENT_CODES);
export const isRobotEventCode = (c: EventCode): c is RobotEventCode => !SERVER_CODES.has(c);

/** What a robot reports, about once per second. */
export const Report = z.object({
  id: z.string(),
  t: z.number(),
  battery: z.number(),
  x: z.number(),
  y: z.number(),
  /** The robot's own view of itself. "offline" is never reported; it is derived. */
  state: z.enum(['ok', 'error']),
  fault: z.string().optional(),
  /** Display text only. Branch on `taskKind`. */
  task: z.string(),
  taskKind: TaskKind.catch('other'),
  /** When the robot came online this shift. */
  since: z.number(),
  /**
   * Robot clock skew in ms: server receive time minus the robot's own timestamp, smoothed. Positive means
   * the robot's clock is behind. Includes network transit (milliseconds). Absent from the demo backend.
   * Shown for diagnosis only: ordering and freshness never use the robot clock.
   */
  skew: z.number().optional(),
});
export type Report = z.infer<typeof Report>;

export const EventKind = z.enum(['info', 'low', 'warn', 'error', 'off', 'ok']);
export type EventKind = z.infer<typeof EventKind>;

export const RobotEvent = z.object({
  /** The robot's ID. */
  id: z.string(),
  /** Unique per event, and the same on the live `event` message and in history, so clients dedupe on it. */
  eventId: z.string(),
  t: z.number(),
  /** Severity, for styling. */
  kind: EventKind,
  /** What happened, for logic. */
  code: EventCode.catch('other'),
  /** Display text only. */
  text: z.string(),
  sub: z.string().optional(),
  /** Charging bay number, on `bay_assigned` when the robot was given a specific bay. */
  bay: z.number().int().nonnegative().optional(),
});
export type RobotEvent = z.infer<typeof RobotEvent>;

/**
 * Whether the server is receiving robot data. `paused` means the server lost its own link to the robots
 * (the MQTT broker). `frozenAt` is the server time of the last robot message it received: the client
 * judges freshness against it, so robots are not marked offline because of our outage.
 */
export const Ingest = z.object({
  state: z.enum(['live', 'paused']),
  frozenAt: z.number().nullable(),
});
export type Ingest = z.infer<typeof Ingest>;

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    serverTime: z.number(),
    robots: z.array(RobotInfo),
    reports: z.array(Report),
    ingest: Ingest.optional(),
  }),
  z.object({ type: z.literal('report'), r: Report }),
  z.object({ type: z.literal('event'), e: RobotEvent }),
  /** Sent when the ingest state changes after `hello`. */
  z.object({ type: z.literal('ingest'), ingest: Ingest }),
  /** Sent every 2 s, so an open socket is never silent while no reports flow (ingest paused, all robots offline). */
  z.object({ type: z.literal('heartbeat'), serverTime: z.number() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** The `type` values this build understands. Anything else is from a newer server and is ignored. */
export const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(ServerMessage.options.map((o) => o.shape.type.value));

export const RobotHistory = z.object({
  id: z.string(),
  /** [t, battery] every 5 s, last 15 min, only while the robot was reporting. */
  battery: z.array(z.tuple([z.number(), z.number()])),
  /** [t, x, y] every 2 s, last 4 min. */
  trail: z.array(z.tuple([z.number(), z.number(), z.number()])),
  /** Today, newest first. */
  events: z.array(RobotEvent),
});
export type RobotHistory = z.infer<typeof RobotHistory>;
