import { MusicIcon } from './Icons';

/** Playlist cover: 2×2 mosaic of album art, single cover, or icon fallback. */
export default function PlaylistCover({ artIds, size = 'md' }: { artIds?: number[]; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-48 w-48 sm:h-56 sm:w-56' : size === 'md' ? 'h-16 w-16' : 'h-11 w-11';
  const ids = artIds ?? [];

  if (ids.length >= 4) {
    return (
      <div className={`grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded ${cls}`}>
        {ids.slice(0, 4).map((id) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={id} src={`/api/artwork/${id}`} alt="" className="h-full w-full object-cover" loading="lazy" />
        ))}
      </div>
    );
  }
  if (ids.length > 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/artwork/${ids[0]}`} alt="" className={`shrink-0 rounded object-cover ${cls}`} loading="lazy" />
    );
  }
  return (
    <div className={`flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-highlight to-base ${cls}`}>
      <MusicIcon size={size === 'lg' ? 72 : size === 'md' ? 24 : 18} className="text-subdued" />
    </div>
  );
}
