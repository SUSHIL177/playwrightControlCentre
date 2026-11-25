"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const ipcChannels_1 = require("../shared/ipcChannels");
const controlCenterAPI = {
    browseDirectory: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_BROWSE_DIR),
    importProject: (projectPath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_IMPORT, projectPath),
    importProjectFromGit: (req) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_IMPORT_FROM_GIT, req),
    hasGitToken: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SETTINGS_HAS_GIT_TOKEN),
    listProjects: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_LIST),
    deleteProject: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_DELETE, projectId),
    rescanProject: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.PROJECT_RESCAN, projectId),
    getTestTree: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.TESTS_GET_TREE, projectId),
    listTests: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.TESTS_LIST, projectId),
    startWatchingTests: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.TESTS_WATCH_START, projectId),
    onTestsChanged: (cb) => {
        const listener = (_, projectId) => cb(projectId);
        electron_1.ipcRenderer.on(ipcChannels_1.IPC.TESTS_CHANGED_EVENT, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(ipcChannels_1.IPC.TESTS_CHANGED_EVENT, listener);
        };
    },
    startExecution: (options) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.EXEC_START, options),
    stopExecution: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.EXEC_STOP),
    getActiveExecutionStatus: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.EXEC_ACTIVE_STATUS),
    onTerminalLog: (cb) => {
        const listener = (_, chunk) => cb(chunk);
        electron_1.ipcRenderer.on(ipcChannels_1.IPC.EXEC_LOG_EVENT, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(ipcChannels_1.IPC.EXEC_LOG_EVENT, listener);
        };
    },
    onExecutionCompleted: (cb) => {
        const listener = (_, batch) => cb(batch);
        electron_1.ipcRenderer.on(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(ipcChannels_1.IPC.EXEC_COMPLETED_EVENT, listener);
        };
    },
    listExecutionBatches: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HISTORY_LIST_BATCHES, projectId),
    getExecutionResults: (executionId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HISTORY_GET_RESULTS, executionId),
    compareBatches: (batchA, batchB) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HISTORY_COMPARE_BATCHES, batchA, batchB),
    deleteBatch: (executionId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HISTORY_DELETE_BATCH, executionId),
    openReportInBrowser: (htmlReportPath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.REPORT_OPEN_BROWSER, htmlReportPath),
    startReportHosting: (htmlReportPath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.REPORT_START_HOSTING, htmlReportPath),
    revealReportInFolder: (htmlReportPath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.REPORT_REVEAL_IN_FOLDER, htmlReportPath),
    listArtifacts: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.ARTIFACTS_LIST, projectId),
    previewArtifact: (projectId, relativePath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.ARTIFACTS_PREVIEW, projectId, relativePath),
    openArtifact: (projectId, relativePath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.ARTIFACTS_OPEN, projectId, relativePath),
    revealArtifact: (projectId, relativePath) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.ARTIFACTS_REVEAL, projectId, relativePath),
    analyzeBatchFailures: (executionId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.FAILURE_ANALYZE_BATCH, executionId),
    listFailures: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.FAILURE_LIST, projectId),
    reclassifyFailure: (id, cat, cls) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.FAILURE_RECLASSIFY, id, cat, cls),
    generateHealingProposal: (failureId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_GENERATE, failureId),
    validateProposal: (proposalId, editedCode) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_VALIDATE, proposalId, editedCode),
    runProposalHeaded: (proposalId, editedCode) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_RUN_HEADED, proposalId, editedCode),
    onHealingProgress: (cb) => {
        const listener = (_, evt) => cb(evt);
        electron_1.ipcRenderer.on(ipcChannels_1.IPC.HEALING_PROGRESS_EVENT, listener);
        return () => {
            electron_1.ipcRenderer.removeListener(ipcChannels_1.IPC.HEALING_PROGRESS_EVENT, listener);
        };
    },
    approveAndApplyProposal: (proposalId, editedCode) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_APPROVE_APPLY, proposalId, editedCode),
    rejectProposal: (proposalId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_REJECT, proposalId),
    rollbackProposal: (proposalId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_ROLLBACK, proposalId),
    listProposals: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.HEALING_LIST, projectId),
    getFlakyTests: (projectId, minRuns) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.INTEL_FLAKY_TESTS, projectId, minRuns),
    getCrossBrowserMatrix: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.INTEL_CROSS_BROWSER, projectId),
    getPerformanceBottlenecks: (projectId) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.INTEL_PERFORMANCE, projectId),
    listSchedules: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SCHEDULER_LIST),
    saveSchedule: (cfg) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SCHEDULER_SAVE, cfg),
    deleteSchedule: (id) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SCHEDULER_DELETE, id),
    getSettings: () => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SETTINGS_GET),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SETTINGS_SAVE, settings),
    saveApiKey: (key) => electron_1.ipcRenderer.invoke(ipcChannels_1.IPC.SETTINGS_SAVE_API_KEY, key),
};
electron_1.contextBridge.exposeInMainWorld('pwControlCenter', controlCenterAPI);
