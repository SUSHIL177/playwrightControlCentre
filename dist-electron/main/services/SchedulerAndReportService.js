"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerAndReportService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const node_cron_1 = __importDefault(require("node-cron"));
const crypto_1 = require("crypto");
const runtime_1 = require("../platform/runtime");
const tenant_1 = require("../platform/tenant");
const db_1 = require("../database/db");
class SchedulerAndReportService {
    executionEngine;
    tasks = new Map();
    reportServer = null;
    hostedPort = 9323;
    constructor(executionEngine) {
        this.executionEngine = executionEngine;
    }
    initPersistedSchedules(getMainWindow) {
        const schedules = this.listSchedules();
        for (const sched of schedules) {
            if (sched.enabled) {
                this.registerCronJob(sched, getMainWindow);
            }
        }
    }
    /**
     * Hosted mode: register one tenant's persisted schedules out-of-band. The cron
     * callback executes with the tenant bound so runs land in that user's workspace.
     */
    initPersistedSchedulesForTenant(ctx, db, getMainWindow) {
        (0, tenant_1.runWithTenant)(ctx, () => {
            const rows = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all();
            for (const r of rows) {
                this.registerCronJob({
                    id: r.id,
                    projectId: r.project_id,
                    name: r.name,
                    cronExpression: r.cron_expression,
                    frequencyLabel: r.frequency_label,
                    environment: r.environment,
                    browsers: JSON.parse(r.browsers || '["chromium"]'),
                    mode: r.mode,
                    tag: r.tag || undefined,
                    workers: r.workers,
                    headed: Boolean(r.headed),
                    enabled: true,
                    lastRunAt: r.last_run_at || undefined,
                    nextRunAt: r.next_run_at || undefined,
                    webhookUrl: r.webhook_url || undefined,
                    notifyEmail: r.notify_email || undefined,
                }, getMainWindow);
            }
        });
    }
    saveSchedule(config, getMainWindow) {
        if (!node_cron_1.default.validate(config.cronExpression)) {
            throw new Error(`Invalid cron expression: ${config.cronExpression}`);
        }
        const db = (0, db_1.getDb)();
        const id = config.id || (0, crypto_1.randomUUID)();
        const record = { ...config, id };
        db.prepare(`
      INSERT INTO schedules (
        id, project_id, name, cron_expression, frequency_label, environment,
        browsers, mode, tag, workers, headed, enabled, webhook_url, notify_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        cron_expression=excluded.cron_expression,
        frequency_label=excluded.frequency_label,
        environment=excluded.environment,
        browsers=excluded.browsers,
        mode=excluded.mode,
        tag=excluded.tag,
        workers=excluded.workers,
        headed=excluded.headed,
        enabled=excluded.enabled,
        webhook_url=excluded.webhook_url,
        notify_email=excluded.notify_email
    `).run(record.id, record.projectId, record.name, record.cronExpression, record.frequencyLabel, record.environment, JSON.stringify(record.browsers), record.mode, record.tag || null, record.workers, record.headed ? 1 : 0, record.enabled ? 1 : 0, record.webhookUrl || null, record.notifyEmail || null);
        this.unregisterCronJob(id);
        if (record.enabled) {
            this.registerCronJob(record, getMainWindow);
        }
        return record;
    }
    listSchedules() {
        const db = (0, db_1.getDb)();
        const rows = db.prepare('SELECT * FROM schedules').all();
        return rows.map((r) => ({
            id: r.id,
            projectId: r.project_id,
            name: r.name,
            cronExpression: r.cron_expression,
            frequencyLabel: r.frequency_label,
            environment: r.environment,
            browsers: JSON.parse(r.browsers),
            mode: r.mode,
            tag: r.tag || undefined,
            workers: r.workers,
            headed: Boolean(r.headed),
            enabled: Boolean(r.enabled),
            lastRunAt: r.last_run_at || undefined,
            nextRunAt: r.next_run_at || undefined,
            webhookUrl: r.webhook_url || undefined,
            notifyEmail: r.notify_email || undefined,
        }));
    }
    deleteSchedule(id) {
        this.unregisterCronJob(id);
        (0, db_1.getDb)().prepare('DELETE FROM schedules WHERE id = ?').run(id);
    }
    registerCronJob(sched, getMainWindow) {
        const capturedTenant = (0, tenant_1.tenantContext)(); // undefined for the desktop app
        const task = node_cron_1.default.schedule(sched.cronExpression, async () => {
            if (capturedTenant)
                return (0, tenant_1.runWithTenant)(capturedTenant, () => this.runScheduledJob(sched, getMainWindow));
            return this.runScheduledJob(sched, getMainWindow);
        });
        this.tasks.set(sched.id, task);
    }
    async runScheduledJob(sched, getMainWindow) {
        if (this.executionEngine.isRunning()) {
            return;
        }
        const now = new Date().toISOString();
        (0, db_1.getDb)().prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(now, sched.id);
        try {
            const batch = await this.executionEngine.startExecution({
                projectId: sched.projectId,
                mode: sched.mode,
                tag: sched.tag,
                browsers: sched.browsers,
                headed: sched.headed,
                workers: sched.workers,
                environment: sched.environment,
                description: `[Scheduled] ${sched.name}`,
            }, getMainWindow());
            if (sched.webhookUrl) {
                await fetch(sched.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: `Playwright Scheduled Run Started: *${sched.name}* (${batch.id}) on ${sched.environment}`,
                    }),
                }).catch(() => { });
            }
        }
        catch {
            // Logged via execution engine
        }
    }
    unregisterCronJob(id) {
        const existing = this.tasks.get(id);
        if (existing) {
            existing.stop();
            this.tasks.delete(id);
        }
    }
    openNativeReportInBrowser(htmlReportPath) {
        if (!fs_1.default.existsSync(htmlReportPath)) {
            throw new Error(`Native Playwright HTML report not found at ${htmlReportPath}`);
        }
        (0, runtime_1.openPath)(htmlReportPath);
    }
    hostReportDirectory(reportDir) {
        if (this.reportServer) {
            this.reportServer.close();
        }
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.webm': 'video/webm',
            '.zip': 'application/zip',
            '.svg': 'image/svg+xml',
        };
        this.reportServer = http_1.default.createServer((req, res) => {
            const safeRel = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'index.html';
            const target = path_1.default.resolve(reportDir, safeRel);
            if (!target.startsWith(path_1.default.resolve(reportDir)) || !fs_1.default.existsSync(target)) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const ext = path_1.default.extname(target);
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs_1.default.createReadStream(target).pipe(res);
        });
        this.reportServer.listen(this.hostedPort, '0.0.0.0');
        return `http://localhost:${this.hostedPort}/index.html`;
    }
}
exports.SchedulerAndReportService = SchedulerAndReportService;
