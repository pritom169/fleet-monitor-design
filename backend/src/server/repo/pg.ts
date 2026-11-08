/**
 * PostgreSQL access. The only module that imports `pg`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { EventCode, Report, type RobotEvent, type RobotHistory, type RobotInfo } from '@fleet/shared/protocol';
import type { Status } from '@fleet/shared/status';
import type { StoredState, TelemetryRow } from '../domain/fleet';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const DAY = 86_400_000;

/** History responses never exceed this many points (§13). */
export const MAX_POINTS = 500;
/** Longest range the telemetry endpoint accepts (§14). */
export const MAX_RANGE_MS = 7 * DAY;
/** Partitions older than this are dropped (§13). */
export const RETENTION_DAYS = 7;

export interface TelemetryPoint {
  t: number;
  batteryMin: number;
  batteryAvg: number;
  x: number;
  y: number;
}

export interface EventPage {
  events: (RobotEvent & { seq: number })[];
  next: string | null;
}

export class Repo {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    // query_timeout: a database that hangs (rather than refusing connections) must fail the write, so the
    // batch writer retries and readiness turns red. Without it one hung flush blocks the queue forever.
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
    // An idle client error must not crash the process; the next query reports it.
    this.pool.on('error', () => {});
  }

  close() {
    return this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  // ---------- schema ----------

  /** Apply migrations/*.sql in name order, once each. Safe to run from several processes. */
  async migrate(dir = MIGRATIONS): Promise<string[]> {
    const c = await this.pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock(727001)');
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
      const applied: string[] = [];
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        if (done.has(name)) continue;
        await c.query('BEGIN');
        try {
          await c.query(fs.readFileSync(path.join(dir, name), 'utf8'));
          await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          await c.query('COMMIT');
          applied.push(name);
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }
      return applied;
    } finally {
      await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
      c.release();
    }
  }

  /**
   * Daily partitions by received_at (server clock, UTC). Creates today and the next `ahead` days,
   * drops partitions older than the retention. Dropping a partition is instant; a DELETE is not.
   */
  async maintainPartitions(now = Date.now(), ahead = 2, keepDays = RETENTION_DAYS): Promise<{ created: string[]; dropped: string[] }> {
    const created: string[] = [];
    const dropped: string[] = [];
    const day0 = Math.floor(now / DAY) * DAY;
    for (let i = 0; i <= ahead; i++) {
      const from = new Date(day0 + i * DAY);
      const to = new Date(day0 + (i + 1) * DAY);
      const name = partitionName(from);
      const r = await this.pool.query(`SELECT to_regclass($1) AS t`, [name]);
      if (r.rows[0].t) continue;
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF telemetry FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
      );
      created.push(name);
    }
    const cutoff = partitionName(new Date(day0 - keepDays * DAY));
    const parts = await this.pool.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'telemetry'`,
    );
    for (const { name } of parts.rows) {
      if (/^telemetry_\d{8}$/.test(name) && name < cutoff) {
        await this.pool.query(`DROP TABLE IF EXISTS ${name}`);
        dropped.push(name);
      }
    }
    return { created, dropped };
  }

  // ---------- registry and state ----------

  async loadRegistry(): Promise<RobotInfo[]> {
    const r = await this.pool.query(`SELECT id, site_id, model, model_full, firmware, network, registered_at FROM robots ORDER BY id`);
    return r.rows.map((row) => ({
      id: row.id,
      siteKey: row.site_id,
      model: row.model,
      modelFull: row.model_full,
      firmware: row.firmware,
      network: row.network ?? '—',
      registeredAt: row.registered_at.getTime(),
      lastCharge: null,
    }));
  }

  async upsertRegistry(robots: RobotInfo[]): Promise<void> {
    if (!robots.length) return;
    await this.pool.query(
      `INSERT INTO robots (id, site_id, model, model_full, firmware, network, registered_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[])
       ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, model = EXCLUDED.model, model_full = EXCLUDED.model_full,
         firmware = EXCLUDED.firmware, network = EXCLUDED.network`,
      [
        robots.map((r) => r.id),
        robots.map((r) => r.siteKey),
        robots.map((r) => r.model),
        robots.map((r) => r.modelFull),
        robots.map((r) => r.firmware),
        robots.map((r) => r.network),
        robots.map((r) => new Date(r.registeredAt)),
      ],
    );
  }

  async loadState(): Promise<StoredState[]> {
    const r = await this.pool.query(`SELECT robot_id, report, boot, seq, status FROM robot_state`);
    // Parsed, not cast: a row stored by an older build lacks newer fields (`taskKind` reads as `other`).
    // A row that does not parse at all is skipped; the robot's next sample replaces it.
    return r.rows.flatMap((row) => {
      const report = Report.safeParse(row.report);
      if (!report.success) return [];
      return [{ robotId: row.robot_id, report: report.data, boot: row.boot, seq: Number(row.seq), status: row.status as Status }];
    });
  }

  async upsertStates(input: StoredState[]): Promise<void> {
    // One row per robot: a batch built up while the database was away holds many rows for the same
    // robot, and Postgres refuses to update one row twice in a single INSERT … ON CONFLICT.
    const rows = [...new Map(input.map((r) => [r.robotId, r])).values()];
    if (!rows.length) return;
    await this.pool.query(
      // The join skips robots removed from the registry since the row was queued: one stale row must not
      // fail the batch (robot_state references robots) and block every later state write.
      `INSERT INTO robot_state (robot_id, report, boot, seq, status, last_seen_at)
       SELECT u.* FROM unnest($1::text[], $2::jsonb[], $3::int[], $4::bigint[], $5::text[], $6::timestamptz[])
              AS u(robot_id, report, boot, seq, status, last_seen_at)
       JOIN robots r ON r.id = u.robot_id
       ON CONFLICT (robot_id) DO UPDATE SET report = EXCLUDED.report, boot = EXCLUDED.boot, seq = EXCLUDED.seq,
         status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at`,
      [
        rows.map((r) => r.robotId),
        rows.map((r) => JSON.stringify(r.report)),
        rows.map((r) => r.boot),
        rows.map((r) => r.seq),
        rows.map((r) => r.status),
        rows.map((r) => new Date(r.report.t)),
      ],
    );
  }

  // ---------- writes ----------

  /** One multi-row INSERT … SELECT FROM unnest(…) per batch (§12). */
  async insertTelemetry(rows: TelemetryRow[]): Promise<void> {
    if (!rows.length) return;
    await this.pool.query(
      `INSERT INTO telemetry (robot_id, boot, seq, received_at, robot_ts, battery, x, y, state, fault, task)
       SELECT * FROM unnest($1::text[], $2::int[], $3::bigint[], $4::timestamptz[], $5::timestamptz[],
                            $6::real[], $7::real[], $8::real[], $9::text[], $10::text[], $11::text[])`,
      [
        rows.map((r) => r.robotId),
        rows.map((r) => r.boot),
        rows.map((r) => r.seq),
        rows.map((r) => new Date(r.receivedAt)),
        rows.map((r) => new Date(r.robotTs)),
        rows.map((r) => r.battery),
        rows.map((r) => r.x),
        rows.map((r) => r.y),
        rows.map((r) => r.state),
        rows.map((r) => r.fault),
        rows.map((r) => r.task),
      ],
    );
  }

  async insertEvents(events: RobotEvent[]): Promise<void> {
    if (!events.length) return;
    await this.pool.query(
      `INSERT INTO robot_events (event_id, robot_id, t, kind, code, text, sub, bay)
       SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[])
       ON CONFLICT (event_id) DO NOTHING`,
      [
        events.map((e) => e.eventId),
        events.map((e) => e.id),
        events.map((e) => new Date(e.t)),
        events.map((e) => e.kind),
        events.map((e) => e.code),
        events.map((e) => e.text),
        events.map((e) => e.sub ?? null),
        events.map((e) => e.bay ?? null),
      ],
    );
  }

  // ---------- reads ----------

  /**
   * Downsampled telemetry: at most MAX_POINTS buckets. Position is the last value in each bucket,
   * never an average (the average of two positions can be inside a rack). Empty buckets return no row,
   * so gaps stay gaps.
   */
  async telemetry(robotId: string, from: number, to: number, maxPoints = MAX_POINTS): Promise<{ bucketMs: number; points: TelemetryPoint[] }> {
    const bucketMs = Math.max(1000, Math.ceil((to - from) / maxPoints / 1000) * 1000);
    const r = await this.pool.query(
      `SELECT date_bin(make_interval(secs => $4::double precision / 1000), received_at, $2::timestamptz) AS t,
              min(battery) AS battery_min,
              avg(battery) AS battery_avg,
              (array_agg(x ORDER BY received_at DESC))[1] AS x,
              (array_agg(y ORDER BY received_at DESC))[1] AS y
       FROM telemetry
       WHERE robot_id = $1 AND received_at >= $2 AND received_at < $3
       GROUP BY 1 ORDER BY 1`,
      [robotId, new Date(from), new Date(to), bucketMs],
    );
    return {
      bucketMs,
      points: r.rows.map((row) => ({
        t: row.t.getTime(),
        batteryMin: round1(row.battery_min),
        batteryAvg: round1(Number(row.battery_avg)),
        x: round1(row.x),
        y: round1(row.y),
      })),
    };
  }

  /** Newest first, keyset-paginated by (t, id). */
  async events(robotId: string, from: number, to: number, cursor: string | null, limit = 100): Promise<EventPage> {
    const c = cursor ? decodeCursor(cursor) : null;
    const r = await this.pool.query(
      `SELECT id, event_id, robot_id, t, kind, code, text, sub, bay FROM robot_events
       WHERE robot_id = $1 AND t >= $2 AND t < $3
         AND ($4::timestamptz IS NULL OR (t, id) < ($4::timestamptz, $5::bigint))
       ORDER BY t DESC, id DESC
       LIMIT $6`,
      [robotId, new Date(from), new Date(to), c ? new Date(c.t) : null, c?.id ?? 0, limit + 1],
    );
    const rows = r.rows.slice(0, limit);
    const events = rows.map((row) => ({
      id: row.robot_id as string,
      eventId: row.event_id as string,
      t: row.t.getTime() as number,
      kind: row.kind as RobotEvent['kind'],
      code: EventCode.catch('other').parse(row.code),
      text: row.text as string,
      ...(row.sub ? { sub: row.sub as string } : {}),
      ...(row.bay !== null ? { bay: row.bay as number } : {}),
      seq: Number(row.id),
    }));
    const last = events[events.length - 1];
    return { events, next: r.rows.length > limit && last ? encodeCursor(last.t, last.seq) : null };
  }

  /** The detail page's default view, in the same shape as the demo (§14). */
  async history(robotId: string, now: number, dayStart: number): Promise<RobotHistory> {
    const [battery, trail, events] = await Promise.all([
      this.pool.query(
        `SELECT date_bin('5 seconds', received_at, 'epoch') AS t, avg(battery) AS b
         FROM telemetry WHERE robot_id = $1 AND received_at >= $2
         GROUP BY 1 ORDER BY 1`,
        [robotId, new Date(now - 15 * 60_000)],
      ),
      this.pool.query(
        `SELECT date_bin('2 seconds', received_at, 'epoch') AS t,
                (array_agg(x ORDER BY received_at DESC))[1] AS x,
                (array_agg(y ORDER BY received_at DESC))[1] AS y
         FROM telemetry WHERE robot_id = $1 AND received_at >= $2
         GROUP BY 1 ORDER BY 1`,
        [robotId, new Date(now - 4 * 60_000)],
      ),
      this.events(robotId, dayStart, now + 60_000, null, 100),
    ]);
    return {
      id: robotId,
      battery: battery.rows.map((r) => [r.t.getTime(), round1(Number(r.b))]),
      trail: trail.rows.map((r) => [r.t.getTime(), round1(r.x), round1(r.y)]),
      events: events.events.map(({ seq: _seq, ...e }) => e),
    };
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function partitionName(d: Date): string {
  return `telemetry_${d.toISOString().slice(0, 10).replaceAll('-', '')}`;
}

export function encodeCursor(t: number, id: number): string {
  return Buffer.from(`${t}:${id}`).toString('base64url');
}

export function decodeCursor(s: string): { t: number; id: number } | null {
  const m = /^(\d+):(\d+)$/.exec(Buffer.from(s, 'base64url').toString());
  return m ? { t: Number(m[1]), id: Number(m[2]) } : null;
}
