import { useEffect, useMemo, useState } from 'react';
import { RobotHistory, type Report, type RobotEvent } from '@fleet/shared/protocol';
import { fleet, useFleet } from './store';

const TRAIL_WINDOW = 4 * 60_000;

export interface History {
  state: 'loading' | 'ready' | 'error';
  battery: [number, number][];
  trail: [number, number, number][];
  events: RobotEvent[];
}

/**
 * Battery (15 min), trail (4 min) and today's events for one robot.
 * Fetched on open, every 10 s, and after a reconnect; the trail is extended from live reports.
 */
export function useRobotHistory(id: string): History {
  const [h, setH] = useState<History>({ state: 'loading', battery: [], trail: [], events: [] });
  const connection = useFleet((s) => s.connection);
  const liveEvents = useFleet((s) => s.liveEvents);

  useEffect(() => {
    if (connection !== 'live') return;
    let cancelled = false;
    const load = () => fetch(`/api/robots/${encodeURIComponent(id)}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // Validated like every socket message: events must carry the `eventId` the merge below dedupes on.
      .then((body: unknown) => RobotHistory.parse(body))
      .then((d) => {
        if (cancelled) return;
        setH({ state: 'ready', battery: d.battery, trail: d.trail, events: d.events });
      })
      .catch(() => !cancelled && setH((p) => ({ ...p, state: p.battery.length ? p.state : 'error' })));
    load();
    // Battery history is kept at 0.1 % on the server; refresh it rather than appending whole-percent live values.
    const iv = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [id, connection]);

  // Extend with live reports, at the same density as the server history. A store subscription, not an
  // effect on a selected report: the update comes from outside React, so it is set from the store's callback.
  useEffect(() => {
    let last: Report | null = null;
    return fleet.subscribe(() => {
      const report = fleet.get().robots[id]?.report ?? null;
      if (!report || report === last) return;
      last = report;
      setH((p) => {
        if (p.state !== 'ready') return p;
        let { trail } = p;
        const lastT = trail[trail.length - 1];
        if (!lastT || report.t - lastT[0] >= 2000) trail = [...trail, [report.t, report.x, report.y]];
        if (trail === p.trail) return p;
        trail = trail.filter((b) => b[0] >= report.t - TRAIL_WINDOW);
        return { ...p, trail };
      });
    });
  }, [id]);

  const events = useMemo(() => {
    // The server gives each event one ID, on the live message and in history alike.
    const seen = new Set(h.events.map((e) => e.eventId));
    const fresh = liveEvents.filter((e) => e.id === id && !seen.has(e.eventId));
    return [...fresh, ...h.events].sort((a, b) => b.t - a.t);
  }, [h.events, liveEvents, id]);

  return { ...h, events };
}

/** Battery change in % per minute over the last `minutes`, or null if not enough data. */
export function batteryRate(points: [number, number][], minutes = 5): number | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const start = points.find((p) => p[0] >= end[0] - minutes * 60_000) ?? points[0];
  const dt = (end[0] - start[0]) / 60_000;
  if (dt < 1) return null;
  return (end[1] - start[1]) / dt;
}

/** When the battery last went below 20%, if that happened inside the window. */
export function lastCrossing(points: [number, number][], threshold = 20): number | null {
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i][1] < threshold && points[i - 1][1] >= threshold) return points[i][0];
  }
  return null;
}
