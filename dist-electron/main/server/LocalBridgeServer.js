"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalBridgeServer = void 0;
const http_1 = __importDefault(require("http"));
const dispatchCore_1 = require("../../server/dispatchCore");
/**
 * Desktop bridge for the no-Electron fallback: serves the same RPC surface over HTTP
 * (127.0.0.1 only) so the renderer can run in a plain browser against the desktop
 * backend. The hosted multi-user server lives in src/server/webServer.ts and shares
 * the exact same dispatch table (dispatchCore.ts).
 */
class LocalBridgeServer {
    discoveryService;
    executionService;
    failureService;
    analyticsService;
    schedulerReportService;
    settingsService;
    artifactService;
    specAnalysis;
    improvement;
    getMainWindow;
    server = null;
    sseClients = new Set();
    dispatch;
    constructor(discoveryService, executionService, failureService, analyticsService, schedulerReportService, settingsService, artifactService, specAnalysis, improvement, getMainWindow) {
        this.discoveryService = discoveryService;
        this.executionService = executionService;
        this.failureService = failureService;
        this.analyticsService = analyticsService;
        this.schedulerReportService = schedulerReportService;
        this.settingsService = settingsService;
        this.artifactService = artifactService;
        this.specAnalysis = specAnalysis;
        this.improvement = improvement;
        this.getMainWindow = getMainWindow;
        const services = {
            discovery: discoveryService,
            execution: executionService,
            failure: failureService,
            analytics: analyticsService,
            schedulerReport: schedulerReportService,
            settings: settingsService,
            artifacts: artifactService,
            specAnalysis,
            improvement,
        };
        const hooks = {
            emitEvent: (channel, payload) => this.broadcast(channel, payload),
            getMainWindow: this.getMainWindow,
            isWeb: false,
        };
        this.dispatch = (0, dispatchCore_1.createDispatch)(services, hooks);
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
}
exports.LocalBridgeServer = LocalBridgeServer;
