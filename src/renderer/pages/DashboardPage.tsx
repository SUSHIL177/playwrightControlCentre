import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { Play, AlertTriangle, CheckCircle2, Clock, Activity, ExternalLink, RefreshCw, Loader2, CalendarRange, Info } from 'lucide-react';
import { DiscoveredTest, ExecutionBatch, FailureAnalysisRecord, ProjectConfig } from '@shared/types';
import { batchShortLabel } from '../utils/batchFormat';
import { toMinutes } from '@shared/format';
import { buildWeekBuckets, startOfMonday, WEEK_PRESETS, MAX_WEEK_LIMIT, isoDate } from '../utils/weekly';
import { WorkersModal } from '../components/WorkersModal';
import { BrowserType } from '@shared/types';

interface DashboardPageProps {
  project: ProjectConfig | null;
  tests: DiscoveredTest[];
  batches: ExecutionBatch[];
  failures: FailureAnalysisRecord[];
  onQuickRun: (workers: number, browsers: BrowserType[]) => void;
  onRefresh: () => Promise<void>;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  project,
  tests,
  batches,
  failures,
  onQuickRun,
  onRefresh,
}) => {
  const [reportError, setReportError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [workersModalOpen, setWorkersModalOpen] = useState(false);

  // Weekly range: preset (2/4/8/12 weeks) or custom from/to dates with a weekly limit.
  const [rangeMode, setRangeMode] = useState<'preset' | 'custom'>('preset');
  const [weeks, setWeeks] = useState<number>(4);
  const [fromDate, setFromDate] = useState(() => isoDate(startOfMonday(new Date(Date.now() - 27 * 24 * 3600 * 1000))));
  const [toDate, setToDate] = useState(() => isoDate(startOfMonday(new Date())));
  const [weekLimit, setWeekLimit] = useState<number>(12);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
      setRefreshedAt(new Date());
    } catch (err: any) {
      setRefreshError(err?.message || 'Failed to refresh telemetry.');
    } finally {
      setRefreshing(false);
    }
  };

  // ── KPI figures: LATEST run (front) vs ALL-TIME (back) ────────────────────
  const latest = batches[0];
  const latestPassed = latest?.passed ?? 0;
  const latestFailed = latest?.failed ?? 0;
  const latestFlaky = latest?.flaky ?? 0;
  const latestSkipped = latest?.skipped ?? 0;
  const latestPassRate = latest && latest.totalTests > 0 ? Math.round((latest.passed / latest.totalTests) * 100) : 0;
  const latestDurationMin = latest ? toMinutes(latest.durationMs) : 0;

  const totalExecuted = batches.reduce((s, b) => s + b.totalTests, 0);
  const totalPassed = batches.reduce((s, b) => s + b.passed, 0);
  const totalFailed = batches.reduce((s, b) => s + b.failed, 0);
  const totalSkipped = batches.reduce((s, b) => s + b.skipped, 0);
  const totalFlaky = batches.reduce((s, b) => s + b.flaky, 0);
  const passRate = totalExecuted > 0 ? Math.round((totalPassed / totalExecuted) * 100) : 0;
  const avgDurationMin =
    batches.length > 0 ? toMinutes(batches.reduce((s, b) => s + b.durationMs, 0) / batches.length) : 0;

  const donutData = [
    { name: 'Passed', value: latest?.passed || 0, color: '#10B981' },
    { name: 'Failed', value: latest?.failed || 0, color: '#F43F5E' },
    { name: 'Skipped', value: latest?.skipped || 0, color: '#64748B' },
    { name: 'Flaky', value: latest?.flaky || 0, color: '#F59E0B' },
  ].filter((d) => d.value > 0);

  const weekBuckets = useMemo(
    () =>
      buildWeekBuckets(
        batches,
        rangeMode === 'preset' ? { weeks } : { from: fromDate, to: toDate, maxWeeks: weekLimit }
      ),
    [batches, rangeMode, weeks, fromDate, toDate, weekLimit]
  );
  const weekTotals = useMemo(
    () =>
      weekBuckets.reduce(
        (acc, b) => ({
          runs: acc.runs + b.runs,
          total: acc.total + b.total,
          passed: acc.passed + b.passed,
          failed: acc.failed + b.failed,
        }),
        { runs: 0, total: 0, passed: 0, failed: 0 }
      ),
    [weekBuckets]
  );
  const weekPassPct = weekTotals.total > 0 ? Math.round((weekTotals.passed / weekTotals.total) * 100) : 0;

  const categoryCounts = failures.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});
  const failureCategoryData = Object.entries(categoryCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  if (!project) {
    return (
      <div className="p-8 text-center text-slate-400">
        Import a local Playwright project in <strong className="text-sky-400">Project Configuration</strong> to view real analytics.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">QA Automation Intelligence Overview</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Live telemetry from <span className="text-sky-400 font-mono">{project.name}</span> ({batches.length} stored batches • {totalExecuted} total test runs)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh Dashboard Telemetry"
            aria-label="Refresh Dashboard Telemetry"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-wait text-slate-200"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          {refreshing ? (
            <span className="text-[10px] text-sky-300">Refreshing…</span>
          ) : refreshedAt ? (
            <span className="text-[10px] text-slate-500 hidden md:inline">
              Telemetry refreshed at {refreshedAt.toLocaleTimeString(undefined, { hour12: false })}
            </span>
          ) : null}
          {latest && (
            <button
              onClick={async () => {
                setReportError(null);
                try {
                  await window.pwControlCenter.openReportInBrowser(latest.htmlReportPath);
                } catch (e: any) {
                  setReportError(e?.message || 'HTML report not found for the latest batch.');
                }
              }}
              className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open Latest HTML Report
            </button>
          )}
          <button
            onClick={() => setWorkersModalOpen(true)}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Run Full Regression
          </button>
        </div>
      </div>

      {reportError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {reportError}
        </div>
      )}

      {refreshError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          Unable to refresh telemetry: {refreshError}
        </div>
      )}

      {/* KPI Cards — front shows the LATEST execution; hover/focus flips to ALL-TIME totals */}
      <p className="text-[10px] text-slate-500 -mb-3 flex items-center gap-1">
        <Info className="w-3 h-3" /> Cards show the latest execution — hover (or tab to) a card to flip to all-time totals.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <FlipKpiCard
          delayMs={0}
          label="Discovered Tests"
          icon={<CheckCircle2 className="w-4 h-4 text-sky-400" />}
          frontValue={tests.length}
          frontCaption="current suite · latest scan"
          backValue={tests.length}
          backCaption="suite size (unchanged across runs)"
        />
        <FlipKpiCard
          delayMs={70}
          label="Total Passed"
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          frontValue={latestPassed}
          frontCaption={latest ? batchShortLabel(latest) : 'latest run'}
          backValue={totalPassed}
          backCaption={`${batches.length} batches`}
        />
        <FlipKpiCard
          delayMs={140}
          label="Total Failed"
          icon={<AlertTriangle className="w-4 h-4 text-rose-400" />}
          frontValue={latestFailed}
          frontCaption={latest ? batchShortLabel(latest) : 'latest run'}
          backValue={totalFailed}
          backCaption={`${batches.length} batches`}
        />
        <FlipKpiCard
          delayMs={210}
          label="Pass Rate"
          icon={<Activity className="w-4 h-4 text-emerald-400" />}
          frontValue={`${latestPassRate}%`}
          frontCaption={latest ? batchShortLabel(latest) : 'latest run'}
          backValue={`${passRate}%`}
          backCaption={`${totalExecuted} test runs`}
        />
        <FlipKpiCard
          delayMs={280}
          label="Flaky / Skipped"
          icon={<Activity className="w-4 h-4 text-amber-400" />}
          frontValue={`${latestFlaky} / ${latestSkipped}`}
          frontCaption={latest ? batchShortLabel(latest) : 'latest run'}
          backValue={`${totalFlaky} / ${totalSkipped}`}
          backCaption={`${batches.length} batches`}
        />
        <FlipKpiCard
          delayMs={350}
          label="Avg Duration"
          icon={<Clock className="w-4 h-4 text-indigo-400" />}
          frontValue={`${latestDurationMin} min`}
          frontCaption={latest ? batchShortLabel(latest) : 'latest run'}
          backValue={`${avgDurationMin} min`}
          backCaption={`${batches.length} batches`}
        />
      </div>

      {/* Weekly analytics — pick a preset week window or a custom past date range */}
      <div className="bg-pw-panel border border-pw-border rounded-xl p-4 space-y-4 pacc-animate-in-delay-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-sky-400" /> Weekly Analytics
            <span className="normal-case text-[10px] text-slate-500 font-normal">
              {weekBuckets.length} week{weekBuckets.length === 1 ? '' : 's'} · {weekTotals.runs} runs
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className="flex items-center rounded-lg border border-pw-border overflow-hidden">
              {WEEK_PRESETS.map((w) => (
                <button
                  key={w}
                  onClick={() => {
                    setRangeMode('preset');
                    setWeeks(w);
                  }}
                  aria-pressed={rangeMode === 'preset' && weeks === w}
                  className={`px-2.5 py-1.5 font-semibold transition-colors ${
                    rangeMode === 'preset' && weeks === w
                      ? 'bg-sky-500/25 text-sky-300'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  {w}W
                </button>
              ))}
              <button
                onClick={() => setRangeMode('custom')}
                aria-pressed={rangeMode === 'custom'}
                className={`px-2.5 py-1.5 font-semibold border-l border-pw-border transition-colors ${
                  rangeMode === 'custom' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                Custom…
              </button>
            </div>
            {rangeMode === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-slate-400">
                  From
                  <input
                    type="date"
                    value={fromDate}
                    max={toDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-pw-navy border border-pw-border rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400">
                  To
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-pw-navy border border-pw-border rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-400" title="Custom ranges are clamped to this many weeks">
                  Limit
                  <select
                    value={weekLimit}
                    onChange={(e) => setWeekLimit(Number(e.target.value))}
                    className="bg-pw-navy border border-pw-border rounded px-2 py-1 text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    {[2, 4, 8, 12, 26].map((n) => (
                      <option key={n} value={n}>
                        {n} weeks
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Range summary strip */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
          <span className="px-2 py-1 rounded bg-slate-800">Runs: <strong className="text-slate-200">{weekTotals.runs}</strong></span>
          <span className="px-2 py-1 rounded bg-slate-800">Executed: <strong className="text-slate-200">{weekTotals.total}</strong></span>
          <span className="px-2 py-1 rounded bg-slate-800">Passed: <strong className="text-emerald-300">{weekTotals.passed}</strong></span>
          <span className="px-2 py-1 rounded bg-slate-800">Failed: <strong className="text-rose-300">{weekTotals.failed}</strong></span>
          <span className="px-2 py-1 rounded bg-slate-800">Pass rate: <strong className="text-sky-300">{weekPassPct}%</strong></span>
          {rangeMode === 'custom' && (
            <span className="text-slate-600">custom range clamped to {Math.min(weekLimit, MAX_WEEK_LIMIT)} weeks</span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Weekly pass/fail stacked bars */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Passed vs Failed per week</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={10} interval="preserveStartEnd" />
                  <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.rangeLabel ?? ''}
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="passed" name="Passed" fill="#10B981" radius={[4, 4, 0, 0]} stackId="r" />
                  <Bar dataKey="failed" name="Failed" fill="#F43F5E" radius={[4, 4, 0, 0]} stackId="r" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Weekly pass % line */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Pass % per week</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weekBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={10} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} stroke="#64748B" fontSize={10} />
                  <Tooltip
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.rangeLabel ?? ''}
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }}
                  />
                  <Line type="monotone" dataKey="passPct" name="Pass %" stroke="#38BDF8" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Weekly table */}
        <div className="overflow-x-auto max-h-44 overflow-y-auto rounded-lg border border-pw-border">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-800/60 text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5">Week</th>
                <th className="text-right px-3 py-1.5">Runs</th>
                <th className="text-right px-3 py-1.5">Executed</th>
                <th className="text-right px-3 py-1.5">Passed</th>
                <th className="text-right px-3 py-1.5">Failed</th>
                <th className="text-right px-3 py-1.5">Pass %</th>
                <th className="text-right px-3 py-1.5">Avg min</th>
              </tr>
            </thead>
            <tbody className="pacc-rows">
              {[...weekBuckets].reverse().map((b) => (
                <tr key={b.key} className="border-t border-pw-border text-slate-300">
                  <td className="px-3 py-1.5 whitespace-nowrap">{b.rangeLabel}</td>
                  <td className="px-3 py-1.5 text-right">{b.runs}</td>
                  <td className="px-3 py-1.5 text-right">{b.total}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-300">{b.passed}</td>
                  <td className="px-3 py-1.5 text-right text-rose-300">{b.failed}</td>
                  <td className="px-3 py-1.5 text-right">{b.total > 0 ? `${b.passPct}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-right">{b.runs > 0 ? b.avgDurationMin : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="bg-pw-panel border border-pw-border rounded-xl p-8 text-center text-sm text-slate-400">
          No executions recorded yet for <strong className="text-white">{project.name}</strong>. Click{' '}
          <strong className="text-emerald-400">Run Full Regression</strong> or open the{' '}
          <strong className="text-sky-400">Test Explorer</strong> to execute real Playwright tests.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Latest Batch Donut */}
          <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Latest Batch Breakdown ({batchShortLabel(latest)}) — {latest?.passed} Passed / {latest?.failed} Failed
            </h3>
            <div className="h-60">
              {donutData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Batch recorded 0 parsed test items.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {donutData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Failure Category Distribution (always shown; fed by analyzed failures) */}
          <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              AI Failure Category Distribution
            </h3>
            <div className="h-60">
              {failureCategoryData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-6">
                  <AlertTriangle className="w-8 h-8 text-slate-600" />
                  <p className="text-xs text-slate-400">
                    No analyzed failures yet.
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-sm">
                    Failures are auto-analyzed after each run when the offline engine is active. Open{' '}
                    <strong className="text-slate-300">Failure Intelligence</strong> and click{' '}
                    <strong className="text-slate-300">Analyze</strong> on a batch to classify them — the distribution will appear here.
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={failureCategoryData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis type="number" allowDecimals={false} stroke="#64748B" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={150} stroke="#94A3B8" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                    <Bar dataKey="value" name="Failures" fill="#F43F5E" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      <WorkersModal
        open={workersModalOpen}
        title="Run Full Regression Suite"
        description="Pick the browsers (overrides playwright.config.ts) and parallel workers for this batch."
        confirmLabel="Start Regression Run"
        defaultWorkers={4}
        onConfirm={(workers, browsers) => {
          setWorkersModalOpen(false);
          onQuickRun(workers, browsers);
        }}
        onClose={() => setWorkersModalOpen(false)}
      />
    </div>
  );
};

interface FlipKpiCardProps {
  label: string;
  icon: React.ReactNode;
  frontValue: string | number;
  frontCaption: string;
  backValue: string | number;
  backCaption: string;
  /** Entrance delay for the stagger animation (ms). */
  delayMs?: number;
}

const FlipKpiCard: React.FC<FlipKpiCardProps> = ({ label, icon, frontValue, frontCaption, backValue, backCaption, delayMs = 0 }) => (
  <div
    className="kpi-flip h-28 pacc-lift pacc-animate-in"
    style={{ animationDelay: `${delayMs}ms` }}
    tabIndex={0}
    role="group"
    aria-label={`${label}: latest ${frontValue}, all-time ${backValue}`}
  >
    <div className="kpi-flip-inner">
      {/* Front — latest execution */}
      <div className="kpi-flip-face bg-pw-panel border border-pw-border p-3 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 text-[11px] leading-none text-slate-400">
          <span className="flex items-center gap-1.5 min-w-0" title={label}>
            <span className="shrink-0">{icon}</span>
            <span className="truncate">{label}</span>
          </span>
          <span className="text-[8px] font-bold tracking-widest text-sky-400 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5 shrink-0">
            LATEST
          </span>
        </div>
        <div className="text-2xl font-bold text-white mt-auto leading-none tabular-nums">{frontValue}</div>
        <div className="text-[9px] leading-tight text-slate-500 mt-1 truncate" title={frontCaption}>{frontCaption}</div>
      </div>
      {/* Back — all-time totals */}
      <div className="kpi-flip-face kpi-flip-back bg-pw-navy border border-sky-900/60 p-3 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 text-[11px] leading-none text-slate-400">
          <span className="flex items-center gap-1.5 min-w-0" title={label}>
            <span className="shrink-0">{icon}</span>
            <span className="truncate">{label}</span>
          </span>
          <span className="text-[8px] font-bold tracking-widest text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 rounded px-1.5 py-0.5 shrink-0">
            ALL TIME
          </span>
        </div>
        <div className="text-2xl font-bold text-sky-100 mt-auto leading-none tabular-nums">{backValue}</div>
        <div className="text-[9px] leading-tight text-slate-500 mt-1 truncate" title={backCaption}>{backCaption}</div>
      </div>
    </div>
  </div>
);
