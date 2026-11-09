export const WINDOW = 256;

export type SeqResult = 'newest' | 'duplicate' | 'older';

export class SeqWindow {
  boot = -1;
  top = -1;
  private bits = new Uint32Array(WINDOW / 32);

  static from(boot: number, seq: number): SeqWindow {
    const w = new SeqWindow();
    w.boot = boot;
    w.top = seq;
    w.set(seq);
    return w;
  }

  check(boot: number, seq: number): SeqResult {
    if (boot > this.boot) {
      this.boot = boot;
      this.top = seq;
      this.bits.fill(0);
      this.set(seq);
      return 'newest';
    }
    if (boot < this.boot) return 'older';
    if (seq > this.top) {
      const d = seq - this.top;
      if (d >= WINDOW) this.bits.fill(0);
      else for (let s = this.top + 1; s < seq; s++) this.clear(s);
      this.top = seq;
      this.set(seq);
      return 'newest';
    }
    if (this.top - seq >= WINDOW) return 'older';
    if (this.has(seq)) return 'duplicate';
    this.set(seq);
    return 'older';
  }

  private has(s: number) {
    const i = s % WINDOW;
    return (this.bits[i >>> 5] & (1 << (i & 31))) !== 0;
  }
  private set(s: number) {
    const i = s % WINDOW;
    this.bits[i >>> 5] |= 1 << (i & 31);
  }
  private clear(s: number) {
    const i = s % WINDOW;
    this.bits[i >>> 5] &= ~(1 << (i & 31));
  }
}
