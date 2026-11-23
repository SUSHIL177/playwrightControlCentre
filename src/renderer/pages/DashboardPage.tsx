import React, { useState } from 'react';
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
import { Play, AlertTriangle, CheckCircle2, Clock, Activity, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { DiscoveredTest, ExecutionBatch, FailureAnalysisRecord, ProjectConfig } from '@shared/types';
import { batchAxisLabel, batchShortLabel } from '../utils/batchFormat';
interface DashboardPageProps {
  project: ProjectConfig | null;
  tests: DiscoveredTest[];
  batches: ExecutionBatch[];
  failures: FailureAnalysisRecord[];
  onQuickRun: () => void;
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

  if (!project) {
    return (
      <div className="p-8 text-center text-slate-400">
        Import a local Playwright project in <strong className="text-sky-400">Project Configuration</strong> to view real analytics.
      </div>
    );
  }

  const latest = batches[0];
  const totalExecuted = batches.reduce((s, b) => s + b.totalTests, 0);
  const totalPassed = batches.reduce((s, b) => s + b.passed, 0);
  const totalFailed = batches.reduce((s, b) => s + b.failed, 0);
  const totalSkipped = batches.reduce((s, b) => s + b.skipped, 0);
  const totalFlaky = batches.reduce((s, b) => s + b.flaky, 0);
  const passRate = totalExecuted > 0 ? Math.round((totalPassed / totalExecuted) * 100) : 0;
  const avgDurationSec =
    batches.length > 0
      ? (batches.reduce((s, b) => s + b.durationMs, 0) / batches.length / 1000).toFixed(1)
      : '0.0';

  const donutData = [
    { name: 'Passed', value: latest?.passed || 0, color: '#10B981' },
    { name: 'Failed', value: latest?.failed || 0, color: '#F43F5E' },
    { name: 'Skipped', value: latest?.skipped || 0, color: '#64748B' },
    { name: 'Flaky', value: latest?.flaky || 0, color: '#F59E0B' },
  ].filter((d) => d.value > 0);

  const trendData = [...batches]
    .slice(0, 12)
    .reverse()
    .map((b) => ({
      name: batchAxisLabel(b),
      passPct: b.totalTests > 0 ? Math.round((b.passed / b.totalTests) * 100) : 0,
      passed: b.passed,
      failed: b.failed,
      skipped: b.skipped,
      durationSec: Number((b.durationMs / 1000).toFixed(1)),
    }));

  const categoryCounts = failures.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});
  const failureCategoryData = Object.entries(categoryCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

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
            onClick={onQuickRun}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Discovered Tests" value={tests.length} icon={<CheckCircle2 className="w-4 h-4 text-sky-400" />} />
        <KpiCard label="Total Passed" value={totalPassed} icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />} />
        <KpiCard label="Total Failed" value={totalFailed} icon={<AlertTriangle className="w-4 h-4 text-rose-400" />} />
        <KpiCard label="Pass Rate" value={`${passRate}%`} icon={<Activity className="w-4 h-4 text-emerald-400" />} />
        <KpiCard label="Flaky / Skipped" value={`${totalFlaky} / ${totalSkipped}`} icon={<Activity className="w-4 h-4 text-amber-400" />} />
        <KpiCard label="Avg Duration" value={`${avgDurationSec}s`} icon={<Clock className="w-4 h-4 text-indigo-400" />} />
      </div>

      {batches.length === 0 ? (
        <div className="bg-pw-panel border border-pw-border rounded-xl p-8 text-center text-sm text-slate-400">
          No executions recorded yet for <strong className="text-white">{project.name}</strong>. Click{' '}
          <strong className="text-emerald-400">Run Full Regression</strong> or open the{' '}
          <strong className="text-sky-400">Test Explorer</strong> to execute real Playwright tests.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Latest Batch Donut */}
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

          {/* Chart 2: Batch Results Stacked Bar */}
          <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Execution Batch Results (Passed vs Failed)
            </h3>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="passed" name="Passed" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" fill="#F43F5E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: Pass Percentage & Duration Trend */}
          <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Pass Percentage Trend (%)
            </h3>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
                  <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="passPct" name="Pass %" stroke="#38BDF8" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Failure Category Distribution (always shown; fed by analyzed failures) */}
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
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string | number; icon: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
    <div className="flex items-center justify-between text-xs text-slate-400">
      <span>{label}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold text-white mt-2">{value}</div>
  </div>
);
