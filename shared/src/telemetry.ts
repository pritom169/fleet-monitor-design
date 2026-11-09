/**
 * MQTT payload contract (SYSTEM_DESIGN.md §10–11). Robots publish these; the ingest server validates
 * them at the boundary. The browser never sees these types: the server turns each accepted sample
 * into a protocol `Report` with `t = receivedAt`.
 */
import { z } from 'zod';
import { ROBOT_EVENT_CODES, TASK_KINDS } from './protocol';

export const Telemetry = z.object({
  id: z.string().min(1).max(64),
  siteId: z.string().min(1).max(64),
  /** Boot counter, +1 on each restart, stored on the robot. */
  boot: z.number().int().nonnegative(),
  /** +1 per message, reset to 0 on boot. */
  seq: z.number().int().nonnegative(),
  /** Robot clock, epoch ms. Stored, never used for ordering or freshness. */
  robotTs: z.number().int(),
  battery: z.number().min(0).max(100),
  x: z.number(),
  y: z.number(),
  state: z.enum(['ok', 'error']),
  fault: z.string().max(128).optional(),
  /** Display text only. */
  task: z.string().max(128),
  /** Missing or unknown (older or newer firmware) reads as `other`, so the sample is still accepted. */
  taskKind: z.enum(TASK_KINDS).catch('other'),
  since: z.number().int(),
});
export type Telemetry = z.infer<typeof Telemetry>;

/** Robot-side events: task started or completed, fault raised, Wi-Fi warning, charging. QoS 1. */
export const RobotEventMsg = z.object({
  id: z.string().min(1).max(64),
  robotTs: z.number().int(),
  kind: z.enum(['info', 'warn', 'error']),
  /** Missing or unknown reads as `other`, as for `taskKind`. */
  code: z.enum(ROBOT_EVENT_CODES).catch('other'),
  text: z.string().min(1).max(200),
  sub: z.string().max(200).optional(),
  bay: z.number().int().nonnegative().max(999).optional(),
});
export type RobotEventMsg = z.infer<typeof RobotEventMsg>;

/** Retained `online` on connect; the broker publishes the LWT `offline` on an unclean disconnect. */
export const ConnStatus = z.enum(['online', 'offline']);
export type ConnStatus = z.infer<typeof ConnStatus>;

export type TopicKind = 'telemetry' | 'event' | 'status';

export const topic = (siteId: string, robotId: string, kind: TopicKind) => `fleet/${siteId}/${robotId}/${kind}`;

/** `fleet/{siteId}/{robotId}/{kind}` → parts, or null for anything else (including the reserved `cmd` topics). */
export function parseTopic(t: string): { siteId: string; robotId: string; kind: TopicKind } | null {
  const m = /^fleet\/([^/]+)\/([^/]+)\/(telemetry|event|status)$/.exec(t);
  return m ? { siteId: m[1], robotId: m[2], kind: m[3] as TopicKind } : null;
}
