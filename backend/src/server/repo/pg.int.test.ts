/** Repo edge cases against a real Postgres 16: migrations, empty batches, state round trip. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Repo, decodeCursor, encodeCursor } from './pg';
import { robot, startPostgres } from '../../test/harness';

let pg: StartedPostgreSqlContainer;
let repo: Repo;

beforeAll(async () => {
  pg = await startPostgres();
  repo = new Repo(pg.getConnectionUri());
});
afterAll(async () => {
  await repo?.close();
  await pg?.stop();
});

describe('Repo', () => {
  it('applies migrations once, and rolls back a failing one without recording it', async () => {
    expect(await repo.migrate()).toEqual(['001_init.sql', '002_event_codes.sql']);
    expect(await repo.migrate()).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    try {
      fs.writeFileSync(path.join(dir, '900_ok.sql'), 'CREATE TABLE mig_ok (x int);');
      fs.writeFileSync(path.join(dir, '901_bad.sql'), 'CREATE TABLE mig_bad (x int); SELECT nope FROM nowhere;');
      fs.writeFileSync(path.join(dir, 'README.md'), 'not a migration');
      await expect(repo.migrate(dir)).rejects.toMatchObject({ code: '42P01' });
      const names = (await repo.pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
      expect(names).toEqual(['001_init.sql', '002_event_codes.sql', '900_ok.sql']);
      expect((await repo.pool.query(`SELECT to_regclass('mig_bad') AS t`)).rows[0].t).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats empty batches as no-ops', async () => {
    await repo.upsertRegistry([]);
    await repo.upsertStates([]);
    await repo.insertTelemetry([]);
    await repo.insertEvents([]);
  });

  it('round-trips the registry and current state, one row per robot, skipping removed robots', async () => {
    await repo.upsertRegistry([robot('R-001', 'hh'), { ...robot('R-002', 'le'), network: null as unknown as string }]);
    const reg = await repo.loadRegistry();
    expect(reg.map((r) => [r.id, r.siteKey, r.network])).toEqual([['R-001', 'hh', 'AP test'], ['R-002', 'le', '—']]);
    expect(typeof reg[0].registeredAt).toBe('number');

    const now = Date.now();
    const report = (battery: number) => ({ id: 'R-001', t: now, battery, x: 1, y: 2, state: 'ok' as const, task: 'Idle', taskKind: 'idle' as const, since: 0 });
    await repo.upsertStates([
      { robotId: 'R-001', report: report(50), boot: 1, seq: 10, status: 'ok' },
      { robotId: 'R-001', report: report(19), boot: 1, seq: 11, status: 'low' }, // same robot twice in one batch
      { robotId: 'R-999', report: { ...report(5), id: 'R-999' }, boot: 1, seq: 1, status: 'low' }, // not in the registry
    ]);
    expect(await repo.loadState()).toEqual([{ robotId: 'R-001', report: report(19), boot: 1, seq: 11, status: 'low' }]);
  });

  it('keeps an event without a sub-line, and pages with a cursor', async () => {
    const t = Date.now();
    await repo.insertEvents([{ id: 'R-001', eventId: 'ev-plain', t, kind: 'info', code: 'other', text: 'plain' }]);
    const page = await repo.events('R-001', t - 1000, t + 1000, null, 1);
    expect(page.events).toEqual([{ id: 'R-001', eventId: 'ev-plain', t, kind: 'info', code: 'other', text: 'plain', seq: expect.any(Number) }]);
    expect(page.next).toBeNull();
  });

  it('stores code and bay, and ignores an event ID it already has (a retried batch)', async () => {
    const t = Date.now() + 5000;
    const e = { id: 'R-002', eventId: 'ev-bay', t, kind: 'info' as const, code: 'bay_assigned' as const, text: 'Charging bay 3 assigned', sub: 'A dock is free', bay: 3 };
    await repo.insertEvents([e]);
    await repo.insertEvents([e]);
    const page = await repo.events('R-002', t - 1000, t + 1000, null, 10);
    expect(page.events).toEqual([{ ...e, seq: expect.any(Number) }]);
  });
});

describe('cursors', () => {
  it('round-trips, and rejects anything else', () => {
    expect(decodeCursor(encodeCursor(1700000000000, 42))).toEqual({ t: 1700000000000, id: 42 });
    expect(decodeCursor('garbage')).toBeNull();
    expect(decodeCursor(Buffer.from('1:x').toString('base64url'))).toBeNull();
  });
});
