import type { Ingest, Report, RobotEvent, RobotInfo } from '@fleet/shared/protocol';
import type { ReportedStatus, Status } from '@fleet/shared/status';

export type { ReportedStatus, Status };
export type Connection = 'connecting' | 'live' | 'lost';
export type HoverSource = 'table' | 'map' | 'card' | 'list';

/**
 * Status and report travel together: `never` means no report, and every other status has one.
 * Checking `r.status` (or `r.report`) narrows the other, so no `report!` is needed.
 */
export type Judged = { status: 'never'; report: null } | { status: ReportedStatus; report: Report };

export type Robot = RobotFields & Judged;
/** A robot that has reported at least once. */
export type ReportedRobot = Extract<Robot, { status: ReportedStatus }>;

interface RobotFields {
  id: string;
  info: RobotInfo;
  /** Battery hysteresis latch (enter low below 20 %, leave at 22 %). Kept with `nextLow`. */
  low: boolean;
  /** Server time of the last status change seen in this session; null if none. Drives the row highlight. */
  changedAt: number | null;
  /** Last few positions, oldest first, for map trails. */
  ghosts: [number, number][];
}

export interface FleetState {
  /** Registry received at least once. */
  ready: boolean;
  connection: Connection;
  /** Reconnect attempts since the last good connection. */
  attempt: number;
  /** Client time of the next reconnect attempt. */
  nextRetryAt: number | null;
  /** Server time of the newest message received. */
  lastMessageAt: number | null;
  /** Whether the server is receiving robot data. */
  ingest: Ingest;
  /** serverTime − Date.now(), measured at hello. */
  offset: number;
  /** Server-time clock, advanced by the single 1 Hz ticker. */
  now: number;
  ids: string[];
  robots: Record<string, Robot>;
  hover: { id: string; from: HoverSource } | null;
  /** Events received live, newest first. */
  liveEvents: RobotEvent[];
}

export type { Ingest, Report, RobotEvent, RobotInfo };
