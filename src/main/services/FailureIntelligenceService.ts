import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import {
  DefectClassification,
  FailureAnalysisRecord,
  FailureCategory,
  HealingProposal,
} from '../../shared/types';
import { getDb } from '../database/db';
import { assertPathWithinRoot, ensureDirSync } from '../utils/pathSecurity';
import { SettingsService } from './SettingsService';

const execFileAsync = promisify(execFile);

export class FailureIntelligenceService {
  constructor(private settingsService: SettingsService) {}

  async analyzeExecutionFailures(executionId: string): Promise<FailureAnalysisRecord[]> {
    const db = getDb();
    const batch = db.prepare('SELECT * FROM execution_batches WHERE id = ?').get(executionId) as any;
    if (!batch) throw new Error('Execution batch not found.');

    const failedResults = db
      .prepare(`SELECT * FROM test_results WHERE execution_id = ? AND status IN ('failed', 'timedOut')`)
      .all(executionId) as any[];

    const analyses: FailureAnalysisRecord[] = [];

    for (const res of failedResults) {
      const existing = db.prepare('SELECT * FROM failure_analyses WHERE result_id = ?').get(res.id) as any;
      if (existing) {
        analyses.push(this.mapRow(existing));
        continue;
      }

      const analysis = await this.classifySingleFailure(res, batch.environment);
      db.prepare(`
        INSERT INTO failure_analyses (
          id, result_id, execution_id, project_id, test_title, file_path, folder_path,
          browser, environment, error_message, stack_trace, screenshot_path, trace_path,
          category, classification, probable_root_cause, confidence, evidence,
          recommended_action, healing_eligible, manually_reclassified, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        analysis.id,
        analysis.resultId,
        analysis.executionId,
        analysis.projectId,
        analysis.testTitle,
        analysis.filePath,
        analysis.folderPath,
        analysis.browser,
        analysis.environment,
        analysis.errorMessage,
        analysis.stackTrace,
        analysis.screenshotPath || null,
        analysis.tracePath || null,
        analysis.category,
        analysis.classification,
        analysis.probableRootCause,
        analysis.confidence,
        JSON.stringify(analysis.evidence),
        analysis.recommendedAction,
        analysis.healingEligible ? 1 : 0,
        analysis.createdAt
      );

      analyses.push(analysis);
    }

    return analyses;
  }

  private async classifySingleFailure(res: any, environment: string): Promise<FailureAnalysisRecord> {
    const err = `${res.error_message || ''}\n${res.stack_trace || ''}`;
    let category: FailureCategory = 'Unknown';
    let classification: DefectClassification = 'Unknown cause';
    let probableRootCause = 'Unclassified failure; inspect stack trace and Playwright trace.';
    let confidence = 0.72;
    const evidence: string[] = [];
    let recommendedAction = 'Inspect trace viewer and verify application state.';
    let healingEligible = false;

    if (/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|net::ERR_|Target page, context or browser has been closed|browserType\.launch/i.test(err)) {
      category = 'Environment & Infrastructure Issue';
      classification = 'Environment issue';
      probableRootCause = 'Target application endpoint unreachable or browser context crashed.';
      confidence = 0.94;
      evidence.push('Network/Browser launch error signature detected in stderr/stack.');
      recommendedAction = 'Verify target server health, DNS, VPN/proxy connectivity, and worker memory.';
      healingEligible = false;
    } else if (/strict mode violation|waiting for locator|getByRole|getByTestId|locator\(/i.test(err) && !/expect\(.*\)\.toHaveText|toEqual|toBe\(/i.test(err)) {
      category = 'Locator Issue';
      classification = 'Automation defect';
      probableRootCause = 'DOM element selector no longer resolves uniquely or timed out waiting for visibility.';
      confidence = 0.89;
      evidence.push('Playwright Locator resolution failure in stack trace.');
      if (/strict mode violation/i.test(err)) {
        evidence.push('Strict mode matched multiple DOM elements.');
      }
      recommendedAction = 'Generate role/test-id resilient locator proposal and validate in isolation.';
      healingEligible = true;
    } else if (/expect\(received\)\.(toBe|toEqual|toContain|toHaveText|toHaveValue)|Status: 500|Internal Server Error/i.test(err)) {
      category = 'Application Defect';
      classification = 'Suspected application defect';
      probableRootCause = 'Application returned unexpected data, HTTP 5xx, or business value mismatch against assertion.';
      confidence = 0.86;
      evidence.push('Explicit assertion mismatch on expected business output.');
      recommendedAction = 'Do NOT auto-heal expected values. Log defect with attached trace and screenshot.';
      healingEligible = false;
    } else if (/Timeout \d+ms exceeded|Navigation failed because page was closed|waiting for navigation/i.test(err)) {
      category = 'Timeout Issue';
      classification = 'Automation defect';
      probableRootCause = 'Page navigation or network response exceeded configured timeout threshold.';
      confidence = 0.82;
      evidence.push('Playwright timeout threshold exceeded during action or navigation.');
      recommendedAction = 'Add explicit network/state wait condition before interaction.';
      healingEligible = true;
    }

    const settings = this.settingsService.getSettings();
    const apiKey = this.settingsService.getApiKey();
    if (settings.ai.analysisEnabled && settings.ai.provider !== 'heuristic_offline' && (apiKey || settings.ai.provider === 'ollama')) {
      try {
        const llmResult = await this.queryConfiguredLLM(settings.ai.provider, settings.ai.model, settings.ai.endpoint, apiKey, res);
        if (llmResult) {
          category = llmResult.category || category;
          classification = llmResult.classification || classification;
          probableRootCause = llmResult.probableRootCause || probableRootCause;
          confidence = llmResult.confidence || confidence;
          recommendedAction = llmResult.recommendedAction || recommendedAction;
          healingEligible = Boolean(llmResult.healingEligible) && classification !== 'Confirmed application defect' && classification !== 'Suspected application defect';
          evidence.push(`Enriched via ${settings.ai.provider} (${settings.ai.model})`);
        }
      } catch {
        evidence.push('LLM endpoint unreachable; used deterministic rule-engine classification.');
      }
    }

    return {
      id: uuidv4(),
      resultId: res.id,
      executionId: res.execution_id,
      projectId: res.project_id,
      testTitle: res.test_title,
      filePath: res.file_path,
      folderPath: res.folder_path,
      browser: res.browser,
      environment,
      errorMessage: res.error_message || 'Unknown error',
      stackTrace: res.stack_trace || '',
      screenshotPath: res.screenshot_path || undefined,
      tracePath: res.trace_path || undefined,
      category,
      classification,
      probableRootCause,
      confidence,
      evidence,
      recommendedAction,
      healingEligible,
      manuallyReclassified: false,
      createdAt: new Date().toISOString(),
    };
  }

  private async queryConfiguredLLM(
    provider: string,
    model: string,
    endpoint: string,
    apiKey: string | null,
    res: any
  ): Promise<any | null> {
    const prompt = `Analyze this Playwright test failure and return strict JSON with keys: category, classification, probableRootCause, confidence (0-1), recommendedAction, healingEligible (boolean). Never mark business value mismatches as healingEligible.\nTest: ${res.test_title}\nError: ${res.error_message}\nStack: ${(res.stack_trace || '').slice(0, 1500)}`;

    if (provider === 'gemini' && apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      const data: any = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? JSON.parse(text) : null;
    }

    if ((provider === 'openai' && apiKey) || provider === 'ollama') {
      const baseUrl = provider === 'ollama' ? endpoint || 'http://localhost:11434/v1' : endpoint || 'https://api.openai.com/v1';
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model || (provider === 'ollama' ? 'llama3.1' : 'gpt-4o-mini'),
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
      });
      const data: any = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      return text ? JSON.parse(text) : null;
    }

    return null;
  }

  async generateHealingProposal(failureId: string): Promise<HealingProposal> {
    const db = getDb();
    const failure = db.prepare('SELECT * FROM failure_analyses WHERE id = ?').get(failureId) as any;
    if (!failure) throw new Error('Failure analysis record not found.');
    if (!failure.healing_eligible) {
      throw new Error('Safety Guardrail: Suspected/Confirmed application defects are excluded from self-healing.');
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(failure.project_id) as any;
    const safeFilePath = assertPathWithinRoot(project.root_path, failure.file_path);
    if (!fs.existsSync(safeFilePath)) {
      throw new Error(`Target spec file not found: ${safeFilePath}`);
    }

    const originalCode = fs.readFileSync(safeFilePath, 'utf-8');
    let proposedCode = originalCode;
    let explanation = 'Added explicit visibility wait before interaction to eliminate timing race condition.';

    if (/strict mode violation/i.test(failure.error_message)) {
      proposedCode = originalCode.replace(
        /(await\s+page\.(?:locator|getByText|getByRole)\([^)]+\))(\.(?:click|fill|press)\()/g,
        '$1.first()$2'
      );
      explanation =
        'Resolved Playwright strict mode violation by scoping ambiguous locator to `.first()` while preserving all business assertions.';
    } else if (/Timeout \d+ms exceeded/i.test(failure.error_message)) {
      proposedCode = originalCode.replace(
        /(await\s+page\.goto\([^)]+\);)/g,
        "$1\n  await page.waitForLoadState('domcontentloaded');"
      );
      explanation =
        'Added `await page.waitForLoadState(\'domcontentloaded\')` after navigation to prevent premature element interaction.';
    }

    if (proposedCode === originalCode) {
      proposedCode = `// [AI Healing Suggestion]: Verify resilient data-testid or role locator for "${failure.test_title}"\n${originalCode}`;
      explanation = 'Flagged target test block with locator stabilization guidance for manual QA review.';
    }

    const proposal: HealingProposal = {
      id: uuidv4(),
      failureId: failure.id,
      projectId: failure.project_id,
      testTitle: failure.test_title,
      targetFilePath: safeFilePath,
      originalCode,
      proposedCode,
      explanation,
      confidence: failure.confidence,
      validationStatus: 'pending',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO healing_proposals (
        id, failure_id, project_id, test_title, target_file_path, original_code,
        proposed_code, explanation, confidence, validation_status, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?)
    `).run(
      proposal.id,
      proposal.failureId,
      proposal.projectId,
      proposal.testTitle,
      proposal.targetFilePath,
      proposal.originalCode,
      proposal.proposedCode,
      proposal.explanation,
      proposal.confidence,
      proposal.createdAt
    );

    return proposal;
  }

  async validateProposal(proposalId: string): Promise<HealingProposal> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM healing_proposals WHERE id = ?').get(proposalId) as any;
    if (!row) throw new Error('Healing proposal not found.');

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id) as any;
    const safeTarget = assertPathWithinRoot(project.root_path, row.target_file_path);
    const currentDiskContent = fs.readFileSync(safeTarget, 'utf-8');

    let validationStatus: 'validated_pass' | 'validated_fail' = 'validated_fail';
    let validationLog = '';

    try {
      fs.writeFileSync(safeTarget, row.proposed_code, 'utf-8');
      const relSpec = path.relative(project.root_path, safeTarget).replace(/\\/g, '/');
      const escapedTitle = row.test_title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

      const { stdout, stderr } = await execFileAsync(
        npxCmd,
        ['playwright', 'test', relSpec, '--grep', escapedTitle, '--retries=0'],
        { cwd: project.root_path, shell: process.platform === 'win32' }
      );
      validationStatus = 'validated_pass';
      validationLog = `${stdout}\n${stderr}`.trim();
    } catch (err: any) {
      validationStatus = 'validated_fail';
      validationLog = `${err.stdout || ''}\n${err.stderr || err.message}`.trim();
    } finally {
      fs.writeFileSync(safeTarget, currentDiskContent, 'utf-8');
    }

    db.prepare('UPDATE healing_proposals SET validation_status = ?, validation_log = ? WHERE id = ?').run(
      validationStatus,
      validationLog,
      proposalId
    );

    return this.getProposal(proposalId);
  }

  approveAndApply(proposalId: string, editedCode?: string): HealingProposal {
    const db = getDb();
    const row = db.prepare('SELECT * FROM healing_proposals WHERE id = ?').get(proposalId) as any;
    if (!row) throw new Error('Healing proposal not found.');

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id) as any;
    const safeTarget = assertPathWithinRoot(project.root_path, row.target_file_path);

    const backupDir = path.join(project.root_path, '.pw-control-center-backups');
    ensureDirSync(backupDir);
    const backupFile = path.join(backupDir, `${path.basename(safeTarget)}.${Date.now()}.bak`);
    fs.copyFileSync(safeTarget, backupFile);

    const finalCode = editedCode ?? row.proposed_code;
    fs.writeFileSync(safeTarget, finalCode, 'utf-8');

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE healing_proposals
      SET status = 'approved', proposed_code = ?, backup_file_path = ?, applied_at = ?
      WHERE id = ?
    `).run(finalCode, backupFile, now, proposalId);

    return this.getProposal(proposalId);
  }

  rollbackProposal(proposalId: string): HealingProposal {
    const db = getDb();
    const row = db.prepare('SELECT * FROM healing_proposals WHERE id = ?').get(proposalId) as any;
    if (!row) throw new Error('Healing proposal not found.');

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id) as any;
    const safeTarget = assertPathWithinRoot(project.root_path, row.target_file_path);

    if (row.backup_file_path && fs.existsSync(row.backup_file_path)) {
      fs.copyFileSync(row.backup_file_path, safeTarget);
    } else {
      fs.writeFileSync(safeTarget, row.original_code, 'utf-8');
    }

    db.prepare(`UPDATE healing_proposals SET status = 'rolled_back' WHERE id = ?`).run(proposalId);
    return this.getProposal(proposalId);
  }

  reclassifyFailure(failureId: string, category: FailureCategory, classification: DefectClassification): void {
    const db = getDb();
    const healingEligible = classification === 'Automation defect' ? 1 : 0;
    db.prepare(`
      UPDATE failure_analyses
      SET category = ?, classification = ?, healing_eligible = ?, manually_reclassified = 1
      WHERE id = ?
    `).run(category, classification, healingEligible, failureId);
  }

  listFailures(projectId: string): FailureAnalysisRecord[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM failure_analyses WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  listProposals(projectId: string): HealingProposal[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM healing_proposals WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      failureId: r.failure_id,
      projectId: r.project_id,
      testTitle: r.test_title,
      targetFilePath: r.target_file_path,
      originalCode: r.original_code,
      proposedCode: r.proposed_code,
      explanation: r.explanation,
      confidence: r.confidence,
      validationStatus: r.validation_status,
      validationLog: r.validation_log || undefined,
      status: r.status,
      backupFilePath: r.backup_file_path || undefined,
      createdAt: r.created_at,
      appliedAt: r.applied_at || undefined,
    }));
  }

  private getProposal(id: string): HealingProposal {
    const db = getDb();
    const r = db.prepare('SELECT * FROM healing_proposals WHERE id = ?').get(id) as any;
    return {
      id: r.id,
      failureId: r.failure_id,
      projectId: r.project_id,
      testTitle: r.test_title,
      targetFilePath: r.target_file_path,
      originalCode: r.original_code,
      proposedCode: r.proposed_code,
      explanation: r.explanation,
      confidence: r.confidence,
      validationStatus: r.validation_status,
      validationLog: r.validation_log || undefined,
      status: r.status,
      backupFilePath: r.backup_file_path || undefined,
      createdAt: r.created_at,
      appliedAt: r.applied_at || undefined,
    };
  }

  private mapRow(r: any): FailureAnalysisRecord {
    return {
      id: r.id,
      resultId: r.result_id,
      executionId: r.execution_id,
      projectId: r.project_id,
      testTitle: r.test_title,
      filePath: r.file_path,
      folderPath: r.folder_path,
      browser: r.browser,
      environment: r.environment,
      errorMessage: r.error_message,
      stackTrace: r.stack_trace,
      screenshotPath: r.screenshot_path || undefined,
      tracePath: r.trace_path || undefined,
      category: r.category,
      classification: r.classification,
      probableRootCause: r.probable_root_cause,
      confidence: r.confidence,
      evidence: JSON.parse(r.evidence),
      recommendedAction: r.recommended_action,
      healingEligible: Boolean(r.healing_eligible),
      manuallyReclassified: Boolean(r.manually_reclassified),
      createdAt: r.created_at,
    };
  }
}
