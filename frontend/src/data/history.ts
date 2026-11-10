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

export function useRobotHistory(id: string): History {
  const [h, setH] = useState<History>({ state: 'loading', battery: [], trail: [], events: [] });
  const connection = useFleet((s) => s.connection);
  const liveEvents = useFleet((s) => s.liveEvents);

  useEffect(() => {
    if (connection !== 'live') return;
    let cancelled = false;
    const load = () => fetch(`/api/robots/${encodeURIComponent(id)}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: unknown) => RobotHistory.parse(body))
      .then((d) => {
        if (cancelled) return;
        setH({ state: 'ready', battery: d.battery, trail: d.trail, events: d.events });
      })
      .catch(() => !cancelled && setH((p) => ({ ...p, state: p.battery.length ? p.state : 'error' })));
    load();
    const iv = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [id, connection]);

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
    const seen = new Set(h.events.map((e) => e.eventId));
    const fresh = liveEvents.filter((e) => e.id === id && !seen.has(e.eventId));
    return [...fresh, ...h.events].sort((a, b) => b.t - a.t);
  }, [h.events, liveEvents, id]);

  return { ...h, events };
}

export function batteryRate(points: [number, number][], minutes = 5): number | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const start = points.find((p) => p[0] >= end[0] - minutes * 60_000) ?? points[0];
  const dt = (end[0] - start[0]) / 60_000;
  if (dt < 1) return null;
  return (end[1] - start[1]) / dt;
}

export function lastCrossing(points: [number, number][], threshold = 20): number | null {
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i][1] < threshold && points[i - 1][1] >= threshold) return points[i][0];
  }
  return null;
}
