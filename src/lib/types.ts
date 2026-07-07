export interface Track {
  id: number; // negative for internet radio stations (id = -stationId)
  title: string;
  artist: string;
  artistId: number;
  album: string;
  albumId: number;
  duration: number;
  trackNo: number;
  discNo: number;
  genre: string | null;
  gain?: number | null;
  playCount?: number;
  streamUrl?: string; // set for internet radio stations — played directly, no library track behind it
}

export interface RadioStation {
  id: number;
  name: string;
  streamUrl: string;
  homePageUrl: string | null;
}

/** Queue entry for an internet radio station. */
export function stationTrack(s: RadioStation): Track {
  return {
    id: -s.id,
    title: s.name,
    artist: 'Internet radio',
    artistId: 0,
    album: s.name,
    albumId: 0,
    duration: 0,
    trackNo: 0,
    discNo: 1,
    genre: null,
    streamUrl: `/api/stations/${s.id}/stream`,
  };
}

export interface Album {
  id: number;
  name: string;
  artist: string;
  artistId: number;
  year: number | null;
  trackCount: number;
  duration: number;
}

export interface Artist {
  id: number;
  name: string;
  albumCount: number;
  trackCount: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  trackCount: number;
  duration: number;
  artIds?: number[];
}

export interface HomeSection {
  title: string;
  kind: 'tracks' | 'albums' | 'mix';
  tracks?: Track[];
  albums?: Album[];
}
