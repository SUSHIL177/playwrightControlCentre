/**
 * Per-batch host-health capture check:
 *   start() → samples → finish() → aggregate persisted to execution_batch_metrics,
 *   getBatchHealth(batchId) reads it back with sane values.
 *
 * Run: node scripts/verify/run-health.js  (requires `npm run build`)
 */
process.env.PACC_DATA_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'pacc-health-')
);

const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..', '..');

(async () => {
  const { initDb, getDb } = require(path.join(REPO, 'dist-electron/main/database/db.js'));
  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, root_path, config_path, test_dir, playwright_version, node_version, browsers_installed, projects_configured, reporters, npm_scripts, has_ts_config, validation_status, validation_messages, created_at, last_scanned_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('p1', 'fixture', path.join(process.env.PACC_DATA_DIR, 'repo'), null, 'tests', '1.48.2', 'v22',
    '["chromium"]', '["chromium"]', '["list"]', '{}', 1, 'valid', '[]', now, now);
  db.prepare(
    `INSERT INTO execution_batches (id, project_id, description, mode, environment, browsers, tag, status, total_tests, passed, failed, skipped, timed_out, flaky, start_time, end_time, duration_ms, html_report_path, json_report_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run('RUN-0001-20261123-000000-A1B2', 'p1', 'health fixture', 'full', 'ci', '["chromium"]', null,
    'completed', 12, 12, 0, 0, 0, 0, now, now, 60000, '/tmp/h/index.html', '/tmp/h/results.json');

  const { runHealthService } = require(path.join(REPO, 'dist-electron/main/services/RunHealthService.js'));

  runHealthService.start('RUN-0001-20261123-000000-A1B2', 'p1');
  // burn ~2.5s of CPU so the aggregate has a real delta to report
  const until = Date.now() + 2500;
  let x = 0;
  while (Date.now() < until) { x += Math.sqrt(x + 1.3); }
  const summary = runHealthService.finish('RUN-0001-20261123-000000-A1B2');
  assert.ok(summary, 'finish must return a summary');
  console.log('summary:', JSON.stringify(summary));
  assert.ok(summary.samples >= 1, 'at least one sample captured');
  assert.strictEqual(summary.memTotalMb > 0, true);
  assert.ok(summary.memPeakMb !== null && summary.memPeakMb > 0, 'peak memory captured');

  const stored = runHealthService.getBatchHealth('p1', 'RUN-0001-20261123-000000-A1B2');
  assert.ok(stored, 'aggregate must be persisted');
  assert.strictEqual(stored.batchId, 'RUN-0001-20261123-000000-A1B2');
  assert.ok(stored.memPeakMb > 0 && stored.memTotalMb > 0, 'persisted memory fields sane');
  assert.ok(stored.cpuPeakPercent === null || stored.cpuPeakPercent >= 0, 'cpu peak sane');

  const latest = runHealthService.getBatchHealth('p1');
  assert.ok(latest && latest.batchId === 'RUN-0001-20261123-000000-A1B2', 'getBatchHealth without id returns the latest batch');

  // double finish is a safe no-op
  const again = runHealthService.finish('RUN-0001-20261123-000000-A1B2');
  assert.strictEqual(again, null);

  console.log('\nRUN HEALTH VERIFICATION: ALL CHECKS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('RUN HEALTH VERIFICATION FAILED:', err);
  process.exit(1);
});
