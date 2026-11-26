import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  Info,
  Activity,
  Zap,
  Wrench,
  ShieldCheck,
  Target,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Timer,
  FlaskConical,
  Gauge,
} from 'lucide-react';
import {
  ImprovementAdvisorResult,
  ImprovementIssue,
  ImprovementSeverity,
  ImprovementCategory,
  ProjectConfig,
  TestImprovementAdvice,
} from '@shared/types';

const SEVERITY_META: Record<ImprovementSeverity, { label: string; chip: string; stripe: string; icon: React.ReactNode }> = {
  critical: {
    label: 'Critical',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    stripe: 'bg-rose-500',
    icon: <AlertOctagon className="w-4 h-4 text-rose-400" />,
  },
  warning: {
    label: 'Warning',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    stripe: 'bg-amber-400',
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  info: {
    label: 'Info',
    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    stripe: 'bg-sky-400',
    icon: <Info className="w-4 h-4 text-sky-400" />,
  },
};

const CATEGORY_ICON: Record<ImprovementCategory, React.ReactNode> = {
  flakiness: <Activity className="w-3.5 h-3.5" />,
  performance: <Zap className="w-3.5 h-3.5" />,
  maintainability: <Wrench className="w-3.5 h-3.5" />,
  reliability: <ShieldCheck className="w-3.5 h-3.5" />,
  coverage: <Target className="w-3.5 h-3.5" />,
};

const severityWeight: Record<ImprovementSeverity, number> = { critical: 3, warning: 2, info: 1 };

const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
};

const formatSaving = (ms: number): string => {
  if (ms <= 0) return '0s';
  return ms >= 1000 ? `~${(ms / 1000).toFixed(1)}s` : `~${Math.round(ms)}ms`;
};

function buildMarkdownReport(data: ImprovementAdvisorResult): string {
  const lines: string[] = [
    '# Test Improvement Report',
    `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
    `Analyzed: ${data.analyzedCount} tests · Flagged: ${data.summary.flaggedTests} · Critical: ${data.summary.critical} · Warning: ${data.summary.warning}`,
    `Estimated saving per run: ${formatSaving(data.summary.totalEstimatedTimeSavedMs)}`,
    '',
  ];
  for (const t of data.tests) {
    lines.push(`## ${t.testTitle}`);
    lines.push(`${t.relativePath}:${t.line}`);
    for (const i of t.issues) {
      lines.push(`- [${i.severity.toUpperCase()}] ${i.title}`);
      lines.push(`  - Fix: ${i.recommendation}`);
      lines.push(`  - Impact: ${i.impact}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const TestAdvisorPage: React.FC<{
  project: ProjectConfig | null;
  /** Bumped by the app whenever an execution batch completes. */
  refreshKey?: number;
}> = ({ project, refreshKey = 0 }) => {
  const [data, setData] = useState<ImprovementAdvisorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<'all' | ImprovementSeverity>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    setError(null);
    window.pwControlCenter
      .getImprovementAdvisor(project.id)
      .then((result: ImprovementAdvisorResult) => setData(result))
      .catch((err: any) => {
        console.error('[ControlCenter] Improvement advisor failed:', err);
        setError(err?.message || 'Failed to analyze this project.');
      })
      .finally(() => setLoading(false));
  }, [project?.id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, refreshKey, manualRefresh]);

  const visibleTests = useMemo(() => {
    if (!data) return [];
    if (severityFilter === 'all') return data.tests;
    return data.tests.filter((t) => t.issues.some((i) => i.severity === severityFilter));
  }, [data, severityFilter]);

  const copyReport = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(buildMarkdownReport(data));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (!project) {
    return <div className="p-8 text-slate-400">Import a project first.</div>;
  }

  const summary = data?.summary;

  return (
    <div className="p-6 space-y-5 max-w-[1200px]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            Test Improvement Advisor
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Statically reviews every discovered test against Playwright best practices and cross-checks runtime
            telemetry — hard waits, brittle locators, missing assertions, retry burns — then ranks the tests where a
            fix pays off most. Deterministic: no AI calls, fully reproducible.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copyReport}
            disabled={!data || data.tests.length === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copy a Markdown report of all flagged tests"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy report'}
          </button>
          <button
            onClick={() => setManualRefresh((n) => n + 1)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-analyze
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">{error}</div>
      )}

      {/* ── Summary tiles ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          icon={<FlaskConical className="w-4 h-4 text-violet-300" />}
          label="Tests analyzed"
          value={data ? String(data.analyzedCount) : '—'}
          sub={summary ? `${summary.flaggedTests} need work` : 'awaiting first scan'}
          tone="violet"
        />
        <SummaryTile
          icon={<AlertOctagon className="w-4 h-4 text-rose-300" />}
          label="Critical"
          value={summary ? String(summary.critical) : '—'}
          sub="fix before trusting the suite"
          tone="rose"
        />
        <SummaryTile
          icon={<AlertTriangle className="w-4 h-4 text-amber-300" />}
          label="Warnings"
          value={summary ? String(summary.warning) : '—'}
          sub={summary ? `${summary.info} info notes` : '—'}
          tone="amber"
        />
        <SummaryTile
          icon={<Timer className="w-4 h-4 text-emerald-300" />}
          label="Potential saving"
          value={summary ? formatSaving(summary.totalEstimatedTimeSavedMs) : '—'}
          sub="per full suite run"
          tone="emerald"
        />
      </div>

      {/* ── Severity filter ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-500 font-semibold uppercase tracking-wide">Show:</span>
        {(['all', 'critical', 'warning', 'info'] as const).map((sev) => {
          const active = severityFilter === sev;
          const count =
            sev === 'all'
              ? data?.tests.length ?? 0
              : data?.tests.filter((t) => t.issues.some((i) => i.severity === sev)).length ?? 0;
          return (
            <button
              key={sev}
              onClick={() => setSeverityFilter(sev)}
              className={`px-2.5 py-1 rounded-full border font-semibold transition-colors ${
                active
                  ? 'bg-violet-500/20 border-violet-500/50 text-violet-200'
                  : 'border-pw-border text-slate-400 hover:text-slate-100'
              }`}
            >
              {sev === 'all' ? 'All flagged' : SEVERITY_META[sev].label} ({count})
            </button>
          );
        })}
      </div>

      {/* ── Ranked findings ────────────────────────────────────────────────── */}
      {loading && !data && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="pacc-shimmer h-24 border border-pw-border" />
          ))}
        </div>
      )}

      {!loading && data && visibleTests.length === 0 && (
        <div className="p-10 text-center border border-emerald-500/30 rounded-2xl bg-emerald-500/5">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h2 className="text-base font-bold text-emerald-300">Nothing to flag</h2>
          <p className="text-xs text-slate-400 mt-1">
            {severityFilter === 'all'
              ? 'Every analyzed spec follows the checked automation standards. Nice work.'
              : `No ${severityFilter} findings — try a different filter.`}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visibleTests.map((advice, idx) => (
          <AdviceCard
            key={advice.testId}
            rank={idx + 1}
            advice={advice}
            expanded={expandedId === advice.testId}
            onToggle={() => setExpandedId((prev) => (prev === advice.testId ? null : advice.testId))}
          />
        ))}
      </div>

      {data && data.tests.length > 0 && (
        <p className="text-[10px] text-slate-600 flex items-center gap-1.5 pt-1">
          <Gauge className="w-3.5 h-3.5" />
          Ranked by improvement score — critical 50 pts · warning 18 pts · info 5 pts, tie-broken by estimated time
          saved. Signals: spec source ({data.analyzedCount} files scanned) + run telemetry. Prepared{' '}
          {new Date(data.generatedAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
};

/* ── Summary tile ─────────────────────────────────────────────────────────── */
const toneClasses: Record<string, string> = {
  violet: 'border-violet-500/30',
  rose: 'border-rose-500/30',
  amber: 'border-amber-500/30',
  emerald: 'border-emerald-500/30',
};

const SummaryTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}> = ({ icon, label, value, sub, tone }) => (
  <div className={`pacc-lift bg-pw-panel border ${toneClasses[tone] || 'border-pw-border'} rounded-xl p-4`}>
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-bold text-white mt-2 tabular-nums leading-none">{value}</div>
    <div className="text-[10px] text-slate-500 mt-1.5">{sub}</div>
  </div>
);

/* ── One flagged test ─────────────────────────────────────────────────────── */
const AdviceCard: React.FC<{
  rank: number;
  advice: TestImprovementAdvice;
  expanded: boolean;
  onToggle: () => void;
}> = ({ rank, advice, expanded, onToggle }) => {
  const worst = advice.issues.reduce<ImprovementSeverity>(
    (acc, i) => (severityWeight[i.severity] > severityWeight[acc] ? i.severity : acc),
    'info'
  );
  const meta = SEVERITY_META[worst];

  return (
    <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden pacc-animate-in">
      <button onClick={onToggle} className="w-full text-left flex items-stretch" aria-expanded={expanded}>
        <div className={`w-1.5 shrink-0 ${meta.stripe}`} />
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono font-bold text-slate-600 w-6 shrink-0">#{rank}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-100 truncate" title={advice.testTitle}>
                {advice.testTitle}
              </div>
              <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5" title={`${advice.relativePath}:${advice.line}`}>
                {advice.relativePath}:{advice.line}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0 text-[10px]">
              <MetaChip label="avg" value={advice.avgDurationMs !== null ? formatMs(advice.avgDurationMs) : '—'} />
              <MetaChip label="flaky" value={`${advice.flakinessRate}%`} tone={advice.flakinessRate >= 30 ? 'rose' : advice.flakinessRate >= 10 ? 'amber' : undefined} />
              <MetaChip label="retries" value={String(advice.retryCount)} tone={advice.retryCount > 0 ? 'amber' : undefined} />
              {advice.estimatedTimeSavedMs > 0 && (
                <span className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold">
                  save {formatSaving(advice.estimatedTimeSavedMs)}/run
                </span>
              )}
            </div>
            <span className="shrink-0 text-slate-500">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
          </div>
          {!expanded && (
            <div className="mt-2 ml-9 flex items-center gap-2 text-[10px] text-slate-400 min-w-0">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${meta.chip} font-semibold shrink-0`}>
                {advice.issues.length} issue{advice.issues.length === 1 ? '' : 's'}
              </span>
              <span className="truncate">{advice.issues[0]?.title}</span>
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-pw-border/70 divide-y divide-pw-border/50">
          {advice.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
};

const MetaChip: React.FC<{ label: string; value: string; tone?: 'rose' | 'amber' }> = ({ label, value, tone }) => (
  <span
    className={`px-2 py-1 rounded-md border font-mono ${
      tone === 'rose'
        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        : tone === 'amber'
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
        : 'bg-slate-800/70 border-pw-border text-slate-300'
    }`}
  >
    <span className="text-slate-500">{label} </span>
    {value}
  </span>
);

/* ── One issue ────────────────────────────────────────────────────────────── */
const IssueRow: React.FC<{ issue: ImprovementIssue }> = ({ issue }) => {
  const sev = SEVERITY_META[issue.severity];
  return (
    <div className="p-4 pl-6 flex gap-3">
      <div className="pt-0.5 shrink-0">{sev.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${sev.chip}`}>
            {sev.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {CATEGORY_ICON[issue.category]}
            {issue.category}
          </span>
          {issue.line && <span className="text-[9px] font-mono text-slate-600">line {issue.line}</span>}
          {issue.estimatedTimeSavedMs ? (
            <span className="text-[9px] font-semibold text-emerald-400">{formatSaving(issue.estimatedTimeSavedMs)} / run</span>
          ) : null}
        </div>
        <h3 className="text-xs font-semibold text-slate-100 mt-1.5">{issue.title}</h3>
        <p className="text-[11px] text-slate-400 mt-1">{issue.detail}</p>
        {issue.code && (
          <pre className="mt-2 inline-block max-w-full overflow-x-auto text-[10px] font-mono text-amber-200/90 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
            {issue.code}
          </pre>
        )}
        <div className="mt-2 grid md:grid-cols-2 gap-2">
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-sky-400 mb-1">Recommendation</div>
            <p className="text-[11px] text-sky-100/90 leading-snug">{issue.recommendation}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 mb-1">Impact if implemented</div>
            <p className="text-[11px] text-emerald-100/90 leading-snug">{issue.impact}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
