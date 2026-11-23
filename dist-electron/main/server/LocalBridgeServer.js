"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalBridgeServer = void 0;
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const db_1 = require("../database/db");
class LocalBridgeServer {
    discoveryService;
    executionService;
    failureService;
    analyticsService;
    schedulerReportService;
    settingsService;
    getMainWindow;
    server = null;
    sseClients = new Set();
    constructor(discoveryService, executionService, failureService, analyticsService, schedulerReportService, settingsService, getMainWindow) {
        this.discoveryService = discoveryService;
        this.executionService = executionService;
        this.failureService = failureService;
        this.analyticsService = analyticsService;
        this.schedulerReportService = schedulerReportService;
        this.settingsService = settingsService;
        this.getMainWindow = getMainWindow;
    }
    broadcast(event, data) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of this.sseClients) {
            res.write(msg);
        }
    }
    start(port = 17890) {
        if (this.server)
            return;
        this.server = http_1.default.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`);
            if (urlObj.pathname === '/api/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                });
                this.sseClients.add(res);
                req.on('close', () => this.sseClients.delete(res));
                return;
            }
            if (urlObj.pathname === '/api/rpc' && req.method === 'POST') {
                let bodyRaw = '';
                req.on('data', (chunk) => (bodyRaw += chunk));
                req.on('end', async () => {
                    try {
                        const { method, args = [] } = JSON.parse(bodyRaw || '{}');
                        const result = await this.dispatch(method, args);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, result }));
                    }
                    catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
                    }
                });
                return;
            }
            res.writeHead(404);
            res.end('Not found');
        });
        this.server.listen(port, '127.0.0.1');
    }
    async dispatch(method, args) {
        switch (method) {
            case 'browseDirectory': {
                const win = this.getMainWindow();
                const opts = {
                    properties: ['openDirectory'],
                    title: 'Select Local Playwright Project Directory',
                };
                const r = win ? await electron_1.dialog.showOpenDialog(win, opts) : await electron_1.dialog.showOpenDialog(opts);
                return r.canceled ? null : r.filePaths[0];
            }
            case 'importProject':
                return this.discoveryService.importProject(args[0]);
            case 'listProjects':
                return this.discoveryService.listProjects();
            case 'deleteProject':
                (0, db_1.getDb)().prepare('DELETE FROM projects WHERE id = ?').run(args[0]);
                return true;
            case 'rescanProject': {
                const project = this.discoveryService.listProjects().find((p) => p.id === args[0]);
                if (!project)
                    throw new Error('Project not found');
                await this.discoveryService.discoverTests(project);
                return this.discoveryService.buildFolderTree(args[0]);
            }
            case 'getTestTree':
                return this.discoveryService.buildFolderTree(args[0]);
            case 'listTests':
                return this.discoveryService.listTestsForProject(args[0]);
            case 'startExecution':
                return this.executionService.startExecution(args[0], this.getMainWindow(), (ev, payload) => this.broadcast(ev, payload));
            case 'stopExecution':
                return this.executionService.stopExecution();
            case 'getActiveExecutionStatus':
                return {
                    isRunning: this.executionService.isRunning(),
                    activeExecutionId: this.executionService.getActiveExecutionId(),
                };
            case 'listExecutionBatches':
                return this.executionService.listBatchesWithDiskSync(args[0]);
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
                return this.analyticsService.compareBatches(args[0], args[1]);
            case 'deleteBatch':
                (0, db_1.getDb)().prepare('DELETE FROM execution_batches WHERE id = ?').run(args[0]);
                return true;
            case 'openReportInBrowser':
                this.schedulerReportService.openNativeReportInBrowser(args[0]);
                return true;
            case 'startReportHosting':
                return this.schedulerReportService.hostReportDirectory(path_1.default.dirname(args[0]));
            case 'analyzeBatchFailures':
                return this.failureService.analyzeExecutionFailures(args[0]);
            case 'listFailures':
                return this.failureService.listFailures(args[0]);
            case 'reclassifyFailure':
                this.failureService.reclassifyFailure(args[0], args[1], args[2]);
                return true;
            case 'generateHealingProposal':
                return this.failureService.generateHealingProposal(args[0]);
            case 'validateProposal':
                return this.failureService.validateProposal(args[0]);
            case 'approveAndApplyProposal':
                return this.failureService.approveAndApply(args[0], args[1]);
            case 'rejectProposal':
                (0, db_1.getDb)().prepare(`UPDATE healing_proposals SET status = 'rejected' WHERE id = ?`).run(args[0]);
                return true;
            case 'rollbackProposal':
                return this.failureService.rollbackProposal(args[0]);
            case 'listProposals':
                return this.failureService.listProposals(args[0]);
            case 'getFlakyTests':
                return this.analyticsService.getFlakyTests(args[0], args[1]);
            case 'getCrossBrowserMatrix':
                return this.analyticsService.getCrossBrowserMatrix(args[0]);
            case 'getPerformanceBottlenecks':
                return this.analyticsService.getPerformanceBottlenecks(args[0]);
            case 'listSchedules':
                return this.schedulerReportService.listSchedules();
            case 'saveSchedule':
                return this.schedulerReportService.saveSchedule(args[0], this.getMainWindow);
            case 'deleteSchedule':
                this.schedulerReportService.deleteSchedule(args[0]);
                return true;
            case 'getSettings':
                return this.settingsService.getSettings();
            case 'saveSettings':
                return this.settingsService.saveSettings(args[0]);
            case 'saveApiKey':
                this.settingsService.saveApiKey(args[0]);
                return this.settingsService.getSettings();
            default:
                throw new Error(`Unknown RPC method: ${method}`);
        }
    }
}
exports.LocalBridgeServer = LocalBridgeServer;
