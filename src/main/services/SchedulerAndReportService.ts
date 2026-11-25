import fs from 'fs';
import path from 'path';
import http from 'http';
import cron, { ScheduledTask } from 'node-cron';
import { randomUUID as uuidv4 } from 'crypto';
import type { BrowserWindow } from 'electron';
import { openPath } from '../platform/runtime';
import { runWithTenant, tenantContext, type TenantContext } from '../platform/tenant';
import { ScheduleConfig } from '../../shared/types';
import { getDb } from '../database/db';
import { ExecutionEngineService } from './ExecutionEngineService';

export class SchedulerAndReportService {
  private tasks = new Map<string, ScheduledTask>();
  private reportServer: http.Server | null = null;
  private hostedPort = 9323;

  constructor(private executionEngine: ExecutionEngineService) {}

  initPersistedSchedules(getMainWindow: () => BrowserWindow | null): void {
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
  initPersistedSchedulesForTenant(ctx: TenantContext, db: import('../database/db').PersistentSqliteDB, getMainWindow: () => BrowserWindow | null): void {
    runWithTenant(ctx, () => {
      const rows = db.prepare('SELECT * FROM schedules WHERE enabled = 1').all() as any[];
      for (const r of rows) {
        this.registerCronJob(
          {
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
          },
          getMainWindow
        );
      }
    });
  }

  saveSchedule(config: Omit<ScheduleConfig, 'id'> & { id?: string }, getMainWindow: () => BrowserWindow | null): ScheduleConfig {
    if (!cron.validate(config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${config.cronExpression}`);
    }

    const db = getDb();
    const id = config.id || uuidv4();
    const record: ScheduleConfig = { ...config, id };

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
    `).run(
      record.id,
      record.projectId,
      record.name,
      record.cronExpression,
      record.frequencyLabel,
      record.environment,
      JSON.stringify(record.browsers),
      record.mode,
      record.tag || null,
      record.workers,
      record.headed ? 1 : 0,
      record.enabled ? 1 : 0,
      record.webhookUrl || null,
      record.notifyEmail || null
    );

    this.unregisterCronJob(id);
    if (record.enabled) {
      this.registerCronJob(record, getMainWindow);
    }

    return record;
  }

  listSchedules(): ScheduleConfig[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM schedules').all() as any[];
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

  deleteSchedule(id: string): void {
    this.unregisterCronJob(id);
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  private registerCronJob(sched: ScheduleConfig, getMainWindow: () => BrowserWindow | null): void {
    const capturedTenant = tenantContext(); // undefined for the desktop app
    const task = cron.schedule(sched.cronExpression, async () => {
      if (capturedTenant) return runWithTenant(capturedTenant, () => this.runScheduledJob(sched, getMainWindow));
      return this.runScheduledJob(sched, getMainWindow);
    });
    this.tasks.set(sched.id, task);
  }

  private async runScheduledJob(sched: ScheduleConfig, getMainWindow: () => BrowserWindow | null): Promise<void> {
      if (this.executionEngine.isRunning()) {
        return;
      }
      const now = new Date().toISOString();
      getDb().prepare('UPDATE schedules SET last_run_at = ? WHERE id = ?').run(now, sched.id);

      try {
        const batch = await this.executionEngine.startExecution(
          {
            projectId: sched.projectId,
            mode: sched.mode,
            tag: sched.tag,
            browsers: sched.browsers,
            headed: sched.headed,
            workers: sched.workers,
            environment: sched.environment,
            description: `[Scheduled] ${sched.name}`,
          },
          getMainWindow()
        );

        if (sched.webhookUrl) {
          await fetch(sched.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `Playwright Scheduled Run Started: *${sched.name}* (${batch.id}) on ${sched.environment}`,
            }),
          }).catch(() => {});
        }
      } catch {
        // Logged via execution engine
      }
  }

  private unregisterCronJob(id: string): void {
    const existing = this.tasks.get(id);
    if (existing) {
      existing.stop();
      this.tasks.delete(id);
    }
  }

  openNativeReportInBrowser(htmlReportPath: string): void {
    if (!fs.existsSync(htmlReportPath)) {
      throw new Error(`Native Playwright HTML report not found at ${htmlReportPath}`);
    }
    openPath(htmlReportPath);
  }

  hostReportDirectory(reportDir: string): string {
    if (this.reportServer) {
      this.reportServer.close();
    }

    const mimeTypes: Record<string, string> = {
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

    this.reportServer = http.createServer((req, res) => {
      const safeRel = (req.url || '/').split('?')[0].replace(/^\/+/, '') || 'index.html';
      const target = path.resolve(reportDir, safeRel);
      if (!target.startsWith(path.resolve(reportDir)) || !fs.existsSync(target)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(target);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
    });

    this.reportServer.listen(this.hostedPort, '0.0.0.0');
    return `http://localhost:${this.hostedPort}/index.html`;
  }
}
