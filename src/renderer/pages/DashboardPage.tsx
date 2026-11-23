import React from 'react';
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
import { Play, AlertTriangle, CheckCircle2, Clock, Activity, ExternalLink, RefreshCw } from 'lucide-react';
import { DiscoveredTest, ExecutionBatch, FailureAnalysisRecord, ProjectConfig } from '@shared/types';

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
      name: b.id.slice(-6),
      passPct: b.totalTests > 0 ? Math.round((b.passed / b.totalTests) * 100) : 0,
      passed: b.passed,
      failed: b.failed,
      skipped: b.skipped,
      durationSec: Number((b.durationMs / 1000).toFixed(1)),
    }));

  const folderCounts = tests.reduce<Record<string, { folder: string; passed: number; failed: number; total: number }>>(
    (acc, t) => {
      const f = t.folderPath.split('/').pop() || t.folderPath;
      if (!acc[f]) acc[f] = { folder: f, passed: 0, failed: 0, total: 0 };
      acc[f].total += 1;
      if (t.lastStatus === 'passed') acc[f].passed += 1;
      if (t.lastStatus === 'failed' || t.lastStatus === 'timedOut') acc[f].failed += 1;
      return acc;
    },
    {}
  );
  const folderChartData = Object.values(folderCounts);

  const categoryCounts = failures.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});
  const failureCategoryData = Object.entries(categoryCounts).map(([name, value]) => ({ name, value }));

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
            onClick={onRefresh}
            title="Refresh Dashboard Telemetry"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {latest && (
            <button
              onClick={() => window.pwControlCenter.openReportInBrowser(latest.htmlReportPath)}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
              Latest Batch Breakdown ({latest?.id}) — {latest?.passed} Passed / {latest?.failed} Failed
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

          {/* Chart 4: Folder-wise Coverage & Failure Distribution */}
          <div className="bg-pw-panel border border-pw-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              {failureCategoryData.length > 0 ? 'AI Failure Category Distribution' : 'Folder-Wise Test Status'}
            </h3>
            <div className="h-60">
              {failureCategoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={failureCategoryData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis type="number" stroke="#64748B" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={135} stroke="#94A3B8" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                    <Bar dataKey="value" fill="#F43F5E" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={folderChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="folder" stroke="#64748B" fontSize={11} />
                    <YAxis stroke="#64748B" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="passed" name="Passed" fill="#10B981" />
                    <Bar dataKey="failed" name="Failed" fill="#F43F5E" />
                    <Bar dataKey="total" name="Discovered" fill="#38BDF8" />
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
