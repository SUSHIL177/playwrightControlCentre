"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactCatalogService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const runtime_1 = require("../platform/runtime");
const db_1 = require("../database/db");
const pathSecurity_1 = require("../utils/pathSecurity");
const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.svn',
    '.idea',
    '.vscode',
    'dist',
    'build',
    'coverage',
    '.next',
    '.cache',
    '.pw-control-center-backups',
    'obj',
    'bin',
]);
const TEXT_EXTS = new Set([
    'json', 'csv', 'tsv', 'xml', 'txt', 'md', 'yaml', 'yml', 'html', 'htm', 'log', 'sql',
    'properties', 'ini', 'env', 'sh', 'bat', 'ps1', 'py', 'rb', 'conf', 'cfg', 'toml',
    'java', 'js', 'ts', 'tsx', 'jsx', 'cs', 'go', 'rs', 'php', 'r', 'scss', 'css', 'har',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);
const VIDEO_EXTS = new Set(['webm', 'mp4', 'mov', 'mkv', 'avi']);
const ARCHIVE_EXTS = new Set(['zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'bz2']);
const TEXT_PREVIEW_LIMIT = 512 * 1024;
const IMAGE_PREVIEW_LIMIT = 8 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_DEPTH = 8;
const SKIP_FILE_BYTES = 250 * 1024 * 1024;
const MIME_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
};
function classify(extension) {
    if (TEXT_EXTS.has(extension))
        return 'text';
    if (IMAGE_EXTS.has(extension))
        return 'image';
    if (VIDEO_EXTS.has(extension))
        return 'video';
    if (ARCHIVE_EXTS.has(extension))
        return 'archive';
    if (extension === 'pdf')
        return 'pdf';
    return 'other';
}
class ArtifactCatalogService {
    /**
     * Recursively catalogs files the user's Playwright suite writes into the project folder
     * (data exports, downloads, JSON/CSV payloads, traces, screenshots, …) so they can be
     * browsed, previewed and opened from inside PACC.
     */
    listArtifacts(projectId) {
        const db = (0, db_1.getDb)();
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project)
            throw new Error('Project not found.');
        const root = project.root_path;
        const results = [];
        const walk = (dir, depth) => {
            if (depth > MAX_DEPTH || results.length >= MAX_FILES)
                return;
            let entries;
            try {
                entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return; // unreadable directory — skip silently
            }
            for (const entry of entries) {
                if (results.length >= MAX_FILES)
                    return;
                const name = entry.name;
                if (name.startsWith('.'))
                    continue; // hidden dirs/files are tooling, not test artifacts
                const full = path_1.default.join(dir, name);
                if (entry.isDirectory()) {
                    if (!EXCLUDED_DIRS.has(name.toLowerCase()))
                        walk(full, depth + 1);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                let stat;
                try {
                    stat = fs_1.default.statSync(full);
                }
                catch {
                    continue;
                }
                if (stat.size > SKIP_FILE_BYTES)
                    continue;
                const ext = path_1.default.extname(name).replace(/^\./, '').toLowerCase();
                const rel = path_1.default.relative(root, full).replace(/\\/g, '/');
                const relFolder = path_1.default.dirname(rel).replace(/\\/g, '/') || '.';
                results.push({
                    name,
                    relativePath: rel,
                    folderPath: relFolder === '' ? '.' : relFolder,
                    extension: ext,
                    sizeBytes: stat.size,
                    modifiedAt: stat.mtime.toISOString(),
                    absolutePath: full,
                    kind: classify(ext),
                });
            }
        };
        walk(root, 0);
        return results.sort((a, b) => +new Date(b.modifiedAt) - +new Date(a.modifiedAt));
    }
    /**
     * Safe in-app preview. Text files are returned inline (capped at 512 KB), images as
     * base64 data URLs (capped at 8 MB). Anything else throws with an actionable message —
     * the renderer then offers "Open with default app" / "Reveal in folder" instead.
     */
    previewArtifact(projectId, relativePath) {
        const abs = this.resolveWithinProject(projectId, relativePath);
        const ext = path_1.default.extname(abs).replace(/^\./, '').toLowerCase();
        const stat = fs_1.default.statSync(abs);
        if (TEXT_EXTS.has(ext) || (!ext && stat.size <= TEXT_PREVIEW_LIMIT)) {
            const cap = Math.min(stat.size, TEXT_PREVIEW_LIMIT);
            const fd = fs_1.default.openSync(abs, 'r');
            let text = '';
            try {
                const buffer = Buffer.alloc(cap);
                fs_1.default.readSync(fd, buffer, 0, cap, 0);
                text = buffer.toString('utf-8');
            }
            finally {
                fs_1.default.closeSync(fd);
            }
            return {
                relativePath: relativePath.replace(/\\/g, '/'),
                contentType: 'text',
                text,
                truncated: stat.size > TEXT_PREVIEW_LIMIT,
            };
        }
        if (IMAGE_EXTS.has(ext)) {
            if (stat.size > IMAGE_PREVIEW_LIMIT) {
                throw new Error('Image is larger than 8 MB — use "Open with default app" instead.');
            }
            const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
            const dataUrl = `data:${mime};base64,${fs_1.default.readFileSync(abs).toString('base64')}`;
            return {
                relativePath: relativePath.replace(/\\/g, '/'),
                contentType: 'image',
                dataUrl,
                truncated: false,
            };
        }
        throw new Error(`No inline preview for .${ext || 'file'} — use "Open with default app" or "Reveal in folder".`);
    }
    openArtifact(projectId, relativePath) {
        const abs = this.resolveWithinProject(projectId, relativePath);
        // Fire-and-forget: the OS picks the handler; surface synchronous validation errors only.
        (0, runtime_1.openPath)(abs);
        return true;
    }
    revealArtifact(projectId, relativePath) {
        const abs = this.resolveWithinProject(projectId, relativePath);
        (0, runtime_1.revealInFolder)(abs);
        return true;
    }
    /**
     * Resolve an artifact to its absolute path + mime for download serving (web mode).
     * Same root-containment guard as previews — callers must never see a path outside the project.
     */
    getArtifactFile(projectId, relativePath) {
        const abs = this.resolveWithinProject(projectId, relativePath);
        const stat = fs_1.default.statSync(abs);
        if (!stat.isFile())
            throw new Error('Not a file.');
        if (stat.size > SKIP_FILE_BYTES)
            throw new Error('File is larger than 250 MB.');
        const ext = path_1.default.extname(abs).replace(/^\./, '').toLowerCase();
        const mime = MIME_BY_EXT[ext] ||
            (TEXT_EXTS.has(ext)
                ? 'text/plain; charset=utf-8'
                : ext === 'pdf'
                    ? 'application/pdf'
                    : VIDEO_EXTS.has(ext)
                        ? `video/${ext === 'mov' ? 'quicktime' : ext}`
                        : ARCHIVE_EXTS.has(ext)
                            ? 'application/octet-stream'
                            : 'application/octet-stream');
        return {
            relativePath: relativePath.replace(/\\/g, '/'),
            name: path_1.default.basename(abs),
            absolutePath: abs,
            sizeBytes: stat.size,
            mime,
        };
    }
    resolveWithinProject(projectId, relativePath) {
        const db = (0, db_1.getDb)();
        const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        if (!project)
            throw new Error('Project not found.');
        const root = project.root_path;
        const abs = path_1.default.resolve(root, relativePath);
        return (0, pathSecurity_1.assertPathWithinRoot)(root, abs);
    }
}
exports.ArtifactCatalogService = ArtifactCatalogService;
