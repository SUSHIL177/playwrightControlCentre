import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipcChannels';
import {
  AppSettings,
  DefectClassification,
  ExecutionOptions,
  FailureCategory,
  ScheduleConfig,
  TerminalLogChunk,
} from '../shared/types';

const controlCenterAPI = {
  browseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.PROJECT_BROWSE_DIR),
  importProject: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_IMPORT, projectPath),
  listProjects: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
  deleteProject: (projectId: string) => ipcRenderer.invoke(IPC.PROJECT_DELETE, projectId),
  rescanProject: (projectId: string) => ipcRenderer.invoke(IPC.PROJECT_RESCAN, projectId),

  getTestTree: (projectId: string) => ipcRenderer.invoke(IPC.TESTS_GET_TREE, projectId),
  listTests: (projectId: string) => ipcRenderer.invoke(IPC.TESTS_LIST, projectId),
  startWatchingTests: (projectId: string) => ipcRenderer.invoke(IPC.TESTS_WATCH_START, projectId),
  onTestsChanged: (cb: (projectId: string) => void) => {
    const listener = (_: unknown, projectId: string) => cb(projectId);
    ipcRenderer.on(IPC.TESTS_CHANGED_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC.TESTS_CHANGED_EVENT, listener);
    };
  },

  startExecution: (options: ExecutionOptions) => ipcRenderer.invoke(IPC.EXEC_START, options),
  stopExecution: () => ipcRenderer.invoke(IPC.EXEC_STOP),
  getActiveExecutionStatus: () => ipcRenderer.invoke(IPC.EXEC_ACTIVE_STATUS),
  onTerminalLog: (cb: (chunk: TerminalLogChunk) => void) => {
    const listener = (_: unknown, chunk: TerminalLogChunk) => cb(chunk);
    ipcRenderer.on(IPC.EXEC_LOG_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC.EXEC_LOG_EVENT, listener);
    };
  },
  onExecutionCompleted: (cb: (batch: any) => void) => {
    const listener = (_: unknown, batch: any) => cb(batch);
    ipcRenderer.on(IPC.EXEC_COMPLETED_EVENT, listener);
    return () => {
      ipcRenderer.removeListener(IPC.EXEC_COMPLETED_EVENT, listener);
    };
  },

  listExecutionBatches: (projectId: string) => ipcRenderer.invoke(IPC.HISTORY_LIST_BATCHES, projectId),
  getExecutionResults: (executionId: string) => ipcRenderer.invoke(IPC.HISTORY_GET_RESULTS, executionId),
  compareBatches: (batchA: string, batchB: string) => ipcRenderer.invoke(IPC.HISTORY_COMPARE_BATCHES, batchA, batchB),
  deleteBatch: (executionId: string) => ipcRenderer.invoke(IPC.HISTORY_DELETE_BATCH, executionId),
  openReportInBrowser: (htmlReportPath: string) => ipcRenderer.invoke(IPC.REPORT_OPEN_BROWSER, htmlReportPath),
  startReportHosting: (htmlReportPath: string) => ipcRenderer.invoke(IPC.REPORT_START_HOSTING, htmlReportPath),

  analyzeBatchFailures: (executionId: string) => ipcRenderer.invoke(IPC.FAILURE_ANALYZE_BATCH, executionId),
  listFailures: (projectId: string) => ipcRenderer.invoke(IPC.FAILURE_LIST, projectId),
  reclassifyFailure: (id: string, cat: FailureCategory, cls: DefectClassification) =>
    ipcRenderer.invoke(IPC.FAILURE_RECLASSIFY, id, cat, cls),
  generateHealingProposal: (failureId: string) => ipcRenderer.invoke(IPC.HEALING_GENERATE, failureId),
  validateProposal: (proposalId: string) => ipcRenderer.invoke(IPC.HEALING_VALIDATE, proposalId),
  approveAndApplyProposal: (proposalId: string, editedCode?: string) =>
    ipcRenderer.invoke(IPC.HEALING_APPROVE_APPLY, proposalId, editedCode),
  rejectProposal: (proposalId: string) => ipcRenderer.invoke(IPC.HEALING_REJECT, proposalId),
  rollbackProposal: (proposalId: string) => ipcRenderer.invoke(IPC.HEALING_ROLLBACK, proposalId),
  listProposals: (projectId: string) => ipcRenderer.invoke(IPC.HEALING_LIST, projectId),

  getFlakyTests: (projectId: string, minRuns?: number) => ipcRenderer.invoke(IPC.INTEL_FLAKY_TESTS, projectId, minRuns),
  getCrossBrowserMatrix: (projectId: string) => ipcRenderer.invoke(IPC.INTEL_CROSS_BROWSER, projectId),
  getPerformanceBottlenecks: (projectId: string) => ipcRenderer.invoke(IPC.INTEL_PERFORMANCE, projectId),

  listSchedules: () => ipcRenderer.invoke(IPC.SCHEDULER_LIST),
  saveSchedule: (cfg: Omit<ScheduleConfig, 'id'> & { id?: string }) => ipcRenderer.invoke(IPC.SCHEDULER_SAVE, cfg),
  deleteSchedule: (id: string) => ipcRenderer.invoke(IPC.SCHEDULER_DELETE, id),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),
  saveApiKey: (key: string): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SAVE_API_KEY, key),
};

contextBridge.exposeInMainWorld('pwControlCenter', controlCenterAPI);
export type ControlCenterAPI = typeof controlCenterAPI;
