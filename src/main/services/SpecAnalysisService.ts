import fs from 'fs';
import path from 'path';
import { getDb } from '../database/db';
import { extractTestBlock, TestStepsResult } from '../../shared/specAnalysis';
export type { TestStepsResult };

/**
 * Resolves a discovered test to the concrete `test(...)` block in its spec file
 * and decomposes it into steps. Purely local — never executes project code.
 */
export class SpecAnalysisService {
  getTestSteps(projectId: string, testId: string): TestStepsResult {
    const db = getDb();
    const row = db.prepare('SELECT * FROM discovered_tests WHERE id = ? AND project_id = ?').get(testId, projectId) as
      | any
      | undefined;
    if (!row) throw new Error('Test case not found in this project. Refresh the Explorer tree and try again.');

    const rel: string = row.relative_path || '';
    const filePath: string = row.file_path || '';
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || '[]');
    } catch {
      tags = [];
    }

    const base: TestStepsResult = {
      testId,
      testTitle: row.full_title || row.title,
      relativePath: rel,
      lineCount: 0,
      tags,
      lastStatus: row.last_status || undefined,
      lastDurationMs: row.last_duration_ms ?? undefined,
      fileExists: false,
      found: false,
      startLine: 0,
      endLine: 0,
      source: '',
      bodySource: '',
      bodyStartLine: 0,
      steps: [],
    };

    if (!filePath || !fs.existsSync(filePath)) {
      return { ...base, reason: 'The spec file no longer exists on disk. Re-scan the project to refresh the test tree.' };
    }

    // Path safety: never read outside the imported project root.
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as
      | { root_path: string }
      | undefined;
    const root = project?.root_path ? path.resolve(project.root_path) : null;
    if (root && !path.resolve(filePath).startsWith(root + path.sep) && path.resolve(filePath) !== root) {
      return { ...base, reason: 'Refusing to read a file outside the imported project workspace.' };
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      return { ...base, reason: `Could not read the spec file: ${err?.message || err}` };
    }

    const extraction = extractTestBlock(content, row.full_title || row.title);
    return {
      ...base,
      ...extraction,
      lineCount: content.split('\n').length,
      fileExists: true,
    };
  }
}

export default SpecAnalysisService;
