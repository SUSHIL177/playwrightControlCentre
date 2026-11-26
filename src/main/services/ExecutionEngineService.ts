import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { BrowserWindow } from 'electron';
import { executionsRoot, isWebTenant, tenantContext } from '../platform/tenant';
import { randomUUID as uuidv4 } from 'crypto';
import treeKill from 'tree-kill';
import {
  BrowserType,
  ExecutionBatch,
  ExecutionOptions,
  TestExecutionResult,
  TestStatus,
} from '../../shared/types';
import { IPC } from '../../shared/ipcChannels';
import { getDb } from '../database/db';
import { ensureDirSync } from '../utils/pathSecurity';
import { writeEffectiveConfig } from './effectiveConfig';
import { runHealthService } from './RunHealthService';

const ANSI_STRIP = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

interface ActiveRun {
  child: ChildProcess;
  executionId: string;
}

/**
 * Runs are tracked per tenant (web mode: one entry per end user; desktop: a single
 * 'desktop' entry) so team members never block — or stop — each other's batches.
 */
export class ExecutionEngineService {
  private activeRuns = new Map<string, ActiveRun>();

  private tenantKey(): string {
    return tenantContext()?.userId ?? 'desktop';
  }

  private mapBatchRow(row: any): ExecutionBatch {
    return {
      id: row.id,
      projectId: row.project_id,
      description: row.description,
      mode: row.mode,
      environment: row.environment,
      browsers: (() => {
        try {
          return JSON.parse(row.browsers || '["chromium"]');
        } catch {
          return ['chromium'];
        }
      })(),
      tag: row.tag || undefined,
      status: row.status,
      totalTests: row.total_tests,
      passed: row.passed,
      failed: row.failed,
      skipped: row.skipped,
      timedOut: row.timed_out,
      flaky: row.flaky,
      startTime: row.start_time,
      endTime: row.end_time || undefined,
      durationMs: row.duration_ms,
      htmlReportPath: row.html_report_path,
      jsonReportPath: row.json_report_path,
      workers: row.workers ?? null,
      workersSource: (row.workers_source as 'requested' | 'auto' | null) ?? null,
    };
  }

  isRunning(): boolean {
    return this.activeRuns.has(this.tenantKey());
  }

  getActiveExecutionId(): string | null {
    return this.activeRuns.get(this.tenantKey())?.executionId ?? null;
  }

  /**
   * Lists all execution batches for a project by merging SQLite rows AND scanning the on-disk
   * `%APPDATA%/playwright-automation-control-center/executions` folder so saved reports & results
   * are NEVER lost even across reloads or upgrades.
   */
  listBatchesWithDiskSync(projectId: string): ExecutionBatch[] {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
    const rows = db
      .prepare('SELECT * FROM execution_batches WHERE project_id = ? ORDER BY start_time DESC')
      .all(projectId) as any[];

    const batchMap = new Map<string, ExecutionBatch>();
    for (const r of rows) {
      batchMap.set(r.id, this.mapBatchRow(r));
    }

    // Reconcile any execution folders on disk that have results.json or html-report/index.html
    const execRoot = executionsRoot();
    if (fs.existsSync(execRoot)) {
      const dirs = fs.readdirSync(execRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const dir of dirs) {
        const execId = dir.name;
        const execDir = path.join(execRoot, execId);
        const htmlIndex = path.join(execDir, 'html-report', 'index.html');
        const jsonFile = path.join(execDir, 'results.json');
        const existing = batchMap.get(execId);

        // Skip folders that belong to a different project
        const anyProjectRow = db.prepare('SELECT project_id FROM execution_batches WHERE id = ?').get(execId) as
          | { project_id: string }
          | undefined;
        if (anyProjectRow && anyProjectRow.project_id !== projectId) continue;

        if ((!existing || existing.totalTests === 0) && (fs.existsSync(jsonFile) || fs.existsSync(htmlIndex))) {
          const stat = fs.statSync(execDir);
          const hydrated = this.finalizeExecution(
            execId,
            projectId,
            project?.root_path || process.cwd(),
            jsonFile,
            path.join(execDir, 'html-report'),
            '',
            stat.birthtime.toISOString(),
            0
          );
          batchMap.set(execId, hydrated);
        }
      }
    }

    return Array.from(batchMap.values()).sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  async startExecution(
    options: ExecutionOptions,
    mainWindow: BrowserWindow | null,
    onEvent?: (channel: string, payload: any) => void
  ): Promise<ExecutionBatch> {
    const tenantKey = this.tenantKey();
    if (this.activeRuns.has(tenantKey)) {
      throw new Error('An execution batch is already in progress for this workspace. Stop it before starting a new run.');
    }
    // Hosted instances cap global concurrency so one busy suite cannot starve the box.
    const cap = Number(process.env.PACC_MAX_CONCURRENT_RUNS || (isWebTenant() ? 2 : Number.MAX_SAFE_INTEGER));
    if (Number.isFinite(cap) && this.activeRuns.size >= cap) {
      throw new Error(`The server is at capacity (${cap} concurrent run(s)). Please retry in a few minutes.`);
    }

    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(options.projectId) as any;
    if (!project) throw new Error('Imported project not found.');

    // Meaningful, project-scoped run number + timestamp so users can tell runs apart at a glance
    // ("Run #7 · Full Regression · Nov 23, 07:12") instead of an opaque hash.
    const runSeqRow = db
      .prepare('SELECT COUNT(*) + 1 AS next FROM execution_batches WHERE project_id = ?')
      .get(project.id) as { next: number } | undefined;
    const runSeq = String(runSeqRow?.next ?? 1).padStart(4, '0');
    const nowStamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // yyyymmddHHMMSS
    const executionId = `RUN-${runSeq}-${nowStamp.slice(0, 8)}-${nowStamp.slice(8)}-${uuidv4().slice(0, 4).toUpperCase()}`;
    const artifactsBase = path.join(executionsRoot(), executionId);
    const htmlReportDir = path.join(artifactsBase, 'html-report');
    const jsonReportFile = path.join(artifactsBase, 'results.json');
    const testOutputDir = path.join(artifactsBase, 'test-results');
    ensureDirSync(htmlReportDir);
    ensureDirSync(testOutputDir);

    const browsers: BrowserType[] = options.browsers.length > 0 ? options.browsers : ['chromium'];
    // Effective worker count for this run: an explicit setting wins; otherwise Playwright's
    // own default applies (50% of the logical cores) which we reproduce for reporting.
    const workersRequested = options.workers && options.workers > 0 ? Math.floor(options.workers) : null;
    const workersEffective = workersRequested ?? Math.max(1, Math.floor(os.cpus().length / 2));
    const workersSource: 'requested' | 'auto' = workersRequested ? 'requested' : 'auto';
    const startTime = new Date().toISOString();
    const description =
      options.description ||
      `${options.mode.toUpperCase()} Run (${browsers.join(', ')})`;

    const batch: ExecutionBatch = {
      id: executionId,
      projectId: project.id,
      description,
      mode: options.mode,
      environment: options.environment || 'default',
      browsers,
      tag: options.tag,
      status: 'running',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      flaky: 0,
      startTime,
      durationMs: 0,
      htmlReportPath: path.join(htmlReportDir, 'index.html'),
      jsonReportPath: jsonReportFile,
      workers: workersEffective,
      workersSource,
    };

    db.prepare(`
      INSERT INTO execution_batches (
        id, project_id, description, mode, environment, browsers, tag, status,
        total_tests, passed, failed, skipped, timed_out, flaky, start_time,
        duration_ms, html_report_path, json_report_path, workers, workers_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, 0, ?, ?, ?, ?)
    `).run(
      batch.id,
      batch.projectId,
      batch.description,
      batch.mode,
      batch.environment,
      JSON.stringify(batch.browsers),
      batch.tag || null,
      batch.status,
      batch.startTime,
      batch.htmlReportPath,
      batch.jsonReportPath,
      workersEffective,
      workersSource
    );

    let effectiveConfig: ReturnType<typeof writeEffectiveConfig> = null;

    // Browser override: the selection made at run time REPLACES whatever projects the
    // imported playwright.config.ts declares (see effectiveConfig.ts). Written after the
    // batch row exists; deleted when the run closes/errors.
    const localPlaywrightCli = path.join(project.root_path, 'node_modules', '@playwright', 'test', 'cli.js');
    const useDirectNode = fs.existsSync(localPlaywrightCli);
    const executable = useDirectNode
      ? (process.platform === 'win32' ? 'node.exe' : 'node')
      : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const args: string[] = useDirectNode ? [localPlaywrightCli, 'test'] : ['playwright', 'test'];
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    const capturedStdout: string[] = [];
    const emitLog = (stream: 'stdout' | 'stderr' | 'system', text: string) => {
      const payload = {
        executionId,
        stream,
        text,
        timestamp: new Date().toISOString(),
      };
      mainWindow?.webContents.send(IPC.EXEC_LOG_EVENT, payload);
      onEvent?.(IPC.EXEC_LOG_EVENT, payload);
    };

    try {
      effectiveConfig = writeEffectiveConfig(project.root_path, project.config_path, browsers);
      if (effectiveConfig) args.push('--config', effectiveConfig.configPath);

      if (options.mode === 'folder' || options.mode === 'spec') {
        if (options.targetPaths && options.targetPaths.length > 0) {
          args.push(...options.targetPaths.map((p) => p.replace(/\\/g, '/')));
        }
      } else if (options.mode === 'tests' && options.testIds && options.testIds.length > 0) {
        const placeholders = options.testIds.map(() => '?').join(',');
        const selectedRows = db
          .prepare(`SELECT title, relative_path FROM discovered_tests WHERE id IN (${placeholders})`)
          .all(...options.testIds) as Array<{ title: string; relative_path: string }>;

        const files = Array.from(new Set(selectedRows.map((r) => r.relative_path.replace(/\\/g, '/'))));
        args.push(...files);

        const escapedTitles = selectedRows.map((r) => r.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (escapedTitles.length > 0) {
          args.push('--grep', `(${escapedTitles.join('|')})`);
        }
      } else if (options.mode === 'tag' && options.tag) {
        args.push('--grep', options.tag.startsWith('@') ? options.tag : `@${options.tag}`);
      } else if (options.mode === 'smoke') {
        args.push('--grep', '@smoke');
      } else if (options.mode === 'failed' && options.parentExecutionId) {
        const failedRows = db
          .prepare(`SELECT DISTINCT test_title, file_path FROM test_results WHERE execution_id = ? AND status IN ('failed', 'timedOut')`)
          .all(options.parentExecutionId) as Array<{ test_title: string; file_path: string }>;

        if (failedRows.length === 0) {
          throw new Error('No failed tests found in the specified execution batch.');
        }
        const relFiles = Array.from(
          new Set(failedRows.map((r) => path.relative(project.root_path, r.file_path).replace(/\\/g, '/')))
        );
        args.push(...relFiles);
        const escaped = failedRows.map((r) => r.test_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        args.push('--grep', `(${escaped.join('|')})`);
      }

      if (options.headed) args.push('--headed');
      if (options.workers && options.workers > 0) args.push(`--workers=${options.workers}`);
      if (typeof options.retries === 'number') args.push(`--retries=${options.retries}`);
      if (options.timeoutMs && options.timeoutMs > 0) args.push(`--timeout=${options.timeoutMs}`);

      // When the effective config wrapper is active it ALREADY pins the selected browsers —
      // passing --project too would double-filter. Only fall back to config-matching when the
      // wrapper could not be written (e.g. unwritable project folder).
      if (!effectiveConfig) {
        const configuredProjects: string[] = JSON.parse(project.projects_configured || '[]');
        for (const b of browsers) {
          const matched = configuredProjects.find((cp) => cp.toLowerCase().includes(b.toLowerCase()));
          if (matched) {
            args.push(`--project=${matched}`);
          } else if (browsers.length === 1) {
            args.push(`--browser=${b}`);
          }
        }
      }

      args.push('--reporter=list,html,json');
      args.push(`--output=${testOutputDir}`);

      delete childEnv.NO_COLOR;
      childEnv.FORCE_COLOR = '0';
      childEnv.PLAYWRIGHT_HTML_REPORT = htmlReportDir;
      childEnv.PLAYWRIGHT_HTML_OPEN = 'never';
      childEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonReportFile;
      childEnv.TEST_ENV = options.environment || process.env.TEST_ENV || 'staging';

      const overrideLine = effectiveConfig
        ? `[Control Center] Browsers pinned to: ${browsers.join(', ')} (overriding playwright.config.ts projects)\n`
        : `[Control Center] Browsers: ${browsers.join(', ')} (project config used as-is)\n`;
      const workersLine = `[Workers] ${workersEffective} (${workersSource === 'requested' ? 'run setting' : 'Playwright default ≈ 50% of cores'})\n`;
      emitLog('system', `[Control Center] Starting Execution ${executionId}\n[Report Output] ${htmlReportDir}\n[Working Directory] ${project.root_path}\n${overrideLine}${workersLine}`);

    } catch (err) {
      effectiveConfig?.cleanup();
      throw err;
    }

    const child = spawn(executable, args, {
      cwd: project.root_path,
      env: childEnv,
      shell: !useDirectNode && process.platform === 'win32',
    });

    this.activeRuns.set(tenantKey, { child, executionId });
    // Host health sampling — aggregates persist when the batch closes.
    runHealthService.start(executionId, project.id);
    let spawnErrorHandled = false;

    // A failed spawn (missing node/npx, bad cwd, EMFILE …) never emits 'close' on some platforms.
    // Surface it as a failed batch + completion event so the UI never gets stuck in "EXECUTING".
    child.on('error', (spawnErr) => {
      effectiveConfig?.cleanup();
      if (spawnErrorHandled) return;
      spawnErrorHandled = true;
      const current = this.activeRuns.get(tenantKey);
      if (current?.child === child) this.activeRuns.delete(tenantKey);

      runHealthService.finish(executionId);
      const endTime = new Date().toISOString();
      const durationMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
      db.prepare(`UPDATE execution_batches SET status = 'failed', end_time = ?, duration_ms = ? WHERE id = ?`).run(
        endTime,
        durationMs,
        executionId
      );
      const failedBatch = this.mapBatchRow(
        db.prepare('SELECT * FROM execution_batches WHERE id = ?').get(executionId)
      );
      emitLog('system', `\n[Control Center] Execution ${executionId} failed to start: ${spawnErr.message}\n`);
      mainWindow?.webContents.send(IPC.EXEC_COMPLETED_EVENT, failedBatch);
      onEvent?.(IPC.EXEC_COMPLETED_EVENT, failedBatch);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      capturedStdout.push(str);
      emitLog('stdout', str);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      emitLog('stderr', chunk.toString('utf-8'));
    });

    child.on('close', (code) => {
      effectiveConfig?.cleanup();
      if (spawnErrorHandled) return;
      const current = this.activeRuns.get(tenantKey);
      if (current?.child === child) this.activeRuns.delete(tenantKey);

      const completedBatch = this.finalizeExecution(
        executionId,
        project.id,
        project.root_path,
        jsonReportFile,
        htmlReportDir,
        capturedStdout.join(''),
        startTime,
        code,
        {
          description,
          mode: options.mode,
          environment: batch.environment,
          browsers,
          tag: options.tag,
        }
      );

      emitLog(
        'system',
        `\n[Control Center] Execution ${executionId} completed: ${completedBatch.passed} passed, ${completedBatch.failed} failed, ${completedBatch.skipped} skipped (${(completedBatch.durationMs / 60000).toFixed(1)} min).\n`
      );
      mainWindow?.webContents.send(IPC.EXEC_COMPLETED_EVENT, completedBatch);
      onEvent?.(IPC.EXEC_COMPLETED_EVENT, completedBatch);
    });

    return batch;
  }

  stopExecution(): boolean {
    const run = this.activeRuns.get(this.tenantKey());
    if (!run?.child?.pid) return false;
    treeKill(run.child.pid, 'SIGTERM');
    return true;
  }

  finalizeExecution(
    executionId: string,
    projectId: string,
    projectRoot: string,
    jsonReportFile: string,
    htmlReportDir: string,
    rawStdout: string,
    startTimeIso: string,
    exitCode: number | null,
    originals?: {
      description?: string;
      mode?: string;
      environment?: string;
      browsers?: BrowserType[];
      tag?: string;
    }
  ): ExecutionBatch {
    const db = getDb();
    const endTime = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endTime).getTime() - new Date(startTimeIso).getTime());

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let timedOut = 0;
    let flaky = 0;
    const results: TestExecutionResult[] = [];

    const candidateJsonFiles = [
      jsonReportFile,
      path.join(projectRoot, 'results.json'),
      path.join(projectRoot, 'test-results', 'results.json'),
      path.join(projectRoot, 'playwright-report', 'results.json'),
    ];
    const resolvedJsonFile = candidateJsonFiles.find((f) => fs.existsSync(f));

    if (resolvedJsonFile) {
      try {
        const raw = JSON.parse(fs.readFileSync(resolvedJsonFile, 'utf-8'));

        // Playwright's JSON reporter emits spec.file relative to the config rootDir/testDir
        // (observed: bare "sample.spec.ts" for testDir './tests'), NOT necessarily relative to
        // the project root. Resolve against both so per-test paths match discovery.
        const projectRow = db
          .prepare('SELECT test_dir FROM projects WHERE id = ?')
          .get(projectId) as { test_dir?: string } | undefined;
        const configuredTestDir = projectRow?.test_dir || 'tests';

        const resolveSpecPath = (rawFile: string): string => {
          if (!rawFile) return projectRoot;
          if (path.isAbsolute(rawFile)) return rawFile;
          const fromRoot = path.join(projectRoot, rawFile);
          if (fs.existsSync(fromRoot)) return fromRoot;
          const fromTestDir = path.join(projectRoot, configuredTestDir, rawFile);
          if (fs.existsSync(fromTestDir)) return fromTestDir;
          return fromRoot;
        };

        const walkSuite = (suite: any, ancestors: string[]) => {
          const nextAncestors = suite.title && !suite.file ? [...ancestors, suite.title] : ancestors;

          for (const spec of suite.specs || []) {
            const rawFile = spec.file || suite.file || '';
            const fullPath = resolveSpecPath(rawFile);
            const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
            const folderPath = path.dirname(relPath).replace(/\\/g, '/');

            for (const t of spec.tests || []) {
              const browser = t.projectName || 'chromium';
              const attempts = t.results || [];
              const lastAttempt = attempts[attempts.length - 1] || {};
              const outcome = t.outcome;

              let status: TestStatus = 'passed';
              if (outcome === 'flaky') {
                status = 'flaky';
                flaky += 1;
              } else if (outcome === 'skipped' || lastAttempt.status === 'skipped') {
                status = 'skipped';
                skipped += 1;
              } else if (lastAttempt.status === 'timedOut') {
                status = 'timedOut';
                timedOut += 1;
                failed += 1;
              } else if (outcome === 'unexpected' || lastAttempt.status === 'failed') {
                status = 'failed';
                failed += 1;
              } else {
                status = 'passed';
                passed += 1;
              }

              const attachments = lastAttempt.attachments || [];
              const screenshot = attachments.find((a: any) => a.contentType?.startsWith('image/'))?.path;
              const video = attachments.find((a: any) => a.contentType?.startsWith('video/'))?.path;
              const trace = attachments.find((a: any) => a.name === 'trace' || a.path?.endsWith('.zip'))?.path;

              const errorObj = lastAttempt.error || (lastAttempt.errors && lastAttempt.errors[0]) || {};
              // Playwright embeds ANSI color codes in JSON error messages/stacks — strip them
              // so stored text stays machine-classifiable and human-readable in the UI.
              const errorMessage = typeof errorObj.message === 'string' ? errorObj.message.replace(ANSI_STRIP, '') : undefined;
              const stackTrace = typeof errorObj.stack === 'string' ? errorObj.stack.replace(ANSI_STRIP, '') : undefined;
              const uniqueKey = `${relPath}::${nextAncestors.join(' > ')}::${spec.title}`;
              const testId = Buffer.from(uniqueKey).toString('base64url');
              const totalTestDuration = attempts.reduce((acc: number, a: any) => acc + (a.duration || 0), 0);

              results.push({
                id: uuidv4(),
                executionId,
                projectId,
                testId,
                testTitle: spec.title,
                fullTitle: [...nextAncestors, spec.title].join(' > '),
                filePath: fullPath,
                folderPath,
                browser,
                status,
                durationMs: totalTestDuration,
                retry: Math.max(0, attempts.length - 1),
                errorMessage,
                stackTrace,
                screenshotPath: screenshot,
                videoPath: video,
                tracePath: trace,
                timestamp: endTime,
              });
            }
          }

          for (const child of suite.suites || []) {
            walkSuite(child, nextAncestors);
          }
        };

        for (const s of raw.suites || []) {
          walkSuite(s, []);
        }
      } catch {
        // Fall through
      }
    }

    if (results.length === 0 && rawStdout) {
      const cleanOut = rawStdout.replace(ANSI_STRIP, '');
      const lineRegex = /^\s*(✓|✘|×|-)\s+\d+\s+\[([^\]]+)\]\s+›\s+([^:]+):(\d+):\d+\s+›\s+(.+?)\s+(?:\((\d+(?:\.\d+)?)(m?s)\))?$/gm;
      let m: RegExpExecArray | null;
      while ((m = lineRegex.exec(cleanOut)) !== null) {
        const symbol = m[1];
        const browser = m[2];
        const relFile = m[3].replace(/\\/g, '/');
        const fullTitle = m[5].trim();
        const titleParts = fullTitle.split(' › ');
        const testTitle = titleParts[titleParts.length - 1];
        const numVal = m[6] ? parseFloat(m[6]) : 0;
        const unit = m[7] || 's';
        const durMs = unit === 'ms' ? Math.round(numVal) : Math.round(numVal * 1000);

        let status: TestStatus = 'passed';
        if (symbol === '✓') {
          status = 'passed';
          passed += 1;
        } else if (symbol === '-') {
          status = 'skipped';
          skipped += 1;
        } else {
          status = 'failed';
          failed += 1;
        }

        const fullPath = path.join(projectRoot, relFile);
        const folderPath = path.dirname(relFile);
        const uniqueKey = `${relFile}::::${testTitle}`;

        results.push({
          id: uuidv4(),
          executionId,
          projectId,
          testId: Buffer.from(uniqueKey).toString('base64url'),
          testTitle,
          fullTitle,
          filePath: fullPath,
          folderPath,
          browser,
          status,
          durationMs: durMs,
          retry: 0,
          timestamp: endTime,
        });
      }
    }

    const isolatedIndex = path.join(htmlReportDir, 'index.html');
    const projectDefaultHtmlDir = path.join(projectRoot, 'playwright-report');
    if (!fs.existsSync(isolatedIndex) && fs.existsSync(path.join(projectDefaultHtmlDir, 'index.html'))) {
      fs.cpSync(projectDefaultHtmlDir, htmlReportDir, { recursive: true });
    }

    const totalTests = results.length;
    const finalStatus = exitCode === null ? 'stopped' : failed > 0 ? 'failed' : 'completed';

    const tx = db.transaction(() => {
      // When the batch row already exists (normal live-run path) its user-facing metadata
      // (description / mode / environment / browsers / tag) is preserved via the DO UPDATE clause.
      // The INSERT branch only fires for crash-recovery hydration from disk.
      db.prepare(`
        INSERT INTO execution_batches (
          id, project_id, description, mode, environment, browsers, tag, status,
          total_tests, passed, failed, skipped, timed_out, flaky, start_time,
          end_time, duration_ms, html_report_path, json_report_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          total_tests = excluded.total_tests,
          passed = excluded.passed,
          failed = excluded.failed,
          skipped = excluded.skipped,
          timed_out = excluded.timed_out,
          flaky = excluded.flaky,
          end_time = excluded.end_time,
          duration_ms = excluded.duration_ms,
          html_report_path = excluded.html_report_path,
          json_report_path = excluded.json_report_path,
          tag = COALESCE(excluded.tag, tag)
      `).run(
        executionId,
        projectId,
        originals?.description || `Execution ${executionId.slice(-6)}`,
        originals?.mode || 'full',
        originals?.environment || 'staging',
        JSON.stringify(originals?.browsers || ['chromium']),
        originals?.tag || null,
        finalStatus,
        totalTests,
        passed,
        failed,
        skipped,
        timedOut,
        flaky,
        startTimeIso,
        endTime,
        durationMs,
        isolatedIndex,
        jsonReportFile
      );

      db.prepare('DELETE FROM test_results WHERE execution_id = ?').run(executionId);

      const insertResult = db.prepare(`
        INSERT INTO test_results (
          id, execution_id, project_id, test_id, test_title, full_title,
          file_path, folder_path, browser, status, duration_ms, retry,
          error_message, stack_trace, screenshot_path, video_path, trace_path, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Match discovered tests on title + file (absolute or project-relative) so identically-titled
      // tests in different spec files do not stomp each other's last_status.
      const updateDiscovered = db.prepare(`
        UPDATE discovered_tests SET last_status = ?, last_duration_ms = ?, retry_count = ?
        WHERE project_id = ? AND title = ? AND (file_path = ? OR relative_path = ?)
      `);

      for (const r of results) {
        insertResult.run(
          r.id,
          r.executionId,
          r.projectId,
          r.testId,
          r.testTitle,
          r.fullTitle,
          r.filePath,
          r.folderPath,
          r.browser,
          r.status,
          r.durationMs,
          r.retry,
          r.errorMessage || null,
          r.stackTrace || null,
          r.screenshotPath || null,
          r.videoPath || null,
          r.tracePath || null,
          r.timestamp
        );

        const relMatch = path.isAbsolute(r.filePath)
          ? path.relative(projectRoot, r.filePath).replace(/\\/g, '/')
          : r.filePath.replace(/\\/g, '/');
        updateDiscovered.run(r.status, r.durationMs, r.retry, projectId, r.testTitle, r.filePath, relMatch);
      }
    });

    tx();
    runHealthService.finish(executionId);

    const row = db.prepare('SELECT * FROM execution_batches WHERE id = ?').get(executionId) as any;
    return this.mapBatchRow(row);
  }
}
