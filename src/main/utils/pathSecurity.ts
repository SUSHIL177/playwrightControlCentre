import path from 'path';
import fs from 'fs';

export function assertPathWithinRoot(projectRoot: string, targetPath: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(targetPath);

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Security Violation: Path "${resolvedTarget}" escapes project root "${resolvedRoot}".`);
  }
  return resolvedTarget;
}

export function normalizeWinPath(inputPath: string): string {
  return path.normalize(inputPath.trim().replace(/^["']+|["']+$/g, ''));
}

export function ensureDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
