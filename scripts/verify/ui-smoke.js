/**
 * jsdom smoke for the renderer bundle. Builds src/renderer/App on the fly with esbuild
 * and drives it with a scripted mock of window.pwControlCenter.
 * Run: node scripts/verify/ui-smoke.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const entry = path.join(REPO, 'scripts', 'verify', '.ui-smoke-entry.cjs');
const bundle = path.join(REPO, 'scripts', 'verify', '.ui-smoke-bundle.cjs');

fs.writeFileSync(
  entry,
  `const React = require('react');
const { createRoot } = require('react-dom/client');
const App = require(${JSON.stringify(path.join(REPO, 'src', 'renderer', 'App.tsx'))}).default;
const el = document.getElementById('root');
if (!el) throw new Error('root missing');
createRoot(el).render(React.createElement(App));
`
);

try {
  const esbuildBin = require.resolve('esbuild/bin/esbuild', { paths: [REPO] });
  execFileSync(
    esbuildBin,
    [entry, '--bundle', '--platform=node', '--format=cjs',
     `--outfile=${bundle}`, '--jsx=automatic', '--loader:.css=empty', '--loader:.svg=empty', '--loader:.png=empty',
     '--log-level=error'],
    { cwd: REPO, stdio: 'inherit' }
  );
} catch (e) {
  console.error('esbuild bundle failed');
  process.exit(1);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const BATCH = {
  id: 'RUN-0007-20261123-071240-AB12',
  projectId: 'p1',
  description: 'Weekly full regression',
  mode: 'full',
  environment: 'staging',
  browsers: ['chromium'],
  status: 'completed',
  totalTests: 12,
  passed: 11,
  failed: 1,
  skipped: 0,
  timedOut: 0,
  flaky: 0,
  startTime: '2026-11-23T07:12:40.000Z',
  endTime: '2026-11-23T07:15:00.000Z',
  durationMs: 140000,
  htmlReportPath: '/tmp/report/index.html',
  jsonReportPath: '/tmp/report/results.json',
};

const SPEC_PATH = '/fixture/tests/checkout.spec.ts';
const ORIGINAL_CODE = `import { test, expect } from '@playwright/test';

test('checkout flow', async ({ page }) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
});
`;
const PROPOSED_CODE = ORIGINAL_CODE.replace(
  "await page.getByRole('button', { name: 'Submit' }).click();",
  "await page.getByRole('button', { name: 'Submit' }).first().click();"
);

let proposalState = {
  id: 'prop-1',
  failureId: 'fail-1',
  projectId: 'p1',
  testTitle: 'checkout flow',
  targetFilePath: SPEC_PATH,
  originalCode: ORIGINAL_CODE,
  proposedCode: PROPOSED_CODE,
  explanation: "[AI openai (gpt-4o-mini)] scoped the ambiguous locator to .first()",
  confidence: 0.9,
  validationStatus: 'validated_pass',
  validationLog: 'Running 1 test using 1 worker\n  1 passed (30ms)\n',
  status: 'pending',
  createdAt: new Date().toISOString(),
};
let proposalList = [];

const FAILURE = {
  id: 'fail-1',
  resultId: 'r-1',
  executionId: BATCH.id,
  projectId: 'p1',
  testTitle: 'checkout flow',
  filePath: SPEC_PATH,
  folderPath: '/fixture/tests',
  browser: 'chromium',
  environment: 'staging',
  errorMessage: "strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements",
  stackTrace: '',
  category: 'Locator Issue',
  classification: 'Automation defect',
  probableRootCause: 'ambiguous locator',
  confidence: 0.9,
  evidence: ['strict mode violation'],
  recommendedAction: 'heal it',
  healingEligible: true,
  manuallyReclassified: false,
  createdAt: new Date().toISOString(),
};

const ARTIFACT = {
  relativePath: 'test_data/orders_export.csv',
  name: 'orders_export.csv',
  folderPath: 'test_data',
  extension: 'csv',
  kind: 'text',
  sizeBytes: 42,
  modifiedAt: '2026-11-23T07:15:00.000Z',
};

const settings = {
  defaultProjectId: 'p1',
  defaultBrowser: 'chromium',
  defaultEnvironment: 'staging',
  defaultHeaded: false,
  defaultWorkers: 4,
  defaultRetries: 1,
  reportRetentionDays: 30,
  flakyMinRuns: 3,
  theme: 'dark',
  ai: { provider: 'openai', apiKeyConfigured: true, model: 'gpt-4o-mini', endpoint: '', analysisEnabled: true, healingEnabled: true },
};

// ── jsdom ────────────────────────────────────────────────────────────────────
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'CustomEvent', 'KeyboardEvent', 'getComputedStyle', 'DocumentFragment', 'CSSStyleDeclaration']) {
  if (window[key] !== undefined) global[key] = window[key];
}
global.self = window;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
global.ResizeObserver = ResizeObserverStub;
window.HTMLElement.prototype.scrollIntoView = function () {};
window.scrollTo = () => {};
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
console.error = (...args) => { if (!String(args[0]).includes('Warning')) process.stdout.write(`[console.error] ${args.map(String).join(' ')}\n`); };

// ── Mock bridge ──────────────────────────────────────────────────────────────
const healingProgressCbs = new Set();
const executionCompletedCbs = new Set();
const previewCalls = [];
const mock = {
  browseDirectory: async () => '/fixture',
  importProject: async () => null,
  listProjects: async () => [{ id: 'p1', name: 'fixture', rootPath: '/fixture', root_path: '/fixture', configPath: '/fixture/playwright.config.ts', testDir: 'tests', playwrightVersion: '1.48.2', nodeVersion: 'v22', browsersInstalled: ['chromium'], projectsConfigured: ['chromium'], reporters: ['list', 'html', 'json'], npmScripts: { test: 'playwright test' }, hasTsConfig: true, validationStatus: 'valid', validationMessages: [], createdAt: new Date().toISOString(), lastScannedAt: new Date().toISOString() }],
  deleteProject: async () => undefined,
  rescanProject: async () => undefined,
  getTestTree: async () => [],
  listTests: async () => [],
  startWatchingTests: async () => true,
  onTestsChanged: () => () => {},
  startExecution: async () => ({ executionId: BATCH.id }),
  stopExecution: async () => undefined,
  getActiveExecutionStatus: async () => ({ running: false }),
  onTerminalLog: () => () => {},
  onExecutionCompleted: (cb) => { executionCompletedCbs.add(cb); return () => executionCompletedCbs.delete(cb); },
  onHealingProgress: (cb) => { healingProgressCbs.add(cb); return () => healingProgressCbs.delete(cb); },
  listExecutionBatches: async () => [BATCH],
  getExecutionResults: async () => [{ id: 'r-1', test_title: 'checkout flow', testTitle: 'checkout flow', status: 'failed', file_path: SPEC_PATH, duration_ms: 1000, browser: 'chromium' }],
  compareBatches: async () => ({ baseline: 'RUN-0006-x', candidate: BATCH.id, newlyFailing: [{ test_title: 'checkout flow' }], fixedTests: [], consistentlyFailing: [] }),
  deleteBatch: async () => undefined,
  openReportInBrowser: async () => undefined,
  revealReportInFolder: async () => undefined,
  startReportHosting: async () => undefined,
  listArtifacts: async () => [{ ...ARTIFACT }],
  previewArtifact: async (_id, rel) => { previewCalls.push(rel); return { contentType: 'text', text: 'id,total\n1,42\n', relativePath: rel, truncated: false }; },
  openArtifact: async () => undefined,
  revealArtifact: async () => undefined,
  listFailures: async () => [FAILURE],
  listProposals: async () => proposalList,
  analyzeBatchFailures: async () => [FAILURE],
  generateHealingProposal: async () => {
    proposalState = { ...proposalState, validationStatus: 'validated_pass' };
    proposalList = [proposalState];
    // Emit a few synthetic progress lines so the ACTIVITY panel renders.
    for (const [phase, message, stream] of [
      ['generate', "AI engine (openai (gpt-4o-mini)) is generating a repair…", 'system'],
      ['spawn', 'Running: node /fixture/node_modules/@playwright/test/cli.js test tests/checkout.spec.ts', 'system'],
      ['output', '  1 passed (30ms)', 'stdout'],
      ['restore', 'Restored original tests/checkout.spec.ts (validation writes are always temporary).', 'system'],
      ['done', 'Validation PASSED — the candidate fix survived the real test run.', 'system'],
    ]) {
      const evt = { phase, message, stream, timestamp: new Date().toISOString(), proposalId: 'prop-1', failureId: 'fail-1' };
      healingProgressCbs.forEach((cb) => cb(evt));
    }
    return proposalState;
  },
  validateProposal: async () => { proposalState = { ...proposalState, validationStatus: 'validated_pass' }; return proposalState; },
  approveAndApplyProposal: async () => { proposalState = { ...proposalState, status: 'approved' }; proposalList = [proposalState]; return proposalState; },
  rejectProposal: async () => { proposalState = { ...proposalState, status: 'rejected' }; proposalList = [proposalState]; return proposalState; },
  rollbackProposal: async () => ({ ...proposalState, status: 'rolled_back' }),
  runProposalHeaded: async () => {
    const evt = { phase: 'done', message: 'Headed run finished — test PASSED with the fix applied.', stream: 'system', timestamp: new Date().toISOString(), proposalId: 'prop-1' };
    healingProgressCbs.forEach((cb) => cb(evt));
    return { exitCode: 0 };
  },
  getFlakyTests: async () => [],
  getCrossBrowserMatrix: async () => [],
  getPerformanceBottlenecks: async () => [],
  listSchedules: async () => [],
  saveSchedule: async () => undefined,
  deleteSchedule: async () => undefined,
  getSettings: async () => settings,
  saveSettings: async (s) => s,
  saveApiKey: async () => undefined,
  listProjectsConfigured: undefined, // not used
};
window.pwControlCenter = mock;

// ── Drive the bundle ─────────────────────────────────────────────────────────
const results = [];
const check = (name, cond) => { results.push([name, !!cond]); if (cond) console.log(`  ✓ ${name}`); else console.log(`  ✗ FAIL ${name}`); };
const bodyText = () => window.document.body.textContent || '';
const click = (el) => {
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
};
const findButton = (text) => [...window.document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text));
const tick = () => new Promise((r) => setTimeout(r, 50));
const flush = async (ms = 400) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await tick(); } };

(async () => {
  require(bundle);
  await flush(600);

  check('Dashboard mounts by default', /Execution Trend|Dashboard/i.test(bodyText()));
  check('Dashboard formats RUN-0007 batch as Run #7', bodyText().includes('Run #7'));
  check('failure-category chart renders', /Failure Category|Locator/i.test(bodyText()));

  const nav = (label) => {
    const btn = [...window.document.querySelectorAll('button, a, [role="button"]')].find((b) => (b.textContent || '').trim().startsWith(label));
    if (!btn) throw new Error(`nav entry not found: ${label}`);
    click(btn);
  };

  // Reports Center
  nav('Reports Center'); await flush();
  check('Reports Center mounts', /Reports Center|Native Playwright HTML Reports/i.test(bodyText()));

  // Execution History
  nav('Execution History'); await flush();
  check('Execution History mounts', /Execution History|Run #7|Weekly full regression/i.test(bodyText()));

  // Artifacts — and the fresh-preview fix: a rescan must refire the preview fetch
  nav('Test Artifacts'); await flush(500);
  const previewCallsAfterMount = previewCalls.length;
  check('Artifacts page mounts', bodyText().includes('orders_export.csv'));
  const rescanBtn = findButton('Rescan');
  if (rescanBtn) { click(rescanBtn); await flush(500); }
  check('artifact rescan re-fetches the preview of the selected file', previewCalls.length > previewCallsAfterMount);

  // Failure Intelligence — self-heal flow
  nav('Failure Intelligence'); await flush();
  check('Failure Intelligence mounts', /Failure Intelligence/i.test(bodyText()));
  const healAllBtn = findButton('Self-Heal All');
  check('Self-Heal All button shows eligible count', !!healAllBtn && /\(1\)/.test(healAllBtn.textContent || ''));
  click(healAllBtn);
  await flush(700);
  check('self-heal auto-navigates to Self-Healing view', /Self-Healing|Approval Center/i.test(bodyText()));
  check('ACTIVITY log panel rendered with healer lines', /ACTIVITY/i.test(bodyText()) && /AI engine|Validation PASSED/i.test(bodyText()));
  check('auto-validation badge shown', /VALIDATION PASSED/.test(bodyText()));
  check('highlighted diff shows the .first() scoping change', /\.first\(\)/.test(bodyText()));
  check('diff tab is the default', /Highlight Diff/.test(bodyText()));
  const watchBtn = findButton('Watch Headed (tentative)');
  check('headed watch option visible pre-approval', !!watchBtn);
  if (watchBtn) { click(watchBtn); await flush(400); }
  check('watch headed result streamed to activity log', /Headed run finished/i.test(bodyText()));
  const revalidateBtn = findButton('Re-validate (edited code)');
  check('re-validate option present', !!revalidateBtn);
  const diffTab = findButton('Highlight Diff');
  const originalTab = findButton('Original');
  if (originalTab) { click(originalTab); await flush(150); }
  check('original tab renders', /Original Source Code/i.test(bodyText()));
  if (diffTab) { click(diffTab); await flush(150); }
  check('diff tab renders', /Highlighted Changes/i.test(bodyText()));
  const approveBtn = findButton('Approve & Apply');
  check('approve option present', !!approveBtn);
  if (approveBtn) { click(approveBtn); await flush(400); }
  check('post-approval Run Headed option appears', !!findButton('Run Headed'));

  // Remaining routes mount
  for (const [label, marker] of [
    ['Execution Center', /Execution Center/i],
    ['Live Terminal', /Terminal/i],
    ['Test Explorer', /Test Explorer/i],
    ['Flaky Intelligence', /Flaky/i],
    ['Cross-Browser', /Cross-Browser/i],
    ['Performance', /Performance/i],
    ['Regression Scheduler', /Scheduler|Regression/i],
    ['Project Configuration', /Project Configuration|Configuration/i],
    ['Settings', /Settings/i],
  ]) {
    let ok = true;
    try { nav(label); await flush(); ok = marker.test(bodyText()); } catch { ok = false; }
    check(`${label} mounts`, ok);
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length === 0 ? '\nUI SMOKE: ALL CHECKS PASSED' : `\nUI SMOKE: ${failed.length} FAILURE(S)`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('UI SMOKE HARNESS ERROR:', err);
  process.exit(1);
});
