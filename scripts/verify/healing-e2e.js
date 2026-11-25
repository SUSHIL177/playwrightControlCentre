/**
 * Headless E2E for the self-heal engine (FailureIntelligenceService).
 * Run: node scripts/verify/healing-e2e.js
 *
 * Mocks `electron` (app.getPath / safeStorage) before loading the compiled
 * dist-electron services, stands up a fixture Playwright project with a
 * behavioral @playwright/test CLI stub, and exercises the full
 * generate → auto-validate → AI self-repair → restore cycle.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-heal-e2e-data-'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pcc-heal-e2e-fixture-'));

// ── Electron mock ────────────────────────────────────────────────────────────
const electronMock = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s), 'utf-8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf-8'),
  },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
};
// The tenant/data layer resolves its default root from PACC_DATA_DIR before Electron's userData —
// point it at the same temp dir the mock hands to Electron so runs stay hermetic.
process.env.PACC_DATA_DIR = userData;

const electronPath = require.resolve('electron', { paths: [REPO] });
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronMock,
};

// ── Fixture project with behavioral Playwright CLI stub ─────────────────────
const SPEC_REL = path.join('tests', 'checkout.spec.ts');
const specAbs = path.join(fixture, SPEC_REL);
fs.mkdirSync(path.join(fixture, 'tests'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'node_modules', '@playwright', 'test'), { recursive: true });

const SPEC_TITLE = 'checkout flow exports orders csv';
const ORIGINAL_SPEC = `import { test, expect } from '@playwright/test';

test('${SPEC_TITLE}', async ({ page }) => {
  await page.goto('https://example.test/cart');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Order placed')).toBeVisible();
});
`;
fs.writeFileSync(specAbs, ORIGINAL_SPEC);

const stub = `const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args.includes('--headed')) console.log('[stub] launching headed browser (chromium)');
const specArg = args[1];
const grepIdx = args.indexOf('--grep');
const grepRaw = grepIdx >= 0 ? String(args[grepIdx + 1] || '') : '';
const title = grepRaw.replace(/^\\(/, '').replace(/\\)$/, '');
const specAbs = path.resolve(process.cwd(), specArg || '');
console.log('Running 1 test using 1 worker');
let src = '';
try { src = fs.readFileSync(specAbs, 'utf8'); } catch { console.error('Error: spec file not found'); process.exit(1); }
if (title && !src.includes(title)) { console.error('Error: no tests found'); process.exit(1); }
const fixed = src.includes("getByRole('button', { name: 'Submit' }).first().click()");
if (fixed) { console.log('  1 passed (30ms)'); process.exit(0); }
console.error("Error: locator.click: strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements:");
console.error('        <button>Submit</button>');
console.error('1 failed');
process.exit(1);
`;
fs.writeFileSync(path.join(fixture, 'node_modules', '@playwright', 'test', 'cli.js'), stub);

// ── Load compiled services ───────────────────────────────────────────────────
const { initDb, getDb } = require(path.join(REPO, 'dist-electron', 'main', 'database', 'db.js'));
const { SettingsService } = require(path.join(REPO, 'dist-electron', 'main', 'services', 'SettingsService.js'));
const { FailureIntelligenceService } = require(path.join(REPO, 'dist-electron', 'main', 'services', 'FailureIntelligenceService.js'));

const events = [];
const onProgress = (_channel, payload) => events.push(payload);
const phaseLog = () => events.map((e) => `${e.phase}: ${e.message}`);

function insertFailure(db, { id, title, errorMessage, eligible }) {
  db.prepare(
    `INSERT INTO execution_batches (id, project_id, description, mode, environment, browsers, tag, status,
       total_tests, passed, failed, skipped, timed_out, flaky, start_time, duration_ms, html_report_path, json_report_path)
     VALUES (?, ?, 'e2e', 'full', 'staging', '["chromium"]', NULL, 'completed', 1, 0, 1, 0, 0, 0, ?, 5, '/tmp/r.html', '/tmp/r.json')`
  ).run(`RUN-E2E-${id}`, PROJECT_ID, new Date().toISOString());
  db.prepare(
    `INSERT INTO test_results (id, execution_id, project_id, test_id, test_title, full_title, file_path, folder_path, browser, status, duration_ms, retry, error_message, stack_trace, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chromium', 'failed', 1000, 0, ?, '', ?)`
  ).run(`tr-${id}`, `RUN-E2E-${id}`, PROJECT_ID, `t-${id}`, title, title, specAbs, path.dirname(specAbs), errorMessage, new Date().toISOString());
  db.prepare(
    `INSERT INTO failure_analyses (id, result_id, execution_id, project_id, test_title, file_path, folder_path, browser, environment, error_message, stack_trace, screenshot_path, trace_path, category, classification, probable_root_cause, confidence, evidence, recommended_action, healing_eligible, manually_reclassified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'chromium', 'staging', ?, '', NULL, NULL, 'Locator Issue', 'Automation defect', 'ambiguous locator', 0.9, '[]', 'heal it', ?, 0, ?)`
  ).run(id, `tr-${id}`, `RUN-E2E-${id}`, PROJECT_ID, title, specAbs, path.dirname(specAbs), errorMessage, eligible ? 1 : 0, new Date().toISOString());
}

const PROJECT_ID = 'proj-e2e-1';

(async () => {
  await initDb();
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, root_path, config_path, test_dir, playwright_version, node_version, browsers_installed, projects_configured, reporters, npm_scripts, has_ts_config, validation_status, validation_messages, created_at, last_scanned_at)
     VALUES (?, 'fixture', ?, NULL, 'tests', '1.48.2', 'v22', '["chromium"]', '[]', '["list"]', '{}', 1, 'valid', '[]', ?, ?)`
  ).run(PROJECT_ID, fixture, now, now);

  const settingsService = new SettingsService();
  const service = new FailureIntelligenceService(settingsService);
  const setProvider = (provider, model = 'gpt-4o-mini') => {
    const s = settingsService.getSettings();
    settingsService.saveSettings({ ...s, ai: { ...s.ai, provider, model, healingEnabled: true } });
  };

  // ── Scenario D (gate first): suspected app defect is refused ─────────────
  insertFailure(db, { id: 'fail-gate', title: 'checkout flow applies wrong total', errorMessage: 'expect(received).toBe expected 1 received 2', eligible: 0 });
  let gateThrew = null;
  try {
    await service.generateAndValidate('fail-gate', onProgress);
  } catch (err) {
    gateThrew = err;
  }
  assert(gateThrew && /Safety Guardrail/.test(String(gateThrew.message || gateThrew)), 'ineligible failure must be refused by the safety gate');
  console.log('✓ safety gate refuses suspected application defects');

  // ── Scenario A: offline deterministic engine heals a strict-mode violation ─
  setProvider('heuristic_offline');
  insertFailure(db, { id: 'fail-det', title: SPEC_TITLE, errorMessage: "strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements", eligible: 1 });
  events.length = 0;
  const detProposal = await service.generateAndValidate('fail-det', onProgress);
  assert.strictEqual(detProposal.validationStatus, 'validated_pass', 'deterministic .first() fix should validate green');
  assert(detProposal.proposedCode.includes(".first().click()"), 'proposed code must scope the locator');
  assert.strictEqual(fs.readFileSync(specAbs, 'utf8'), ORIGINAL_SPEC, 'spec must be restored after validation');
  assert(phaseLog().some((m) => /deterministic offline engine/i.test(m)), 'progress log must state the engine used');
  console.log('✓ offline deterministic heal: .first() fix, validation passed, spec restored');

  // ── Scenario B: AI repair loop (initial fix fails → repair pass 1 succeeds) ─
  setProvider('openai', 'gpt-4o-mini');
  settingsService.saveApiKey('sk-e2e-fake-key');
  const badAiFix = ORIGINAL_SPEC.replace("import { test, expect } from '@playwright/test';", "import { test, expect } from '@playwright/test';\n// AI: considered scrollIntoView before clicking");
  const goodAiFix = ORIGINAL_SPEC.replace(
    "await page.getByRole('button', { name: 'Submit' }).click();",
    "await page.getByRole('button', { name: 'Submit' }).first().click();"
  );
  const aiPayload = (fixedCode, explanation) =>
    JSON.stringify({ fixedCode, explanation, changes: ['scoped the submit locator'] });
  const fetchQueue = [aiPayload(badAiFix, 'initial AI attempt (still broken)'), aiPayload(goodAiFix, 'scoped ambiguous locator to .first()')];
  const fetchCalls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), body: String(opts?.body || '') });
    const content = fetchQueue.length > 1 ? fetchQueue.shift() : fetchQueue[0];
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  insertFailure(db, { id: 'fail-llm', title: SPEC_TITLE, errorMessage: "strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements", eligible: 1 });
  events.length = 0;
  const llmProposal = await service.generateAndValidate('fail-llm', onProgress);
  global.fetch = realFetch;
  assert.strictEqual(llmProposal.validationStatus, 'validated_pass', 'AI repair loop should converge to validated_pass');
  assert.strictEqual(fetchCalls.length, 2, `expected exactly 2 LLM calls (initial + repair), got ${fetchCalls.length}`);
  assert(llmProposal.proposedCode.includes('.first().click()'), 'final proposal must carry the repaired locator');
  assert(/repair attempt 1/i.test(llmProposal.explanation), 'explanation must record the repair attempt');
  assert.strictEqual(fs.readFileSync(specAbs, 'utf8'), ORIGINAL_SPEC, 'spec must be restored after the repair cycle');
  assert(phaseLog().some((m) => /repair attempt 1\/2/i.test(m)), 'progress log must announce the repair attempt');
  console.log('✓ AI self-repair loop: failing fix → log fed back → repaired → validation passed');

  // ── Scenario C: AI output missing the test title is rejected → validation skipped ─
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ fixedCode: "import { test } from '@playwright/test';\ntest('renamed title entirely', async () => {});", explanation: 'nope' }) } }] }),
  });
  insertFailure(db, { id: 'fail-shape', title: SPEC_TITLE, errorMessage: 'locator.getByLabel timed out waiting 5000ms', eligible: 1 });
  events.length = 0;
  const shapeProposal = await service.generateAndValidate('fail-shape', onProgress);
  global.fetch = realFetch;
  assert.strictEqual(shapeProposal.validationStatus, 'pending', 'no candidate fix → validation must be skipped, not marked failed');
  assert.strictEqual(shapeProposal.proposedCode, shapeProposal.originalCode, 'spec content must be untouched when AI output is rejected');
  assert.strictEqual(fs.readFileSync(specAbs, 'utf8'), ORIGINAL_SPEC);
  assert(phaseLog().some((m) => /No candidate fix was generated/i.test(m)), 'progress log must explain the skip');
  console.log('✓ AI shape-guard: title-dropping fix rejected, spec untouched, validation skipped honestly');

  // ── Scenario E: headed run applies fix, runs headed, restores spec ─────────
  setProvider('heuristic_offline');
  // Build a pending proposal through the deterministic path and watch it headed.
  insertFailure(db, { id: 'fail-headed', title: SPEC_TITLE, errorMessage: "strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 2 elements", eligible: 1 });
  events.length = 0;
  const det2 = await service.generateAndValidate('fail-headed', onProgress);
  const headed = await service.runProposalHeaded(det2.id, undefined, onProgress);
  assert.strictEqual(headed.exitCode, 0, 'headed run of the .first() fix should pass');
  assert.strictEqual(fs.readFileSync(specAbs, 'utf8'), ORIGINAL_SPEC, 'spec must be restored after headed run');
  assert(phaseLog().some((m) => /headed/i.test(m)), 'progress log must record the headed run');
  console.log('✓ headed watch run: exit 0, spec auto-restored');

  // ── Scenario F: meta title validation — forcing "no tests found" → validated_fail ─
  const det3 = await service.generateAndValidate('fail-det', onProgress); // reuse existing proposal? re-fetch row
  const failedMeta = await service.validateProposal(det3.id, ORIGINAL_SPEC.replace(SPEC_TITLE, 'a different title altogether'), onProgress);
  assert.strictEqual(failedMeta.validationStatus, 'validated_fail', 'grep matching zero tests must be a validation failure');
  assert(/no tests found/i.test(failedMeta.validationLog || ''), 'log must explain the empty grep result');
  assert.strictEqual(fs.readFileSync(specAbs, 'utf8'), ORIGINAL_SPEC, 'spec must be restored after meta validation');
  console.log('✓ "no tests found" meta failure is detected and reported honestly');

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
  console.log('\nALL HEALING E2E CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('\n✗ HEALING E2E FAILED:', err);
  console.error(phaseLog().join('\n'));
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(fixture, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
