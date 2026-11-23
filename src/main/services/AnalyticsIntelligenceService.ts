import { FlakyTestMetric } from '../../shared/types';
import { getDb } from '../database/db';

interface CrossBrowserRow {
  testId: string;
  testTitle: string;
  folderPath: string;
  chromium?: any;
  firefox?: any;
  webkit?: any;
}

export class AnalyticsIntelligenceService {
  getFlakyTests(projectId: string, minRuns = 3): FlakyTestMetric[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM test_results WHERE project_id = ? ORDER BY timestamp ASC')
      .all(projectId) as any[];

    const grouped = new Map<string, any[]>();
    for (const r of rows) {
      const list = grouped.get(r.test_id) || [];
      list.push(r);
      grouped.set(r.test_id, list);
    }

    const metrics: FlakyTestMetric[] = [];
    for (const [testId, runs] of grouped.entries()) {
      if (runs.length < minRuns) continue;

      const passCount = runs.filter((r) => r.status === 'passed').length;
      const failCount = runs.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
      const flakyRunCount = runs.filter((r) => r.status === 'flaky' || r.retry > 0).length;
      const retryCount = runs.reduce((acc, r) => acc + (r.retry || 0), 0);

      const inconsistent = (passCount > 0 && failCount > 0) || flakyRunCount > 0;
      if (!inconsistent) continue;

      const flakinessRate = Math.round(((failCount + flakyRunCount) / runs.length) * 100);
      const lastFailure = [...runs].reverse().find((r) => r.status === 'failed' || r.status === 'timedOut' || r.status === 'flaky');
      const recent3 = runs.slice(-3);
      const recentPasses = recent3.filter((r) => r.status === 'passed').length;

      let trend: 'newly_flaky' | 'consistently_flaky' | 'stabilized' = 'consistently_flaky';
      if (recentPasses === 3) trend = 'stabilized';
      else if (runs.length <= 5) trend = 'newly_flaky';

      metrics.push({
        testId,
        testTitle: runs[0].test_title,
        folderPath: runs[0].folder_path,
        filePath: runs[0].file_path,
        totalRuns: runs.length,
        passCount,
        failCount,
        retryCount,
        flakinessRate,
        lastFailureDate: lastFailure?.timestamp || 'N/A',
        commonReason: lastFailure?.error_message?.split('\n')[0] || 'Intermittent synchronization/retry recovery',
        browsersAffected: Array.from(new Set(runs.map((r) => r.browser))),
        trend,
      });
    }

    return metrics.sort((a, b) => b.flakinessRate - a.flakinessRate);
  }

  getCrossBrowserMatrix(projectId: string): CrossBrowserRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM test_results WHERE project_id = ? ORDER BY timestamp DESC')
      .all(projectId) as any[];

    const matrix = new Map<string, CrossBrowserRow>();

    for (const r of rows) {
      const entry: CrossBrowserRow = matrix.get(r.test_id) ?? {
        testId: r.test_id,
        testTitle: r.test_title,
        folderPath: r.folder_path,
      };
      const bKey = String(r.browser || '').toLowerCase();
      if (bKey.includes('chrom') && !entry.chromium) entry.chromium = r;
      else if (bKey.includes('fire') && !entry.firefox) entry.firefox = r;
      else if (bKey.includes('web') && !entry.webkit) entry.webkit = r;

      matrix.set(r.test_id, entry);
    }

    return Array.from(matrix.values());
  }

  getPerformanceBottlenecks(projectId: string) {
    const db = getDb();
    const slowTests = db
      .prepare(`
        SELECT test_id as testId, test_title as testTitle, folder_path as folderPath,
               browser, AVG(duration_ms) as avgDurationMs, MAX(duration_ms) as maxDurationMs,
               MIN(duration_ms) as minDurationMs, COUNT(*) as runs, SUM(retry) as totalRetries
        FROM test_results
        WHERE project_id = ?
        GROUP BY test_id, browser
        ORDER BY avgDurationMs DESC
        LIMIT 25
      `)
      .all(projectId);

    const folderDurations = db
      .prepare(`
        SELECT folder_path as folderPath, AVG(duration_ms) as avgDurationMs, COUNT(*) as executions
        FROM test_results
        WHERE project_id = ?
        GROUP BY folder_path
        ORDER BY avgDurationMs DESC
      `)
      .all(projectId);

    return { slowTests, folderDurations };
  }

  compareBatches(batchIdA: string, batchIdB: string) {
    const db = getDb();
    const resultsA = db.prepare('SELECT * FROM test_results WHERE execution_id = ?').all(batchIdA) as any[];
    const resultsB = db.prepare('SELECT * FROM test_results WHERE execution_id = ?').all(batchIdB) as any[];

    const mapA = new Map(resultsA.map((r) => [`${r.test_id}::${r.browser}`, r]));
    const mapB = new Map(resultsB.map((r) => [`${r.test_id}::${r.browser}`, r]));

    const newlyFailing: any[] = [];
    const fixedTests: any[] = [];
    const consistentlyFailing: any[] = [];

    for (const [key, resB] of mapB.entries()) {
      const resA = mapA.get(key);
      const bFailed = resB.status === 'failed' || resB.status === 'timedOut';
      const aFailed = resA && (resA.status === 'failed' || resA.status === 'timedOut');

      if (bFailed && !aFailed) newlyFailing.push(resB);
      else if (!bFailed && aFailed) fixedTests.push(resB);
      else if (bFailed && aFailed) consistentlyFailing.push(resB);
    }

    return { newlyFailing, fixedTests, consistentlyFailing };
  }
}
