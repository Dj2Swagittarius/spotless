import { getDb } from './db';

export type RequestStatus = 'pending' | 'approved' | 'denied';

export interface DownloadRequest {
  id: number;
  user_id: number;
  user_name: string | null;
  artist: string;
  album: string | null;
  status: RequestStatus;
  requested_at: string;
  resolved_at: string | null;
}

const SELECT = `
  SELECT r.id, r.user_id, u.name AS user_name, r.artist, r.album, r.status, r.requested_at, r.resolved_at
  FROM requests r LEFT JOIN users u ON u.id = r.user_id
`;

/** Create a pending request; an already-pending request for the same artist/album (any user) is reused. */
export function createRequest(userId: number, artist: string, album: string | null): DownloadRequest {
  const db = getDb();
  const existing = db
    .prepare(
      `${SELECT} WHERE r.status = 'pending' AND r.artist = ? COLLATE NOCASE
       AND ((r.album IS NULL AND ? IS NULL) OR r.album = ? COLLATE NOCASE)`
    )
    .get(artist, album, album) as DownloadRequest | undefined;
  if (existing) return existing;
  const id = Number(
    db.prepare('INSERT INTO requests (user_id, artist, album) VALUES (?, ?, ?)').run(userId, artist, album).lastInsertRowid
  );
  return getRequest(id)!;
}

export function getRequest(id: number): DownloadRequest | null {
  return ((getDb().prepare(`${SELECT} WHERE r.id = ?`).get(id) as DownloadRequest | undefined) ?? null);
}

/** All requests (admin view), pending first then most recent resolved. */
export function listAllRequests(limit = 50): DownloadRequest[] {
  return getDb()
    .prepare(`${SELECT} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.requested_at DESC LIMIT ?`)
    .all(limit) as DownloadRequest[];
}

/** One user's requests, newest first. */
export function listUserRequests(userId: number, limit = 30): DownloadRequest[] {
  return getDb()
    .prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.requested_at DESC LIMIT ?`)
    .all(userId, limit) as DownloadRequest[];
}

export function resolveRequest(id: number, status: 'approved' | 'denied'): void {
  getDb()
    .prepare("UPDATE requests SET status = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(status, id);
}
