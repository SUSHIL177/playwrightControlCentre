import fs from 'fs';
import path from 'path';
import { defaultDataRoot, ensureTenantSkeleton } from '../main/platform/tenant';
import { openRawDatabase, type PersistentSqliteDB } from '../main/database/db';

/**
 * Hub = the single shared SQLite holding accounts & sessions ONLY.
 * No project, run, failure or artifact ever lives here — those are strictly
 * per-tenant files under <PACC_DATA_DIR>/users/<id>/.
 */
let hubDb: PersistentSqliteDB | null = null;

export async function openHub(): Promise<PersistentSqliteDB> {
  if (hubDb) return hubDb;
  const file = path.join(defaultDataRoot(), 'hub.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  hubDb = await openRawDatabase(file);
  hubDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_failures (
      key TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );
  `);
  return hubDb;
}

export function tenantRootFor(userId: string): string {
  const root = path.join(defaultDataRoot(), 'users', userId);
  ensureTenantSkeleton(root);
  return root;
}
