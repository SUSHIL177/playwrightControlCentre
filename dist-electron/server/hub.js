"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openHub = openHub;
exports.tenantRootFor = tenantRootFor;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const tenant_1 = require("../main/platform/tenant");
const db_1 = require("../main/database/db");
/**
 * Hub = the single shared SQLite holding accounts & sessions ONLY.
 * No project, run, failure or artifact ever lives here — those are strictly
 * per-tenant files under <PACC_DATA_DIR>/users/<id>/.
 */
let hubDb = null;
async function openHub() {
    if (hubDb)
        return hubDb;
    const file = path_1.default.join((0, tenant_1.defaultDataRoot)(), 'hub.sqlite');
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true, mode: 0o700 });
    hubDb = await (0, db_1.openRawDatabase)(file);
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
function tenantRootFor(userId) {
    const root = path_1.default.join((0, tenant_1.defaultDataRoot)(), 'users', userId);
    (0, tenant_1.ensureTenantSkeleton)(root);
    return root;
}
