import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { BrowserType, DiscoveredTest, FolderNode, ProjectConfig, SpecFileNode } from '../../shared/types';
import { getDb } from '../database/db';
import { normalizeWinPath } from '../utils/pathSecurity';

const execFileAsync = promisify(execFile);

export class ProjectDiscoveryService {
  async importProject(rawPath: string): Promise<ProjectConfig> {
    const rootPath = normalizeWinPath(rawPath);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      throw new Error(`Directory does not exist: ${rootPath}`);
    }

    const validationMessages: string[] = [];
    let validationStatus: 'valid' | 'warning' | 'invalid' = 'valid';

    const pkgPath = path.join(rootPath, 'package.json');
    let playwrightVersion = 'Not detected';
    let npmScripts: Record<string, string> = {};
    let projectName = path.basename(rootPath);

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      projectName = pkg.name || projectName;
      npmScripts = pkg.scripts || {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['@playwright/test']) {
        playwrightVersion = deps['@playwright/test'];
      } else {
        validationStatus = 'invalid';
        validationMessages.push('@playwright/test is missing from package.json. Run: npm i -D @playwright/test');
      }
    } else {
      validationStatus = 'invalid';
      validationMessages.push('package.json not found in selected folder.');
    }

    const configCandidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
    let configPath: string | null = null;
    for (const candidate of configCandidates) {
      const full = path.join(rootPath, candidate);
      if (fs.existsSync(full)) {
        configPath = full;
        break;
      }
    }

    if (!configPath) {
      if (validationStatus === 'valid') validationStatus = 'warning';
      validationMessages.push('No playwright.config.ts found; Playwright CLI defaults will apply.');
    }

    const hasTsConfig = fs.existsSync(path.join(rootPath, 'tsconfig.json'));

    let nodeVersion = process.version;
    try {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'node.exe' : 'node', ['-v']);
      nodeVersion = stdout.trim();
    } catch {
      // fallback
    }

    let testDir = 'tests';
    let projectsConfigured: string[] = ['chromium'];
    let reporters: string[] = ['html'];

    if (configPath) {
      const configRaw = fs.readFileSync(configPath, 'utf-8');
      const testDirMatch = configRaw.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/);
      if (testDirMatch) {
        testDir = testDirMatch[1].replace(/^\.\//, '');
      }

      const projectNames: string[] = [];
      const projRegex = /name\s*:\s*['"`]([^'"`]+)['"`]/g;
      let match: RegExpExecArray | null;
      while ((match = projRegex.exec(configRaw)) !== null) {
        projectNames.push(match[1]);
      }
      if (projectNames.length > 0) {
        projectsConfigured = Array.from(new Set(projectNames));
      }
    }

    const browsersInstalled = this.detectInstalledBrowsers();
    if (browsersInstalled.length === 0) {
      if (validationStatus === 'valid') validationStatus = 'warning';
      validationMessages.push('No Playwright browser binaries detected. Run: npx playwright install');
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, created_at FROM projects WHERE root_path = ?').get(rootPath) as
      | { id: string; created_at: string }
      | undefined;

    const now = new Date().toISOString();
    const project: ProjectConfig = {
      id: existing?.id || uuidv4(),
      name: projectName,
      rootPath,
      configPath,
      testDir,
      playwrightVersion,
      nodeVersion,
      browsersInstalled,
      projectsConfigured,
      reporters,
      npmScripts,
      hasTsConfig,
      validationStatus,
      validationMessages,
      createdAt: existing?.created_at || now,
      lastScannedAt: now,
    };

    db.prepare(`
      INSERT INTO projects (
        id, name, root_path, config_path, test_dir, playwright_version, node_version,
        browsers_installed, projects_configured, reporters, npm_scripts, has_ts_config,
        validation_status, validation_messages, created_at, last_scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET
        name=excluded.name,
        config_path=excluded.config_path,
        test_dir=excluded.test_dir,
        playwright_version=excluded.playwright_version,
        node_version=excluded.node_version,
        browsers_installed=excluded.browsers_installed,
        projects_configured=excluded.projects_configured,
        reporters=excluded.reporters,
        npm_scripts=excluded.npm_scripts,
        has_ts_config=excluded.has_ts_config,
        validation_status=excluded.validation_status,
        validation_messages=excluded.validation_messages,
        last_scanned_at=excluded.last_scanned_at
    `).run(
      project.id,
      project.name,
      project.rootPath,
      project.configPath,
      project.testDir,
      project.playwrightVersion,
      project.nodeVersion,
      JSON.stringify(project.browsersInstalled),
      JSON.stringify(project.projectsConfigured),
      JSON.stringify(project.reporters),
      JSON.stringify(project.npmScripts),
      project.hasTsConfig ? 1 : 0,
      project.validationStatus,
      JSON.stringify(project.validationMessages),
      project.createdAt,
      project.lastScannedAt
    );

    await this.discoverTests(project);
    return project;
  }

  /**
   * Discovers all Playwright specs & tests directly from the project's test directory first (instantaneous, 100% reliable)
   * and enriches with Playwright CLI metadata when available.
   */
  async discoverTests(project: ProjectConfig): Promise<DiscoveredTest[]> {
    // Step 1: Immediate deterministic source scan so every folder, spec, describe block, and test is guaranteed to appear
    let discovered = this.scanSpecFilesFromDisk(project);

    // Step 2: Enrich via Playwright CLI `--list --reporter=json` if available
    try {
      const localPlaywrightCli = path.join(project.rootPath, 'node_modules', '@playwright', 'test', 'cli.js');
      const useDirectNode = fs.existsSync(localPlaywrightCli);
      const executable = useDirectNode
        ? (process.platform === 'win32' ? 'node.exe' : 'node')
        : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
      const cliArgs = useDirectNode
        ? [localPlaywrightCli, 'test', '--list', '--reporter=json']
        : ['playwright', 'test', '--list', '--reporter=json'];

      const cleanEnv = { ...process.env };
      delete cleanEnv.NO_COLOR;
      cleanEnv.FORCE_COLOR = '0';

      const { stdout } = await execFileAsync(executable, cliArgs, {
        cwd: project.rootPath,
        maxBuffer: 1024 * 1024 * 32,
        shell: !useDirectNode && process.platform === 'win32',
        env: cleanEnv,
      });

      const jsonStart = stdout.indexOf('{');
      const cleanJson = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
      const parsed = JSON.parse(cleanJson);
      const testsMap = new Map<string, DiscoveredTest>();

      const resolveSpecPath = (rawFile: string): string => {
        if (!rawFile) return '';
        if (path.isAbsolute(rawFile)) return normalizeWinPath(rawFile);

        const candidateFromRoot = normalizeWinPath(path.join(project.rootPath, rawFile));
        if (fs.existsSync(candidateFromRoot)) return candidateFromRoot;

        const candidateFromTestDir = normalizeWinPath(path.join(project.rootPath, project.testDir, rawFile));
        if (fs.existsSync(candidateFromTestDir)) return candidateFromTestDir;

        return candidateFromTestDir;
      };

      const walkSuite = (suite: any, ancestors: string[]) => {
        const nextAncestors = suite.title && !suite.file ? [...ancestors, suite.title] : ancestors;

        if (Array.isArray(suite.specs)) {
          for (const spec of suite.specs) {
            const rawFile: string = spec.file || suite.file || '';
            const fullPath = resolveSpecPath(rawFile);
            if (!fullPath) continue;

            const relativeToRoot = path.relative(project.rootPath, fullPath).replace(/\\/g, '/');
            const rawFolder = path.dirname(relativeToRoot).replace(/\\/g, '/');
            const folderPath = !rawFolder || rawFolder === '.' ? project.testDir || 'tests' : rawFolder;

            const specTags: string[] = Array.isArray(spec.tags)
              ? spec.tags.map((t: string) => (t.startsWith('@') ? t : `@${t}`))
              : [];

            const inlineTags = (spec.title || '').match(/@[a-zA-Z0-9_-]+/g) || [];
            const allTags = Array.from(new Set([...specTags, ...inlineTags]));

            for (const testEntry of spec.tests || []) {
              const projectName = testEntry.projectName || 'default';
              const uniqueKey = `${relativeToRoot}::${nextAncestors.join(' > ')}::${spec.title}`;

              if (!testsMap.has(uniqueKey)) {
                const annotations = Array.isArray(testEntry.annotations) ? testEntry.annotations : [];
                testsMap.set(uniqueKey, {
                  id: Buffer.from(uniqueKey).toString('base64url'),
                  projectId: project.id,
                  title: spec.title,
                  fullTitle: [...nextAncestors, spec.title].join(' > '),
                  suitePath: nextAncestors,
                  filePath: fullPath,
                  relativePath: relativeToRoot,
                  folderPath,
                  line: spec.line || 1,
                  column: spec.column || 1,
                  tags: allTags,
                  annotations,
                  projectName,
                });
              }
            }
          }
        }

        if (Array.isArray(suite.suites)) {
          for (const child of suite.suites) {
            walkSuite(child, nextAncestors);
          }
        }
      };

      if (Array.isArray(parsed.suites)) {
        for (const rootSuite of parsed.suites) {
          walkSuite(rootSuite, []);
        }
      }

      if (testsMap.size > 0) {
        discovered = Array.from(testsMap.values());
      }
    } catch {
      // Keep the deterministic disk scan results
    }

    const db = getDb();
    const existingStats = db
      .prepare('SELECT id, title, last_status, last_duration_ms, retry_count FROM discovered_tests WHERE project_id = ?')
      .all(project.id) as Array<{
        id: string;
        title: string;
        last_status: any;
        last_duration_ms: number;
        retry_count: number;
      }>;
    const statsById = new Map(existingStats.map((s) => [s.id, s]));
    const statsByTitle = new Map(existingStats.map((s) => [s.title, s]));

    const tx = db.transaction((items: DiscoveredTest[]) => {
      db.prepare('DELETE FROM discovered_tests WHERE project_id = ?').run(project.id);
      const insert = db.prepare(`
        INSERT INTO discovered_tests (
          id, project_id, title, full_title, suite_path, file_path, relative_path,
          folder_path, line, column, tags, annotations, project_name,
          last_status, last_duration_ms, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const t of items) {
        const prev = statsById.get(t.id) || statsByTitle.get(t.title);
        insert.run(
          t.id,
          t.projectId,
          t.title,
          t.fullTitle,
          JSON.stringify(t.suitePath),
          t.filePath,
          t.relativePath,
          t.folderPath,
          t.line,
          t.column,
          JSON.stringify(t.tags),
          JSON.stringify(t.annotations),
          t.projectName,
          prev?.last_status || null,
          prev?.last_duration_ms || null,
          prev?.retry_count || 0
        );
      }
    });

    tx(discovered);
    return discovered;
  }

  /**
   * Scans the project's test directory recursively for all *.spec.* and *.test.* files,
   * extracting describe blocks, test names, line numbers, and @tags.
   */
  scanSpecFilesFromDisk(project: ProjectConfig): DiscoveredTest[] {
    const results: DiscoveredTest[] = [];
    const configuredRoot = path.join(project.rootPath, project.testDir);
    const scanRoot = fs.existsSync(configuredRoot) ? configuredRoot : project.rootPath;
    if (!fs.existsSync(scanRoot)) return results;

    const specFilePattern = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/i;
    const describePattern = /\b(?:test\.)?describe(?:\.(?:only|skip|parallel|serial))?\s*\(\s*(['"`])([\s\S]*?)\1/g;
    const testCallPattern = /\b(?:test|it)(?:\.(?:only|skip|fixme))?\s*(?:<[^>]+>)?\s*\(\s*(['"`])([\s\S]*?)\1\s*,/g;

    const walkFiles = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'playwright-report', 'test-results', 'dist', 'build'].includes(entry.name)) {
            walkFiles(full);
          }
        } else if (entry.isFile() && specFilePattern.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8');
          const relativeToRoot = path.relative(project.rootPath, full).replace(/\\/g, '/');
          const rawFolder = path.dirname(relativeToRoot).replace(/\\/g, '/');
          const folderPath = !rawFolder || rawFolder === '.' ? project.testDir || 'tests' : rawFolder;

          // Capture top-level describe title if present
          describePattern.lastIndex = 0;
          const descMatch = describePattern.exec(content);
          const suiteTitle = descMatch ? descMatch[2].trim() : '';

          testCallPattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = testCallPattern.exec(content)) !== null) {
            const title = match[2].trim();
            const line = content.slice(0, match.index).split(/\r?\n/).length;
            const tags = title.match(/@[a-zA-Z0-9_-]+/g) || [];
            const suitePath = suiteTitle ? [suiteTitle] : [];
            const fullTitle = suiteTitle ? `${suiteTitle} > ${title}` : title;
            const uniqueKey = `${relativeToRoot}::${suiteTitle}::${title}`;

            results.push({
              id: Buffer.from(uniqueKey).toString('base64url'),
              projectId: project.id,
              title,
              fullTitle,
              suitePath,
              filePath: full,
              relativePath: relativeToRoot,
              folderPath,
              line,
              column: 1,
              tags,
              annotations: [],
              projectName: 'chromium',
            });
          }
        }
      }
    };

    walkFiles(scanRoot);
    return results;
  }

  listTestsForProject(projectId: string): DiscoveredTest[] {
    const db = getDb();
    let rows = db
      .prepare('SELECT * FROM discovered_tests WHERE project_id = ? ORDER BY relative_path, line')
      .all(projectId) as any[];

    // If DB has 0 tests for this project, scan disk synchronously right now so Explorer is never blank
    if (rows.length === 0) {
      const project = this.listProjects().find((p) => p.id === projectId);
      if (project) {
        const scanned = this.scanSpecFilesFromDisk(project);
        if (scanned.length > 0) {
          const tx = db.transaction((items: DiscoveredTest[]) => {
            const insert = db.prepare(`
              INSERT INTO discovered_tests (
                id, project_id, title, full_title, suite_path, file_path, relative_path,
                folder_path, line, column, tags, annotations, project_name,
                last_status, last_duration_ms, retry_count
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)
            `);
            for (const t of items) {
              insert.run(
                t.id,
                t.projectId,
                t.title,
                t.fullTitle,
                JSON.stringify(t.suitePath),
                t.filePath,
                t.relativePath,
                t.folderPath,
                t.line,
                t.column,
                JSON.stringify(t.tags),
                JSON.stringify(t.annotations),
                t.projectName
              );
            }
          });
          tx(scanned);
          rows = db
            .prepare('SELECT * FROM discovered_tests WHERE project_id = ? ORDER BY relative_path, line')
            .all(projectId) as any[];
        }
      }
    }

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      fullTitle: r.full_title,
      suitePath: JSON.parse(r.suite_path),
      filePath: r.file_path,
      relativePath: r.relative_path,
      folderPath: r.folder_path,
      line: r.line,
      column: r.column,
      tags: JSON.parse(r.tags),
      annotations: JSON.parse(r.annotations),
      projectName: r.project_name,
      lastStatus: r.last_status || undefined,
      lastDurationMs: r.last_duration_ms || undefined,
      retryCount: r.retry_count || 0,
    }));
  }

  buildFolderTree(projectId: string): FolderNode[] {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return [];

    const tests = this.listTestsForProject(projectId);
    const rootMap = new Map<string, FolderNode>();

    const getOrCreateFolder = (relFolderPath: string): FolderNode => {
      if (rootMap.has(relFolderPath)) return rootMap.get(relFolderPath)!;
      const parts = relFolderPath.split('/').filter(Boolean);
      const name = parts[parts.length - 1] || project.test_dir || 'tests';
      const node: FolderNode = {
        name,
        relativePath: relFolderPath,
        fullPath: path.join(project.rootPath, relFolderPath),
        testCount: 0,
        children: [],
        specs: [],
      };
      rootMap.set(relFolderPath, node);

      if (parts.length > 1) {
        const parentRel = parts.slice(0, -1).join('/');
        const parent = getOrCreateFolder(parentRel);
        if (!parent.children.some((c) => c.relativePath === relFolderPath)) {
          parent.children.push(node);
        }
      }
      return node;
    };

    const specMap = new Map<string, SpecFileNode>();

    for (const test of tests) {
      const normalizedFolder = !test.folderPath || test.folderPath === '.' ? project.test_dir || 'tests' : test.folderPath;
      const folderNode = getOrCreateFolder(normalizedFolder);
      let specNode = specMap.get(test.relativePath);
      if (!specNode) {
        specNode = {
          name: path.basename(test.relativePath),
          relativePath: test.relativePath,
          fullPath: test.filePath,
          testCount: 0,
          tests: [],
        };
        specMap.set(test.relativePath, specNode);
        folderNode.specs.push(specNode);
      }
      specNode.tests.push(test);
      specNode.testCount += 1;
    }

    const computeCounts = (node: FolderNode): number => {
      const directTests = node.specs.reduce((sum, s) => sum + s.testCount, 0);
      const childTests = node.children.reduce((sum, c) => sum + computeCounts(c), 0);
      node.testCount = directTests + childTests;
      return node.testCount;
    };

    const topLevelFolders: FolderNode[] = [];
    for (const [relPath, node] of rootMap.entries()) {
      const parentRel = relPath.split('/').slice(0, -1).join('/');
      if (!parentRel || !rootMap.has(parentRel)) {
        computeCounts(node);
        topLevelFolders.push(node);
      }
    }

    return topLevelFolders;
  }

  listProjects(): ProjectConfig[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_scanned_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootPath: r.root_path,
      configPath: r.config_path,
      testDir: r.test_dir,
      playwrightVersion: r.playwright_version,
      nodeVersion: r.node_version,
      browsersInstalled: JSON.parse(r.browsers_installed),
      projectsConfigured: JSON.parse(r.projects_configured),
      reporters: JSON.parse(r.reporters),
      npmScripts: JSON.parse(r.npm_scripts),
      hasTsConfig: Boolean(r.has_ts_config),
      validationStatus: r.validation_status,
      validationMessages: JSON.parse(r.validation_messages),
      createdAt: r.created_at,
      lastScannedAt: r.last_scanned_at,
    }));
  }

  private detectInstalledBrowsers(): BrowserType[] {
    const cacheDir =
      process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
        : path.join(process.env.HOME || '', '.cache', 'ms-playwright');

    if (!fs.existsSync(cacheDir)) return ['chromium'];
    const entries = fs.readdirSync(cacheDir);
    const detected: BrowserType[] = [];
    if (entries.some((e) => e.startsWith('chromium'))) detected.push('chromium');
    if (entries.some((e) => e.startsWith('firefox'))) detected.push('firefox');
    if (entries.some((e) => e.startsWith('webkit'))) detected.push('webkit');
    return detected.length > 0 ? detected : ['chromium'];
  }
}
