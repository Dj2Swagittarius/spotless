import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from './db';
import { sessionFromRequest } from './auth';

/** User 1 remains the server administrator for backwards compatibility. */
export const ADMIN_USER_ID = 1;

export interface User {
  id: number;
  name: string;
  color: string;
  passwordSet: boolean;
}

export interface AuthUser extends User {
  passwordHash: string | null;
}

function mapUser(row: { id: number; name: string; color: string; passwordHash?: string | null; passwordSet?: number }): User {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    passwordSet: row.passwordHash !== undefined ? Boolean(row.passwordHash) : Boolean(row.passwordSet),
  };
}

export function listUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT id, name, color, (password_hash IS NOT NULL) AS passwordSet FROM users ORDER BY id')
    .all() as { id: number; name: string; color: string; passwordSet: number }[];
  return rows.map(mapUser);
}

export function getUser(id: number): User | null {
  const row = getDb()
    .prepare('SELECT id, name, color, (password_hash IS NOT NULL) AS passwordSet FROM users WHERE id = ?')
    .get(id) as { id: number; name: string; color: string; passwordSet: number } | undefined;
  return row ? mapUser(row) : null;
}

export function getAuthUser(id: number): AuthUser | null {
  const row = getDb()
    .prepare('SELECT id, name, color, password_hash AS passwordHash FROM users WHERE id = ?')
    .get(id) as { id: number; name: string; color: string; passwordHash: string | null } | undefined;
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.passwordHash };
}

const COLORS = ['#1ed760', '#539df5', '#f3727f', '#ffa42b', '#c084fc', '#2dd4bf'];
export function createUser(name: string, passwordHash: string): User {
  const db = getDb();
  const duplicate = db.prepare('SELECT 1 AS found FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(name);
  if (duplicate) throw new Error('duplicate user');
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const color = COLORS[count % COLORS.length];
  const result =
    count === 0
      ? db.prepare('INSERT INTO users (id, name, color, password_hash) VALUES (1, ?, ?, ?)').run(name, color, passwordHash)
      : db.prepare('INSERT INTO users (name, color, password_hash) VALUES (?, ?, ?)').run(name, color, passwordHash);
  const id = count === 0 ? ADMIN_USER_ID : Number(result.lastInsertRowid);
  return { id, name, color, passwordSet: true };
}

export function legacyBootstrapAllowed(): boolean {
  const db = getDb();
  const admin = db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = 1').get() as
    | { passwordHash: string | null }
    | undefined;
  if (!admin || admin.passwordHash) return false;
  const configured = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL').get() as { n: number }).n;
  return configured === 0;
}

export function currentUserFrom(req: NextRequest): User | null {
  const session = sessionFromRequest(req);
  return session ? getUser(session.userId) : null;
}

/** Resolve the authenticated web user. 0 deliberately means unauthenticated; never fall back to admin. */
export function userIdFrom(req: NextRequest): number {
  return sessionFromRequest(req)?.userId ?? 0;
}

export function isAdmin(req: NextRequest): boolean {
  return sessionFromRequest(req)?.userId === ADMIN_USER_ID;
}

/** Guard for server-wide settings routes. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (session.userId === ADMIN_USER_ID) return null;
  return NextResponse.json({ error: 'Server settings can only be changed by the admin profile' }, { status: 403 });
}
