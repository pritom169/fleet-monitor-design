import { useId, type SVGProps } from 'react';
import type { Status } from '../data/types';

/** All icons: 16 px grid, 1.5 px stroke, round caps and joins. Only Error is filled, so the worst state carries the most ink. */
type P = { size?: number; stroke?: number } & Omit<SVGProps<SVGSVGElement>, 'stroke'>;

const svg = (size: number, p: P) => {
  const { size: _s, stroke: _k, ...rest } = p;
  void _s;
  void _k;
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true as const,
    focusable: false as const,
    ...rest,
  };
};

export const OkIcon = ({ size = 14, stroke = 1.5, ...p }: P) => (
  <svg {...svg(size, p)}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth={stroke} />
    <path d="m5.3 8.2 1.8 1.8 3.6-3.9" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LowIcon = ({ size = 15, stroke = 1.4, ...p }: P) => (
  <svg {...svg(size, p)}>
    <rect x="1.25" y="4.25" width="11.5" height="7.5" rx="2.25" stroke="currentColor" strokeWidth={stroke} />
    <rect x="3" y="6" width="2.5" height="4" rx=".75" fill="currentColor" />
    <path d="M14.75 6.9v2.2" stroke="currentColor" strokeWidth={stroke + 0.1} strokeLinecap="round" />
  </svg>
);

/** Filled triangle with a true cut-out, so it reads on any background. */
export const ErrorIcon = ({ size = 12, ...p }: P) => {
  const id = useId();
  return (
    <svg {...svg(size, p)}>
      <mask id={id}>
        <rect width="16" height="16" fill="#fff" />
        <path d="M8 6.1v3.3" stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r=".95" fill="#000" />
      </mask>
      <path d="M6.62 2.4a1.6 1.6 0 0 1 2.76 0l5.36 9.4a1.6 1.6 0 0 1-1.38 2.4H2.64a1.6 1.6 0 0 1-1.38-2.4Z" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
};

export const OfflineIcon = ({ size = 12, stroke = 1.8, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M1.9 6.5a8.7 8.7 0 0 1 12.2 0M4.1 8.9a5.5 5.5 0 0 1 7.8 0M6.3 11.3a2.4 2.4 0 0 1 3.4 0" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    <path d="m2.5 2.5 11 11" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
  </svg>
);

export const NeverIcon = ({ size = 13, stroke = 1.5, ...p }: P) => (
  <svg {...svg(size, p)}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth={stroke} strokeDasharray="1.6 2.2" strokeLinecap="round" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" />
  </svg>
);

/** "!" used inside a red map pin, where the pin itself is the triangle's job. */
export const BangIcon = ({ size = 12, stroke = 2.6, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M8 3.2v6" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    <circle cx="8" cy="12.9" r={stroke * 0.56} fill="currentColor" />
  </svg>
);

export const ChargingIcon = ({ size = 12, stroke = 1.6, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M9.2 1.75 3.6 9h4.1l-1 5.25L12.4 7H8.3Z" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
  </svg>
);

export const SearchIcon = ({ size = 13, ...p }: P) => (
  <svg {...svg(size, p)}>
    <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10.5 10.5 3.25 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const SpinnerIcon = ({ size = 12, ...p }: P) => (
  <svg {...svg(size, p)} viewBox="0 0 12 12" className={`spin ${p.className ?? ''}`}>
    <path d="M6 1.25a4.75 4.75 0 1 0 4.75 4.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const PlusIcon = ({ size = 16, ...p }: P) => (
  <svg {...svg(size, p)}><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
);
export const MinusIcon = ({ size = 16, ...p }: P) => (
  <svg {...svg(size, p)}><path d="M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
);
export const FitIcon = ({ size = 16, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M2.75 6V3.75a1 1 0 0 1 1-1H6M10 2.75h2.25a1 1 0 0 1 1 1V6M13.25 10v2.25a1 1 0 0 1-1 1H10M6 13.25H3.75a1 1 0 0 1-1-1V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const LabelIcon = ({ size = 17, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M2 3.75A1.75 1.75 0 0 1 3.75 2h4.1a1.75 1.75 0 0 1 1.24.51l4.4 4.4a1.75 1.75 0 0 1 0 2.48l-4.1 4.1a1.75 1.75 0 0 1-2.48 0l-4.4-4.4A1.75 1.75 0 0 1 2 7.85Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
  </svg>
);
export const TrailIcon = ({ size = 17, ...p }: P) => (
  <svg {...svg(size, p)}>
    <circle cx="12.5" cy="3.5" r="1.75" fill="currentColor" />
    <circle cx="8.6" cy="6.4" r="1.25" fill="currentColor" opacity=".6" />
    <circle cx="5.6" cy="9.6" r="1" fill="currentColor" opacity=".38" />
    <circle cx="3.2" cy="12.8" r=".8" fill="currentColor" opacity=".2" />
  </svg>
);
export const ChevronLeft = ({ size = 12, ...p }: P) => (
  <svg {...svg(size, p)}><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const SunIcon = ({ size = 15, ...p }: P) => (
  <svg {...svg(size, p)}>
    <circle cx="8" cy="8" r="2.9" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 1.5v1.3M8 13.2v1.3M14.5 8h-1.3M2.8 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const MoonIcon = ({ size = 15, ...p }: P) => (
  <svg {...svg(size, p)}>
    <path d="M13.2 9.9A5.6 5.6 0 0 1 6.1 2.8a5.6 5.6 0 1 0 7.1 7.1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

/** The one status glyph component. */
export function StatusIcon({ status, size }: { status: Status; size?: number }) {
  switch (status) {
    case 'ok': return <OkIcon size={size ?? 14} />;
    case 'low': return <LowIcon size={size ?? 15} />;
    case 'error': return <ErrorIcon size={size ?? 12} />;
    case 'offline': return <OfflineIcon size={size ?? 12} />;
    case 'never': return <NeverIcon size={size ?? 13} />;
  }
}

/** Glyph inside a map pin: 0.2 px heavier so it still reads at 13 px. */
export function PinGlyph({ status, big }: { status: Status; big?: boolean }) {
  if (status === 'low') return <LowIcon size={big ? 15 : 13} stroke={big ? 1.6 : 1.7} />;
  if (status === 'error') return <BangIcon size={big ? 14 : 12} stroke={big ? 2.4 : 2.6} />;
  return <OfflineIcon size={big ? 15 : 13} stroke={big ? 1.6 : 1.7} />;
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect width="26" height="26" rx="7" fill="var(--ink)" />
      <circle cx="9" cy="9" r="2" fill="var(--page)" opacity=".45" />
      <circle cx="17" cy="9" r="2" fill="var(--page)" opacity=".45" />
      <circle cx="9" cy="17" r="2" fill="var(--page)" opacity=".45" />
      <circle cx="17" cy="17" r="2.6" fill="var(--page)" />
    </svg>
  );
}
