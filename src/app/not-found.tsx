import Link from 'next/link';

/** Rendered for any URL that matches no route, inside the normal shell so navigation still works. */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 p-12 text-center">
      <div className="text-6xl font-extrabold text-subdued">404</div>
      <div className="text-2xl font-bold">Page not found</div>
      <p className="max-w-md text-subdued">Nothing lives at this address. The link may be out of date.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/" className="btn-primary">
          Go home
        </Link>
        <Link href="/search" className="btn-pill">
          Search
        </Link>
      </div>
    </div>
  );
}
