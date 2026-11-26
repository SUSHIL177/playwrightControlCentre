"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImprovementAdvisorService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../database/db");
const specAnalysis_1 = require("../../shared/specAnalysis");
/**
 * Deterministic, offline "code reviewer" for Playwright specs.
 *
 * Combines three signal sources per discovered test case:
 *   1. Static analysis of the actual test block (locators, waits, assertions, structure)
 *   2. Runtime telemetry from past executions (duration vs suite median, retries, outcomes)
 *   3. Discovery metadata (last status, tags, retry counter)
 *
 * Every recommendation carries an explicit impact statement and, where measurable,
 * an estimated wall-clock saving. No network calls, no LLM — results are reproducible.
 */
class ImprovementAdvisorService {
    analyze(projectId) {
        const db = (0, db_1.getDb)();
        const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
        const root = project?.root_path ? path_1.default.resolve(project.root_path) : null;
        const tests = db
            .prepare(`SELECT id, title, full_title, file_path, relative_path, line, tags, last_status, last_duration_ms, retry_count
         FROM discovered_tests WHERE project_id = ? ORDER BY relative_path, line`)
            .all(projectId);
        const telemetryRows = db
            .prepare(`SELECT test_id as testId,
                COUNT(*) as runs,
                AVG(duration_ms) as avgDurationMs,
                MAX(duration_ms) as maxDurationMs,
                SUM(retry) as totalRetries,
                SUM(CASE WHEN status IN ('failed', 'timedOut') THEN 1 ELSE 0 END) as failCount,
                SUM(CASE WHEN status = 'flaky' OR retry > 0 THEN 1 ELSE 0 END) as flakyRuns
         FROM test_results WHERE project_id = ?
         GROUP BY test_id`)
            .all(projectId);
        const telemetry = new Map(telemetryRows.map((r) => [r.testId, r]));
        const durationSamples = telemetryRows
            .map((r) => Number(r.avgDurationMs))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);
        const medianDuration = durationSamples.length
            ? durationSamples[Math.floor(durationSamples.length / 2)]
            : 0;
        const fileCache = new Map();
        const advice = [];
        let analyzedCount = 0;
        for (const test of tests) {
            analyzedCount += 1;
            let tags = [];
            try {
                tags = JSON.parse(test.tags || '[]');
            }
            catch {
                tags = [];
            }
            const tele = telemetry.get(test.id);
            const avgDurationMs = tele ? Math.round(Number(tele.avgDurationMs) || 0) : test.last_duration_ms ?? null;
            const flakinessRate = tele && tele.runs > 0 ? Math.round((100 * Number(tele.flakyRuns || 0)) / tele.runs) : 0;
            const retryCount = Math.max(Number(test.retry_count || 0), Number(tele?.totalRetries || 0));
            const issues = [];
            // ── Source analysis ──────────────────────────────────────────────────────
            const filePath = test.file_path;
            const inRoot = root && filePath
                ? path_1.default.resolve(filePath).startsWith(root + path_1.default.sep) || path_1.default.resolve(filePath) === root
                : false;
            if (filePath && inRoot && fs_1.default.existsSync(filePath)) {
                let content = fileCache.get(filePath);
                if (content === undefined) {
                    try {
                        content = fs_1.default.readFileSync(filePath, 'utf-8');
                    }
                    catch {
                        content = null;
                    }
                    fileCache.set(filePath, content);
                }
                if (content) {
                    issues.push(...this.analyzeSource(content, test.full_title || test.title));
                }
            }
            // ── Runtime telemetry analysis ───────────────────────────────────────────
            if (avgDurationMs !== null) {
                if (medianDuration > 0 && avgDurationMs > medianDuration * 1.8 && avgDurationMs > 5000) {
                    const overage = Math.round(avgDurationMs - medianDuration);
                    issues.push({
                        id: 'slow-vs-suite',
                        severity: 'warning',
                        category: 'performance',
                        title: `Runs ${(avgDurationMs / 1000).toFixed(1)}s avg vs ${(medianDuration / 1000).toFixed(1)}s suite median`,
                        detail: `Across ${tele?.runs ?? 1} recorded run(s) this test spends ~${(overage / 1000).toFixed(1)}s longer than a typical test in the suite.`,
                        recommendation: 'Audit setup/teardown (beforeEach), replace repeated UI flows with storage-state seeding, and split oversized tests — or tag it to run in a deeper tier instead of blocking smoke.',
                        impact: `Cutting even the overage saves ~${(overage / 1000).toFixed(1)}s from every batch this test belongs to.`,
                        estimatedTimeSavedMs: overage,
                    });
                }
                else if (avgDurationMs > 60_000) {
                    issues.push({
                        id: 'very-slow',
                        severity: 'warning',
                        category: 'performance',
                        title: `Very slow test (${(avgDurationMs / 1000).toFixed(0)}s average)`,
                        detail: 'Tests above ~60s dominate regression wall-clock and are prime flake candidates under load.',
                        recommendation: 'Split the scenario, seed data via API/fixtures, and remove inter-step sleeps.',
                        impact: 'Parallel workers finish faster and the batch window shrinks — direct CI cost and queue-time win.',
                        estimatedTimeSavedMs: Math.round(avgDurationMs * 0.3),
                    });
                }
            }
            if (flakinessRate >= 30) {
                issues.push({
                    id: 'flaky-high',
                    severity: 'critical',
                    category: 'flakiness',
                    title: `${flakinessRate}% of recent runs needed a retry or broke`,
                    detail: `${tele?.flakyRuns ?? 0} of ${tele?.runs ?? 0} recorded runs flaked; ${retryCount} retry attempt(s) burned.`,
                    recommendation: 'Replace positional/CSS locators with getByRole/getByTestId, drop fixed sleeps for web-first assertions, and isolate shared state. Re-run 10× to confirm stability.',
                    impact: 'Eliminating the retry tax recovers roughly a full extra test duration per flaky run and restores trust in red builds.',
                });
            }
            else if (flakinessRate >= 10) {
                issues.push({
                    id: 'flaky-moderate',
                    severity: 'warning',
                    category: 'flakiness',
                    title: `Intermittent behaviour (${flakinessRate}% of runs)`,
                    detail: `${tele?.flakyRuns ?? 0} of ${tele?.runs ?? 0} runs flaked; ${retryCount} retry attempt(s).`,
                    recommendation: 'Check for unawaited promises, animation-sensitive assertions, and shared fixtures. Prefer auto-waiting locator assertions over manual polls.',
                    impact: 'Each retry costs the full test duration again — stability fixes pay back linearly on every CI run.',
                });
            }
            if (test.last_status === 'failed' || test.last_status === 'timedOut') {
                issues.push({
                    id: 'last-run-failed',
                    severity: 'warning',
                    category: 'reliability',
                    title: test.last_status === 'timedOut' ? 'Last run timed out' : 'Last run failed',
                    detail: test.last_status === 'timedOut'
                        ? 'The test exhausted its timeout — usually a missing/slow wait condition rather than a genuinely slow app.'
                        : 'The test is red on its latest attempt. Investigate before the next merge trains the team to ignore failures.',
                    recommendation: test.last_status === 'timedOut'
                        ? 'Scope the timeout to the slow step (test.slow() or per-expect timeout), and wait for a concrete condition instead of the global timeout.'
                        : 'Open Failure Intelligence for the classified root cause and apply the recommended action or self-heal proposal.',
                    impact: 'A green, trusted suite merges faster; red-but-ignored tests hide real regressions and erode the safety net.',
                });
            }
            if (issues.length === 0)
                continue;
            const estimatedTimeSavedMs = issues.reduce((sum, i) => sum + (i.estimatedTimeSavedMs || 0), 0);
            const score = issues.reduce((sum, i) => sum + (i.severity === 'critical' ? 50 : i.severity === 'warning' ? 18 : 5), 0);
            advice.push({
                testId: test.id,
                testTitle: test.full_title || test.title,
                relativePath: test.relative_path,
                line: test.line,
                avgDurationMs,
                lastStatus: test.last_status || undefined,
                retryCount,
                flakinessRate,
                score,
                estimatedTimeSavedMs,
                issues,
            });
        }
        advice.sort((a, b) => b.score - a.score || b.estimatedTimeSavedMs - a.estimatedTimeSavedMs);
        const critical = advice.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'critical').length, 0);
        const warning = advice.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'warning').length, 0);
        const info = advice.reduce((n, a) => n + a.issues.filter((i) => i.severity === 'info').length, 0);
        const totalEstimatedTimeSavedMs = advice.reduce((n, a) => n + a.estimatedTimeSavedMs, 0);
        return {
            generatedAt: new Date().toISOString(),
            projectId,
            analyzedCount,
            tests: advice.slice(0, 100),
            summary: { flaggedTests: advice.length, critical, warning, info, totalEstimatedTimeSavedMs },
        };
    }
    analyzeSource(content, fullTitle) {
        const issues = [];
        const block = (0, specAnalysis_1.extractTestBlock)(content, fullTitle);
        if (!block.found)
            return issues;
        const body = block.bodySource;
        const bodyLines = body.split('\n');
        const lineOf = (offsetInBody) => {
            let acc = 0;
            for (let i = 0; i < bodyLines.length; i++) {
                acc += bodyLines[i].length + 1;
                if (acc >= offsetInBody)
                    return block.bodyStartLine + i;
            }
            return undefined;
        };
        // 1) Hard-coded sleeps — the single biggest flake/slowness source.
        const hardWaits = [];
        const waitRe = /waitForTimeout\s*\(\s*(\d+)/g;
        let m;
        while ((m = waitRe.exec(body)) !== null) {
            hardWaits.push({ ms: Number(m[1]), line: lineOf(m.index) });
        }
        if (hardWaits.length > 0) {
            const total = hardWaits.reduce((s, w) => s + w.ms, 0);
            const worst = Math.max(...hardWaits.map((w) => w.ms));
            issues.push({
                id: 'hard-wait',
                severity: worst >= 5000 ? 'critical' : 'warning',
                category: 'flakiness',
                title: `${hardWaits.length} hard-coded wait${hardWaits.length > 1 ? 's' : ''} (${(total / 1000).toFixed(1)}s of blind sleeping)`,
                detail: hardWaits
                    .map((w) => `waitForTimeout(${w.ms})`)
                    .slice(0, 4)
                    .join(', '),
                code: hardWaits.length ? `await page.waitForTimeout(${hardWaits[0].ms})` : undefined,
                line: hardWaits[0].line,
                recommendation: 'Delete fixed sleeps. Wait for the real condition: expect(locator).toBeVisible()/toHaveText(), page.waitForLoadState("load"), waitForURL, or expect.poll — Playwright retries until the condition holds.',
                impact: `Recovers ~${(total / 1000).toFixed(1)}s per run and removes the single most common cause of passes locally / failures in CI.`,
                estimatedTimeSavedMs: total,
            });
        }
        // 2) networkidle — unreliable on modern pages.
        const networkIdle = /waitForLoadState\s*\(\s*['"`]networkidle['"`]/.exec(body);
        if (networkIdle) {
            issues.push({
                id: 'network-idle',
                severity: 'warning',
                category: 'flakiness',
                title: "waits for 'networkidle'",
                detail: 'Modern SPAs keep long-lived connections (polling, analytics, websockets) — “network idle” often never happens or arrives unpredictably.',
                code: 'await page.waitForLoadState(\'networkidle\')',
                line: lineOf(networkIdle.index),
                recommendation: "Use 'load'/'domcontentloaded' plus web-first assertions on the element you actually need.",
                impact: 'Removes a classic 30s-timeout flake and trims seconds from every affected run.',
                estimatedTimeSavedMs: 2000,
            });
        }
        // 3) Raw / structural selectors instead of user-facing locators.
        const locatorRe = /\.locator\(\s*(['"`])((?:\\.|(?!\1).){0,120})\1/g;
        const xpathHits = [];
        const cssClassHits = [];
        const chainHits = [];
        while ((m = locatorRe.exec(body)) !== null) {
            const sel = m[2].trim();
            if (/^(xpath=|\/\/[a-z])/i.test(sel) || /^css=/i.test(sel))
                xpathHits.push(m.index);
            else if (/^\.[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(sel))
                cssClassHits.push(m.index);
            else if (/[>\s+~]/.test(sel) && !sel.includes('[data-testid'))
                chainHits.push(m.index);
        }
        if (xpathHits.length) {
            issues.push({
                id: 'xpath-selector',
                severity: 'warning',
                category: 'maintainability',
                title: `${xpathHits.length} XPath/CSS-engine locator${xpathHits.length > 1 ? 's' : ''}`,
                detail: 'Index- and path-based selectors break on any DOM reshuffle and are painful to debug.',
                line: lineOf(xpathHits[0]),
                recommendation: 'Prefer page.getByRole(...), getByTestId(...), or getByLabel — user-facing contracts that survive refactors.',
                impact: 'Drastically fewer locator-fix commits per UI change; Playwright auto-waits keep working with role selectors.',
            });
        }
        if (cssClassHits.length) {
            issues.push({
                id: 'css-class-selector',
                severity: 'info',
                category: 'maintainability',
                title: `${cssClassHits.length} CSS-class selector${cssClassHits.length > 1 ? 's' : ''} (e.g. .btn-primary)`,
                detail: 'Styling classes change with design-system refactors and carry no semantic meaning.',
                line: lineOf(cssClassHits[0]),
                recommendation: 'Switch to getByRole/getByTestId, or add data-testid attributes to the markup you own.',
                impact: 'Selector churn stops blocking redesigns; tests keep passing when class names rotate.',
            });
        }
        else if (chainHits.length) {
            issues.push({
                id: 'structural-selector',
                severity: 'info',
                category: 'maintainability',
                title: `${chainHits.length} deep structural selector chain${chainHits.length > 1 ? 's' : ''}`,
                detail: 'Descendant/child chains (“div > ul li:nth-child…”) encode DOM shape, not intent.',
                line: lineOf(chainHits[0]),
                recommendation: 'Anchor on a stable role/testid near the leaf instead of a 5-level path.',
                impact: 'UI refactors stop cascading into spec rewrites.',
            });
        }
        const nthHits = body.match(/\.nth\(\s*\d+\s*\)/g);
        if (nthHits && nthHits.length) {
            issues.push({
                id: 'nth-ordinal',
                severity: 'info',
                category: 'flakiness',
                title: `${nthHits.length} ordinal .nth() dependency${nthHits.length > 1 ? 's' : ''}`,
                detail: 'Positional selection silently shifts when lists reorder or gain a row.',
                recommendation: 'Filter by text/role/name (getByRole("row", { name: /…/ })) so the test picks the element it means.',
                impact: 'Removes off-by-one data races that present as “works on my machine” flakes.',
            });
        }
        // 4) Actionability bypass.
        const forceMatch = /force:\s*true/.exec(body);
        if (forceMatch) {
            issues.push({
                id: 'force-true',
                severity: 'warning',
                category: 'flakiness',
                title: 'force: true bypasses actionability checks',
                detail: 'Clicks land even when the element is covered, detached, or animating — the exact conditions real users hit.',
                code: 'click({ force: true })',
                line: lineOf(forceMatch.index),
                recommendation: 'Remove force:true and fix the underlying overlay/animation/scroll issue; use expect(locator).toBeEnabled() first if needed.',
                impact: 'True actionability re-enabled: the test now fails loudly instead of corrupting downstream state mid-flight.',
            });
        }
        // 5) Conditional logic inside the test body.
        const conditional = /if\s*\(\s*await[^\n]{0,80}isVisible\s*\(/.exec(body);
        if (conditional) {
            issues.push({
                id: 'conditional-branch',
                severity: 'warning',
                category: 'flakiness',
                title: 'Branches on isVisible() inside the test',
                detail: 'Two hidden test paths = double the maintenance and a coin-flip which path CI exercises.',
                line: lineOf(conditional.index),
                recommendation: 'Assert the branch you expect with web-first assertions; poll with expect.poll if the element arrives asynchronously.',
                impact: 'Single deterministic path — halves the effective failure space of the test.',
            });
        }
        // 6) Assertions present at all?
        const assertionCount = (body.match(/\bexpect\s*\(/g) || []).length;
        if (assertionCount === 0) {
            issues.push({
                id: 'no-assertions',
                severity: 'warning',
                category: 'coverage',
                title: 'No expect() assertions in this test',
                detail: 'A test without assertions passes as long as no exception is thrown — it cannot detect a wrong result.',
                recommendation: 'Add web-first assertions on the outcome: toHaveURL, toHaveText, toBeVisible, toHaveCount — at least one per user journey.',
                impact: 'The test starts guarding real behaviour; silent regressions become visible on the PR that introduces them.',
            });
        }
        // 7) Debugging leftovers and focus traps.
        const onlyMatch = /\.only\s*\(/.exec(body);
        if (onlyMatch) {
            issues.push({
                id: 'test-only',
                severity: 'critical',
                category: 'maintainability',
                title: '.only( focused test left in the suite',
                detail: 'Playwright runs ONLY focused tests in this file — everything else is silently skipped on this branch.',
                code: 'test.only(...)',
                line: lineOf(onlyMatch.index),
                recommendation: 'Remove .only / rely on CI’s --forbid-only flag; enforce it with a lint rule (playwright/no-focused-test).',
                impact: 'Restores the full regression net — zero silent skips reaching main.',
            });
        }
        const pauseMatch = /\bpage\.pause\s*\(/.exec(body);
        if (pauseMatch) {
            issues.push({
                id: 'page-pause',
                severity: 'critical',
                category: 'maintainability',
                title: 'page.pause() debugger left in the test',
                detail: 'pause() opens the Inspector and blocks forever on CI — the run hangs until timeout.',
                code: 'await page.pause()',
                line: lineOf(pauseMatch.index),
                recommendation: 'Remove page.pause(); use PWDEBUG=console or --debug locally instead.',
                impact: 'Eliminates guaranteed CI hangs and the timeout/retry burn that follows them.',
            });
        }
        // 8) Overlong tests — cognitive load and retry cost.
        if (block.steps.length > 12) {
            issues.push({
                id: 'long-test',
                severity: 'info',
                category: 'maintainability',
                title: `Monolithic test — ${block.steps.length} steps in one case`,
                detail: 'Long tests are hard to review, slow to retry, and their failures demand heavy triage.',
                recommendation: 'Split by journey stage into separate test cases sharing fixtures, or group sections with test.step("…", …) for readable reports.',
                impact: 'Failures localize instantly; retries only re-run the broken journey instead of the whole flow.',
            });
        }
        return issues;
    }
}
exports.ImprovementAdvisorService = ImprovementAdvisorService;
exports.default = ImprovementAdvisorService;
