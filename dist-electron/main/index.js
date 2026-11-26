"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const runtime_1 = require("./platform/runtime");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const chokidar_1 = __importDefault(require("chokidar"));
const ipcChannels_1 = require("../shared/ipcChannels");
const db_1 = require("./database/db");
const ProjectDiscoveryService_1 = require("./services/ProjectDiscoveryService");
const ExecutionEngineService_1 = require("./services/ExecutionEngineService");
const FailureIntelligenceService_1 = require("./services/FailureIntelligenceService");
const AnalyticsIntelligenceService_1 = require("./services/AnalyticsIntelligenceService");
const SchedulerAndReportService_1 = require("./services/SchedulerAndReportService");
const SettingsService_1 = require("./services/SettingsService");
const ArtifactCatalogService_1 = require("./services/ArtifactCatalogService");
const SpecAnalysisService_1 = require("./services/SpecAnalysisService");
const ImprovementAdvisorService_1 = require("./services/ImprovementAdvisorService");
const RunHealthService_1 = require("./services/RunHealthService");
const LocalBridgeServer_1 = require("./server/LocalBridgeServer");
const tenant_1 = require("./platform/tenant");
// Keep desktop data where it always was; the web server never calls this (uses PACC_DATA_DIR / ~/.pacc).
(0, tenant_1.configureElectronUserData)(() => electron_1.app.getPath('userData'));
let mainWindow = null;
let specWatcher = null;
const settingsService = new SettingsService_1.SettingsService();
const discoveryService = new ProjectDiscoveryService_1.ProjectDiscoveryService();
const executionService = new ExecutionEngineService_1.ExecutionEngineService();
const failureService = new FailureIntelligenceService_1.FailureIntelligenceService(settingsService);
const analyticsService = new AnalyticsIntelligenceService_1.AnalyticsIntelligenceService();
const schedulerReportService = new SchedulerAndReportService_1.SchedulerAndReportService(executionService);
const artifactService = new ArtifactCatalogService_1.ArtifactCatalogService();
const specAnalysisService = new SpecAnalysisService_1.SpecAnalysisService();
const improvementAdvisorService = new ImprovementAdvisorService_1.ImprovementAdvisorService();
const bridgeServer = new LocalBridgeServer_1.LocalBridgeServer(discoveryService, executionService, failureService, analyticsService, schedulerReportService, settingsService, artifactService, specAnalysisService, improvementAdvisorService, () => mainWindow);
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1480,
        height: 920,
        minWidth: 1180,
        minHeight: 740,
        backgroundColor: '#0B1120',
        title: 'Playwright Automation Control Center',
        webPreferences: {
            preload: path_1.default.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    if (process.env.VITE_DEV_SERVER_URL || !electron_1.app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function registerIpcHandlers() {
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_BROWSE_DIR, async () => {
        const opts = {
            properties: ['openDirectory'],
            title: 'Select Local Playwright Project Directory',
        };
        const result = mainWindow ? await electron_1.dialog.showOpenDialog(mainWindow, opts) : await electron_1.dialog.showOpenDialog(opts);
        return result.canceled ? null : result.filePaths[0];
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_IMPORT, async (_, projectPath) => {
        return discoveryService.importProject(projectPath);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SETTINGS_HAS_GIT_TOKEN, () => {
        return settingsService.hasGitToken();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_IMPORT_FROM_GIT, async (_, req) => {
        let token = req?.token;
        if (req?.useSavedToken) {
            token = settingsService.getGitToken() ?? undefined;
            if (!token)
                throw new Error('No saved git token on this instance.');
        }
        const project = await discoveryService.importProjectFromGit({
            url: req?.url,
            token,
            branch: req?.branch,
        });
        if (req?.rememberToken && token) {
            settingsService.saveGitToken(token);
        }
        return project;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_LIST, () => {
        return discoveryService.listProjects();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_DELETE, (_, projectId) => {
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
        deleteCascade(projectId);
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.PROJECT_RESCAN, async (_, projectId) => {
        const project = discoveryService.listProjects().find((p) => p.id === projectId);
        if (!project)
            throw new Error('Project not found');
        await discoveryService.discoverTests(project);
        return discoveryService.buildFolderTree(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.TESTS_GET_TREE, (_, projectId) => {
        return discoveryService.buildFolderTree(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.TESTS_LIST, (_, projectId) => {
        return discoveryService.listTestsForProject(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.TESTS_WATCH_START, (_, projectId) => {
        const project = discoveryService.listProjects().find((p) => p.id === projectId);
        if (!project)
            return false;
        if (specWatcher) {
            specWatcher.close();
        }
        const watchDir = path_1.default.join(project.rootPath, project.testDir);
        if (!fs_1.default.existsSync(watchDir))
            return false;
        specWatcher = chokidar_1.default.watch(watchDir, { ignoreInitial: true, depth: 8 });
        let debounceTimer = null;
        specWatcher.on('all', () => {
            if (debounceTimer)
                clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                await discoveryService.discoverTests(project);
                mainWindow?.webContents.send(ipcChannels_1.IPC.TESTS_CHANGED_EVENT, projectId);
                bridgeServer.broadcast(ipcChannels_1.IPC.TESTS_CHANGED_EVENT, projectId);
            }, 800);
        });
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.EXEC_START, async (_, options) => {
        return executionService.startExecution(options, mainWindow, (ev, payload) => bridgeServer.broadcast(ev, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.EXEC_STOP, () => {
        return executionService.stopExecution();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.EXEC_ACTIVE_STATUS, () => {
        return {
            isRunning: executionService.isRunning(),
            activeExecutionId: executionService.getActiveExecutionId(),
        };
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HISTORY_LIST_BATCHES, (_, projectId) => {
        return executionService.listBatchesWithDiskSync(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HISTORY_GET_RESULTS, (_, executionId) => {
        const rows = (0, db_1.getDb)()
            .prepare('SELECT * FROM test_results WHERE execution_id = ?')
            .all(executionId);
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
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HISTORY_COMPARE_BATCHES, (_, batchA, batchB) => {
        return analyticsService.compareBatches(batchA, batchB);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HISTORY_DELETE_BATCH, (_, executionId) => {
        const db = (0, db_1.getDb)();
        const deleteCascade = db.transaction((id) => {
            db.prepare(`DELETE FROM healing_proposals WHERE failure_id IN (SELECT id FROM failure_analyses WHERE execution_id = ?)`).run(id);
            db.prepare('DELETE FROM failure_analyses WHERE execution_id = ?').run(id);
            db.prepare('DELETE FROM test_results WHERE execution_id = ?').run(id);
            db.prepare('DELETE FROM execution_batches WHERE id = ?').run(id);
        });
        deleteCascade(executionId);
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.REPORT_OPEN_BROWSER, (_, htmlReportPath) => {
        schedulerReportService.openNativeReportInBrowser(htmlReportPath);
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.REPORT_START_HOSTING, (_, htmlReportPath) => {
        return schedulerReportService.hostReportDirectory(path_1.default.dirname(htmlReportPath));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.REPORT_REVEAL_IN_FOLDER, (_, htmlReportPath) => {
        if (!htmlReportPath)
            throw new Error('No report path provided.');
        if (fs_1.default.existsSync(htmlReportPath)) {
            (0, runtime_1.revealInFolder)(htmlReportPath);
        }
        else {
            void (0, runtime_1.openPath)(path_1.default.dirname(htmlReportPath));
        }
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.ARTIFACTS_LIST, (_, projectId) => {
        return artifactService.listArtifacts(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.ARTIFACTS_PREVIEW, (_, projectId, relativePath) => {
        return artifactService.previewArtifact(projectId, relativePath);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.ARTIFACTS_OPEN, (_, projectId, relativePath) => {
        return artifactService.openArtifact(projectId, relativePath);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.ARTIFACTS_REVEAL, (_, projectId, relativePath) => {
        return artifactService.revealArtifact(projectId, relativePath);
    });
    const sendProgress = (event, payload) => {
        try {
            event.sender.send(ipcChannels_1.IPC.HEALING_PROGRESS_EVENT, payload);
        }
        catch {
            /* renderer gone */
        }
    };
    electron_1.ipcMain.handle(ipcChannels_1.IPC.FAILURE_ANALYZE_BATCH, (event, executionId) => {
        return failureService.analyzeExecutionFailures(executionId, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.FAILURE_LIST, (_, projectId) => {
        return failureService.listFailures(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.FAILURE_RECLASSIFY, (_, failureId, category, classification) => {
        failureService.reclassifyFailure(failureId, category, classification);
        return true;
    });
    // Generate now auto-validates in the background — the card the user sees already
    // carries a validated_pass / validated_fail verdict instead of "pending".
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_GENERATE, (event, failureId) => {
        return failureService.generateAndValidate(failureId, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_VALIDATE, (event, proposalId, editedCode) => {
        return failureService.validateProposal(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_APPROVE_APPLY, (event, proposalId, editedCode) => {
        return failureService.approveAndApply(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_ROLLBACK, (event, proposalId) => {
        return failureService.rollbackProposal(proposalId, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_RUN_HEADED, (event, proposalId, editedCode) => {
        return failureService.runProposalHeaded(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_REJECT, (_, proposalId) => {
        (0, db_1.getDb)().prepare(`UPDATE healing_proposals SET status = 'rejected' WHERE id = ?`).run(proposalId);
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.HEALING_LIST, (_, projectId) => {
        return failureService.listProposals(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_FLAKY_TESTS, (_, projectId, minRuns) => {
        return analyticsService.getFlakyTests(projectId, minRuns);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_CROSS_BROWSER, (_, projectId) => {
        return analyticsService.getCrossBrowserMatrix(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.TESTS_GET_STEPS, (_, projectId, testId) => {
        return specAnalysisService.getTestSteps(projectId, testId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_IMPROVE, (_, projectId) => {
        return improvementAdvisorService.analyze(projectId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_APPLY_FIX, (_, req) => {
        return improvementAdvisorService.applyFix(req);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_REVERT_FIX, (_, applicationId) => {
        return improvementAdvisorService.revertFix(applicationId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_GET_HEALTH, () => {
        return RunHealthService_1.runHealthService.snapshot();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.INTEL_GET_BATCH_HEALTH, (_, projectId, batchId) => {
        return RunHealthService_1.runHealthService.getBatchHealth(projectId, batchId);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SCHEDULER_LIST, () => {
        return schedulerReportService.listSchedules();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SCHEDULER_SAVE, (_, config) => {
        return schedulerReportService.saveSchedule(config, () => mainWindow);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SCHEDULER_DELETE, (_, id) => {
        schedulerReportService.deleteSchedule(id);
        return true;
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SETTINGS_GET, () => {
        return settingsService.getSettings();
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SETTINGS_SAVE, (_, settings) => {
        return settingsService.saveSettings(settings);
    });
    electron_1.ipcMain.handle(ipcChannels_1.IPC.SETTINGS_SAVE_API_KEY, (_, key) => {
        settingsService.saveApiKey(key);
        return settingsService.getSettings();
    });
}
electron_1.app.whenReady().then(async () => {
    await (0, db_1.initDb)();
    registerIpcHandlers();
    bridgeServer.start(17890);
    schedulerReportService.initPersistedSchedules(() => mainWindow);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
