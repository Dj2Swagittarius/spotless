export interface Track {
  id: number;
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
