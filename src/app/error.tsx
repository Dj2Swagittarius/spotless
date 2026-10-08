'use client';

import Link from 'next/link';

/**
 * Route-level safety net: catches render errors from any page so the shell (sidebar,
 * player) stays up and playback keeps going. `reset` re-renders the failed segment.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 p-12 text-center">
      <div className="text-2xl font-bold">Something went wrong</div>
      <p className="max-w-md text-subdued">
        This page hit an error it couldn&apos;t recover from. Your music keeps playing; try the page again or head home.
      </p>
      {error.digest && <p className="text-xs text-subdued">Reference: {error.digest}</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-pill">
          Go home
        </Link>
      </div>
    </div>
  );
}
