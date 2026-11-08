/**
 * WebSocket fan-out to browsers (SYSTEM_DESIGN.md §14).
 *
 * - Reports are coalesced per client to at most one per robot per second.
 * - If a client's send buffer passes 1 MB, only the newest report per robot is kept for it.
 *   If the buffer does not drain within 10 s, the socket is closed. The client reconnects and
 *   gets a fresh `hello`, so nothing is lost but staleness.
 */
import type { Report, ServerMessage } from '@fleet/shared/protocol';

export interface Sink {
  send(data: string): void;
  readonly bufferedAmount: number;
  /** Close at once. `reason` is for metrics. */
  terminate(reason: 'slow' | 'shutdown'): void;
}

export const MIN_GAP_MS = 900; // 1 Hz with radio jitter
export const BUFFER_LIMIT = 1 << 20;
export const DRAIN_TIMEOUT_MS = 10_000;

interface Client {
  sink: Sink;
  lastSent: Map<string, number>;
  pending: Map<string, Report>;
  overSince: number | null;
}

export class Fanout {
  private clients = new Set<Client>();

  constructor(private readonly now: () => number = Date.now) {}

  get size() {
    return this.clients.size;
  }

  add(sink: Sink, hello: ServerMessage): () => void {
    const c: Client = { sink, lastSent: new Map(), pending: new Map(), overSince: null };
    this.clients.add(c);
    sink.send(JSON.stringify(hello));
    return () => this.clients.delete(c);
  }

  /** Small, rare messages for everyone (ingest state, heartbeats) go straight out. */
  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) c.sink.send(data);
  }

  /** Send every client a fresh snapshot, e.g. after the registry changed. */
  resync(hello: ServerMessage) {
    const data = JSON.stringify(hello);
    for (const c of this.clients) {
      c.pending.clear();
      c.sink.send(data);
    }
  }

  report(r: Report) {
    const now = this.now();
    let data: string | null = null;
    for (const c of this.clients) {
      const last = c.lastSent.get(r.id) ?? -Infinity;
      if (c.sink.bufferedAmount <= BUFFER_LIMIT && now - last >= MIN_GAP_MS) {
        data ??= JSON.stringify({ type: 'report', r } satisfies ServerMessage);
        c.sink.send(data);
        c.lastSent.set(r.id, now);
        c.pending.delete(r.id);
      } else {
        c.pending.set(r.id, r); // newest per robot wins
      }
    }
  }

  /** Call every ~250 ms: send coalesced reports that are due, and cut clients that never drain. */
  flush() {
    const now = this.now();
    for (const c of [...this.clients]) {
      if (c.sink.bufferedAmount > BUFFER_LIMIT) {
        c.overSince ??= now;
        if (now - c.overSince > DRAIN_TIMEOUT_MS) {
          this.clients.delete(c);
          c.sink.terminate('slow');
        }
        continue;
      }
      c.overSince = null;
      for (const [id, r] of c.pending) {
        if (now - (c.lastSent.get(id) ?? -Infinity) < MIN_GAP_MS) continue;
        c.sink.send(JSON.stringify({ type: 'report', r } satisfies ServerMessage));
        c.lastSent.set(id, now);
        c.pending.delete(id);
      }
    }
  }

  closeAll() {
    for (const c of this.clients) c.sink.terminate('shutdown');
    this.clients.clear();
  }
}
