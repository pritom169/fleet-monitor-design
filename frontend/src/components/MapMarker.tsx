import { memo, type CSSProperties } from 'react';
import { FLOOR_W } from '@fleet/shared/sites';
import { useFleet } from '../data/store';
import type { Robot } from '../data/types';
import { aria } from '../lib/fleet';
import { STATUS_LABEL, TONE, isProblem } from '../lib/status';
import { Ago } from './Clock';
import { PinGlyph } from './Icons';
import { px, py } from './SitePlan';
import css from './MapMarker.module.css';

interface Props {
  robot: Robot;
  now?: number;
  big?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  dimmed?: number;
  showTag?: boolean;
  label?: boolean;
  popover?: boolean;
  onEnter?: (id: string) => void;
  onLeave?: () => void;
  onClick?: () => void;
}

export const MapMarker = memo(function MapMarker({ robot: r, now, big, highlighted, selected, dimmed, showTag = true, label, popover, onEnter, onLeave, onClick }: Props) {
  const rep = r.report;
  const name = useFleet((s) => (onClick ? aria(r, now ?? s.now) : null));
  if (!rep) return null;
  const problem = isProblem(r.status);
  const cls = [css.mark, css[r.status], big && css.big, highlighted && css.hl].filter(Boolean).join(' ');
  const style: CSSProperties = {
    left: px(rep.x),
    top: py(rep.y),
    zIndex: highlighted || selected ? 12 : problem ? 8 : 1,
    opacity: dimmed ?? 1,
  };
  const Tag = onClick ? 'button' : 'div';
  const right = rep.x > FLOOR_W * 0.6;

  return (
    <Tag
      className={cls}
      style={style}
      onMouseEnter={onEnter && (() => onEnter(r.id))}
      onMouseLeave={onLeave}
      onFocus={onEnter && (() => onEnter(r.id))}
      onBlur={onLeave}
      onClick={onClick}
      {...(onClick ? { type: 'button' as const, 'aria-label': name ?? undefined } : { 'aria-hidden': true })}
    >
      {selected && <span className={css.ring} />}
      {problem ? (
        <>
          <span className={css.foot} />
          <span className={css.pin}>
            <span className={css.head}><PinGlyph status={r.status} big={big} /></span>
            <span className={css.tail} />
          </span>
          {showTag && !highlighted && <span className={css.tag} style={{ color: TONE[r.status] }}>{r.id}</span>}
        </>
      ) : (
        <>
          <span className={css.dot} />
          {label && <span className={css.olabel}>{r.id}</span>}
        </>
      )}
      {popover && highlighted && (
        <span className={`${css.pop} ${right ? css.popLeft : css.popRight}`}>
          <span className={css.popHead}>
            <span className={css.popId}>{r.id}</span>
            <span className={css.popStatus} style={{ color: TONE[r.status] }}>{STATUS_LABEL[r.status]}</span>
          </span>
          <span className={css.popMeta}>{r.info.model} · <Ago t={rep.t} now={now} /></span>
          <span className={`${css.popRow} ${css.popSep}`}><span>Battery</span><span style={{ fontWeight: 600 }}>{rep.battery}%</span></span>
          <span className={css.popRow}><span>{r.status === 'error' ? 'Fault' : 'Task'}</span><span>{r.status === 'error' ? rep.fault : rep.task}</span></span>
        </span>
      )}
    </Tag>
  );
});
