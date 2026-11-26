export type NavRoute =
  | 'dashboard'
  | 'projects'
  | 'explorer'
  | 'artifacts'
  | 'execution'
  | 'terminal'
  | 'failures'
  | 'healing'
  | 'flaky'
  | 'cross-browser'
  | 'code-fix'
  | 'improve'
  | 'scheduler'
  | 'reports'
  | 'history'
  | 'settings'
  | 'team';

export type BrowserType = 'chromium' | 'firefox' | 'webkit';
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'flaky' | 'running' | 'pending';
export type FailureCategory =
  | 'Application Defect'
  | 'Locator Issue'
  | 'Automation Script Issue'
  | 'Timeout Issue'
  | 'Synchronization Issue'
  | 'Test Data Issue'
  | 'Environment & Infrastructure Issue'
  | 'Unknown';

export type DefectClassification =
  | 'Confirmed application defect'
  | 'Suspected application defect'
  | 'Automation defect'
  | 'Environment issue'
  | 'Test data issue'
  | 'Unknown cause';

export interface ProjectConfig {
  id: string;
  name: string;
  rootPath: string;
  configPath: string | null;
  testDir: string;
  playwrightVersion: string;
  nodeVersion: string;
  browsersInstalled: BrowserType[];
  projectsConfigured: string[];
  reporters: string[];
  npmScripts: Record<string, string>;
  hasTsConfig: boolean;
  validationStatus: 'valid' | 'warning' | 'invalid';
  validationMessages: string[];
  createdAt: string;
  lastScannedAt: string;
}

export interface DiscoveredTest {
  id: string;
  projectId: string;
  title: string;
  fullTitle: string;
  suitePath: string[];
  filePath: string;
  relativePath: string;
  folderPath: string;
  line: number;
  column: number;
  tags: string[];
  annotations: Array<{ type: string; description?: string }>;
  projectName: string;
  lastStatus?: TestStatus;
  lastDurationMs?: number;
  retryCount?: number;
}

export interface FolderNode {
  name: string;
  relativePath: string;
  fullPath: string;
  testCount: number;
  children: FolderNode[];
  specs: SpecFileNode[];
}

export interface SpecFileNode {
  name: string;
  relativePath: string;
  fullPath: string;
  testCount: number;
  tests: DiscoveredTest[];
}

export interface ExecutionOptions {
  projectId: string;
  mode: 'full' | 'folder' | 'spec' | 'tests' | 'tag' | 'failed' | 'smoke';
  targetPaths?: string[];
  testIds?: string[];
  grepPattern?: string;
  tag?: string;
  browsers: BrowserType[];
  pwProjects?: string[];
  headed: boolean;
  workers?: number;
  retries?: number;
  timeoutMs?: number;
  environment?: string;
  description?: string;
  parentExecutionId?: string;
}

export interface ExecutionBatch {
  id: string;
  projectId: string;
  description: string;
  mode: string;
  environment: string;
  browsers: BrowserType[];
  tag?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  flaky: number;
  startTime: string;
  endTime?: string;
  durationMs: number;
  htmlReportPath: string;
  jsonReportPath: string;
}

export interface TestExecutionResult {
  id: string;
  executionId: string;
  projectId: string;
  testId: string;
  testTitle: string;
  fullTitle: string;
  filePath: string;
  folderPath: string;
  browser: string;
  status: TestStatus;
  durationMs: number;
  retry: number;
  errorMessage?: string;
  stackTrace?: string;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  timestamp: string;
}

export interface FailureAnalysisRecord {
  id: string;
  resultId: string;
  executionId: string;
  projectId: string;
  testTitle: string;
  filePath: string;
  folderPath: string;
  browser: string;
  environment: string;
  errorMessage: string;
  stackTrace: string;
  screenshotPath?: string;
  tracePath?: string;
  category: FailureCategory;
  classification: DefectClassification;
  probableRootCause: string;
  confidence: number;
  evidence: string[];
  recommendedAction: string;
  healingEligible: boolean;
  manuallyReclassified: boolean;
  createdAt: string;
}

export interface HealingProposal {
  id: string;
  failureId: string;
  projectId: string;
  testTitle: string;
  targetFilePath: string;
  originalCode: string;
  proposedCode: string;
  explanation: string;
  confidence: number;
  validationStatus: 'pending' | 'validated_pass' | 'validated_fail';
  validationLog?: string;
  status: 'pending' | 'approved' | 'rejected' | 'rolled_back';
  backupFilePath?: string;
  createdAt: string;
  appliedAt?: string;
}

export interface FlakyTestMetric {
  testId: string;
  testTitle: string;
  folderPath: string;
  filePath: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  retryCount: number;
  flakinessRate: number;
  lastFailureDate: string;
  commonReason: string;
  browsersAffected: string[];
  trend: 'newly_flaky' | 'consistently_flaky' | 'stabilized';
}

export interface ScheduleConfig {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  frequencyLabel: string;
  environment: string;
  browsers: BrowserType[];
  mode: 'full' | 'smoke' | 'tag';
  tag?: string;
  workers: number;
  headed: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  webhookUrl?: string;
  notifyEmail?: string;
}

export interface AIProviderSettings {
  provider: 'gemini' | 'openai' | 'ollama' | 'heuristic_offline';
  apiKeyConfigured: boolean;
  model: string;
  endpoint: string;
  analysisEnabled: boolean;
  healingEnabled: boolean;
}

export interface AppSettings {
  defaultProjectId: string;
  defaultBrowser: BrowserType;
  defaultEnvironment: string;
  defaultHeaded: boolean;
  defaultWorkers: number;
  defaultRetries: number;
  reportRetentionDays: number;
  flakyMinRuns: number;
  theme: 'dark' | 'light';
  ai: AIProviderSettings;
}

export interface GitImportRequest {
  url: string;
  /** HTTPS personal access token — used for this clone only, never stored unless rememberToken is set. */
  token?: string;
  branch?: string;
  /** Persist the token (encrypted) as this instance's git import token. */
  rememberToken?: boolean;
  /** Use the instance's saved token instead of req.token. */
  useSavedToken?: boolean;
}

export interface TerminalLogChunk {
  executionId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  timestamp: string;
}

/** Live progress line emitted while a self-heal operation runs (streamed to the UI). */
export interface HealingProgressEvent {
  /** Present once a proposal exists (undefined for batch-level markers). */
  proposalId?: string;
  failureId?: string;
  phase:
    | 'analyze'
    | 'generate'
    | 'write'
    | 'spawn'
    | 'output'
    | 'restore'
    | 'approve'
    | 'rollback'
    | 'headed'
    | 'done'
    | 'error';
  /** Human-readable step description, or a raw output line when stream is stdout/stderr. */
  message: string;
  stream?: 'stdout' | 'stderr' | 'system';
  timestamp: string;
}

export type ArtifactKind = 'text' | 'image' | 'video' | 'archive' | 'pdf' | 'other';

export interface ArtifactFile {
  name: string;
  /** Forward-slash path relative to the project root. */
  relativePath: string;
  /** Forward-slash directory portion of relativePath ('.' for root files). */
  folderPath: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  absolutePath: string;
  kind: ArtifactKind;
}

export interface ArtifactPreview {
  relativePath: string;
  contentType: 'text' | 'image';
  /** Present for contentType === 'text'. */
  text?: string;
  /** Present for contentType === 'image' — base64 data URL. */
  dataUrl?: string;
  truncated: boolean;
}

// ── Test Improvement Advisor ─────────────────────────────────────────────────
export type ImprovementSeverity = 'critical' | 'warning' | 'info';
export type ImprovementCategory =
  | 'flakiness'
  | 'performance'
  | 'maintainability'
  | 'reliability'
  | 'coverage';

/** Exact code change a recommendation implies — the lines to replace and what to put in their place. */
export interface AdviceFix {
  /**
   * The exact offending statement/fragment matched in the spec. Omitted only for purely
   * additive edits — see `insertAtEndOfTest`. Multi-statement blocks are expressed via
   * `replacements` instead.
   */
  before?: string;
  /** Replacement for `before` (or the lines to insert, for additive fixes). Optional when `replacements` is used. */
  after?: string;
  /** Free-form implementation guidance shown under the diff. */
  note?: string;
  /**
   * Multi-part fix — each pair is matched and replaced independently inside the test block
   * (e.g. several `waitForTimeout(…)` statements). When present it supersedes
   * `before`/`after` for application purposes.
   */
  replacements?: Array<{ before: string; after: string }>;
  /** Additive fix: insert `after` before the closing brace of the test block (no lines are replaced). */
  insertAtEndOfTest?: boolean;
}

export interface ImprovementIssue {
  id: string;
  severity: ImprovementSeverity;
  category: ImprovementCategory;
  /** Short headline, e.g. "2 hard-coded waits (5.0s of blind sleeping)". */
  title: string;
  /** Evidence detail — counts, sample lines, measured values. */
  detail: string;
  /** Offending source line, when applicable. */
  code?: string;
  /** 1-based line in the spec file, when applicable. */
  line?: number;
  /**
   * Exact code change this recommendation implies — which part of the spec to
   * replace and with what. Every recommendation from the static analyzer carries one.
   */
  fix?: AdviceFix;
  /** Concrete, actionable fix. */
  recommendation: string;
  /** What changes if the fix lands — the "impact if implemented" statement. */
  impact: string;
  /** Measurable wall-clock saving per affected run, when estimable. */
  estimatedTimeSavedMs?: number;
}

export interface TestImprovementAdvice {
  /** Stable identity: relativePath:line — survives re-analysis of unchanged code. */
  testId: string;
  testTitle: string;
  relativePath: string;
  /** 1-based line where the test block starts. */
  line: number;
  /** Ranking score — higher means more improvement headroom. */
  score: number;
  estimatedTimeSavedMs: number;
  issues: ImprovementIssue[];
}

/**
 * Import-time advisor: analysis is derived COMPLETELY from the imported project's
 * spec sources (local folder or VCS clone) — never from execution history.
 */
export interface ImprovementAdvisorResult {
  generatedAt: string;
  projectId: string;
  /** Test blocks analyzed across the scanned specs. */
  analyzedCount: number;
  /** Spec files that were scanned (matched *.spec.* / *.test.* / *.e2e.*). */
  scannedFiles: number;
  tests: TestImprovementAdvice[];
  summary: {
    flaggedTests: number;
    critical: number;
    warning: number;
    info: number;
    totalEstimatedTimeSavedMs: number;
  };
}

/** Payload for applying one recommendation's fix directly to the spec on disk. */
export interface ApplyFixRequest {
  projectId: string;
  /** Spec path, project-root relative (as reported in the advice). */
  relativePath: string;
  /** Full title of the test block the issue belongs to (block-scoped matching). */
  testFullTitle: string;
  issueId: string;
  fix: AdviceFix;
}

export interface ApplyFixResult {
  ok: boolean;
  /** Backup handle — present when the write happened; pass to revertFix to undo. */
  applicationId?: string;
  /** Human-readable outcome (or the reason the fix was refused). */
  message: string;
  /** File lines changed, when known. */
  changedLines?: number[];
}

export interface RevertFixResult {
  ok: boolean;
  message: string;
}

/** Live system-health snapshot (host CPU/memory) taken on demand. */
export interface RunHealthSnapshot {
  /** Busy CPU percent (0–100), null until a delta sample exists. */
  cpuPercent: number | null;
  memUsedMb: number;
  memTotalMb: number;
  memPercent: number;
  /** 1-minute load average (0 on platforms without loadavg). */
  load1: number;
  timestamp: string;
}

/** Persisted per-batch health summary (aggregate of samples taken while the batch ran). */
export interface BatchHealthSummary {
  batchId: string;
  samples: number;
  cpuAvgPercent: number | null;
  cpuPeakPercent: number | null;
  memAvgMb: number | null;
  memPeakMb: number | null;
  memTotalMb: number;
  load1Peak: number;
  startedAt: string;
  endedAt: string;
}
