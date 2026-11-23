import { app, BrowserWindow, dialog, ipcMain } from 'electron';
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
import { LocalBridgeServer } from './server/LocalBridgeServer';

let mainWindow: BrowserWindow | null = null;
let specWatcher: FSWatcher | null = null;

const settingsService = new SettingsService();
const discoveryService = new ProjectDiscoveryService();
const executionService = new ExecutionEngineService();
const failureService = new FailureIntelligenceService(settingsService);
const analyticsService = new AnalyticsIntelligenceService();
const schedulerReportService = new SchedulerAndReportService(executionService);
const bridgeServer = new LocalBridgeServer(
  discoveryService,
  executionService,
  failureService,
  analyticsService,
  schedulerReportService,
  settingsService,
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

  ipcMain.handle(IPC.PROJECT_LIST, () => {
    return discoveryService.listProjects();
  });

  ipcMain.handle(IPC.PROJECT_DELETE, (_, projectId: string) => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
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
    getDb().prepare('DELETE FROM execution_batches WHERE id = ?').run(executionId);
    return true;
  });

  ipcMain.handle(IPC.REPORT_OPEN_BROWSER, (_, htmlReportPath: string) => {
    schedulerReportService.openNativeReportInBrowser(htmlReportPath);
    return true;
  });

  ipcMain.handle(IPC.REPORT_START_HOSTING, (_, htmlReportPath: string) => {
    return schedulerReportService.hostReportDirectory(path.dirname(htmlReportPath));
  });

  ipcMain.handle(IPC.FAILURE_ANALYZE_BATCH, (_, executionId: string) => {
    return failureService.analyzeExecutionFailures(executionId);
  });

  ipcMain.handle(IPC.FAILURE_LIST, (_, projectId: string) => {
    return failureService.listFailures(projectId);
  });

  ipcMain.handle(IPC.FAILURE_RECLASSIFY, (_, failureId: string, category, classification) => {
    failureService.reclassifyFailure(failureId, category, classification);
    return true;
  });

  ipcMain.handle(IPC.HEALING_GENERATE, (_, failureId: string) => {
    return failureService.generateHealingProposal(failureId);
  });

  ipcMain.handle(IPC.HEALING_VALIDATE, (_, proposalId: string) => {
    return failureService.validateProposal(proposalId);
  });

  ipcMain.handle(IPC.HEALING_APPROVE_APPLY, (_, proposalId: string, editedCode?: string) => {
    return failureService.approveAndApply(proposalId, editedCode);
  });

  ipcMain.handle(IPC.HEALING_REJECT, (_, proposalId: string) => {
    getDb().prepare(`UPDATE healing_proposals SET status = 'rejected' WHERE id = ?`).run(proposalId);
    return true;
  });

  ipcMain.handle(IPC.HEALING_ROLLBACK, (_, proposalId: string) => {
    return failureService.rollbackProposal(proposalId);
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

  ipcMain.handle(IPC.INTEL_PERFORMANCE, (_, projectId: string) => {
    return analyticsService.getPerformanceBottlenecks(projectId);
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
