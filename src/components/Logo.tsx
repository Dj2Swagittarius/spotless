'use client';

import { useId } from 'react';

/**
 * Spotless brand mark — a four-point glint pressed like a vinyl record:
 * groove rings and a spindle hole live inside the sparkle. The star
 * silhouette is the identity; green ties it to the app accent.
 * `hole` should match the background the mark sits on.
 */
export function LogoMark({ size = 28, hole = '#000' }: { size?: number; hole?: string }) {
  const id = useId();
  const spark = 'M256 56 Q308 204 456 256 Q308 308 256 456 Q204 308 56 256 Q204 204 256 56 Z';
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <path d={spark} />
        </clipPath>
      </defs>
      <path d={spark} fill="#1ed760" />
      <g clipPath={`url(#${id})`} fill="none" stroke="#0c110d" strokeOpacity="0.32" strokeWidth="7">
        <circle cx="256" cy="256" r="64" />
        <circle cx="256" cy="256" r="104" />
        <circle cx="256" cy="256" r="144" />
      </g>
      <circle cx="256" cy="256" r="30" fill={hole} />
      <path
        d="M376 92 Q385 123 416 132 Q385 141 376 172 Q367 141 336 132 Q367 123 376 92 Z"
        fill="#f2fff7"
      />
    </svg>
  );
}

/** Horizontal lockup: mark + wordmark. */
export function Logo({ markSize = 30, hole = '#000' }: { markSize?: number; hole?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={markSize} hole={hole} />
      <span className="font-display text-2xl font-extrabold leading-none tracking-tight text-white">
        Spotless<span className="text-accent">.</span>
      </span>
    </span>
  );
}
