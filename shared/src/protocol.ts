import { z } from 'zod';

export const RobotInfo = z.object({
  id: z.string(),
  model: z.string(),
  modelFull: z.string(),
  siteKey: z.string(),
  firmware: z.string(),
  network: z.string(),
  registeredAt: z.number(),
  lastCharge: z.tuple([z.number(), z.number()]).nullable(),
});
export type RobotInfo = z.infer<typeof RobotInfo>;

export const TASK_KINDS = ['picking', 'returning_to_dock', 'waiting_for_dock', 'charging', 'idle', 'other'] as const;
export const TaskKind = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKind>;

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

export const EVENT_CODES = [...ROBOT_EVENT_CODES, ...SERVER_EVENT_CODES] as const;
export const EventCode = z.enum(EVENT_CODES);
export type EventCode = z.infer<typeof EventCode>;

const SERVER_CODES: ReadonlySet<EventCode> = new Set(SERVER_EVENT_CODES);
export const isRobotEventCode = (c: EventCode): c is RobotEventCode => !SERVER_CODES.has(c);

export const Report = z.object({
  id: z.string(),
  t: z.number(),
  battery: z.number(),
  x: z.number(),
  y: z.number(),
  state: z.enum(['ok', 'error']),
  fault: z.string().optional(),
  task: z.string(),
  taskKind: TaskKind.catch('other'),
  since: z.number(),
  skew: z.number().optional(),
});
export type Report = z.infer<typeof Report>;

export const EventKind = z.enum(['info', 'low', 'warn', 'error', 'off', 'ok']);
export type EventKind = z.infer<typeof EventKind>;

export const RobotEvent = z.object({
  id: z.string(),
  eventId: z.string(),
  t: z.number(),
  kind: EventKind,
  code: EventCode.catch('other'),
  text: z.string(),
  sub: z.string().optional(),
  bay: z.number().int().nonnegative().optional(),
});
export type RobotEvent = z.infer<typeof RobotEvent>;

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
  z.object({ type: z.literal('ingest'), ingest: Ingest }),
  z.object({ type: z.literal('heartbeat'), serverTime: z.number() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(ServerMessage.options.map((o) => o.shape.type.value));

export const RobotHistory = z.object({
  id: z.string(),
  battery: z.array(z.tuple([z.number(), z.number()])),
  trail: z.array(z.tuple([z.number(), z.number(), z.number()])),
  events: z.array(RobotEvent),
});
export type RobotHistory = z.infer<typeof RobotHistory>;
