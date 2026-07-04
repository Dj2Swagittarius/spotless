import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from './db';

/** User 1 — the first profile created (or the pre-migration data owner) — owns server-wide settings. */
export const ADMIN_USER_ID = 1;

export interface User {
  id: number;
  name: string;
  color: string;
}

export function listUsers(): User[] {
  return getDb().prepare('SELECT id, name, color FROM users ORDER BY id').all() as User[];
}

export function getUser(id: number): User | null {
  return (getDb().prepare('SELECT id, name, color FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

const COLORS = ['#1ed760', '#539df5', '#f3727f', '#ffa42b', '#c084fc', '#2dd4bf'];

export function createUser(name: string): User {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const color = COLORS[count % COLORS.length];
  const res = db.prepare('INSERT INTO users (name, color) VALUES (?, ?)').run(name, color);
  return { id: Number(res.lastInsertRowid), name, color };
}

/** Resolve the acting user from the uid cookie; falls back to user 1 so old clients keep working. */
export function userIdFrom(req: NextRequest): number {
  const raw = req.cookies.get('uid')?.value;
  const id = Number(raw);
  if (Number.isInteger(id) && getUser(id)) return id;
  return 1;
}

/** Strict admin check: the uid cookie itself must be the admin user — no fallback-to-1 like userIdFrom. */
export function isAdmin(req: NextRequest): boolean {
  return Number(req.cookies.get('uid')?.value) === ADMIN_USER_ID;
}

/** Guard for server-wide settings routes: returns a 403 response for non-admins, null when allowed. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (isAdmin(req)) return null;
  return NextResponse.json({ error: 'Server settings can only be changed from the admin profile' }, { status: 403 });
}
