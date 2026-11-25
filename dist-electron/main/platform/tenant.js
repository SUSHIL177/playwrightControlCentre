"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithTenant = runWithTenant;
exports.tenantContext = tenantContext;
exports.isWebTenant = isWebTenant;
exports.tenantUsername = tenantUsername;
exports.defaultDataRoot = defaultDataRoot;
exports.configureElectronUserData = configureElectronUserData;
exports.executionsRoot = executionsRoot;
exports.reposRoot = reposRoot;
exports.tenantDataRoot = tenantDataRoot;
exports.ensureTenantSkeleton = ensureTenantSkeleton;
const async_hooks_1 = require("async_hooks");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const storage = new async_hooks_1.AsyncLocalStorage();
function runWithTenant(ctx, fn) {
    return storage.run(ctx, fn);
}
function tenantContext() {
    return storage.getStore();
}
function isWebTenant() {
    return !!storage.getStore();
}
function tenantUsername() {
    return storage.getStore()?.username;
}
/** Absolute root for the default (desktop / single-tenant) installation. */
function defaultDataRoot() {
    const envRoot = (process.env.PACC_DATA_DIR || '').trim();
    if (envRoot)
        return path_1.default.resolve(envRoot);
    if (electronUserData)
        return electronUserData();
    return path_1.default.join(os_1.default.homedir(), '.pacc');
}
/** Desktop bootstrap registers Electron's userData here (keeps existing installs' data in place). */
let electronUserData = null;
function configureElectronUserData(fn) {
    electronUserData = fn;
}
function executionsRoot() {
    const ctx = tenantContext();
    return path_1.default.join(ctx ? ctx.tenantRoot : defaultDataRoot(), 'executions');
}
function reposRoot(...segments) {
    const ctx = tenantContext();
    return path_1.default.join(ctx ? ctx.tenantRoot : defaultDataRoot(), 'repos', ...segments);
}
/** Root of the currently active project-safe data dir (used for logs, secret key, etc.). */
function tenantDataRoot() {
    return tenantContext()?.tenantRoot ?? defaultDataRoot();
}
function ensureTenantSkeleton(tenantRoot) {
    for (const sub of ['data', 'executions', 'repos']) {
        fs_1.default.mkdirSync(path_1.default.join(tenantRoot, sub), { recursive: true, mode: 0o700 });
    }
}
