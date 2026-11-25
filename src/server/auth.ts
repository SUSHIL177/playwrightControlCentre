import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { openHub, tenantRootFor } from './hub';
import { runWithTenant, defaultDataRoot, type TenantContext } from '../main/platform/tenant';
import { openUserDatabase, closeUserDatabase, type PersistentSqliteDB } from '../main/database/db';

export type Role = 'admin' | 'member';
export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SESSION_DAYS = 14;
const MAX_LOGIN_FAILS = 5;
const LOCKOUT_MINUTES = 10;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function mapUser(row: any): PublicUser {
  return { id: row.id, username: row.username, displayName: row.display_name ?? null, role: row.role as Role };
}

export async function usersExist(): Promise<boolean> {
  const hub = await openHub();
  const row = hub.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n > 0;
}

export async function listUsers(): Promise<PublicUser[]> {
  const hub = await openHub();
  const rows = hub.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[];
  return rows.map(mapUser);
}

export async function createUser(username: string, password: string, role: Role = 'member', displayName?: string): Promise<PublicUser> {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) {
    throw new Error('Username must be 3–32 chars: lowercase letters, digits, dot, dash, underscore; start with a letter or digit.');
  }
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const hub = await openHub();
  const existing = hub.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
  if (existing) throw new Error(`User "${normalized}" already exists.`);
  const id = crypto.randomUUID();
  hub.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, normalized, displayName?.trim() || null, hashPassword(password), role, new Date().toISOString());
  tenantRootFor(id); // create + lock down the private workspace eagerly
  const row = hub.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  return mapUser(row);
}

export async function deleteUser(userId: string): Promise<void> {
  const hub = await openHub();
  const users = (hub.prepare('SELECT * FROM users').all() as any[]).map(mapUser);
  const target = users.find((u) => u.id === userId);
  if (!target) throw new Error('User not found.');
  const admins = users.filter((u) => u.role === 'admin');
  if (target.role === 'admin' && admins.length === 1) {
    throw new Error('Refusing to delete the last admin account.');
  }
  const root = path.join(defaultDataRoot(), 'users', userId);
  hub.transaction((id: string) => {
    hub.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    hub.prepare('DELETE FROM login_failures WHERE key LIKE ?').run(`%|${target.username}`);
    hub.prepare('DELETE FROM users WHERE id = ?').run(id);
  })(userId);
  // Drop the cached DB handle, then remove the tenant's data directory as well — account and data are deleted together.
  closeUserDatabase(userId);
  fs.rmSync(root, { recursive: true, force: true });
}

export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
  const hub = await openHub();
  const row = hub.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found.');
  hub.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  // A password reset revokes every existing session for that account.
  hub.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function createSession(userId: string): Promise<{ token: string; maxAgeSec: number }> {
  const hub = await openHub();
  const token = `${crypto.randomBytes(32).toString('hex')}`;
  const now = Date.now();
  hub.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_DAYS * 24 * 3600 * 1000).toISOString()
  );
  hub.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
  return { token, maxAgeSec: SESSION_DAYS * 24 * 3600 };
}

export interface SessionInfo {
  user: PublicUser;
  tenantRoot: string;
}

export async function resolveSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const hub = await openHub();
  const tokenHash = hashToken(token);
  const row = hub.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) as any;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    hub.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const userRow = hub.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as any;
  if (!userRow) return null;
  return { user: mapUser(userRow), tenantRoot: tenantRootFor(userRow.id) };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const hub = await openHub();
  hub.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

// ── Login throttling (per ip+username) ───────────────────────────────────────

export async function loginLockedOut(key: string): Promise<number> {
  const hub = await openHub();
  const row = hub.prepare('SELECT locked_until FROM login_failures WHERE key = ?').get(key) as any;
  if (!row?.locked_until) return 0;
  const until = new Date(row.locked_until).getTime();
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export async function recordLoginFailure(key: string): Promise<void> {
  const hub = await openHub();
  const row = hub.prepare('SELECT fails FROM login_failures WHERE key = ?').get(key) as any;
  const fails = (row?.fails ?? 0) + 1;
  const lockedUntil = fails >= MAX_LOGIN_FAILS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
  hub.prepare(
    `INSERT INTO login_failures (key, fails, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until`
  ).run(key, fails >= MAX_LOGIN_FAILS ? 0 : fails, lockedUntil);
}

export async function clearLoginFailures(key: string): Promise<void> {
  const hub = await openHub();
  hub.prepare('DELETE FROM login_failures WHERE key = ?').run(key);
}

export async function verifyLogin(username: string, password: string): Promise<PublicUser | null> {
  const hub = await openHub();
  const row = hub.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()) as any;
  if (!row) {
    // Constant-ish behavior: hash anyway to reduce user enumeration signal.
    verifyPassword(password, hashPassword(password));
    return null;
  }
  return verifyPassword(password, row.password_hash) ? mapUser(row) : null;
}

/** Bind a tenant context + open database and run fn. Used by every RPC in web mode. */
export async function withTenant<T>(session: SessionInfo, fn: (ctx: TenantContext, db: PersistentSqliteDB) => Promise<T>): Promise<T> {
  const tenantRoot = session.tenantRoot;
  const db = await openUserDatabase(tenantRoot, session.user.id);
  const ctx: TenantContext = {
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
    tenantRoot,
    db,
  };
  return runWithTenant(ctx, () => fn(ctx, db));
}
