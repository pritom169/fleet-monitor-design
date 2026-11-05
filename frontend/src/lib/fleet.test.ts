import { describe, expect, it } from 'vitest';
import { fleetState, info, rep, reported, T } from '../test/fixtures';
import { SITE_KEYS, aria, attention, countBy, isProblem, matches, overviewHeadline, reason, siteName, sitesWithRobots, type Counts } from './fleet';

const s = fleetState();
const robots = s.ids.map((id) => s.robots[id]);
const r = (id: string) => s.robots[id];
const rr = (id: string) => reported(s, id);
const n = countBy(robots);
const head = (o: Partial<Parameters<typeof overviewHeadline>[0]> = {}) =>
  overviewHeadline({ ready: true, connection: 'live', attempt: 0, lastMessageAt: T, site: 'all', n, sitesWithRobots: 3, ...o });

describe('counts', () => {
  it('counts robots by status, and the ones that need attention', () => {
    expect(n).toEqual({ all: 7, ok: 2, low: 1, error: 1, offline: 2, never: 1 });
    expect(attention(n)).toBe(4);
    expect(sitesWithRobots(robots)).toBe(3);
    expect(isProblem('low')).toBe(true);
  });
});

describe('siteName', () => {
  it('names known sites and passes unknown keys through', () => {
    expect(siteName('hh')).toBe('Hamburg DC');
    expect(siteName('xx')).toBe('xx');
    expect(SITE_KEYS).toEqual(['hh', 'le', 'mu', 'be']);
  });
});

describe('matches', () => {
  it('searches ID (with or without the dash), model, task, fault and site, case-insensitively', () => {
    expect(matches(r('R-001'), '')).toBe(true);
    expect(matches(r('R-001'), 'r001')).toBe(true);
    expect(matches(r('R-001'), ' r-001 ')).toBe(true);
    expect(matches(r('R-003'), 'overcurrent')).toBe(true);
    expect(matches(r('R-010'), 'leipzig')).toBe(true);
    expect(matches(r('R-002'), 'returning')).toBe(true);
    expect(matches(r('R-005'), 'tote')).toBe(true); // never reported: model still matches
    expect(matches(r('R-001'), 'munich')).toBe(false);
  });
});

describe('overviewHeadline', () => {
  it('says it is connecting, and whether the server answers', () => {
    expect(head({ ready: false })).toEqual(['Connecting to your fleet.', 'Waiting for the first report.']);
    expect(head({ ready: false, attempt: 2 })[1]).toBe('The fleet server is not answering yet.');
  });

  it('says a site is empty', () => {
    const empty: Counts = { all: 0, ok: 0, low: 0, error: 0, offline: 0, never: 0 };
    expect(head({ site: 'be', n: empty })).toEqual(['No robots at Berlin South yet.', 'A robot appears here after its first report.']);
  });

  it('describes our outage and the server’s, with the time of the data', () => {
    expect(head({ connection: 'lost' })).toEqual(['Live updates paused.', 'Showing the fleet as of 10:30:00. 4 robots needed attention then.']);
    expect(head({ connection: 'lost', lastMessageAt: null })[1]).toMatch(/^Showing the fleet as of —\./);
    expect(head({ ingest: { state: 'paused', frozenAt: T } })).toEqual(['Robot data paused.', 'Showing the fleet as of 10:30:00. 4 robots needed attention then.']);
    const one = { ...n, low: 1, error: 0, offline: 0 };
    expect(head({ ingest: { state: 'paused', frozenAt: null }, n: one })[1]).toBe('Showing the fleet as of —. 1 robot needed attention then.');
  });

  it('answers the question: who needs attention, and where', () => {
    expect(head()).toEqual(['4 robots need your attention.', '2 of 7 are running normally across 3 sites.']);
    expect(head({ site: 'hh', n: { ...n, low: 1, error: 0, offline: 0 } })[0]).toBe('1 robot needs your attention.');
    const calm: Counts = { all: 1, ok: 1, low: 0, error: 0, offline: 0, never: 0 };
    expect(head({ n: calm, sitesWithRobots: 1 })).toEqual(['All robots are running normally.', '1 robot across 1 site.']);
    expect(head({ n: { ...calm, all: 2, ok: 2 }, site: 'le' })[1]).toBe('2 robots at Leipzig Hub.');
  });
});

describe('reason and aria', () => {
  it('gives the one-line reason per status', () => {
    expect(reason(r('R-001'), T)).toBe('Pick order #4433');
    expect(reason(r('R-002'), T)).toBe('14% battery');
    expect(reason(r('R-003'), T)).toBe('Motor overcurrent');
    expect(reason({ ...rr('R-003'), report: rep('R-003', { state: 'error' }) }, T)).toBe('Error');
    expect(reason(r('R-004'), T)).toBe('Last seen 3 min 4 s ago');
    expect(reason(r('R-005'), T)).toBe('Waiting for first report');
  });

  it('labels a marker for screen readers', () => {
    expect(aria(r('R-001'), T)).toBe('R-001, OK, Pick order #4433');
    expect(aria(r('R-003'), T)).toBe('R-003, Error, Motor overcurrent');
    expect(aria(r('R-004'), T)).toBe('R-004, Offline, Last seen 3 min 4 s ago');
    expect(aria(r('R-005'), T)).toBe('R-005, Never reported, ');
    expect(info('x').siteKey).toBe('hh');
  });
});
