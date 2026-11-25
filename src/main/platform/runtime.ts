import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { defaultDataRoot } from './tenant';

/**
 * Platform helpers that hide the Electron-vs-plain-Node difference.
 * The hosted web server runs the same service layer without Electron, so every
 * Electron-only capability funnels through here with a web-safe fallback.
 */

export const isElectronRuntime: boolean = !!(process as any).versions?.electron;

function loadSafeStorage(): any | null {
  if (!isElectronRuntime) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    return electron?.safeStorage ?? null;
  } catch {
    return null;
  }
}

function loadShell(): any | null {
  if (!isElectronRuntime) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    return electron?.shell ?? null;
  } catch {
    return null;
  }
}

// ── Secret encryption (API keys, git tokens) ─────────────────────────────────

function secretKeyBytes(): Buffer {
  const fromEnv = (process.env.PACC_SECRET || '').trim();
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv).digest();
  const keyPath = path.join(defaultDataRoot(), 'secret.key');
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, fresh, { mode: 0o600 });
  return fresh;
}

/** Encrypt a secret for at-rest storage. Format: enc:gcm:<base64(iv|tag|ciphertext)> */
export function encryptSecret(plain: string): string {
  const safeStorage = loadSafeStorage();
  if (safeStorage?.isEncryptionAvailable?.()) {
    return `enc:safe:${safeStorage.encryptString(plain).toString('base64')}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKeyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:gcm:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

/** Decrypt secrets produced by any historical or current scheme. Throws on tamper/unknown format. */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  if (payload.startsWith('enc:gcm:')) {
    const buf = Buffer.from(payload.slice('enc:gcm:'.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKeyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
  if (payload.startsWith('enc:safe:')) {
    const safeStorage = loadSafeStorage();
    if (!safeStorage) throw new Error('This secret was encrypted on a desktop installation and cannot be decrypted here. Re-save the key.');
    return safeStorage.decryptString(Buffer.from(payload.slice('enc:safe:'.length), 'base64'));
  }
  // Legacy formats: base64(safeStorage bytes) or base64(plain utf8) — desktop-era rows.
  const safeStorage = loadSafeStorage();
  const buf = Buffer.from(payload, 'base64');
  if (safeStorage?.isEncryptionAvailable?.()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      /* fall through to legacy plain */
    }
  }
  const asUtf8 = buf.toString('utf8');
  if (asUtf8.trim().length > 0) return asUtf8;
  throw new Error('Unrecognized secret format.');
}

// ── Shell integration (desktop-only features) ───────────────────────────────

/** Thrown in hosted/web mode when the user asks for a desktop-only action. */
export class DesktopOnlyError extends Error {
  constructor(action: string) {
    super(`${action} is only available in the desktop app, not on the hosted web instance.`);
    this.name = 'DesktopOnlyError';
  }
}

export function openPath(target: string): void {
  const shell = loadShell();
  if (!shell?.openPath) throw new DesktopOnlyError('Opening files/folders');
  void shell.openPath(target);
}

export function revealInFolder(target: string): void {
  const shell = loadShell();
  if (!shell?.showItemInFolder) throw new DesktopOnlyError('Revealing files in the OS file manager');
  shell.showItemInFolder(target);
}
