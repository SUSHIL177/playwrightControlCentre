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
  /** Concrete, actionable fix. */
  recommendation: string;
  /** What changes if the fix lands — the "impact if implemented" statement. */
  impact: string;
  /** Measurable wall-clock saving per affected run, when estimable. */
  estimatedTimeSavedMs?: number;
}

export interface TestImprovementAdvice {
  testId: string;
  testTitle: string;
  relativePath: string;
  line: number;
  avgDurationMs: number | null;
  lastStatus?: string;
  retryCount: number;
  flakinessRate: number;
  /** Ranking score — higher means more improvement headroom. */
  score: number;
  estimatedTimeSavedMs: number;
  issues: ImprovementIssue[];
}

export interface ImprovementAdvisorResult {
  generatedAt: string;
  projectId: string;
  analyzedCount: number;
  tests: TestImprovementAdvice[];
  summary: {
    flaggedTests: number;
    critical: number;
    warning: number;
    info: number;
    totalEstimatedTimeSavedMs: number;
  };
}
