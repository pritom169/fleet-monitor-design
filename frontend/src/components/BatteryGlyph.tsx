import type { CSSProperties } from 'react';
import type { Status } from '../data/types';
import css from './BatteryGlyph.module.css';

/** Small inline battery. Amber only when low; grey when we do not know the real value. */
export function BatteryGlyph({ value, status }: { value: number; status: Status }) {
  const style = {
    '--rim': status === 'low' ? 'var(--amb)' : 'var(--ink2)',
    '--bf': status === 'low' ? 'var(--amb)' : status === 'offline' ? 'var(--off)' : 'var(--ink)',
  } as CSSProperties;
  return (
    <span className={css.glyph} style={style} aria-hidden="true">
      <span className={css.fill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      <span className={css.nub} />
    </span>
  );
}
