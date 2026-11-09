import { z } from 'zod';
import { ROBOT_EVENT_CODES, TASK_KINDS } from './protocol';

export const Telemetry = z.object({
  id: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  boot: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  robotTs: z.number().int(),
  battery: z.number().min(0).max(100),
  x: z.number(),
  y: z.number(),
  state: z.enum(['ok', 'error']),
  fault: z.string().max(128).optional(),
  task: z.string().max(128),
  taskKind: z.enum(TASK_KINDS).catch('other'),
  since: z.number().int(),
});
export type Telemetry = z.infer<typeof Telemetry>;

export const RobotEventMsg = z.object({
  id: z.string().min(1).max(64),
  robotTs: z.number().int(),
  kind: z.enum(['info', 'warn', 'error']),
  code: z.enum(ROBOT_EVENT_CODES).catch('other'),
  text: z.string().min(1).max(200),
  sub: z.string().max(200).optional(),
  bay: z.number().int().nonnegative().max(999).optional(),
});
export type RobotEventMsg = z.infer<typeof RobotEventMsg>;

export const ConnStatus = z.enum(['online', 'offline']);
export type ConnStatus = z.infer<typeof ConnStatus>;

export type TopicKind = 'telemetry' | 'event' | 'status';

export const topic = (siteId: string, robotId: string, kind: TopicKind) => `fleet/${siteId}/${robotId}/${kind}`;

export function parseTopic(t: string): { siteId: string; robotId: string; kind: TopicKind } | null {
  const m = /^fleet\/([^/]+)\/([^/]+)\/(telemetry|event|status)$/.exec(t);
  return m ? { siteId: m[1], robotId: m[2], kind: m[3] as TopicKind } : null;
}
