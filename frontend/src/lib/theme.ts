import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'fm-theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

function effective(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return mq().matches ? 'dark' : 'light';
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(effective);
  useEffect(() => {
    const m = mq();
    const on = () => setTheme(effective());
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const toggle = () => {
    const next: Theme = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    setTheme(next);
  };
  return [theme, toggle];
}
