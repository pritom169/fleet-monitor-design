import { describe, expect, it } from 'vitest';
import { SITES, SITE_BY_KEY, placeName } from './sites';

describe('placeName', () => {
  const hh = SITE_BY_KEY.hh;
  const le = SITE_BY_KEY.le;

  it('names the zone a point is in, before any aisle', () => {
    expect(placeName(hh, 50, 5)).toBe('Charging zone');
    expect(placeName(hh, 61, 26)).toBe('Pack-out zone'); // edges count
  });

  it('names the nearest aisle within 1.2 m, horizontal or vertical', () => {
    expect(placeName(hh, 20, 6.5)).toBe('aisle A1');
    expect(placeName(hh, 20, 11.1)).toBe('aisle A2');
    expect(placeName(hh, 44.5, 20)).toBe('aisle A5'); // the vertical cross aisle
    expect(placeName(le, 7.6, 10)).toBe('aisle B1');
  });

  it('picks the closer of two aisles in range', () => {
    // On the Hamburg cross aisle, close to the end of A2: the vertical aisle is nearer.
    expect(placeName(hh, 43.9, 11.6)).toBe('aisle A5');
  });

  it('returns null away from every aisle and zone, and past an aisle’s end', () => {
    expect(placeName(hh, 20, 8.6)).toBeNull(); // on a rack, between aisles
    expect(placeName(hh, 1, 6.1)).toBeNull(); // before A1 starts
    expect(placeName(le, 7.3, 27)).toBeNull(); // past B1's end
  });

  it('has a site map keyed by site, including the empty Berlin floor', () => {
    expect(Object.keys(SITE_BY_KEY)).toEqual(SITES.map((s) => s.key));
    expect(SITE_BY_KEY.be.name).toBe('Berlin South');
  });
});
