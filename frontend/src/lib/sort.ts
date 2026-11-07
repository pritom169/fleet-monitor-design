import type { Robot } from '../data/types';
import { SEVERITY } from './status';

/**
 * Most urgent first, then by ID. The key uses only status and ID, so a battery or position
 * update can never move a row. Rows move only when a status changes.
 */
export function bySeverity(a: Robot, b: Robot): number {
  return SEVERITY[a.status] - SEVERITY[b.status] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const sortRobots = <R extends Robot>(rs: R[]): R[] => [...rs].sort(bySeverity);
