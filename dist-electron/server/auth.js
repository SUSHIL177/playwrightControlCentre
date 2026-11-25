"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.usersExist = usersExist;
exports.listUsers = listUsers;
exports.createUser = createUser;
exports.deleteUser = deleteUser;
exports.resetPassword = resetPassword;
exports.createSession = createSession;
exports.resolveSession = resolveSession;
exports.destroySession = destroySession;
exports.loginLockedOut = loginLockedOut;
exports.recordLoginFailure = recordLoginFailure;
exports.clearLoginFailures = clearLoginFailures;
exports.verifyLogin = verifyLogin;
exports.withTenant = withTenant;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hub_1 = require("./hub");
const tenant_1 = require("../main/platform/tenant");
const db_1 = require("../main/database/db");
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SESSION_DAYS = 14;
const MAX_LOGIN_FAILS = 5;
const LOCKOUT_MINUTES = 10;
function hashPassword(password) {
    const salt = crypto_1.default.randomBytes(16);
    const hash = crypto_1.default.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
    try {
        const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
        if (scheme !== 'scrypt')
            return false;
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');
        const actual = crypto_1.default.scryptSync(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
        return crypto_1.default.timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function mapUser(row) {
    return { id: row.id, username: row.username, displayName: row.display_name ?? null, role: row.role };
}
async function usersExist() {
    const hub = await (0, hub_1.openHub)();
    const row = hub.prepare('SELECT COUNT(*) AS n FROM users').get();
    return row.n > 0;
}
async function listUsers() {
    const hub = await (0, hub_1.openHub)();
    const rows = hub.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
    return rows.map(mapUser);
}
async function createUser(username, password, role = 'member', displayName) {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) {
        throw new Error('Username must be 3–32 chars: lowercase letters, digits, dot, dash, underscore; start with a letter or digit.');
    }
    if (password.length < 8)
        throw new Error('Password must be at least 8 characters.');
    const hub = await (0, hub_1.openHub)();
    const existing = hub.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
    if (existing)
        throw new Error(`User "${normalized}" already exists.`);
    const id = crypto_1.default.randomUUID();
    hub.prepare('INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, normalized, displayName?.trim() || null, hashPassword(password), role, new Date().toISOString());
    (0, hub_1.tenantRootFor)(id); // create + lock down the private workspace eagerly
    const row = hub.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return mapUser(row);
}
async function deleteUser(userId) {
    const hub = await (0, hub_1.openHub)();
    const users = hub.prepare('SELECT * FROM users').all().map(mapUser);
    const target = users.find((u) => u.id === userId);
    if (!target)
        throw new Error('User not found.');
    const admins = users.filter((u) => u.role === 'admin');
    if (target.role === 'admin' && admins.length === 1) {
        throw new Error('Refusing to delete the last admin account.');
    }
    const root = path_1.default.join((0, tenant_1.defaultDataRoot)(), 'users', userId);
    hub.transaction((id) => {
        hub.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        hub.prepare('DELETE FROM login_failures WHERE key LIKE ?').run(`%|${target.username}`);
        hub.prepare('DELETE FROM users WHERE id = ?').run(id);
    })(userId);
    // Drop the cached DB handle, then remove the tenant's data directory as well — account and data are deleted together.
    (0, db_1.closeUserDatabase)(userId);
    fs_1.default.rmSync(root, { recursive: true, force: true });
}
async function resetPassword(userId, newPassword) {
    if (newPassword.length < 8)
        throw new Error('Password must be at least 8 characters.');
    const hub = await (0, hub_1.openHub)();
    const row = hub.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!row)
        throw new Error('User not found.');
    hub.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
    // A password reset revokes every existing session for that account.
    hub.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
async function createSession(userId) {
    const hub = await (0, hub_1.openHub)();
    const token = `${crypto_1.default.randomBytes(32).toString('hex')}`;
    const now = Date.now();
    hub.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 24 * 3600 * 1000).toISOString());
    hub.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
    return { token, maxAgeSec: SESSION_DAYS * 24 * 3600 };
}
async function resolveSession(token) {
    if (!token)
        return null;
    const hub = await (0, hub_1.openHub)();
    const tokenHash = hashToken(token);
    const row = hub.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
    if (!row)
        return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
        hub.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
        return null;
    }
    const userRow = hub.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!userRow)
        return null;
    return { user: mapUser(userRow), tenantRoot: (0, hub_1.tenantRootFor)(userRow.id) };
}
async function destroySession(token) {
    if (!token)
        return;
    const hub = await (0, hub_1.openHub)();
    hub.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
// ── Login throttling (per ip+username) ───────────────────────────────────────
async function loginLockedOut(key) {
    const hub = await (0, hub_1.openHub)();
    const row = hub.prepare('SELECT locked_until FROM login_failures WHERE key = ?').get(key);
    if (!row?.locked_until)
        return 0;
    const until = new Date(row.locked_until).getTime();
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
}
async function recordLoginFailure(key) {
    const hub = await (0, hub_1.openHub)();
    const row = hub.prepare('SELECT fails FROM login_failures WHERE key = ?').get(key);
    const fails = (row?.fails ?? 0) + 1;
    const lockedUntil = fails >= MAX_LOGIN_FAILS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
    hub.prepare(`INSERT INTO login_failures (key, fails, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until`).run(key, fails >= MAX_LOGIN_FAILS ? 0 : fails, lockedUntil);
}
async function clearLoginFailures(key) {
    const hub = await (0, hub_1.openHub)();
    hub.prepare('DELETE FROM login_failures WHERE key = ?').run(key);
}
async function verifyLogin(username, password) {
    const hub = await (0, hub_1.openHub)();
    const row = hub.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
    if (!row) {
        // Constant-ish behavior: hash anyway to reduce user enumeration signal.
        verifyPassword(password, hashPassword(password));
        return null;
    }
    return verifyPassword(password, row.password_hash) ? mapUser(row) : null;
}
/** Bind a tenant context + open database and run fn. Used by every RPC in web mode. */
async function withTenant(session, fn) {
    const tenantRoot = session.tenantRoot;
    const db = await (0, db_1.openUserDatabase)(tenantRoot, session.user.id);
    const ctx = {
        userId: session.user.id,
        username: session.user.username,
        role: session.user.role,
        tenantRoot,
        db,
    };
    return (0, tenant_1.runWithTenant)(ctx, () => fn(ctx, db));
}
