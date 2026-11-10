import type { Counts, Filter } from '../lib/fleet';
import css from './FilterPills.module.css';

const DEFS: [Filter, string][] = [
  ['all', 'All'],
  ['ok', 'OK'],
  ['low', 'Low battery'],
  ['error', 'Error'],
  ['offline', 'Offline'],
  ['never', 'Never reported'],
];

const numColor = (key: Filter, count: number) => {
  if (!count) return 'var(--ink2)';
  if (key === 'low') return 'var(--amb-text)';
  if (key === 'error') return 'var(--err-text)';
  if (key === 'offline') return 'var(--ink)';
  return 'var(--ink2)';
};

export function FilterPills({ counts, value, onChange, showing, loading }: {
  counts: Counts | null; value: Filter; onChange: (f: Filter) => void; showing: string; loading?: boolean;
}) {
  return (
    <section className={css.bar} aria-label="Filter by status">
      {DEFS.filter(([k]) => k !== 'never' || (counts?.never ?? 0) > 0 || value === 'never').map(([key, label]) => {
        const count = counts?.[key] ?? 0;
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            className={css.pill}
            aria-pressed={active}
            disabled={loading}
            onClick={() => onChange(active && key !== 'all' ? 'all' : key)}
          >
            {label} <span className={css.n} style={{ color: numColor(key, count) }}>{loading ? '—' : count}</span>
          </button>
        );
      })}
      <span className={css.showing} aria-live="polite">{showing}</span>
    </section>
  );
}
