export function CardGridSkeleton({ count = 12, round = false }: { count?: number; round?: boolean }) {
  // mirrors CardGrid's column/gap classes so content doesn't jump when it lands
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5 xl:grid-cols-7" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse rounded-lg bg-elevated p-2">
          <div className={`mb-2 aspect-square w-full bg-highlight ${round ? 'rounded-full' : 'rounded'}`} />
          <div className="mb-2 h-4 w-3/4 rounded bg-highlight" />
          <div className="h-3 w-1/2 rounded bg-highlight" />
        </div>
      ))}
    </div>
  );
}

export function DetailHeaderSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div
      className="flex animate-pulse flex-col items-center gap-6 rounded-lg bg-gradient-to-b from-white/10 to-transparent p-6 sm:flex-row sm:items-end"
      aria-hidden
    >
      <div className={`h-48 w-48 shrink-0 bg-highlight sm:h-56 sm:w-56 ${round ? 'rounded-full' : 'rounded'}`} />
      <div className="flex flex-col items-center gap-3 sm:items-start">
        <div className="h-3 w-16 rounded bg-highlight" />
        <div className="h-10 w-64 max-w-full rounded bg-highlight" />
        <div className="h-3 w-40 rounded bg-highlight" />
      </div>
    </div>
  );
}

export function RowListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded p-2">
          <div className="h-12 w-12 rounded bg-highlight" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-1/3 rounded bg-highlight" />
            <div className="h-3 w-1/4 rounded bg-highlight" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatTilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="animate-pulse rounded-lg bg-elevated p-4">
          <div className="mb-2 h-7 w-16 rounded bg-highlight" />
          <div className="h-3 w-24 rounded bg-highlight" />
        </div>
      ))}
    </div>
  );
}
