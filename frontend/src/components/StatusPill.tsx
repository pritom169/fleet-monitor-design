import type { Status } from '../data/types';
import { STATUS_LABEL } from '../lib/status';
import { StatusIcon } from './Icons';
import css from './StatusPill.module.css';

/** Every status: icon + label + colour. Never colour alone. */
export function StatusPill({ status, size = 'sm', solid }: { status: Status; size?: 'sm' | 'lg'; solid?: boolean }) {
  const big = size === 'lg';
  const iconSize = status === 'low' ? (big ? 17 : 15) : status === 'ok' ? 14 : big ? 14 : 12;
  return (
    <span className={[css.pill, css[status], big && css.lg, solid && css.solid].filter(Boolean).join(' ')}>
      <StatusIcon status={status} size={iconSize} />
      {STATUS_LABEL[status]}
    </span>
  );
}
