import { useEffect, useRef } from 'react';
import { SITES } from '@fleet/shared/sites';
import { ChevronLeft, SearchIcon } from './Icons';
import css from './SiteSelector.module.css';

export function SiteSelector({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const OPTIONS: [string, string][] = [['all', 'All Sites'], ...SITES.map((s): [string, string] => [s.key, s.name])];
  return (
    <>
      <nav className={css.tabs} aria-label="Site">
        {OPTIONS.map(([k, label]) => (
          <button key={k} type="button" className={css.tab} aria-pressed={value === k} onClick={() => onChange(k)}>{label}</button>
        ))}
      </nav>
      <span className={css.selectWrap}>
        <select className={css.select} aria-label="Site" value={value} onChange={(e) => onChange(e.target.value)}>
          {OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <ChevronLeft size={10} className={css.chev} />
      </span>
    </>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search robots' }: { value: string; onChange: (q: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  return (
    <span className={css.search}>
      <SearchIcon />
      <input
        ref={ref}
        type="search"
        aria-label="Find robot by name or ID"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); ref.current?.blur(); } }}
      />
      <span className={css.kbd} aria-hidden="true">/</span>
    </span>
  );
}
