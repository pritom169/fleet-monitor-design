import { describe, expect, it } from 'vitest';
import { EVENT_CODES, TASK_KINDS } from '@fleet/shared/protocol';
import { createFleet, originOf } from './fleet';

const START = 1_800_000_000_000;

describe('simulated fleet', () => {
  const fleet = createFleet({ start: START, incidents: 'demo' });
  for (let t = START; t < START + 60_000; t += 1000) fleet.tick(t);
  const events = fleet.robots.flatMap((r) => r.events);

  it('gives every event a unique ID and a known code', () => {
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
    for (const e of events) expect(EVENT_CODES).toContain(e.code);
  });

  it('reports a task kind that matches what the robot is doing', () => {
    for (const r of fleet.robots) if (r.last) expect(TASK_KINDS).toContain(r.last.taskKind);
    expect(fleet.byId('R-032')!.last!.taskKind).toBe('waiting_for_dock');
    expect(fleet.byId('R-017')!.last!.taskKind).toBe('returning_to_dock');
    const charging = fleet.robots.filter((r) => r.mode === 'charge');
    expect(charging.length).toBeGreaterThan(0);
    for (const r of charging) expect(r.last!.taskKind).toBe('charging');
  });

  it('puts the bay number on the event, not only in its text', () => {
    expect(fleet.byId('R-017')!.events.find((e) => e.code === 'bay_assigned')).toMatchObject({ bay: 3 });
  });

  it('takes the origin from the code: status transitions are the server’s', () => {
    expect(originOf('battery_low')).toBe('server');
    expect(originOf('went_offline')).toBe('server');
    expect(originOf('bay_assigned')).toBe('robot');
  });
});
