import fs from 'fs';
import path from 'path';
import { openPath, revealInFolder } from '../platform/runtime';
import { ArtifactFile, ArtifactKind, ArtifactPreview } from '../../shared/types';
import { getDb } from '../database/db';
import { assertPathWithinRoot } from '../utils/pathSecurity';

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

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

function classify(extension: string): ArtifactKind {
  if (TEXT_EXTS.has(extension)) return 'text';
  if (IMAGE_EXTS.has(extension)) return 'image';
  if (VIDEO_EXTS.has(extension)) return 'video';
  if (ARCHIVE_EXTS.has(extension)) return 'archive';
  if (extension === 'pdf') return 'pdf';
  return 'other';
}

export class ArtifactCatalogService {
  /**
   * Recursively catalogs files the user's Playwright suite writes into the project folder
   * (data exports, downloads, JSON/CSV payloads, traces, screenshots, …) so they can be
   * browsed, previewed and opened from inside PACC.
   */
  listArtifacts(projectId: string): ArtifactFile[] {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) throw new Error('Project not found.');

    const root: string = project.root_path;
    const results: ArtifactFile[] = [];

    const walk = (dir: string, depth: number) => {
      if (depth > MAX_DEPTH || results.length >= MAX_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // unreadable directory — skip silently
      }

      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;
        const name = entry.name;
        if (name.startsWith('.')) continue; // hidden dirs/files are tooling, not test artifacts

        const full = path.join(dir, name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(name.toLowerCase())) walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.size > SKIP_FILE_BYTES) continue;

        const ext = path.extname(name).replace(/^\./, '').toLowerCase();
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const relFolder = path.dirname(rel).replace(/\\/g, '/') || '.';

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
  previewArtifact(projectId: string, relativePath: string): ArtifactPreview {
    const abs = this.resolveWithinProject(projectId, relativePath);
    const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
    const stat = fs.statSync(abs);

    if (TEXT_EXTS.has(ext) || (!ext && stat.size <= TEXT_PREVIEW_LIMIT)) {
      const cap = Math.min(stat.size, TEXT_PREVIEW_LIMIT);
      const fd = fs.openSync(abs, 'r');
      let text = '';
      try {
        const buffer = Buffer.alloc(cap);
        fs.readSync(fd, buffer, 0, cap, 0);
        text = buffer.toString('utf-8');
      } finally {
        fs.closeSync(fd);
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
      const dataUrl = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
      return {
        relativePath: relativePath.replace(/\\/g, '/'),
        contentType: 'image',
        dataUrl,
        truncated: false,
      };
    }

    throw new Error(
      `No inline preview for .${ext || 'file'} — use "Open with default app" or "Reveal in folder".`
    );
  }

  openArtifact(projectId: string, relativePath: string): true {
    const abs = this.resolveWithinProject(projectId, relativePath);
    // Fire-and-forget: the OS picks the handler; surface synchronous validation errors only.
    openPath(abs);
    return true;
  }

  revealArtifact(projectId: string, relativePath: string): true {
    const abs = this.resolveWithinProject(projectId, relativePath);
    revealInFolder(abs);
    return true;
  }

  /**
   * Resolve an artifact to its absolute path + mime for download serving (web mode).
   * Same root-containment guard as previews — callers must never see a path outside the project.
   */
  getArtifactFile(projectId: string, relativePath: string): { relativePath: string; name: string; absolutePath: string; sizeBytes: number; mime: string } {
    const abs = this.resolveWithinProject(projectId, relativePath);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error('Not a file.');
    if (stat.size > SKIP_FILE_BYTES) throw new Error('File is larger than 250 MB.');
    const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
    const mime =
      MIME_BY_EXT[ext] ||
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
      name: path.basename(abs),
      absolutePath: abs,
      sizeBytes: stat.size,
      mime,
    };
  }

  private resolveWithinProject(projectId: string, relativePath: string): string {
    const db = getDb();
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) throw new Error('Project not found.');
    const root = project.root_path as string;
    const abs = path.resolve(root, relativePath);
    return assertPathWithinRoot(root, abs);
  }
}
