import { useFleet } from '../data/store';
import { ago } from '../lib/time';

export function Ago({ t, now }: { t: number; now?: number }) {
  return <>{useFleet((s) => ago((now ?? s.now) - t))}</>;
}

export function useWithin(since: number | null, ms: number, now?: number): boolean {
  return useFleet((s) => since !== null && (now ?? s.now) - since < ms);
}
