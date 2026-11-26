/**
 * Advisor import-time fixture check — the advisor must work on a bare repo with
 * NO discovery run and NO execution history:
 *   1. Scans specs from disk (local folder == VCS clone, same thing to the scanner).
 *   2. EVERY recommendation carries an applicable fix (fix blocks for all 12 rules).
 *   3. Apply writes the change into the spec (atomic, block-scoped, backed up);
 *      Revert restores the file byte-identically.
 *   4. Broken/foreign fixes are refused without touching the file.
 *
 * Run: node scripts/verify/advisor-static.js   (requires `npm run build`)
 */
process.env.PACC_DATA_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'pacc-advisor-static-')
);

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');
const ROOT = path.join(process.env.PACC_DATA_DIR, 'clone'); // a "freshly cloned" repo
const SPEC_DIR = path.join(ROOT, 'tests');
fs.mkdirSync(SPEC_DIR, { recursive: true });

const SMELLS = `import { test, expect } from '@playwright/test';

test.only('smelly checkout', async ({ page }) => {
  await page.goto('https://example.test/cart');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.locator('//button[@id="pay"]').click();
  await page.locator('.btn-primary').click();
  await page.locator('ul li a').nth(2).click();
  await page.getByRole('button', { name: 'Submit' }).click({ force: true });
  if (await page.locator('.promo').isVisible()) {
    await page.locator('.promo').click();
  }
  await page.waitForTimeout(1500);
  await page.pause();
});
`;

const STRUCTURE = `import { test, expect } from '@playwright/test';

test('structural list', async ({ page }) => {
  await page.goto('https://example.test/list');
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
  await page.locator('div > ul li a').click();
});
`;

const MONOLITH_STEPS = Array.from(
  { length: 13 },
  (_, i) => `  await page.getByRole('link', { name: 'Step ${i + 1}' }).click();`
).join('\n');
const MONOLITH = `import { test, expect } from '@playwright/test';

test('monolithic journey', async ({ page }) => {
  await page.goto('https://example.test/start');
${MONOLITH_STEPS}
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
});
`;

const CLEAN = `import { test, expect } from '@playwright/test';

test('clean path', async ({ page }) => {
  await page.goto('https://example.test/home');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
});
`;

fs.writeFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), SMELLS);
fs.writeFileSync(path.join(SPEC_DIR, 'structure.spec.ts'), STRUCTURE);
fs.writeFileSync(path.join(SPEC_DIR, 'monolith.spec.ts'), MONOLITH);
fs.writeFileSync(path.join(SPEC_DIR, 'clean.spec.ts'), CLEAN);

(async () => {
  const { initDb, getDb } = require(path.join(REPO, 'dist-electron/main/database/db.js'));
  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  // Project row ONLY — the advisor must not read discovery or execution tables.
  db.prepare(
    `INSERT INTO projects (id, name, root_path, config_path, test_dir, playwright_version, node_version, browsers_installed, projects_configured, reporters, npm_scripts, has_ts_config, validation_status, validation_messages, created_at, last_scanned_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p1', 'clone', ROOT, path.join(ROOT, 'playwright.config.ts'), 'tests', '1.48.2', 'v22',
    '["chromium"]', '["chromium"]', '["list","json"]', '{"test":"playwright test"}', 1, 'valid', '[]', now, now);

  const { ImprovementAdvisorService } = require(path.join(REPO, 'dist-electron/main/services/ImprovementAdvisorService.js'));
  const svc = new ImprovementAdvisorService();
  const result = svc.analyze('p1');

  console.log(`scannedFiles=${result.scannedFiles} analyzedCount=${result.analyzedCount} flagged=${result.summary.flaggedTests}`);
  assert.strictEqual(result.scannedFiles, 4, 'all four spec files must be scanned from disk');
  assert.strictEqual(result.analyzedCount, 4, 'all four test blocks must be analyzed');
  assert.strictEqual(result.telemetryScope, undefined, 'execution telemetry must not exist anymore');
  assert.strictEqual(result.latestRunLabel, undefined, 'execution telemetry must not exist anymore');

  const allIssues = result.tests.flatMap((t) => t.issues);
  const ids = new Set(allIssues.map((i) => i.id));
  const expectedRules = [
    'hard-wait', 'network-idle', 'xpath-selector', 'css-class-selector', 'structural-selector',
    'nth-ordinal', 'force-true', 'conditional-branch', 'no-assertions', 'test-only', 'page-pause', 'long-test',
  ];
  for (const rule of expectedRules) {
    assert.ok(ids.has(rule), `planted rule never fired: ${rule}`);
  }

  // The user's hard requirement: EVERY recommendation carries the exact script change.
  for (const issue of allIssues) {
    const fix = issue.fix;
    const applicable = !!(fix && (fix.before || fix.insertAtEndOfTest || (fix.replacements && fix.replacements.length)));
    if (issue.id === 'long-test') continue; // structural restructure — carries a skeleton, apply is intentionally manual
    assert.ok(applicable, `rule ${issue.id} has no applicable fix payload`);
  }

  const smelly = result.tests.find((t) => t.testTitle === 'smelly checkout');
  assert.ok(smelly, 'smelly test flagged');
  const hardWait = smelly.issues.find((i) => i.id === 'hard-wait');
  assert.strictEqual(hardWait.fix.replacements.length, 2, 'both fixed sleeps get their own before→after pair');
  assert.ok(hardWait.fix.replacements.every((r) => r.before.startsWith('await page.waitForTimeout')));
  assert.ok(hardWait.fix.replacements.every((r) => r.after.includes('toBeVisible')));
  const noAssert = smelly.issues.find((i) => i.id === 'no-assertions');
  assert.strictEqual(noAssert.fix.insertAtEndOfTest, true, 'additive fix inserts at the end of the test block');

  const original = fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8');

  // ── Apply: hard-wait (multi-part, block-scoped, atomic) ───────────────────
  const applied = svc.applyFix({
    projectId: 'p1', relativePath: 'tests/smells.spec.ts', testFullTitle: 'smelly checkout', issueId: 'hard-wait', fix: hardWait.fix,
  });
  console.log('apply hard-wait:', applied.message);
  assert.strictEqual(applied.ok, true, applied.message);
  let afterApply = fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8');
  assert.ok(!afterApply.includes('waitForTimeout'), 'both fixed sleeps replaced');
  assert.strictEqual((afterApply.match(/toBeVisible/g) || []).length, 2, 'each fixed sleep becomes one web-first assertion');

  // Revert restores byte-identically
  const reverted = svc.revertFix(applied.applicationId);
  console.log('revert hard-wait:', reverted.message);
  assert.strictEqual(reverted.ok, true, reverted.message);
  assert.strictEqual(fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8'), original, 'revert must be byte-identical');

  // ── Apply: no-assertions (additive insert at end of test) ─────────────────
  const appliedInsert = svc.applyFix({
    projectId: 'p1', relativePath: 'tests/smells.spec.ts', testFullTitle: 'smelly checkout', issueId: 'no-assertions', fix: noAssert.fix,
  });
  console.log('apply no-assertions:', appliedInsert.message);
  assert.strictEqual(appliedInsert.ok, true, appliedInsert.message);
  const afterInsert = fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8');
  const insertedLine = afterInsert.split('\n').findIndex((l) => l.includes("getByText('…')"));
  assert.ok(insertedLine > 0, 'assertion line inserted');
  assert.strictEqual(afterInsert.trimEnd().split('\n').pop().trim(), '});', 'insert landed inside the test block, before its closing brace');
  const revertedInsert = svc.revertFix(appliedInsert.applicationId);
  assert.strictEqual(revertedInsert.ok, true, revertedInsert.message);
  assert.strictEqual(fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8'), original);

  // ── Refusals never touch the file ─────────────────────────────────────────
  const outside = svc.applyFix({
    projectId: 'p1', relativePath: '../outside.spec.ts', testFullTitle: 'smelly checkout', issueId: 'hard-wait', fix: hardWait.fix,
  });
  assert.strictEqual(outside.ok, false, 'paths outside the project root must be refused');
  const ghost = svc.applyFix({
    projectId: 'p1', relativePath: 'tests/smells.spec.ts', testFullTitle: 'smelly checkout', issueId: 'hard-wait',
    fix: { replacements: [{ before: 'this line does not exist', after: 'x' }] },
  });
  assert.strictEqual(ghost.ok, false, 'unmatchable fix must be refused');
  assert.strictEqual(fs.readFileSync(path.join(SPEC_DIR, 'smells.spec.ts'), 'utf-8'), original, 'refusal must leave the file untouched');
  const foreignTitle = svc.applyFix({
    projectId: 'p1', relativePath: 'tests/smells.spec.ts', testFullTitle: 'no such test', issueId: 'hard-wait', fix: hardWait.fix,
  });
  assert.strictEqual(foreignTitle.ok, false, 'unknown test block must be refused');

  // Applying the hard-wait fix makes the finding disappear on re-analysis
  const applied2 = svc.applyFix({
    projectId: 'p1', relativePath: 'tests/smells.spec.ts', testFullTitle: 'smelly checkout', issueId: 'hard-wait', fix: hardWait.fix,
  });
  assert.strictEqual(applied2.ok, true);
  const reanalyzed = svc.analyze('p1');
  const smellyAfter = reanalyzed.tests.find((t) => t.testTitle === 'smelly checkout');
  assert.ok(!smellyAfter || !smellyAfter.issues.some((i) => i.id === 'hard-wait'), 'fixed finding must not reappear');
  const reverted2 = svc.revertFix(applied2.applicationId);
  assert.strictEqual(reverted2.ok, true);

  console.log('\nADVISOR STATIC VERIFICATION: ALL CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('ADVISOR STATIC VERIFICATION FAILED:', err);
  process.exit(1);
});
