/**
 * Write the simulated fleet's registry to Postgres (and run migrations first).
 * In a real deployment the registry comes from provisioning; this stands in for it.
 *
 * Env: DATABASE_URL, ROBOTS (50).
 */
import { Repo } from '../server/repo/pg';
import { createFleet } from './fleet';

const repo = new Repo(process.env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/fleet');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; ; i++) {
  try {
    await repo.ping();
    break;
  } catch (e) {
    if (i >= 30) throw e;
    console.log(`[seed] waiting for the database (${(e as Error).message})`);
    await sleep(1000);
  }
}
const applied = await repo.migrate();
if (applied.length) console.log(`[seed] migrations applied: ${applied.join(', ')}`);
await repo.maintainPartitions();
const registry = createFleet({ count: Number(process.env.ROBOTS ?? 50) }).registry();
await repo.upsertRegistry(registry);
console.log(`[seed] registry: ${registry.length} robots`);
await repo.close();
