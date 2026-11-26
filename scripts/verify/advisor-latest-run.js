/**
 * Advisor latest-run fixture check. Verifies that:
 *   1. The advisor scores telemetry ONLY from the most recent run (discovered_tests mirror)
 *      and reports `telemetryScope` / `latestRunLabel` derived from the newest terminal batch.
 *   2. Static-analysis findings ship exact `fix.before` / `fix.after` code blocks.
 *
 * Run: node scripts/verify/advisor-latest-run.js
 * Requires `npm run build` to have produced dist-electron/.
 */
process.env.PACC_DATA_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'pacc-advisor-')
);

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');
const ROOT = path.join(process.env.PACC_DATA_DIR, 'repo');
const SPEC_DIR = path.join(ROOT, 'tests');
fs.mkdirSync(SPEC_DIR, { recursive: true });

const SPEC = path.join(SPEC_DIR, 'checkout.spec.ts');
fs.writeFileSync(
  SPEC,
  `import { test, expect } from '@playwright/test';

test('checkout flow', async ({ page }) => {
  await page.goto('https://example.test/cart');
  await page.waitForTimeout(3000);
  await page.locator('//button[@id="pay"]').click();
  await page.getByRole('button', { name: 'Submit' }).click({ force: true });
  await page.getByText('Order placed').isVisible();
});
`
);

const CLEAN_SPEC = path.join(SPEC_DIR, 'clean.spec.ts');
fs.writeFileSync(
  CLEAN_SPEC,
  `import { test, expect } from '@playwright/test';

test('clean path', async ({ page }) => {
  await page.goto('https://example.test/home');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
`
);

(async () => {
  const { initDb, getDb } = require(path.join(REPO, 'dist-electron/main/database/db.js'));
  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, root_path, config_path, test_dir, playwright_version, node_version, browsers_installed, projects_configured, reporters, npm_scripts, has_ts_config, validation_status, validation_messages, created_at, last_scanned_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p1', 'fixture', ROOT, path.join(ROOT, 'playwright.config.ts'), 'tests', '1.48.2', 'v22',
    JSON.stringify(['chromium']), JSON.stringify(['chromium']), JSON.stringify(['list', 'json']),
    JSON.stringify({ test: 'playwright test' }), 1, 'valid', '[]', now, now);

  // Older batch — should NOT be reflected anywhere (all-time bait: tiny durations, good status)
  db.prepare(
    `INSERT INTO execution_batches (id, project_id, description, mode, environment, browsers, tag, status, total_tests, passed, failed, skipped, timed_out, flaky, start_time, end_time, duration_ms, html_report_path, json_report_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('RUN-0008-20261101-000000-AAAA', 'p1', 'older run', 'full', 'ci', JSON.stringify(['chromium']), null,
    'completed', 1, 1, 0, 0, 0, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:05:00.000Z', 300000,
    '/tmp/older/index.html', '/tmp/older/results.json');

  // Latest batch — what the advisor must report
  db.prepare(
    `INSERT INTO execution_batches (id, project_id, description, mode, environment, browsers, tag, status, total_tests, passed, failed, skipped, timed_out, flaky, start_time, end_time, duration_ms, html_report_path, json_report_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('RUN-0009-20261123-071240-AB12', 'p1', 'latest run', 'full', 'staging', JSON.stringify(['chromium']), null,
    'completed', 2, 1, 1, 0, 0, 1, '2026-11-23T07:12:40.000Z', '2026-11-23T07:15:00.000Z', 140000,
    '/tmp/latest/index.html', '/tmp/latest/results.json');

  // discovered_tests mirrors the LATEST execution: checkout is slow + needed a retry
  const insert = db.prepare(
    `INSERT INTO discovered_tests (id, project_id, title, full_title, suite_path, file_path, relative_path, folder_path, line, column, tags, annotations, project_name, last_status, last_duration_ms, retry_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  insert.run('t1', 'p1', 'checkout flow', 'checkout flow', '[]', SPEC, 'tests/checkout.spec.ts', 'tests', 3, 1,
    '[]', '[]', 'chromium', 'flaky', 30000, 2);
  insert.run('t2', 'p1', 'clean path', 'clean path', '[]', CLEAN_SPEC, 'tests/clean.spec.ts', 'tests', 3, 1,
    '[]', '[]', 'chromium', 'passed', 1500, 0);

  const { ImprovementAdvisorService } = require(path.join(REPO, 'dist-electron/main/services/ImprovementAdvisorService.js'));
  const svc = new ImprovementAdvisorService();
  const result = svc.analyze('p1');

  console.log('telemetryScope:', result.telemetryScope);
  console.log('latestRunLabel:', result.latestRunLabel);

  assert.strictEqual(result.telemetryScope, 'latest', 'scope must be latest when discovered_tests carry durations');
  assert.ok(result.latestRunLabel && result.latestRunLabel.includes('Run #9'), 'label must come from the newest terminal batch');
  assert.strictEqual(result.analyzedCount, 2);

  const smelly = result.tests.find((t) => t.testId === 't1');
  assert.ok(smelly, 'smelly test should be flagged');
  assert.strictEqual(smelly.latestDurationMs, 30000, 'latest-run duration used, not an all-time average');
  assert.strictEqual(smelly.avgDurationMs, undefined, 'all-time average must not exist anymore');
  assert.strictEqual(smelly.flakinessRate, undefined, 'all-time flakiness rate must not exist anymore');
  assert.strictEqual(smelly.flakyInLatestRun, true);
  assert.strictEqual(smelly.retryCount, 2);

  const ids = smelly.issues.map((i) => i.id);
  console.log('issue ids:', ids.join(', '));
  for (const expected of ['hard-wait', 'xpath-selector', 'force-true', 'no-assertions']) {
    assert.ok(ids.includes(expected), `missing issue ${expected}`);
  }

  const hardWait = smelly.issues.find((i) => i.id === 'hard-wait');
  assert.ok(hardWait.fix && hardWait.fix.before.includes('waitForTimeout(3000)'), 'hard-wait fix must show the exact line to replace');
  assert.ok(hardWait.fix.after.includes('expect'), 'hard-wait fix must show the replacement assertion');

  const xpath = smelly.issues.find((i) => i.id === 'xpath-selector');
  assert.ok(xpath.fix && xpath.fix.before.includes('locator('), 'xpath fix must reference the locator call to replace');

  const force = smelly.issues.find((i) => i.id === 'force-true');
  assert.ok(force.fix && /force:\s*true/.test(force.fix.before), 'force:true fix must show the offending call');
  assert.ok(!/force:\s*true/.test(force.fix.after), 'force:true fix must remove the bypass');

  const noAssert = smelly.issues.find((i) => i.id === 'no-assertions');
  assert.ok(noAssert.fix && !noAssert.fix.before && noAssert.fix.after.includes('expect'), 'no-assertions fix must be additive');

  // clean test may still appear only via telemetry-free static path — it must NOT appear at all
  const clean = result.tests.find((t) => t.testId === 't2');
  assert.ok(!clean, 'clean test with a passing latest run must not be flagged');

  // slow-vs-suite telemetry must use the latest durations: 30000 vs median(30000,1500)=1500 → flagged
  assert.ok(ids.includes('slow-vs-suite'), 'slow-vs-suite must compare latest durations against the latest-run median');

  console.log('\nADVISOR LATEST-RUN VERIFICATION: ALL CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('ADVISOR LATEST-RUN VERIFICATION FAILED:', err);
  process.exit(1);
});
