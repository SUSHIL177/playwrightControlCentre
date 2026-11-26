"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpecAnalysisService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../database/db");
const specAnalysis_1 = require("../../shared/specAnalysis");
/**
 * Resolves a discovered test to the concrete `test(...)` block in its spec file
 * and decomposes it into steps. Purely local — never executes project code.
 */
class SpecAnalysisService {
    getTestSteps(projectId, testId) {
        const db = (0, db_1.getDb)();
        const row = db.prepare('SELECT * FROM discovered_tests WHERE id = ? AND project_id = ?').get(testId, projectId);
        if (!row)
            throw new Error('Test case not found in this project. Refresh the Explorer tree and try again.');
        const rel = row.relative_path || '';
        const filePath = row.file_path || '';
        let tags = [];
        try {
            tags = JSON.parse(row.tags || '[]');
        }
        catch {
            tags = [];
        }
        const base = {
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
        if (!filePath || !fs_1.default.existsSync(filePath)) {
            return { ...base, reason: 'The spec file no longer exists on disk. Re-scan the project to refresh the test tree.' };
        }
        // Path safety: never read outside the imported project root.
        const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        const root = project?.root_path ? path_1.default.resolve(project.root_path) : null;
        if (root && !path_1.default.resolve(filePath).startsWith(root + path_1.default.sep) && path_1.default.resolve(filePath) !== root) {
            return { ...base, reason: 'Refusing to read a file outside the imported project workspace.' };
        }
        let content;
        try {
            content = fs_1.default.readFileSync(filePath, 'utf-8');
        }
        catch (err) {
            return { ...base, reason: `Could not read the spec file: ${err?.message || err}` };
        }
        const extraction = (0, specAnalysis_1.extractTestBlock)(content, row.full_title || row.title);
        return {
            ...base,
            ...extraction,
            lineCount: content.split('\n').length,
            fileExists: true,
        };
    }
}
exports.SpecAnalysisService = SpecAnalysisService;
exports.default = SpecAnalysisService;
