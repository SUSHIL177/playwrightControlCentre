import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { ensureDirSync } from '../utils/pathSecurity';
import { defaultDataRoot, tenantContext } from '../platform/tenant';

export class PersistentSqliteDB {
  private inTransaction = false;

  constructor(private rawDb: SqlJsDatabase, private filePath: string) {}

  exec(sql: string): void {
    this.rawDb.exec(sql);
    if (!this.inTransaction) this.flush();
  }

  prepare(sql: string) {
    return {
      run: (...params: any[]) => {
        const stmt = this.rawDb.prepare(sql);
        try {
          stmt.bind(params as SqlValue[]);
          stmt.step();
        } finally {
          stmt.free();
        }
        if (!this.inTransaction) this.flush();
      },
      get: (...params: any[]): any => {
        const stmt = this.rawDb.prepare(sql);
        try {
          stmt.bind(params as SqlValue[]);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all: (...params: any[]): any[] => {
        const stmt = this.rawDb.prepare(sql);
        const rows: any[] = [];
        try {
          stmt.bind(params as SqlValue[]);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> {
    return (...args: Parameters<T>): ReturnType<T> => {
      this.inTransaction = true;
      this.rawDb.exec('BEGIN TRANSACTION;');
      try {
        const result = fn(...args);
        this.rawDb.exec('COMMIT;');
        this.inTransaction = false;
        this.flush();
        return result;
      } catch (err) {
        this.rawDb.exec('ROLLBACK;');
        this.inTransaction = false;
        throw err;
      }
    };
  }

  flush(): void {
    try {
      ensureDirSync(path.dirname(this.filePath));
      const exported = this.rawDb.export();
      fs.writeFileSync(this.filePath, Buffer.from(exported));
    } catch (err) {
      console.error('[SQLite Flush Error]:', err);
    }
  }
}

let dbInstance: PersistentSqliteDB | null = null;
const userDatabases = new Map<string, PersistentSqliteDB>();

async function openDatabase(filePath: string, migrate = true): Promise<PersistentSqliteDB> {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  ensureDirSync(path.dirname(filePath));
  const existingBytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
  const rawDb = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();

  const db = new PersistentSqliteDB(rawDb, filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (migrate) runMigrations(db);
  return db;
}

/** Desktop / single-tenant bootstrap — unchanged behavior (data stays in the app's userData dir). */
export async function initDb(): Promise<PersistentSqliteDB> {
  if (dbInstance) return dbInstance;
  const dbPath = path.join(defaultDataRoot(), 'data', 'playwright_control_center.sqlite');
  dbInstance = await openDatabase(dbPath);
  return dbInstance;
}

/**
 * Hosted mode: open (or create) the private database for one tenant. Every user gets a
 * fully separate SQLite file — no cross-user rows ever share a table. Databases stay
 * cached for the lifetime of the process.
 */
export async function openUserDatabase(tenantRoot: string, userId: string): Promise<PersistentSqliteDB> {
  const cached = userDatabases.get(userId);
  if (cached) return cached;
  const dbPath = path.join(tenantRoot, 'data', 'playwright_control_center.sqlite');
  const db = await openDatabase(dbPath);
  userDatabases.set(userId, db);
  return db;
}

/** Hub database (web mode accounts/sessions). Shares the same migration runner minus app tables. */
export async function openRawDatabase(filePath: string): Promise<PersistentSqliteDB> {
  return openDatabase(filePath, false);
}

/** Drop a tenant's cached database handle (used when an account is deleted). */
export function closeUserDatabase(userId: string): void {
  const cached = userDatabases.get(userId);
  if (cached) {
    userDatabases.delete(userId);
    try {
      cached.flush();
    } catch {
      /* best effort — the file is being wiped anyway */
    }
  }
}

export function getDb(): PersistentSqliteDB {
  const tenantDb = tenantContext()?.db;
  if (tenantDb) return tenantDb;
  if (!dbInstance) {
    throw new Error('SQLite database has not been initialized yet.');
  }
  return dbInstance;
}

function runMigrations(db: PersistentSqliteDB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      config_path TEXT,
      test_dir TEXT NOT NULL,
      playwright_version TEXT,
      node_version TEXT,
      browsers_installed TEXT NOT NULL,
      projects_configured TEXT NOT NULL,
      reporters TEXT NOT NULL,
      npm_scripts TEXT NOT NULL,
      has_ts_config INTEGER NOT NULL DEFAULT 1,
      validation_status TEXT NOT NULL,
      validation_messages TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_scanned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovered_tests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      full_title TEXT NOT NULL,
      suite_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      column INTEGER NOT NULL,
      tags TEXT NOT NULL,
      annotations TEXT NOT NULL,
      project_name TEXT NOT NULL,
      last_status TEXT,
      last_duration_ms INTEGER,
      retry_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS execution_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      description TEXT NOT NULL,
      mode TEXT NOT NULL,
      environment TEXT NOT NULL,
      browsers TEXT NOT NULL,
      tag TEXT,
      status TEXT NOT NULL,
      total_tests INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      timed_out INTEGER NOT NULL DEFAULT 0,
      flaky INTEGER NOT NULL DEFAULT 0,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      html_report_path TEXT NOT NULL,
      json_report_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      test_title TEXT NOT NULL,
      full_title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      browser TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      retry INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      stack_trace TEXT,
      screenshot_path TEXT,
      video_path TEXT,
      trace_path TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS failure_analyses (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL UNIQUE,
      execution_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      test_title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      browser TEXT NOT NULL,
      environment TEXT NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace TEXT NOT NULL,
      screenshot_path TEXT,
      trace_path TEXT,
      category TEXT NOT NULL,
      classification TEXT NOT NULL,
      probable_root_cause TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      healing_eligible INTEGER NOT NULL DEFAULT 0,
      manually_reclassified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS healing_proposals (
      id TEXT PRIMARY KEY,
      failure_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      test_title TEXT NOT NULL,
      target_file_path TEXT NOT NULL,
      original_code TEXT NOT NULL,
      proposed_code TEXT NOT NULL,
      explanation TEXT NOT NULL,
      confidence REAL NOT NULL,
      validation_status TEXT NOT NULL,
      validation_log TEXT,
      status TEXT NOT NULL,
      backup_file_path TEXT,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      frequency_label TEXT NOT NULL,
      environment TEXT NOT NULL,
      browsers TEXT NOT NULL,
      mode TEXT NOT NULL,
      tag TEXT,
      workers INTEGER NOT NULL DEFAULT 4,
      headed INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      webhook_url TEXT,
      notify_email TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.prepare(`UPDATE execution_batches SET status = 'stopped', end_time = ? WHERE status = 'running'`)
    .run(new Date().toISOString());
}
