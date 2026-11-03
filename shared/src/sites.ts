/**
 * Site floor plans. One source for the client (drawing) and the simulator (movement).
 * All values are metres on a 64 × 28 m floor, origin top-left.
 */
export type Rect = [x: number, y: number, w: number, h: number];
export type Line = [x1: number, y1: number, x2: number, y2: number];
export type Zone = [x: number, y: number, w: number, h: number, label: string];

export interface Site {
  key: string;
  name: string;
  /** Aisle label prefix: A1, A2 … */
  prefix: string;
  racks: Rect[];
  aisles: Line[];
  zones: Zone[];
  charge: Rect;
}

export const FLOOR_W = 64;
export const FLOOR_H = 28;

export const SITES: Site[] = [
  {
    key: 'hh',
    name: 'Hamburg DC',
    prefix: 'A',
    racks: [[3, 3.6, 38, 1.6], [3, 8.6, 38, 1.6], [3, 13.6, 38, 1.6], [3, 18.6, 38, 1.6], [3, 23.6, 38, 1.6]],
    aisles: [[3, 6.1, 41, 6.1], [3, 11.1, 41, 11.1], [3, 16.1, 41, 16.1], [3, 21.1, 41, 21.1], [44, 3, 44, 25]],
    zones: [[47, 2, 14, 10, 'Charging'], [47, 14, 14, 12, 'Pack-out']],
    charge: [47, 2, 14, 10],
  },
  {
    key: 'le',
    name: 'Leipzig Hub',
    prefix: 'B',
    racks: [[4, 3, 1.6, 22], [9, 3, 1.6, 22], [14, 3, 1.6, 22], [19, 3, 1.6, 22], [24, 3, 1.6, 22], [29, 3, 1.6, 22], [34, 3, 1.6, 22]],
    aisles: [[7.3, 3, 7.3, 25], [12.3, 3, 12.3, 25], [17.3, 3, 17.3, 25], [22.3, 3, 22.3, 25], [27.3, 3, 27.3, 25], [32.3, 3, 32.3, 25], [38, 3, 38, 25]],
    zones: [[41, 2, 20, 10, 'Inbound'], [41, 15, 11, 11, 'Charging'], [54, 15, 7, 11, 'Out']],
    charge: [41, 15, 11, 11],
  },
  {
    key: 'mu',
    name: 'Munich North',
    prefix: 'C',
    racks: [[3, 3, 26, 1.6], [3, 7.5, 26, 1.6], [3, 12, 26, 1.6], [3, 16.5, 26, 1.6], [35, 3, 26, 1.6], [35, 7.5, 26, 1.6], [35, 12, 26, 1.6], [35, 16.5, 26, 1.6]],
    aisles: [[3, 5.3, 29, 5.3], [3, 9.8, 29, 9.8], [3, 14.3, 29, 14.3], [35, 5.3, 61, 5.3], [35, 9.8, 61, 9.8], [35, 14.3, 61, 14.3], [32, 2, 32, 19]],
    zones: [[3, 21, 18, 5, 'Charging'], [24, 21, 37, 5, 'Staging']],
    charge: [3, 21, 18, 5],
  },
  {
    // Newly commissioned: no robots assigned yet. Exists so the empty state is real, not mocked.
    key: 'be',
    name: 'Berlin South',
    prefix: 'D',
    racks: [[3, 4, 26, 1.6], [3, 9, 26, 1.6], [3, 14, 26, 1.6], [3, 19, 26, 1.6]],
    aisles: [[3, 6.6, 29, 6.6], [3, 11.6, 29, 11.6], [3, 16.6, 29, 16.6], [32, 3, 32, 24]],
    zones: [[36, 3, 25, 11, 'Inbound'], [36, 17, 12, 8, 'Charging'], [51, 17, 10, 8, 'Out']],
    charge: [36, 17, 12, 8],
  },
];

export const SITE_BY_KEY: Record<string, Site> = Object.fromEntries(SITES.map((s) => [s.key, s]));

/** Name of the aisle a point is on, e.g. "aisle B3", or the zone, or null. */
export function placeName(site: Site, x: number, y: number): string | null {
  for (const z of site.zones) {
    if (x >= z[0] && x <= z[0] + z[2] && y >= z[1] && y <= z[1] + z[3]) return `${z[4]} zone`;
  }
  let best: { i: number; d: number } | null = null;
  site.aisles.forEach((a, i) => {
    const horiz = a[1] === a[3];
    const d = horiz
      ? x >= a[0] - 1 && x <= a[2] + 1 ? Math.abs(y - a[1]) : Infinity
      : y >= a[1] - 1 && y <= a[3] + 1 ? Math.abs(x - a[0]) : Infinity;
    if (d < 1.2 && (!best || d < best.d)) best = { i, d };
  });
  return best ? `aisle ${site.prefix}${(best as { i: number }).i + 1}` : null;
}
