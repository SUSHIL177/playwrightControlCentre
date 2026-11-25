import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PersistentSqliteDB } from '../database/db';

/**
 * Per-request tenant context. The hosted web server runs many users through the
 * same service layer; instead of threading a userId through every service method,
 * each /api/rpc request is wrapped in AsyncLocalStorage and every shared helper
 * (getDb, executionsRoot, reposRoot, defaultDataRoot) resolves against the caller's
 * tenant. The desktop app never sets a tenant — everything falls back to the
 * single shared userData directory, exactly as before.
 */
export interface TenantContext {
  userId: string;
  username: string;
  role: 'admin' | 'member';
  /** Absolute path of this tenant's private root: <hub>/users/<userId> (contains data/, executions/, repos/). */
  tenantRoot: string;
  /** The tenant's own open database, bound by the web server. */
  db?: PersistentSqliteDB;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function tenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function isWebTenant(): boolean {
  return !!storage.getStore();
}

export function tenantUsername(): string | undefined {
  return storage.getStore()?.username;
}

/** Absolute root for the default (desktop / single-tenant) installation. */
export function defaultDataRoot(): string {
  const envRoot = (process.env.PACC_DATA_DIR || '').trim();
  if (envRoot) return path.resolve(envRoot);
  if (electronUserData) return electronUserData();
  return path.join(os.homedir(), '.pacc');
}

/** Desktop bootstrap registers Electron's userData here (keeps existing installs' data in place). */
let electronUserData: (() => string) | null = null;
export function configureElectronUserData(fn: () => string): void {
  electronUserData = fn;
}

export function executionsRoot(): string {
  const ctx = tenantContext();
  return path.join(ctx ? ctx.tenantRoot : defaultDataRoot(), 'executions');
}

export function reposRoot(...segments: string[]): string {
  const ctx = tenantContext();
  return path.join(ctx ? ctx.tenantRoot : defaultDataRoot(), 'repos', ...segments);
}

/** Root of the currently active project-safe data dir (used for logs, secret key, etc.). */
export function tenantDataRoot(): string {
  return tenantContext()?.tenantRoot ?? defaultDataRoot();
}

export function ensureTenantSkeleton(tenantRoot: string): void {
  for (const sub of ['data', 'executions', 'repos']) {
    fs.mkdirSync(path.join(tenantRoot, sub), { recursive: true, mode: 0o700 });
  }
}
