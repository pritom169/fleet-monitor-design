import type { Ingest, Report, RobotEvent, RobotInfo } from '@fleet/shared/protocol';
import type { ReportedStatus, Status } from '@fleet/shared/status';

export type { ReportedStatus, Status };
export type Connection = 'connecting' | 'live' | 'lost';
export type HoverSource = 'table' | 'map' | 'card' | 'list';

export type Judged = { status: 'never'; report: null } | { status: ReportedStatus; report: Report };

export type Robot = RobotFields & Judged;
export type ReportedRobot = Extract<Robot, { status: ReportedStatus }>;

interface RobotFields {
  id: string;
  info: RobotInfo;
  low: boolean;
  changedAt: number | null;
  ghosts: [number, number][];
}

export interface FleetState {
  ready: boolean;
  connection: Connection;
  attempt: number;
  nextRetryAt: number | null;
  lastMessageAt: number | null;
  ingest: Ingest;
  offset: number;
  now: number;
  ids: string[];
  robots: Record<string, Robot>;
  hover: { id: string; from: HoverSource } | null;
  liveEvents: RobotEvent[];
}

export type { Ingest, Report, RobotEvent, RobotInfo };
