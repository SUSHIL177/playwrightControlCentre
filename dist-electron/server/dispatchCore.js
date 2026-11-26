"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchIdFromReportPath = batchIdFromReportPath;
exports.createDispatch = createDispatch;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../main/database/db");
const RunHealthService_1 = require("../main/services/RunHealthService");
const runtime_1 = require("../main/platform/runtime");
const tenant_1 = require("../main/platform/tenant");
/** Extract the RUN-… batch id out of an archived report path, if present. */
function batchIdFromReportPath(htmlReportPath) {
    const m = String(htmlReportPath || '')
        .replace(/\\/g, '/')
        .match(/executions\/([^/]+)\/html-report(?:\/index\.html)?$/);
    return m?.[1];
}
function createDispatch(services, hooks) {
    const progress = (_channel, payload) => hooks.emitEvent('healing:progress-event', payload);
    return async function dispatch(method, args) {
        const { discovery: discoveryService, execution: executionService, failure: failureService } = services;
        const { schedulerReport: schedulerReportService, analytics: analyticsService, settings: settingsService, artifacts: artifactService } = services;
        switch (method) {
            case 'browseDirectory': {
                if (hooks.isWeb) {
                    throw new runtime_1.DesktopOnlyError('Browsing the server filesystem');
                }
                const { dialog } = await import('electron');
                const win = hooks.getMainWindow();
                const opts = {
                    properties: ['openDirectory'],
                    title: 'Select Local Playwright Project Directory',
                };
                const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
                return r.canceled ? null : r.filePaths[0];
            }
            case 'importProject': {
                const target = String(args[0] ?? '');
                if (hooks.isWeb) {
                    // Multi-tenant isolation: imports must stay inside the caller's workspace.
                    const allowedRoot = path_1.default.resolve((0, tenant_1.reposRoot)());
                    const resolved = path_1.default.resolve(target);
                    if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path_1.default.sep)) {
                        throw new Error('Hosted pacc only imports projects cloned into your own workspace (use the Git import).');
                    }
                }
                return discoveryService.importProject(target);
            }
            case 'importProjectFromGit': {
                const req = (args[0] ?? {});
                let token = req.token;
                if (req.useSavedToken) {
                    const saved = settingsService.getGitToken();
                    if (!saved)
                        throw new Error('No saved git token on this instance. Save one by ticking "Remember token" on an import.');
                    token = saved;
                }
                const project = await discoveryService.importProjectFromGit({
                    url: req.url,
                    token,
                    branch: req.branch,
                });
                if (req.rememberToken && token) {
                    settingsService.saveGitToken(token);
                }
                return project;
            }
            case 'hasGitToken':
                return settingsService.hasGitToken();
            case 'listProjects':
                return discoveryService.listProjects();
            case 'deleteProject': {
                const db = (0, db_1.getDb)();
                const deleteCascade = db.transaction((id) => {
                    db.prepare('DELETE FROM healing_proposals WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM failure_analyses WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM test_results WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM execution_batches WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM discovered_tests WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM schedules WHERE project_id = ?').run(id);
                    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
                });
                deleteCascade(args[0]);
                return true;
            }
            case 'rescanProject': {
                const project = discoveryService.listProjects().find((p) => p.id === args[0]);
                if (!project)
                    throw new Error('Project not found');
                await discoveryService.discoverTests(project);
                return discoveryService.buildFolderTree(args[0]);
            }
            case 'getTestTree':
                return discoveryService.buildFolderTree(args[0]);
            case 'listTests':
                return discoveryService.listTestsForProject(args[0]);
            case 'startExecution':
                return executionService.startExecution(args[0], hooks.getMainWindow(), hooks.emitEvent);
            case 'stopExecution':
                return executionService.stopExecution();
            case 'getActiveExecutionStatus':
                return {
                    isRunning: executionService.isRunning(),
                    activeExecutionId: executionService.getActiveExecutionId(),
                };
            case 'listExecutionBatches':
                return executionService.listBatchesWithDiskSync(args[0]);
            case 'getExecutionResults': {
                const rows = (0, db_1.getDb)().prepare('SELECT * FROM test_results WHERE execution_id = ?').all(args[0]);
                return rows.map((r) => ({
                    id: r.id,
                    executionId: r.execution_id,
                    projectId: r.project_id,
                    testId: r.test_id,
                    testTitle: r.test_title,
                    fullTitle: r.full_title,
                    filePath: r.file_path,
                    folderPath: r.folder_path,
                    browser: r.browser,
                    status: r.status,
                    durationMs: r.duration_ms,
                    retry: r.retry,
                    errorMessage: r.error_message || undefined,
                    stackTrace: r.stack_trace || undefined,
                    screenshotPath: r.screenshot_path || undefined,
                    videoPath: r.video_path || undefined,
                    tracePath: r.trace_path || undefined,
                    timestamp: r.timestamp,
                }));
            }
            case 'compareBatches':
                return analyticsService.compareBatches(args[0], args[1]);
            case 'deleteBatch': {
                const db = (0, db_1.getDb)();
                const deleteCascade = db.transaction((id) => {
                    db.prepare(`DELETE FROM healing_proposals WHERE failure_id IN (SELECT id FROM failure_analyses WHERE execution_id = ?)`).run(id);
                    db.prepare('DELETE FROM failure_analyses WHERE execution_id = ?').run(id);
                    db.prepare('DELETE FROM test_results WHERE execution_id = ?').run(id);
                    db.prepare('DELETE FROM execution_batches WHERE id = ?').run(id);
                });
                deleteCascade(args[0]);
                return true;
            }
            case 'openReportInBrowser': {
                if (hooks.isWeb) {
                    const batchId = batchIdFromReportPath(args[0]);
                    if (!batchId)
                        throw new Error('Could not resolve the batch id from the report path.');
                    const row = (0, db_1.getDb)().prepare('SELECT id FROM execution_batches WHERE id = ?').get(batchId);
                    if (!row)
                        throw new Error('Report not found.');
                    return `/reports/${encodeURIComponent(batchId)}/index.html`;
                }
                schedulerReportService.openNativeReportInBrowser(args[0]);
                return true;
            }
            case 'startReportHosting': {
                if (hooks.isWeb) {
                    // The authenticated /reports route IS the hosting mechanism — no extra port.
                    const batchId = batchIdFromReportPath(args[0]);
                    if (!batchId)
                        throw new Error('Could not resolve the batch id from the report path.');
                    const row = (0, db_1.getDb)().prepare('SELECT id FROM execution_batches WHERE id = ?').get(batchId);
                    if (!row)
                        throw new Error('Report not found.');
                    return `/reports/${encodeURIComponent(batchId)}/index.html`;
                }
                return schedulerReportService.hostReportDirectory(path_1.default.dirname(args[0]));
            }
            case 'revealReportInFolder': {
                if (hooks.isWeb)
                    throw new runtime_1.DesktopOnlyError('Revealing files in the OS file manager');
                const target = args[0];
                const { shell } = await import('electron');
                if (target && fs_1.default.existsSync(target)) {
                    shell.showItemInFolder(target);
                }
                else if (target) {
                    shell.openPath(path_1.default.dirname(target));
                }
                return true;
            }
            case 'listArtifacts':
                return artifactService.listArtifacts(args[0]);
            case 'previewArtifact':
                return artifactService.previewArtifact(args[0], args[1]);
            case 'openArtifact': {
                if (hooks.isWeb) {
                    // Serve the file itself instead of asking the server OS to open it.
                    const artifact = artifactService.getArtifactFile(args[0], args[1]);
                    if (!artifact)
                        throw new Error('Artifact not found.');
                    return `/artifacts-file/${encodeURIComponent(args[0])}/${artifact.relativePath.split('/').map(encodeURIComponent).join('/')}`;
                }
                return artifactService.openArtifact(args[0], args[1]);
            }
            case 'revealArtifact':
                if (hooks.isWeb)
                    throw new runtime_1.DesktopOnlyError('Revealing files in the OS file manager');
                return artifactService.revealArtifact(args[0], args[1]);
            case 'analyzeBatchFailures':
                return failureService.analyzeExecutionFailures(args[0], progress);
            case 'listFailures':
                return failureService.listFailures(args[0]);
            case 'reclassifyFailure':
                failureService.reclassifyFailure(args[0], args[1], args[2]);
                return true;
            // Generate auto-validates in the background; progress lines stream to SSE subscribers.
            case 'generateHealingProposal':
                return failureService.generateAndValidate(args[0], progress);
            case 'validateProposal':
                return failureService.validateProposal(args[0], args[1], progress);
            case 'approveAndApplyProposal':
                return failureService.approveAndApply(args[0], args[1], progress);
            case 'runProposalHeaded': {
                if (hooks.isWeb) {
                    throw new runtime_1.DesktopOnlyError('Headed browser runs');
                }
                return failureService.runProposalHeaded(args[0], args[1], progress);
            }
            case 'rejectProposal':
                (0, db_1.getDb)().prepare(`UPDATE healing_proposals SET status = 'rejected' WHERE id = ?`).run(args[0]);
                return true;
            case 'rollbackProposal':
                return failureService.rollbackProposal(args[0], progress);
            case 'listProposals':
                return failureService.listProposals(args[0]);
            case 'getFlakyTests':
                return analyticsService.getFlakyTests(args[0], args[1]);
            case 'getCrossBrowserMatrix':
                return analyticsService.getCrossBrowserMatrix(args[0]);
            case 'getTestSteps':
                return services.specAnalysis.getTestSteps(args[0], args[1]);
            case 'getImprovementAdvisor':
                return services.improvement.analyze(args[0]);
            case 'applyAdvisorFix':
                return services.improvement.applyFix(args[0]);
            case 'revertAdvisorFix':
                return services.improvement.revertFix(args[0]);
            case 'getHealth':
                return RunHealthService_1.runHealthService.snapshot();
            case 'getBatchHealth':
                return RunHealthService_1.runHealthService.getBatchHealth(args[0], args[1]);
            case 'listSchedules':
                return schedulerReportService.listSchedules();
            case 'saveSchedule':
                return schedulerReportService.saveSchedule(args[0], hooks.getMainWindow);
            case 'deleteSchedule':
                schedulerReportService.deleteSchedule(args[0]);
                return true;
            case 'getSettings':
                return settingsService.getSettings();
            case 'saveSettings':
                return settingsService.saveSettings(args[0]);
            case 'saveApiKey':
                settingsService.saveApiKey(args[0]);
                return settingsService.getSettings();
            default:
                throw new Error(`Unknown RPC method: ${method}`);
        }
    };
}
