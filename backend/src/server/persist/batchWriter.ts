export interface BatchWriterOptions<T> {
  name: string;
  capacity: number;
  maxBatch: number;
  maxWaitMs: number;
  write: (batch: T[]) => Promise<void>;
  onDrop?: (n: number) => void;
  onWritten?: (n: number, seconds: number) => void;
  onError?: (err: unknown, attempt: number) => void;
  isFatal?: (err: unknown) => boolean;
  isolate?: (err: unknown) => boolean;
  onFatal?: (err: unknown, dropped: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  now?: () => number;
}

export const BACKOFF_MIN_MS = 100;
export const BACKOFF_MAX_MS = 5000;

export class BatchWriter<T> {
  private buf: T[] = [];
  private head = 0;
  private inFlight: T[] | null = null;
  private splits: T[][] = [];
  private splitItems = 0;
  private timer: unknown = null;
  private timerAt = 0;
  private attempt = 0;
  private closed = false;
  private healthy = true;
  private idle: (() => void)[] = [];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly now: () => number;

  constructor(private readonly o: BatchWriterOptions<T>) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = o.now ?? (() => performance.now());
  }

  get depth(): number {
    return this.buf.length - this.head + this.splitItems;
  }

  get ok(): boolean {
    return this.healthy;
  }

  push(item: T) {
    if (this.closed) return;
    this.buf.push(item);
    const over = this.depth - this.o.capacity;
    if (over > 0) {
      this.head += over;
      this.o.onDrop?.(over);
    }
    this.compact();
    if (this.depth >= this.o.maxBatch) this.kick(0);
    else this.kick(this.o.maxWaitMs);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (!this.inFlight && this.depth === 0) return;
    await new Promise<void>((resolve) => {
      this.idle.push(resolve);
      this.kick(0);
    });
  }

  private kick(ms: number) {
    if (this.inFlight) return;
    const at = this.now() + ms;
    if (this.timer !== null) {
      if (this.timerAt <= at) return;
      this.clearTimer(this.timer);
    }
    this.timerAt = at;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private async flush() {
    if (this.inFlight) return;
    if (this.depth === 0) return this.settle();
    const split = this.splits.shift();
    let batch: T[];
    if (split) {
      batch = split;
      this.splitItems -= split.length;
    } else {
      batch = this.buf.slice(this.head, this.head + this.o.maxBatch);
      this.head += batch.length;
      this.compact();
    }
    this.inFlight = batch;
    const t0 = this.now();
    try {
      await this.o.write(batch);
      this.healthy = true;
      this.attempt = 0;
      this.inFlight = null;
      this.o.onWritten?.(batch.length, (this.now() - t0) / 1000);
      if (this.depth > 0) this.kick(this.depth >= this.o.maxBatch || this.closed ? 0 : this.o.maxWaitMs);
      else this.settle();
    } catch (err) {
      if (this.o.isFatal?.(err)) {
        this.inFlight = null;
        this.attempt = 0;
        if (batch.length > 1 && this.o.isolate?.(err)) {
          const mid = Math.ceil(batch.length / 2);
          this.splits.unshift(batch.slice(0, mid), batch.slice(mid));
          this.splitItems += batch.length;
          this.kick(0);
          return;
        }
        this.o.onDrop?.(batch.length);
        this.o.onFatal?.(err, batch.length);
        if (this.depth > 0) this.kick(0);
        else this.settle();
        return;
      }
      this.healthy = false;
      this.attempt += 1;
      this.o.onError?.(err, this.attempt);
      if (this.closed) {
        this.inFlight = null;
        this.o.onDrop?.(batch.length);
        if (this.depth > 0) this.kick(0);
        else this.settle();
        return;
      }
      if (split) {
        this.splits.unshift(batch);
        this.splitItems += batch.length;
      } else {
        this.buf = [...batch, ...this.buf.slice(this.head)];
        this.head = 0;
      }
      this.inFlight = null;
      const over = Math.min(this.depth - this.o.capacity, this.buf.length - this.head);
      if (over > 0) {
        this.head += over;
        this.o.onDrop?.(over);
        this.compact();
      }
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (this.attempt - 1));
      this.kick(delay);
    }
  }

  private settle() {
    const waiting = this.idle;
    this.idle = [];
    waiting.forEach((r) => r());
  }

  private compact() {
    if (this.head > 4096 && this.head > this.buf.length / 2) {
      this.buf = this.buf.slice(this.head);
      this.head = 0;
    }
  }
}
