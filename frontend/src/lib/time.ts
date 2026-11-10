const two = (v: number) => String(v).padStart(2, '0');

export function span(ms: number): string {
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export const ago = (ms: number) => `${span(ms)} ago`;

export function duration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function clock(t: number): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export function hm(t: number): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function skewText(ms: number): string {
  const s = Math.abs(ms) / 1000;
  if (s < 0.5) return 'In sync with the server';
  const v = s < 10 ? s.toFixed(1) : String(Math.round(s));
  return `${v} s ${ms > 0 ? 'behind' : 'ahead of'} the server`;
}
