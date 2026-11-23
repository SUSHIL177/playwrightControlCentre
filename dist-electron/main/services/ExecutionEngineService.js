"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionEngineService = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const uuid_1 = require("uuid");
const tree_kill_1 = __importDefault(require("tree-kill"));
const ipcChannels_1 = require("../../shared/ipcChannels");
const db_1 = require("../database/db");
const pathSecurity_1 = require("../utils/pathSecurity");
const ANSI_STRIP = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
class ExecutionEngineService {
    activeProcess = null;
    activeExecutionId = null;
    mapBatchRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            description: row.description,
            mode: row.mode,
            environment: row.environment,
            browsers: (() => {
                try {
                    return JSON.parse(row.browsers || '["chromium"]');
                }
                catch {
                    return ['chromium'];
                }
            })(),
            tag: row.tag || undefined,
            status: row.status,
            totalTests: row.total_tests,
            passed: row.passed,
            failed: row.failed,
            skipped: row.skipped,
            timedOut: row.timed_out,
            flaky: row.flaky,
            startTime: row.start_time,
            endTime: row.end_time || undefined,
            durationMs: row.duration_ms,
            htmlReportPath: row.html_report_path,
            jsonReportPath: row.json_report_path,
        };
    }
    isRunning() {
        return this.activeProcess !== null;
    }
    getActiveExecutionId() {
        return this.activeExecutionId;
    }
    /**
     * Lists all execution batches for a project by merging SQLite rows AND scanning the on-disk
     * `%APPDATA%/playwright-automation-control-center/executions` folder so saved reports & results
     * are NEVER lost even across reloads or upgrades.
     */
    listBatchesWithDiskSync(projectId) {
        const db = (0, db_1.getDb)();
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        const rows = db
            .prepare('SELECT * FROM execution_batches WHERE project_id = ? ORDER BY start_time DESC')
            .all(projectId);
        const batchMap = new Map();
        for (const r of rows) {
            batchMap.set(r.id, this.mapBatchRow(r));
        }
        // Reconcile any execution folders on disk that have results.json or html-report/index.html
        const executionsRoot = path_1.default.join(electron_1.app.getPath('userData'), 'executions');
        if (fs_1.default.existsSync(executionsRoot)) {
            const dirs = fs_1.default.readdirSync(executionsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
            for (const dir of dirs) {
                const execId = dir.name;
                const execDir = path_1.default.join(executionsRoot, execId);
                const htmlIndex = path_1.default.join(execDir, 'html-report', 'index.html');
                const jsonFile = path_1.default.join(execDir, 'results.json');
                const existing = batchMap.get(execId);
                // Skip folders that belong to a different project
                const anyProjectRow = db.prepare('SELECT project_id FROM execution_batches WHERE id = ?').get(execId);
                if (anyProjectRow && anyProjectRow.project_id !== projectId)
                    continue;
                if ((!existing || existing.totalTests === 0) && (fs_1.default.existsSync(jsonFile) || fs_1.default.existsSync(htmlIndex))) {
                    const stat = fs_1.default.statSync(execDir);
                    const hydrated = this.finalizeExecution(execId, projectId, project?.root_path || process.cwd(), jsonFile, path_1.default.join(execDir, 'html-report'), '', stat.birthtime.toISOString(), 0);
                    batchMap.set(execId, hydrated);
                }
            }
        }
        return Array.from(batchMap.values()).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }
    async startExecution(options, mainWindow, onEvent) {
        if (this.activeProcess) {
            throw new Error('An execution batch is already in progress. Stop it before starting a new run.');
        }
        const db = (0, db_1.getDb)();
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(options.projectId);
        if (!project)
            throw new Error('Imported project not found.');
        const executionId = `EXEC-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${(0, uuid_1.v4)().slice(0, 6).toUpperCase()}`;
        const artifactsBase = path_1.default.join(electron_1.app.getPath('userData'), 'executions', executionId);
        const htmlReportDir = path_1.default.join(artifactsBase, 'html-report');
        const jsonReportFile = path_1.default.join(artifactsBase, 'results.json');
        const testOutputDir = path_1.default.join(artifactsBase, 'test-results');
        (0, pathSecurity_1.ensureDirSync)(htmlReportDir);
        (0, pathSecurity_1.ensureDirSync)(testOutputDir);
        const browsers = options.browsers.length > 0 ? options.browsers : ['chromium'];
        const startTime = new Date().toISOString();
        const description = options.description ||
            `${options.mode.toUpperCase()} Run (${browsers.join(', ')})`;
        const batch = {
            id: executionId,
            projectId: project.id,
            description,
            mode: options.mode,
            environment: options.environment || 'default',
            browsers,
            tag: options.tag,
            status: 'running',
            totalTests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            timedOut: 0,
            flaky: 0,
            startTime,
            durationMs: 0,
            htmlReportPath: path_1.default.join(htmlReportDir, 'index.html'),
            jsonReportPath: jsonReportFile,
        };
        db.prepare(`
      INSERT INTO execution_batches (
        id, project_id, description, mode, environment, browsers, tag, status,
        total_tests, passed, failed, skipped, timed_out, flaky, start_time,
        duration_ms, html_report_path, json_report_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, 0, ?, ?)
    `).run(batch.id, batch.projectId, batch.description, batch.mode, batch.environment, JSON.stringify(batch.browsers), batch.tag || null, batch.status, batch.startTime, batch.htmlReportPath, batch.jsonReportPath);
        const localPlaywrightCli = path_1.default.join(project.root_path, 'node_modules', '@playwright', 'test', 'cli.js');
        const useDirectNode = fs_1.default.existsSync(localPlaywrightCli);
        const executable = useDirectNode
            ? (process.platform === 'win32' ? 'node.exe' : 'node')
            : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
        const args = useDirectNode ? [localPlaywrightCli, 'test'] : ['playwright', 'test'];
        if (options.mode === 'folder' || options.mode === 'spec') {
            if (options.targetPaths && options.targetPaths.length > 0) {
                args.push(...options.targetPaths.map((p) => p.replace(/\\/g, '/')));
            }
        }
        else if (options.mode === 'tests' && options.testIds && options.testIds.length > 0) {
            const placeholders = options.testIds.map(() => '?').join(',');
            const selectedRows = db
                .prepare(`SELECT title, relative_path FROM discovered_tests WHERE id IN (${placeholders})`)
                .all(...options.testIds);
            const files = Array.from(new Set(selectedRows.map((r) => r.relative_path.replace(/\\/g, '/'))));
            args.push(...files);
            const escapedTitles = selectedRows.map((r) => r.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            if (escapedTitles.length > 0) {
                args.push('--grep', `(${escapedTitles.join('|')})`);
            }
        }
        else if (options.mode === 'tag' && options.tag) {
            args.push('--grep', options.tag.startsWith('@') ? options.tag : `@${options.tag}`);
        }
        else if (options.mode === 'smoke') {
            args.push('--grep', '@smoke');
        }
        else if (options.mode === 'failed' && options.parentExecutionId) {
            const failedRows = db
                .prepare(`SELECT DISTINCT test_title, file_path FROM test_results WHERE execution_id = ? AND status IN ('failed', 'timedOut')`)
                .all(options.parentExecutionId);
            if (failedRows.length === 0) {
                throw new Error('No failed tests found in the specified execution batch.');
            }
            const relFiles = Array.from(new Set(failedRows.map((r) => path_1.default.relative(project.root_path, r.file_path).replace(/\\/g, '/'))));
            args.push(...relFiles);
            const escaped = failedRows.map((r) => r.test_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            args.push('--grep', `(${escaped.join('|')})`);
        }
        if (options.headed)
            args.push('--headed');
        if (options.workers && options.workers > 0)
            args.push(`--workers=${options.workers}`);
        if (typeof options.retries === 'number')
            args.push(`--retries=${options.retries}`);
        if (options.timeoutMs && options.timeoutMs > 0)
            args.push(`--timeout=${options.timeoutMs}`);
        const configuredProjects = JSON.parse(project.projects_configured || '[]');
        for (const b of browsers) {
            const matched = configuredProjects.find((cp) => cp.toLowerCase().includes(b.toLowerCase()));
            if (matched) {
                args.push(`--project=${matched}`);
            }
            else if (browsers.length === 1) {
                args.push(`--browser=${b}`);
            }
        }
        args.push('--reporter=list,html,json');
        args.push(`--output=${testOutputDir}`);
        const childEnv = { ...process.env };
        delete childEnv.NO_COLOR;
        childEnv.FORCE_COLOR = '0';
        childEnv.PLAYWRIGHT_HTML_REPORT = htmlReportDir;
        childEnv.PLAYWRIGHT_HTML_OPEN = 'never';
        childEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonReportFile;
        childEnv.TEST_ENV = options.environment || process.env.TEST_ENV || 'staging';
        this.activeExecutionId = executionId;
        const capturedStdout = [];
        const emitLog = (stream, text) => {
            const payload = {
                executionId,
                stream,
                text,
                timestamp: new Date().toISOString(),
            };
            mainWindow?.webContents.send(ipcChannels_1.IPC.EXEC_LOG_EVENT, payload);
            onEvent?.(ipcChannels_1.IPC.EXEC_LOG_EVENT, payload);
        };
        emitLog('system', `[Control Center] Starting Execution ${executionId}\n[Report Output] ${htmlReportDir}\n`);
        const child = (0, child_process_1.spawn)(executable, args, {
            cwd: project.root_path,
            env: childEnv,
            shell: !useDirectNode && process.platform === 'win32',
        });
        this.activeProcess = child;
        let spawnErrorHandled = false;
        // A failed spawn (missing node/npx, bad cwd, EMFILE …) never emits 'close' on some platforms.
        // Surface it as a failed batch + completion event so the UI never gets stuck in "EXECUTING".
        child.on('error', (spawnErr) => {
            if (spawnErrorHandled)
                return;
            spawnErrorHandled = true;
            this.activeProcess = null;
            this.activeExecutionId = null;
            const endTime = new Date().toISOString();
            const durationMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
            db.prepare(`UPDATE execution_batches SET status = 'failed', end_time = ?, duration_ms = ? WHERE id = ?`).run(endTime, durationMs, executionId);
            const failedBatch = this.mapBatchRow(db.prepare('SELECT * FROM execution_batches WHERE id = ?').get(executionId));
            emitLog('system', `\n[Control Center] Execution ${executionId} failed to start: ${spawnErr.message}\n`);
            mainWindow?.webContents.send(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, failedBatch);
            onEvent?.(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, failedBatch);
        });
        child.stdout?.on('data', (chunk) => {
            const str = chunk.toString('utf-8');
            capturedStdout.push(str);
            emitLog('stdout', str);
        });
        child.stderr?.on('data', (chunk) => {
            emitLog('stderr', chunk.toString('utf-8'));
        });
        child.on('close', (code) => {
            if (spawnErrorHandled)
                return;
            this.activeProcess = null;
            this.activeExecutionId = null;
            const completedBatch = this.finalizeExecution(executionId, project.id, project.root_path, jsonReportFile, htmlReportDir, capturedStdout.join(''), startTime, code, {
                description,
                mode: options.mode,
                environment: batch.environment,
                browsers,
                tag: options.tag,
            });
            emitLog('system', `\n[Control Center] Execution ${executionId} completed: ${completedBatch.passed} passed, ${completedBatch.failed} failed, ${completedBatch.skipped} skipped (${(completedBatch.durationMs / 1000).toFixed(1)}s).\n`);
            mainWindow?.webContents.send(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, completedBatch);
            onEvent?.(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, completedBatch);
        });
        return batch;
    }
    stopExecution() {
        if (!this.activeProcess || !this.activeProcess.pid)
            return false;
        (0, tree_kill_1.default)(this.activeProcess.pid, 'SIGTERM');
        return true;
    }
    finalizeExecution(executionId, projectId, projectRoot, jsonReportFile, htmlReportDir, rawStdout, startTimeIso, exitCode, originals) {
        const db = (0, db_1.getDb)();
        const endTime = new Date().toISOString();
        const durationMs = Math.max(0, new Date(endTime).getTime() - new Date(startTimeIso).getTime());
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        let timedOut = 0;
        let flaky = 0;
        const results = [];
        const candidateJsonFiles = [
            jsonReportFile,
            path_1.default.join(projectRoot, 'results.json'),
            path_1.default.join(projectRoot, 'test-results', 'results.json'),
            path_1.default.join(projectRoot, 'playwright-report', 'results.json'),
        ];
        const resolvedJsonFile = candidateJsonFiles.find((f) => fs_1.default.existsSync(f));
        if (resolvedJsonFile) {
            try {
                const raw = JSON.parse(fs_1.default.readFileSync(resolvedJsonFile, 'utf-8'));
                // Playwright's JSON reporter emits spec.file relative to the config rootDir/testDir
                // (observed: bare "sample.spec.ts" for testDir './tests'), NOT necessarily relative to
                // the project root. Resolve against both so per-test paths match discovery.
                const projectRow = db
                    .prepare('SELECT test_dir FROM projects WHERE id = ?')
                    .get(projectId);
                const configuredTestDir = projectRow?.test_dir || 'tests';
                const resolveSpecPath = (rawFile) => {
                    if (!rawFile)
                        return projectRoot;
                    if (path_1.default.isAbsolute(rawFile))
                        return rawFile;
                    const fromRoot = path_1.default.join(projectRoot, rawFile);
                    if (fs_1.default.existsSync(fromRoot))
                        return fromRoot;
                    const fromTestDir = path_1.default.join(projectRoot, configuredTestDir, rawFile);
                    if (fs_1.default.existsSync(fromTestDir))
                        return fromTestDir;
                    return fromRoot;
                };
                const walkSuite = (suite, ancestors) => {
                    const nextAncestors = suite.title && !suite.file ? [...ancestors, suite.title] : ancestors;
                    for (const spec of suite.specs || []) {
                        const rawFile = spec.file || suite.file || '';
                        const fullPath = resolveSpecPath(rawFile);
                        const relPath = path_1.default.relative(projectRoot, fullPath).replace(/\\/g, '/');
                        const folderPath = path_1.default.dirname(relPath).replace(/\\/g, '/');
                        for (const t of spec.tests || []) {
                            const browser = t.projectName || 'chromium';
                            const attempts = t.results || [];
                            const lastAttempt = attempts[attempts.length - 1] || {};
                            const outcome = t.outcome;
                            let status = 'passed';
                            if (outcome === 'flaky') {
                                status = 'flaky';
                                flaky += 1;
                            }
                            else if (outcome === 'skipped' || lastAttempt.status === 'skipped') {
                                status = 'skipped';
                                skipped += 1;
                            }
                            else if (lastAttempt.status === 'timedOut') {
                                status = 'timedOut';
                                timedOut += 1;
                                failed += 1;
                            }
                            else if (outcome === 'unexpected' || lastAttempt.status === 'failed') {
                                status = 'failed';
                                failed += 1;
                            }
                            else {
                                status = 'passed';
                                passed += 1;
                            }
                            const attachments = lastAttempt.attachments || [];
                            const screenshot = attachments.find((a) => a.contentType?.startsWith('image/'))?.path;
                            const video = attachments.find((a) => a.contentType?.startsWith('video/'))?.path;
                            const trace = attachments.find((a) => a.name === 'trace' || a.path?.endsWith('.zip'))?.path;
                            const errorObj = lastAttempt.error || (lastAttempt.errors && lastAttempt.errors[0]) || {};
                            // Playwright embeds ANSI color codes in JSON error messages/stacks — strip them
                            // so stored text stays machine-classifiable and human-readable in the UI.
                            const errorMessage = typeof errorObj.message === 'string' ? errorObj.message.replace(ANSI_STRIP, '') : undefined;
                            const stackTrace = typeof errorObj.stack === 'string' ? errorObj.stack.replace(ANSI_STRIP, '') : undefined;
                            const uniqueKey = `${relPath}::${nextAncestors.join(' > ')}::${spec.title}`;
                            const testId = Buffer.from(uniqueKey).toString('base64url');
                            const totalTestDuration = attempts.reduce((acc, a) => acc + (a.duration || 0), 0);
                            results.push({
                                id: (0, uuid_1.v4)(),
                                executionId,
                                projectId,
                                testId,
                                testTitle: spec.title,
                                fullTitle: [...nextAncestors, spec.title].join(' > '),
                                filePath: fullPath,
                                folderPath,
                                browser,
                                status,
                                durationMs: totalTestDuration,
                                retry: Math.max(0, attempts.length - 1),
                                errorMessage,
                                stackTrace,
                                screenshotPath: screenshot,
                                videoPath: video,
                                tracePath: trace,
                                timestamp: endTime,
                            });
                        }
                    }
                    for (const child of suite.suites || []) {
                        walkSuite(child, nextAncestors);
                    }
                };
                for (const s of raw.suites || []) {
                    walkSuite(s, []);
                }
            }
            catch {
                // Fall through
            }
        }
        if (results.length === 0 && rawStdout) {
            const cleanOut = rawStdout.replace(ANSI_STRIP, '');
            const lineRegex = /^\s*(✓|✘|×|-)\s+\d+\s+\[([^\]]+)\]\s+›\s+([^:]+):(\d+):\d+\s+›\s+(.+?)\s+(?:\((\d+(?:\.\d+)?)(m?s)\))?$/gm;
            let m;
            while ((m = lineRegex.exec(cleanOut)) !== null) {
                const symbol = m[1];
                const browser = m[2];
                const relFile = m[3].replace(/\\/g, '/');
                const fullTitle = m[5].trim();
                const titleParts = fullTitle.split(' › ');
                const testTitle = titleParts[titleParts.length - 1];
                const numVal = m[6] ? parseFloat(m[6]) : 0;
                const unit = m[7] || 's';
                const durMs = unit === 'ms' ? Math.round(numVal) : Math.round(numVal * 1000);
                let status = 'passed';
                if (symbol === '✓') {
                    status = 'passed';
                    passed += 1;
                }
                else if (symbol === '-') {
                    status = 'skipped';
                    skipped += 1;
                }
                else {
                    status = 'failed';
                    failed += 1;
                }
                const fullPath = path_1.default.join(projectRoot, relFile);
                const folderPath = path_1.default.dirname(relFile);
                const uniqueKey = `${relFile}::::${testTitle}`;
                results.push({
                    id: (0, uuid_1.v4)(),
                    executionId,
                    projectId,
                    testId: Buffer.from(uniqueKey).toString('base64url'),
                    testTitle,
                    fullTitle,
                    filePath: fullPath,
                    folderPath,
                    browser,
                    status,
                    durationMs: durMs,
                    retry: 0,
                    timestamp: endTime,
                });
            }
        }
        const isolatedIndex = path_1.default.join(htmlReportDir, 'index.html');
        const projectDefaultHtmlDir = path_1.default.join(projectRoot, 'playwright-report');
        if (!fs_1.default.existsSync(isolatedIndex) && fs_1.default.existsSync(path_1.default.join(projectDefaultHtmlDir, 'index.html'))) {
            fs_1.default.cpSync(projectDefaultHtmlDir, htmlReportDir, { recursive: true });
        }
        const totalTests = results.length;
        const finalStatus = exitCode === null ? 'stopped' : failed > 0 ? 'failed' : 'completed';
        const tx = db.transaction(() => {
            // When the batch row already exists (normal live-run path) its user-facing metadata
            // (description / mode / environment / browsers / tag) is preserved via the DO UPDATE clause.
            // The INSERT branch only fires for crash-recovery hydration from disk.
            db.prepare(`
        INSERT INTO execution_batches (
          id, project_id, description, mode, environment, browsers, tag, status,
          total_tests, passed, failed, skipped, timed_out, flaky, start_time,
          end_time, duration_ms, html_report_path, json_report_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          total_tests = excluded.total_tests,
          passed = excluded.passed,
          failed = excluded.failed,
          skipped = excluded.skipped,
          timed_out = excluded.timed_out,
          flaky = excluded.flaky,
          end_time = excluded.end_time,
          duration_ms = excluded.duration_ms,
          html_report_path = excluded.html_report_path,
          json_report_path = excluded.json_report_path,
          tag = COALESCE(excluded.tag, tag)
      `).run(executionId, projectId, originals?.description || `Execution ${executionId.slice(-6)}`, originals?.mode || 'full', originals?.environment || 'staging', JSON.stringify(originals?.browsers || ['chromium']), originals?.tag || null, finalStatus, totalTests, passed, failed, skipped, timedOut, flaky, startTimeIso, endTime, durationMs, isolatedIndex, jsonReportFile);
            db.prepare('DELETE FROM test_results WHERE execution_id = ?').run(executionId);
            const insertResult = db.prepare(`
        INSERT INTO test_results (
          id, execution_id, project_id, test_id, test_title, full_title,
          file_path, folder_path, browser, status, duration_ms, retry,
          error_message, stack_trace, screenshot_path, video_path, trace_path, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            // Match discovered tests on title + file (absolute or project-relative) so identically-titled
            // tests in different spec files do not stomp each other's last_status.
            const updateDiscovered = db.prepare(`
        UPDATE discovered_tests SET last_status = ?, last_duration_ms = ?, retry_count = ?
        WHERE project_id = ? AND title = ? AND (file_path = ? OR relative_path = ?)
      `);
            for (const r of results) {
                insertResult.run(r.id, r.executionId, r.projectId, r.testId, r.testTitle, r.fullTitle, r.filePath, r.folderPath, r.browser, r.status, r.durationMs, r.retry, r.errorMessage || null, r.stackTrace || null, r.screenshotPath || null, r.videoPath || null, r.tracePath || null, r.timestamp);
                const relMatch = path_1.default.isAbsolute(r.filePath)
                    ? path_1.default.relative(projectRoot, r.filePath).replace(/\\/g, '/')
                    : r.filePath.replace(/\\/g, '/');
                updateDiscovered.run(r.status, r.durationMs, r.retry, projectId, r.testTitle, r.filePath, relMatch);
            }
        });
        tx();
        const row = db.prepare('SELECT * FROM execution_batches WHERE id = ?').get(executionId);
        return this.mapBatchRow(row);
    }
}
exports.ExecutionEngineService = ExecutionEngineService;
