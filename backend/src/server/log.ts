import pino from 'pino';

export const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { svc: 'fleet-ingest' } });
export type Log = typeof log;

export function sampled(windowMs = 10_000, perWindow = 5) {
  const seen = new Map<string, { from: number; n: number; skipped: number }>();
  return (key: string, fn: (skipped: number) => void) => {
    const now = Date.now();
    let s = seen.get(key);
    if (!s || now - s.from > windowMs) {
      const skipped = s?.skipped ?? 0;
      s = { from: now, n: 0, skipped: 0 };
      seen.set(key, s);
      s.n++;
      return fn(skipped);
    }
    if (s.n < perWindow) {
      s.n++;
      return fn(0);
    }
    s.skipped++;
  };
}

export function errText(err: unknown): string {
  const e = err as { code?: string; message?: string; errors?: { code?: string; message?: string }[] };
  const inner = e?.errors?.[0];
  return [e?.code ?? inner?.code, e?.message || inner?.message].filter(Boolean).join(' ') || String(err);
}
