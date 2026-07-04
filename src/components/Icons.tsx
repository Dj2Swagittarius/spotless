interface IconProps {
  size?: number;
  className?: string;
}

function svg(path: React.ReactNode, { size = 24, className }: IconProps, viewBox = '0 0 24 24', filled = true) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {path}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) =>
  svg(<path d="M12.5 3.247a1 1 0 0 0-1 0L4 7.577V20h4.5v-6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v6H20V7.577l-7.5-4.33zm-2-1.732a3 3 0 0 1 3 0l7.5 4.33a2 2 0 0 1 1 1.732V21a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-6h-3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.577a2 2 0 0 1 1-1.732l7.5-4.33z" />, p);

export const SearchIcon = (p: IconProps) =>
  svg(<path d="M10.533 1.279c-5.18 0-9.407 4.14-9.407 9.279s4.226 9.279 9.407 9.279c2.234 0 4.29-.77 5.907-2.058l4.353 4.353a1 1 0 1 0 1.414-1.414l-4.344-4.344a9.157 9.157 0 0 0 2.077-5.816c0-5.14-4.226-9.28-9.407-9.28zm-7.407 9.279c0-4.006 3.302-7.28 7.407-7.28s7.407 3.274 7.407 7.28-3.302 7.279-7.407 7.279-7.407-3.273-7.407-7.28z" />, p);

export const LibraryIcon = (p: IconProps) =>
  svg(<path d="M3 22a1 1 0 0 1-1-1V3a1 1 0 0 1 2 0v18a1 1 0 0 1-1 1zM15.5 2.134A1 1 0 0 0 14 3v18a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7.041a1 1 0 0 0-.5-.866l-6-4.041zM9 2a1 1 0 0 0-1 1v18a1 1 0 1 0 2 0V3a1 1 0 0 0-1-1z" />, p);

export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) =>
  filled
    ? svg(<path d="M8.667 1.912a6.257 6.257 0 0 0-7.658 9.776l9.21 9.21a2.25 2.25 0 0 0 3.182 0l9.21-9.21a6.257 6.257 0 0 0-8.852-8.847l-.645.645-.645-.645a6.257 6.257 0 0 0-3.802-1.93z" />, p)
    : svg(<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />, p, '0 0 24 24', false);

export const ChevronDownIcon = (p: IconProps) =>
  svg(<polyline points="6 9 12 15 18 9" />, p, '0 0 24 24', false);

export const TrendIcon = (p: IconProps) =>
  svg(
    <>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </>,
    p,
    '0 0 24 24',
    false
  );

export const MoonIcon = (p: IconProps) =>
  svg(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />, p, '0 0 24 24', false);

export const RadioIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.25a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
    </>,
    p,
    '0 0 24 24',
    false
  );

export const MicIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </>,
    p,
    '0 0 24 24',
    false
  );

export const GearIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
    p,
    '0 0 24 24',
    false
  );

export const PlayIcon = (p: IconProps) =>
  svg(<path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z" />, p);

export const PauseIcon = (p: IconProps) =>
  svg(<path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z" />, p);

export const NextIcon = (p: IconProps) =>
  svg(<path d="M17.7 3a.7.7 0 0 0-.7.7v6.805L5.05 3.606A.7.7 0 0 0 4 4.212v15.576a.7.7 0 0 0 1.05.606L17 13.495V20.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-1.6z" />, p);

export const PrevIcon = (p: IconProps) =>
  svg(<path d="M6.3 3a.7.7 0 0 1 .7.7v6.805l11.95-6.899a.7.7 0 0 1 1.05.606v15.576a.7.7 0 0 1-1.05.606L7 13.495V20.3a.7.7 0 0 1-.7.7H4.7a.7.7 0 0 1-.7-.7V3.7a.7.7 0 0 1 .7-.7h1.6z" />, p);

export const ShuffleIcon = (p: IconProps) =>
  svg(<path d="M18.788 3.702a1 1 0 0 1 1.414-1.414l3.5 3.5a1 1 0 0 1 0 1.414l-3.5 3.5a1 1 0 1 1-1.414-1.414L20.586 7.5h-1.672a5.5 5.5 0 0 0-4.213 1.962l-5.198 6.186A7.5 7.5 0 0 1 3.758 18.5H1a1 1 0 1 1 0-2h2.758a5.5 5.5 0 0 0 4.213-1.962l5.198-6.186A7.5 7.5 0 0 1 18.914 5.5h1.672l-1.798-1.798zM1 7.5a1 1 0 0 1 0-2h2.758a7.5 7.5 0 0 1 4.83 1.77L7.1 9.045A5.5 5.5 0 0 0 3.758 7.5H1zm15.687 7.483a5.5 5.5 0 0 1-1.785-1.413l-1.487 1.77a7.5 7.5 0 0 0 2.428 1.838 7.5 7.5 0 0 0 3.071.822h1.672l-1.798 1.798a1 1 0 1 0 1.414 1.414l3.5-3.5a1 1 0 0 0 0-1.414l-3.5-3.5a1 1 0 1 0-1.414 1.414l1.798 1.798h-1.672a5.5 5.5 0 0 1-2.227-.527z" />, p);

export const RepeatIcon = (p: IconProps) =>
  svg(<path d="M6 5h12a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4h-1v-2h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h4.798l-1.537-1.537a1 1 0 0 1 1.415-1.415l3.244 3.245a1 1 0 0 1 0 1.414l-3.244 3.245a1 1 0 0 1-1.415-1.415L10.798 16H6a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" />, p);

export const VolumeIcon = (p: IconProps) =>
  svg(
    <path d="M9.741 1.704a.75.75 0 0 1 .375.65v19.292a.75.75 0 0 1-1.125.65l-6.925-3.996H.75a.75.75 0 0 1-.75-.75V6.45a.75.75 0 0 1 .75-.75h1.316l6.925-3.996a.75.75 0 0 1 .75 0zM12.5 7.55a4.5 4.5 0 0 1 0 8.9v-2.07a2.5 2.5 0 0 0 0-4.76V7.55zm0-4.06a8.5 8.5 0 0 1 0 17.02v-2.02a6.5 6.5 0 0 0 0-12.98V3.49z" />,
    p
  );

export const QueueIcon = (p: IconProps) =>
  svg(<path d="M15 15H1v-1.5h14V15zm0-4.5H1V9h14v1.5zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5zm2.5-1a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2h-9z" />, p, '0 0 16 16');

export const PlusIcon = (p: IconProps) =>
  svg(<path d="M11 3a1 1 0 1 1 2 0v8h8a1 1 0 1 1 0 2h-8v8a1 1 0 1 1-2 0v-8H3a1 1 0 1 1 0-2h8V3z" />, p);

export const MusicIcon = (p: IconProps) =>
  svg(<path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-3a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />, p, '0 0 24 24', false);

export const TrashIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
    </>,
    p,
    '0 0 24 24',
    false
  );

export const XIcon = (p: IconProps) =>
  svg(<path d="M18 6L6 18M6 6l12 12" />, p, '0 0 24 24', false);

export const DotsIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </>,
    p
  );
