import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { openPath, revealInFolder } from './platform/runtime';
import path from 'path';
import fs from 'fs';
import chokidar, { FSWatcher } from 'chokidar';
import { IPC } from '../shared/ipcChannels';
import { getDb, initDb } from './database/db';
import { ProjectDiscoveryService } from './services/ProjectDiscoveryService';
import { ExecutionEngineService } from './services/ExecutionEngineService';
import { FailureIntelligenceService } from './services/FailureIntelligenceService';
import { AnalyticsIntelligenceService } from './services/AnalyticsIntelligenceService';
import { SchedulerAndReportService } from './services/SchedulerAndReportService';
import { SettingsService } from './services/SettingsService';
import { ArtifactCatalogService } from './services/ArtifactCatalogService';
import { SpecAnalysisService } from './services/SpecAnalysisService';
import { ImprovementAdvisorService } from './services/ImprovementAdvisorService';
import { LocalBridgeServer } from './server/LocalBridgeServer';
import { configureElectronUserData } from './platform/tenant';
import { GitImportRequest } from '../shared/types';

// Keep desktop data where it always was; the web server never calls this (uses PACC_DATA_DIR / ~/.pacc).
configureElectronUserData(() => app.getPath('userData'));

let mainWindow: BrowserWindow | null = null;
let specWatcher: FSWatcher | null = null;

const settingsService = new SettingsService();
const discoveryService = new ProjectDiscoveryService();
const executionService = new ExecutionEngineService();
const failureService = new FailureIntelligenceService(settingsService);
const analyticsService = new AnalyticsIntelligenceService();
const schedulerReportService = new SchedulerAndReportService(executionService);
const artifactService = new ArtifactCatalogService();
const specAnalysisService = new SpecAnalysisService();
const improvementAdvisorService = new ImprovementAdvisorService();
const bridgeServer = new LocalBridgeServer(
  discoveryService,
  executionService,
  failureService,
  analyticsService,
  schedulerReportService,
  settingsService,
  artifactService,
  specAnalysisService,
  improvementAdvisorService,
  () => mainWindow
);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    backgroundColor: '#0B1120',
    title: 'Playwright Automation Control Center',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.PROJECT_BROWSE_DIR, async () => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Select Local Playwright Project Directory',
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.PROJECT_IMPORT, async (_, projectPath: string) => {
    return discoveryService.importProject(projectPath);
  });
  ipcMain.handle(IPC.SETTINGS_HAS_GIT_TOKEN, () => {
    return settingsService.hasGitToken();
  });
  ipcMain.handle(IPC.PROJECT_IMPORT_FROM_GIT, async (_, req: GitImportRequest) => {
    let token = req?.token;
    if (req?.useSavedToken) {
      token = settingsService.getGitToken() ?? undefined;
      if (!token) throw new Error('No saved git token on this instance.');
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

  ipcMain.handle(IPC.PROJECT_LIST, () => {
    return discoveryService.listProjects();
  });

  ipcMain.handle(IPC.PROJECT_DELETE, (_, projectId: string) => {
    const db = getDb();
    const deleteCascade = db.transaction((id: string) => {
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

  ipcMain.handle(IPC.PROJECT_RESCAN, async (_, projectId: string) => {
    const project = discoveryService.listProjects().find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found');
    await discoveryService.discoverTests(project);
    return discoveryService.buildFolderTree(projectId);
  });

  ipcMain.handle(IPC.TESTS_GET_TREE, (_, projectId: string) => {
    return discoveryService.buildFolderTree(projectId);
  });

  ipcMain.handle(IPC.TESTS_LIST, (_, projectId: string) => {
    return discoveryService.listTestsForProject(projectId);
  });

  ipcMain.handle(IPC.TESTS_WATCH_START, (_, projectId: string) => {
    const project = discoveryService.listProjects().find((p) => p.id === projectId);
    if (!project) return false;
    if (specWatcher) {
      specWatcher.close();
    }
    const watchDir = path.join(project.rootPath, project.testDir);
    if (!fs.existsSync(watchDir)) return false;

    specWatcher = chokidar.watch(watchDir, { ignoreInitial: true, depth: 8 });
    let debounceTimer: NodeJS.Timeout | null = null;
    specWatcher.on('all', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await discoveryService.discoverTests(project);
        mainWindow?.webContents.send(IPC.TESTS_CHANGED_EVENT, projectId);
        bridgeServer.broadcast(IPC.TESTS_CHANGED_EVENT, projectId);
      }, 800);
    });
    return true;
  });

  ipcMain.handle(IPC.EXEC_START, async (_, options) => {
    return executionService.startExecution(options, mainWindow, (ev, payload) =>
      bridgeServer.broadcast(ev, payload)
    );
  });

  ipcMain.handle(IPC.EXEC_STOP, () => {
    return executionService.stopExecution();
  });

  ipcMain.handle(IPC.EXEC_ACTIVE_STATUS, () => {
    return {
      isRunning: executionService.isRunning(),
      activeExecutionId: executionService.getActiveExecutionId(),
    };
  });

  ipcMain.handle(IPC.HISTORY_LIST_BATCHES, (_, projectId: string) => {
    return executionService.listBatchesWithDiskSync(projectId);
  });

  ipcMain.handle(IPC.HISTORY_GET_RESULTS, (_, executionId: string) => {
    const rows = getDb()
      .prepare('SELECT * FROM test_results WHERE execution_id = ?')
      .all(executionId) as any[];
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

  ipcMain.handle(IPC.HISTORY_COMPARE_BATCHES, (_, batchA: string, batchB: string) => {
    return analyticsService.compareBatches(batchA, batchB);
  });

  ipcMain.handle(IPC.HISTORY_DELETE_BATCH, (_, executionId: string) => {
    const db = getDb();
    const deleteCascade = db.transaction((id: string) => {
      db.prepare(
        `DELETE FROM healing_proposals WHERE failure_id IN (SELECT id FROM failure_analyses WHERE execution_id = ?)`
      ).run(id);
      db.prepare('DELETE FROM failure_analyses WHERE execution_id = ?').run(id);
      db.prepare('DELETE FROM test_results WHERE execution_id = ?').run(id);
      db.prepare('DELETE FROM execution_batches WHERE id = ?').run(id);
    });
    deleteCascade(executionId);
    return true;
  });

  ipcMain.handle(IPC.REPORT_OPEN_BROWSER, (_, htmlReportPath: string) => {
    schedulerReportService.openNativeReportInBrowser(htmlReportPath);
    return true;
  });

  ipcMain.handle(IPC.REPORT_START_HOSTING, (_, htmlReportPath: string) => {
    return schedulerReportService.hostReportDirectory(path.dirname(htmlReportPath));
  });

  ipcMain.handle(IPC.REPORT_REVEAL_IN_FOLDER, (_, htmlReportPath: string) => {
    if (!htmlReportPath) throw new Error('No report path provided.');
    if (fs.existsSync(htmlReportPath)) {
      revealInFolder(htmlReportPath);
    } else {
      void openPath(path.dirname(htmlReportPath));
    }
    return true;
  });

  ipcMain.handle(IPC.ARTIFACTS_LIST, (_, projectId: string) => {
    return artifactService.listArtifacts(projectId);
  });

  ipcMain.handle(IPC.ARTIFACTS_PREVIEW, (_, projectId: string, relativePath: string) => {
    return artifactService.previewArtifact(projectId, relativePath);
  });

  ipcMain.handle(IPC.ARTIFACTS_OPEN, (_, projectId: string, relativePath: string) => {
    return artifactService.openArtifact(projectId, relativePath);
  });

  ipcMain.handle(IPC.ARTIFACTS_REVEAL, (_, projectId: string, relativePath: string) => {
    return artifactService.revealArtifact(projectId, relativePath);
  });

  const sendProgress = (event: Electron.IpcMainInvokeEvent, payload: any) => {
    try {
      event.sender.send(IPC.HEALING_PROGRESS_EVENT, payload);
    } catch {
      /* renderer gone */
    }
  };

  ipcMain.handle(IPC.FAILURE_ANALYZE_BATCH, (event, executionId: string) => {
    return failureService.analyzeExecutionFailures(executionId, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.FAILURE_LIST, (_, projectId: string) => {
    return failureService.listFailures(projectId);
  });

  ipcMain.handle(IPC.FAILURE_RECLASSIFY, (_, failureId: string, category, classification) => {
    failureService.reclassifyFailure(failureId, category, classification);
    return true;
  });

  // Generate now auto-validates in the background — the card the user sees already
  // carries a validated_pass / validated_fail verdict instead of "pending".
  ipcMain.handle(IPC.HEALING_GENERATE, (event, failureId: string) => {
    return failureService.generateAndValidate(failureId, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.HEALING_VALIDATE, (event, proposalId: string, editedCode?: string) => {
    return failureService.validateProposal(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.HEALING_APPROVE_APPLY, (event, proposalId: string, editedCode?: string) => {
    return failureService.approveAndApply(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.HEALING_ROLLBACK, (event, proposalId: string) => {
    return failureService.rollbackProposal(proposalId, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.HEALING_RUN_HEADED, (event, proposalId: string, editedCode?: string) => {
    return failureService.runProposalHeaded(proposalId, editedCode, (_, payload) => sendProgress(event, payload));
  });

  ipcMain.handle(IPC.HEALING_REJECT, (_, proposalId: string) => {
    getDb().prepare(`UPDATE healing_proposals SET status = 'rejected' WHERE id = ?`).run(proposalId);
    return true;
  });

  ipcMain.handle(IPC.HEALING_LIST, (_, projectId: string) => {
    return failureService.listProposals(projectId);
  });

  ipcMain.handle(IPC.INTEL_FLAKY_TESTS, (_, projectId: string, minRuns?: number) => {
    return analyticsService.getFlakyTests(projectId, minRuns);
  });

  ipcMain.handle(IPC.INTEL_CROSS_BROWSER, (_, projectId: string) => {
    return analyticsService.getCrossBrowserMatrix(projectId);
  });

  ipcMain.handle(IPC.TESTS_GET_STEPS, (_, projectId: string, testId: string) => {
    return specAnalysisService.getTestSteps(projectId, testId);
  });

  ipcMain.handle(IPC.INTEL_IMPROVE, (_, projectId: string) => {
    return improvementAdvisorService.analyze(projectId);
  });

  ipcMain.handle(IPC.SCHEDULER_LIST, () => {
    return schedulerReportService.listSchedules();
  });

  ipcMain.handle(IPC.SCHEDULER_SAVE, (_, config) => {
    return schedulerReportService.saveSchedule(config, () => mainWindow);
  });

  ipcMain.handle(IPC.SCHEDULER_DELETE, (_, id: string) => {
    schedulerReportService.deleteSchedule(id);
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return settingsService.getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, (_, settings) => {
    return settingsService.saveSettings(settings);
  });

  ipcMain.handle(IPC.SETTINGS_SAVE_API_KEY, (_, key: string) => {
    settingsService.saveApiKey(key);
    return settingsService.getSettings();
  });
}

app.whenReady().then(async () => {
  await initDb();
  registerIpcHandlers();
  bridgeServer.start(17890);
  schedulerReportService.initPersistedSchedules(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
