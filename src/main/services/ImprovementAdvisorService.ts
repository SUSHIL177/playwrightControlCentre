import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { getDb } from '../database/db';
import { extractTestBlocks, DiscoveredTestBlock } from '../../shared/specAnalysis';
import {
  ImprovementAdvisorResult,
  TestImprovementAdvice,
  ImprovementIssue,
  AdviceFix,
  ApplyFixRequest,
  ApplyFixResult,
  RevertFixResult,
  AdvisorProjectStyle,
} from '../../shared/types';

/**
 * Import-time "code reviewer" for Playwright specs.
 *
 * The analysis is derived COMPLETELY from the imported project's spec sources —
 * a local folder or a repository cloned from any version-control host (both land
 * on disk as a project root). No discovery run, no browsers, no execution history —
 * importing an untouched clone is enough to get a full review.
 *
 * Signal source per spec file:
 *   1. Static analysis of EVERY `test()` block (locators, waits, assertions, structure)
 *   2. File metadata (path/line) — for reporting only
 *
 * Every recommendation carries an explicit impact statement AND the exact code change
 * it implies — `fix.before` matched against the spec, `fix.after` the replacement —
 * so the UI can offer a one-click Apply. Deterministic rules only, no LLM, no network.
 * `applyFix()` writes the change to the spec on disk (with a DB-stored backup);
 * `revertFix()` restores it byte-identically.
 */

const SPEC_FILE_RE = /\.(spec|test|e2e)\.[cm]?[jt]sx?$/i;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  'playwright-report', 'test-results', 'blob-report', '.next', '.nuxt', '.turbo',
  '.cache', '.vercel', '.output',
]);
const MAX_SPEC_FILES = 400;
const MAX_SPEC_BYTES = 512 * 1024;
const MAX_DEPTH = 10;

/** Recursively enumerate candidate spec files under the project root (deterministic order). */
function walkSpecFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || found.length >= MAX_SPEC_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip, never abort the scan
    }
    for (const entry of entries) {
      if (found.length >= MAX_SPEC_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        visit(full, depth + 1);
      } else if (entry.isFile() && SPEC_FILE_RE.test(entry.name)) {
        try {
          if (fs.statSync(full).size <= MAX_SPEC_BYTES) found.push(full);
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  visit(root, 0);
  return found.sort();
}

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
/** File clearly named as a page object: LoginPage.ts / checkout.Screen.js … */
const POM_NAME_RE = /(Page|Screen)s?\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i;
/** Directory conventionally holding page objects. */
const POM_DIR_RE = /^(pages|page-objects|pageobjects|pom|pagefactory|page-factory|screens)$/i;
const MAX_POM_FILES = 200;

/**
 * Enumerate page-object source files: either they live under a POM-style directory,
 * or their name marks them as one (…Page.ts). Confirmed by requiring a class declaration
 * in the head of the file so a `pages.ts` barrel or a spec fixture is not miscounted.
 */
function walkPageObjectFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number, inPomDir: boolean) => {
    if (depth > MAX_DEPTH || found.length >= MAX_POM_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_POM_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        visit(full, depth + 1, inPomDir || POM_DIR_RE.test(entry.name));
      } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name) && !SPEC_FILE_RE.test(entry.name)) {
        if (!inPomDir && !POM_NAME_RE.test(entry.name)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 256 * 1024) continue;
          const head = fs.readFileSync(full, 'utf-8').slice(0, 8192);
          if (/\bclass\s+[A-Za-z_]\w*\b/.test(head)) found.push(full);
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  visit(root, 0, false);
  return found.sort();
}

const LOCATOR_COUNTERS: Array<{ key: AdvisorProjectStyle['preferredLocator']; re: RegExp }> = [
  { key: 'getByRole', re: /\bgetByRole\s*\(/g },
  { key: 'getByTestId', re: /\bgetByTestId\s*\(/g },
  { key: 'getByLabel', re: /\bgetByLabel\s*\(/g },
  { key: 'getByPlaceholder', re: /\bgetByPlaceholder\s*\(/g },
  { key: 'getByText', re: /\bgetByText\s*\(/g },
  { key: 'locator', re: /\.locator\s*\(/g },
];

/** The preferred user-facing locator for this project, from actual usage counts. */
function preferredLocatorFrom(counts: Record<string, number>): AdvisorProjectStyle['preferredLocator'] {
  let best: AdvisorProjectStyle['preferredLocator'] = 'none';
  let bestN = 0;
  for (const { key } of LOCATOR_COUNTERS) {
    if (key === 'locator') continue; // raw engine call is the fallback, not a "preference"
    const n = counts[key] || 0;
    if (n > bestN) { bestN = n; best = key; }
  }
  if (bestN > 0) return best;
  return (counts.locator || 0) > 0 ? 'locator' : 'none';
}

/** Example locator in the project's own idiom (getByRole default for mixed/empty projects). */
function preferredLoc(style: AdvisorProjectStyle): string {
  switch (style.preferredLocator) {
    case 'getByTestId': return "page.getByTestId('…')";
    case 'getByLabel': return "page.getByLabel('…')";
    case 'getByPlaceholder': return "page.getByPlaceholder('…')";
    case 'getByText': return "page.getByText('…')";
    case 'getByRole':
    case 'locator':
    case 'none':
    default: return "page.getByRole('…')";
  }
}

/** Locator examples ordered with the project's preferred style first. */
function locatorExamples(style: AdvisorProjectStyle): string {
  const pref = preferredLoc(style);
  const prefHead = pref.split('(')[0];
  const menu = [
    { head: 'page.getByRole', line: "page.getByRole('button', { name: '…' })" },
    { head: 'page.getByTestId', line: "page.getByTestId('submit-order')" },
    { head: 'page.getByLabel', line: "page.getByLabel('Email address')" },
  ];
  const first = menu.find((x) => x.head === prefHead) ?? menu[0];
  const rest = menu.filter((x) => x !== first);
  return [`${first.line}   // preferred in this project`, ...rest.map((x) => `${x.line}   // or`)].join('\n');
}

const pomHint = (style: AdvisorProjectStyle): string =>
  style.pomDetected
    ? ' If a page object wraps this screen, use its locator instead (e.g. checkoutPage.submitOrder) — same auto-retry semantics.'
    : '';

export class ImprovementAdvisorService {
  analyze(projectId: string): ImprovementAdvisorResult {
    const db = getDb();
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as
      | { root_path: string }
      | undefined;
    if (!project?.root_path) throw new Error('Imported project not found — re-import it first.');
    const root = path.resolve(project.root_path);
    if (!fs.existsSync(root)) throw new Error(`Project root does not exist on disk anymore: ${root}`);

    const specFiles = walkSpecFiles(root);
    const advice: TestImprovementAdvice[] = [];

    // Pass 1 — read every spec once to learn the project's coding style BEFORE judging
    // any single block. Fixes then read like the project's own code, not a template.
    const locatorCounts: Record<string, number> = {
      getByRole: 0, getByTestId: 0, getByLabel: 0, getByPlaceholder: 0, getByText: 0, locator: 0,
    };
    const fixtureImportRe = /import\s*(?:type\s*)?{[^}]*\btest\b[^}]*}\s*from\s*['"]([^'"]+)['"]/g;
    let customFixtures = false;
    const specContents: Array<{ filePath: string; content: string }> = [];
    for (const filePath of specFiles) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      specContents.push({ filePath, content });
      for (const { key, re } of LOCATOR_COUNTERS) {
        const hits = content.match(re);
        if (hits) locatorCounts[key] += hits.length;
      }
      let fixtures = fixtureImportRe.exec(content);
      while (fixtures) {
        if (!/^@playwright\/test$/.test(fixtures[1])) customFixtures = true;
        fixtures = fixtureImportRe.exec(content);
      }
    }
    const pomFiles = walkPageObjectFiles(root).length;
    const style: AdvisorProjectStyle = {
      pomDetected: pomFiles > 0,
      pomFiles,
      preferredLocator: preferredLocatorFrom(locatorCounts),
      customFixtures,
    };

    // Pass 2 — analyze each test block with the style context in hand.
    let analyzedCount = 0;
    for (const { filePath, content } of specContents) {
      const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
      const blocks = extractTestBlocks(content).filter((b) => b.found);
      // Does this file already speak POM — imports a page-object module or instantiates one?
      const fileImportsPom =
        /import[^;]*?\bfrom\s*['"][^'"]*(?:pages?|pom|screens?)[^'"]*['"]/i.test(content) ||
        /\bnew\s+[A-Za-z_]\w*(Page|Screen)\s*\(/.test(content);
      for (const block of blocks) {
        analyzedCount += 1;
        const issues = this.analyzeBlock(block, style, fileImportsPom);
        if (issues.length === 0) continue;

        const estimatedTimeSavedMs = issues.reduce((sum, i) => sum + (i.estimatedTimeSavedMs || 0), 0);
        const score = issues.reduce(
          (sum, i) => sum + (i.severity === 'critical' ? 50 : i.severity === 'warning' ? 18 : 5),
          0
        );
        advice.push({
          testId: `${relativePath}:${block.startLine}:${block.title}`,
          testTitle: block.title,
          relativePath,
          line: block.startLine,
          score,
          estimatedTimeSavedMs,
          issues,
        });
      }
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
      scannedFiles: specFiles.length,
      style,
      tests: advice.slice(0, 200),
      summary: { flaggedTests: advice.length, critical, warning, info, totalEstimatedTimeSavedMs },
    };
  }

  private analyzeBlock(block: DiscoveredTestBlock, style: AdvisorProjectStyle, fileImportsPom = false): ImprovementIssue[] {
    const issues: ImprovementIssue[] = [];
    const body = block.bodySource;
    if (!body) return issues;
    const bodyLines = body.split('\n');
    const lineOf = (offsetInBody: number): number | undefined => {
      let acc = 0;
      for (let i = 0; i < bodyLines.length; i++) {
        acc += bodyLines[i].length + 1;
        if (acc >= offsetInBody) return block.bodyStartLine + i;
      }
      return undefined;
    };


    // 1) Hard-coded sleeps — the single biggest flake/slowness source.
    const hardWaits: Array<{ ms: number; line?: number; stmt: string }> = [];
    const waitRe = /(?:await\s+)?page\.waitForTimeout\s*\(\s*(\d+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = waitRe.exec(body)) !== null) {
      hardWaits.push({ ms: Number(m[1]), line: lineOf(m.index), stmt: m[0].trim() });
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
        recommendation:
          'Delete fixed sleeps. Wait for the real condition: expect(locator).toBeVisible()/toHaveText(), page.waitForLoadState("load"), waitForURL, or expect.poll — Playwright retries until the condition holds.',
        impact: `Recovers ~${(total / 1000).toFixed(1)}s per run and removes the single most common cause of passes locally / failures in CI.`,
        estimatedTimeSavedMs: total,
        fix: {
          replacements: hardWaits.map((w) => ({
            before: w.stmt,
            after: `await expect(${preferredLoc(style)}).toBeVisible();`,
          })),
          note: `Each sleep is replaced by the web-first assertion this step actually waits for — it auto-retries until the expect timeout in playwright.config.ts (default 5s), so nothing here is capped tighter than your suite allows. Replace … with the role + accessible name (or test id) of the element the sleep was covering.${pomHint(style)}`,
        },
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
        fix: {
          before: networkIdle[0] ? `await ${networkIdle[0]}` : `await page.waitForLoadState('networkidle')`,
          after: `await page.waitForLoadState('load');\n// then assert the element you actually need:\n// await expect(${preferredLoc(style)}).toBeVisible();`,
          note: 'Do not swap one blind wait for another — pair the load event with a web-first assertion on the element you actually need.' + pomHint(style),
        },
      });
    }

    // 3) Raw / structural selectors instead of user-facing locators.
    const locatorRe = /\.locator\(\s*(['"`])((?:\\.|(?!\1).){0,120})\1/g;
    const xpathHits: number[] = [];
    const cssClassHits: number[] = [];
    const chainHits: number[] = [];
    while ((m = locatorRe.exec(body)) !== null) {
      const sel = m[2].trim();
      if (/^(xpath=|\/\/[a-z])/i.test(sel) || /^css=/i.test(sel)) xpathHits.push(m.index);
      else if (/^\.[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/.test(sel)) cssClassHits.push(m.index);
      else if (/[>\s+~]/.test(sel) && !sel.includes('[data-testid')) chainHits.push(m.index);
    }
    const locatorFragment = (index: number): string => {
      const end = body.indexOf(')', index);
      return body.slice(index, end !== -1 ? end + 1 : index + 60).trim().slice(0, 160);
    };
    if (xpathHits.length) {
      const offending = locatorFragment(xpathHits[0]);
      issues.push({
        id: 'xpath-selector',
        severity: 'warning',
        category: 'maintainability',
        title: `${xpathHits.length} XPath/CSS-engine locator${xpathHits.length > 1 ? 's' : ''}`,
        detail: 'Index- and path-based selectors break on any DOM reshuffle and are painful to debug.',
        code: offending,
        line: lineOf(xpathHits[0]),
        recommendation: 'Prefer page.getByRole(...), getByTestId(...), or getByLabel — user-facing contracts that survive refactors.',
        impact: 'Drastically fewer locator-fix commits per UI change; Playwright auto-waits keep working with role selectors.',
        fix: {
          before: `page.${offending.replace(/^page\./, '')}`,
          after: locatorExamples(style),
          note: 'Pick the role + accessible name (or a data-testid on markup you own) of the target element — first match wins in strict mode.' + pomHint(style),
        },
      });
    }
    if (cssClassHits.length) {
      const offending = locatorFragment(cssClassHits[0]);
      issues.push({
        id: 'css-class-selector',
        severity: 'info',
        category: 'maintainability',
        title: `${cssClassHits.length} CSS-class selector${cssClassHits.length > 1 ? 's' : ''} (e.g. .btn-primary)`,
        detail: 'Styling classes change with design-system refactors and carry no semantic meaning.',
        code: offending,
        line: lineOf(cssClassHits[0]),
        recommendation: 'Switch to getByRole/getByTestId, or add data-testid attributes to the markup you own.',
        impact: 'Selector churn stops blocking redesigns; tests keep passing when class names rotate.',
        fix: {
          before: `page.${offending.replace(/^page\./, '')}`,
          after: locatorExamples(style),
          note: 'Same target, expressed as a user-facing contract instead of a class name.' + pomHint(style),
        },
      });
    } else if (chainHits.length) {
      const offending = locatorFragment(chainHits[0]);
      issues.push({
        id: 'structural-selector',
        severity: 'info',
        category: 'maintainability',
        title: `${chainHits.length} deep structural selector chain${chainHits.length > 1 ? 's' : ''}`,
        detail: 'Descendant/child chains (“div > ul li:nth-child…”) encode DOM shape, not intent.',
        line: lineOf(chainHits[0]),
        code: offending,
        recommendation: 'Anchor on a stable role/testid near the leaf instead of a 5-level path.',
        impact: 'UI refactors stop cascading into spec rewrites.',
        fix: {
          before: `page.${offending.replace(/^page\./, '')}`,
          after:
            locatorExamples(style) +
            '\n// anchor on the nearest semantic landmark of the leaf — not the 5-level path',
          note: 'Replace the whole chained path — not just the last segment — with the role/testid of the element you actually mean.' + pomHint(style),
        },
      });
    }
    const nthRe = /\.nth\(\s*\d+\s*\)/g;
    const nthHits: Array<{ frag: string; line?: number }> = [];
    while ((m = nthRe.exec(body)) !== null) nthHits.push({ frag: m[0], line: lineOf(m.index) });
    if (nthHits.length) {
      issues.push({
        id: 'nth-ordinal',
        severity: 'info',
        category: 'flakiness',
        title: `${nthHits.length} ordinal .nth() dependency${nthHits.length > 1 ? 's' : ''}`,
        detail: 'Positional selection silently shifts when lists reorder or gain a row.',
        code: nthHits[0].frag,
        line: nthHits[0].line,
        recommendation: 'Filter by text/role/name (getByRole("row", { name: /…/ })) so the test picks the element it means.',
        impact: 'Removes off-by-one data races that present as “works on my machine” flakes.',
        fix: {
          before: nthHits[0].frag,
          after: ".filter({ hasText: '…' })",
          note: 'Anchor on content instead of position, e.g. page.getByRole(\'row\', { name: /Acme Corp/ }) — never rely on list order.',
        },
      });
    }

    // 4) Actionability bypass.
    const forceMatch = /\b(click|dblclick|tap|check|uncheck)\s*\(\s*\{\s*force:\s*true\s*\}\s*\)/.exec(body)
      ?? /force:\s*true/.exec(body);
    if (forceMatch) {
      const full = forceMatch[0];
      issues.push({
        id: 'force-true',
        severity: 'warning',
        category: 'flakiness',
        title: 'force: true bypasses actionability checks',
        detail: 'Clicks land even when the element is covered, detached, or animating — the exact conditions real users hit.',
        code: full,
        line: lineOf(forceMatch.index),
        recommendation: 'Remove force:true and fix the underlying overlay/animation/scroll issue; use expect(locator).toBeEnabled() first if needed.',
        impact: 'True actionability re-enabled: the test now fails loudly instead of corrupting downstream state mid-flight.',
        fix: {
          before: full,
          after: full.replace(/\{\s*force:\s*true\s*\}/, '').replace(/\(\s*\)/, '()'),
          note: 'If the click is genuinely blocked, fix the blocker: await expect(locator).toBeEnabled(); / wait for overlay to detach — do not silence Playwright’s checks.',
        },
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
        recommendation: style.pomDetected
          ? 'Delete the branch. If the element is expected every run, assert it (expect(locator).toBeVisible()). If it is genuinely optional, move the check INTO the page object (e.g. checkoutPage.promoBanner.isVisible()) and poll it there — expect.poll(() => promo.isVisible()).toBe(true) — so the spec stays a straight line of business steps.'
          : 'Delete the branch. If the element is expected every run, assert it with a web-first assertion (expect(locator).toBeVisible()). If it appears asynchronously, use expect.poll(() => locator.isVisible()).toBe(true) — never if/else on visibility inside a test.',
        impact: 'One deterministic path per test — a failure means one real problem, not a coin-flip between two hidden paths.',
        // No mechanical fix on purpose: rewriting an if-branch in place changes the
        // test's semantics and can leave unbalanced braces behind. Review it by hand.
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
        fix: {
          after: `await expect(${preferredLoc(style)}).toBeVisible();`,
          insertAtEndOfTest: true,
          note: 'Inserted right before the closing brace of this test — pick the observable outcome that defines success (toBeVisible / toHaveText / toHaveURL).' + pomHint(style),
        },
      });
    }

    // 7) Debugging leftovers and focus traps. `.only` lives on the declaration line,
    // not inside the body — scan the declaration prefix of the block.
    const declSource = block.bodySource ? block.source.slice(0, block.source.length - block.bodySource.length) : block.source;
    const declLineOf = (offsetInDecl: number): number => {
      const upto = declSource.slice(0, offsetInDecl);
      return block.startLine + (upto.match(/\n/g) || []).length;
    };
    const onlyMatch = /\.only\s*\(/.exec(declSource);
    if (onlyMatch) {
      issues.push({
        id: 'test-only',
        severity: 'critical',
        category: 'maintainability',
        title: '.only( focused test left in the suite',
        detail: 'Playwright runs ONLY focused tests in this file — everything else is silently skipped on this branch.',
        code: 'test.only(...)',
        line: declLineOf(onlyMatch.index),
        recommendation: 'Remove .only / rely on CI’s --forbid-only flag; enforce it with a lint rule (playwright/no-focused-test).',
        impact: 'Restores the full regression net — zero silent skips reaching main.',
        fix: {
          before: '.only(',
          after: '(',
          note: 'That is the whole fix — delete “.only”. Enforce it in CI with --forbid-only and eslint-plugin-playwright.',
        },
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
        fix: {
          before: pauseMatch[0],
          after: '/* removed: page.pause() — use PWDEBUG=console locally */',
          note: 'One line deletes itself.',
        },
      });
    }

    // 8) Overlong tests — cognitive load and retry cost. Only flagged on a real outlier:
    // more than 20 steps AND no test.step() grouping (an already-structured long test is fine).
    if (block.steps.length > 20 && !/\btest\.step\s*\(/.test(body)) {
      issues.push({
        id: 'long-test',
        severity: 'info',
        category: 'maintainability',
        title: `Long test — ${block.steps.length} steps in one case`,
        detail: 'Very long tests are hard to review, slow to retry, and their failures demand heavy triage. (Already using test.step()? This finding is suppressed.)',
        recommendation: 'Group the phases with test.step("arrange" | "act" | "assert", …) for readable reports; split into sibling test() cases sharing a storageState fixture when stages are independent.',
        impact: 'Failures localize instantly; retries only re-run the broken journey instead of the whole flow.',
        fix: {
          after:
            "await test.step('arrange', async () => { /* seed data via fixtures/API */ });\n" +
            "await test.step('act', async () => { /* the user journey */ });\n" +
            "await test.step('assert', async () => { /* web-first assertions */ });",
          note: 'Wrap the three phases in test.step() at minimum — Playwright reports each step separately. Full split into sibling test() cases sharing a storageState fixture is better for >12 steps.',
        },
      });
    }

    // 9) POM bypass — the project HAS page objects and this file/block shows no POM usage at
    // all (no page-object import, no `new XPage()`, no test.step grouping). Only then is the
    // raw-page count actionable advice rather than noise.
    if (style.pomDetected && !fileImportsPom && !/\btest\.step\s*\(/.test(body)) {
      const rawPageRe = /\bpage\.(locator|getBy\w+|fill|type|press|click|dblclick|tap|check|uncheck|selectOption|goto|waitFor\w*)\s*\(/g;
      const rawCount = (body.match(rawPageRe) || []).length;
      if (rawCount >= 5) {
        issues.push({
          id: 'pom-direct-actions',
          severity: 'info',
          category: 'maintainability',
          title: `${rawCount} direct page.* calls — bypassing the project's page objects`,
          detail: `This project ships page objects (${style.pomFiles} found), but this test drives the page directly — navigation, locators and waits belong in the page object so the spec reads as business steps.`,
          recommendation: 'Move page.goto/open(), locator definitions and interactions into the matching page object; the spec should read as business steps (await checkoutPage.submitOrder()) with web-first assertions (or page-object getters that return Locators for expect()).',
          impact: 'DOM changes touch one page object instead of every spec — reviewers read business intent, not selector plumbing, and locator fixes stop cascading.',
          // Advisory by design — extracting methods is a structural change, not a mechanical edit.
        });
      }
    }

    return issues;
  }

  /**
   * Apply one recommendation's fix to the spec file on disk.
   * Safety contract:
   *   • the spec must live INSIDE the imported project root;
   *   • matching is scoped to the originating test block (re-extracted from the
   *     current file contents — if the block drifted, we refuse rather than
   *     guess where an edit lands);
   *   • either every replacement in a multi-part fix matches (inside the block)
   *     or NOTHING is written — the operation is all-or-nothing;
   *   • the original file contents are stored in advisor_fix_backups before the
   *     write, so revertFix() can restore them byte-identically.
   */
  applyFix(req: ApplyFixRequest): ApplyFixResult {
    const db = getDb();
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(req.projectId) as
      | { root_path: string }
      | undefined;
    if (!project?.root_path) return { ok: false, message: 'Imported project not found — re-import it first.' };
    const root = path.resolve(project.root_path);
    const filePath = path.resolve(root, req.relativePath);
    if (!(filePath === root || filePath.startsWith(root + path.sep))) {
      return { ok: false, message: 'Refusing to edit a file outside the imported project root.' };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, message: `Spec file not found: ${req.relativePath} (was it moved or deleted? Re-scan the project.)` };
    }
    let content: string;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024 * 1024) return { ok: false, message: 'Spec file exceeds 1 MB — apply the change manually.' };
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      return { ok: false, message: `Cannot read the spec file: ${err?.message || err}` };
    }

    const fix = req.fix;
    if (!fix || (!fix.before && !fix.replacements?.length && !fix.insertAtEndOfTest)) {
      return { ok: false, message: 'This recommendation is a restructure, not a mechanical edit — apply it manually (each step is described in the note).' };
    }

    const blocks = extractTestBlocks(content).filter((b) => b.found);
    const block = blocks.find((b) => b.title === req.testFullTitle);
    if (!block || block.startOffset === undefined || block.endOffset === undefined) {
      return { ok: false, message: 'Could not re-locate the test block (the spec changed since the analysis — re-analyze and try again).' };
    }
    const blockStart = block.startOffset;
    const blockEnd = block.endOffset;

    // Collect edits as {index, length, text} against absolute offsets.
    const edits: Array<{ index: number; length: number; text: string }> = [];
    const scopedIndexOf = (needle: string): number[] => {
      const out: number[] = [];
      if (!needle) return out;
      let idx = content.indexOf(needle);
      while (idx !== -1) {
        if (idx >= blockStart && idx + needle.length <= blockEnd) out.push(idx);
        idx = content.indexOf(needle, idx + 1);
      }
      return out;
    };

    if (fix.replacements?.length) {
      for (const part of fix.replacements) {
        const hits = scopedIndexOf(part.before);
        if (hits.length === 0) {
          return { ok: false, message: `Could not match this line inside the test block (spec changed?): ${part.before.slice(0, 80)}` };
        }
        for (const index of hits) edits.push({ index, length: part.before.length, text: part.after });
      }
    } else if (fix.before) {
      if (!fix.after) return { ok: false, message: 'Fix payload is missing its replacement text.' };
      const after = fix.after;
      const hits = scopedIndexOf(fix.before);
      if (hits.length === 0) {
        return { ok: false, message: `Could not match the code to replace inside the test block (spec changed?): ${fix.before.slice(0, 80)}` };
      }
      // Identical statements inside the same test all get the same mechanical fix.
      for (const index of hits) edits.push({ index, length: fix.before.length, text: after });
    } else if (fix.insertAtEndOfTest) {
      if (!fix.after) return { ok: false, message: 'Fix payload is missing its insertion text.' };
      // Insert before the closing brace of the block, matching the body's indentation.
      const bodyLines = content.slice(blockStart, blockEnd).split('\n');
      let indent = '  ';
      for (const line of bodyLines) {
        const m2 = line.match(/^(\s+)\S/);
        if (m2 && line.trim().length > 0) { indent = m2[1]; break; }
      }
      const closing = content.lastIndexOf('}', blockEnd - 1);
      const closingIndent = indent.slice(0, Math.max(0, indent.length - 2));
      const needsLeadingNewline = closing > 0 && content[closing - 1] !== '\n';
      const insertion =
        (needsLeadingNewline ? '\n' : '') +
        fix.after.split('\n').map((l) => indent + l).join('\n') +
        '\n' +
        closingIndent;
      edits.push({ index: closing, length: 0, text: insertion });
    }

    if (edits.length === 0) return { ok: false, message: 'Nothing to change.' };

    // Apply all edits in one pass (descending offsets so earlier indices stay valid).
    edits.sort((a, b) => b.index - a.index);
    let applied = content;
    for (const edit of edits) {
      applied = applied.slice(0, edit.index) + edit.text + applied.slice(edit.index + edit.length);
    }
    if (applied === content) return { ok: false, message: 'The replacement is identical to the current code — nothing to write.' };

    const applicationId = uuidv4();
    try {
      db.prepare(
        `INSERT INTO advisor_fix_backups (id, project_id, relative_path, file_path, issue_id, test_title, original, applied, created_at, reverted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(applicationId, req.projectId, req.relativePath, filePath, req.issueId, req.testFullTitle, content, applied, new Date().toISOString());
      fs.writeFileSync(filePath, applied, 'utf-8');
    } catch (err: any) {
      return { ok: false, message: `Write failed (spec untouched): ${err?.message || err}` };
    }

    return {
      ok: true,
      applicationId,
      message: `Applied to ${req.relativePath} — backup saved (${edits.length} change${edits.length === 1 ? '' : 's'}). Undo is available from this page.`,
    };
  }

  /** Byte-identical rollback of a previously applied advisor fix. */
  revertFix(applicationId: string): RevertFixResult {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM advisor_fix_backups WHERE id = ?')
      .get(applicationId) as
      | { id: string; file_path: string; original: string; applied: string; reverted: number }
      | undefined;
    if (!row) return { ok: false, message: 'Backup not found — nothing to revert.' };
    if (row.reverted) return { ok: false, message: 'This fix was already reverted.' };
    let current: string | null = null;
    try {
      current = fs.existsSync(row.file_path) ? fs.readFileSync(row.file_path, 'utf-8') : null;
    } catch {
      current = null;
    }
    if (current !== row.applied) {
      return {
        ok: false,
        message: 'The spec changed since this fix was applied — refusing to overwrite your edits. Review the file manually.',
      };
    }
    try {
      fs.writeFileSync(row.file_path, row.original, 'utf-8');
      db.prepare('UPDATE advisor_fix_backups SET reverted = 1 WHERE id = ?').run(row.id);
    } catch (err: any) {
      return { ok: false, message: `Revert failed (file untouched): ${err?.message || err}` };
    }
    return { ok: true, message: 'Original code restored byte-identically.' };
  }
}

export default ImprovementAdvisorService;
