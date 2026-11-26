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
  Download,
  Timer,
  FlaskConical,
  Gauge,
  CheckCircle2,
  Wand2,
  Undo2,
} from 'lucide-react';
import {
  ImprovementAdvisorResult,
  ImprovementIssue,
  ImprovementSeverity,
  ImprovementCategory,
  ProjectConfig,
  TestImprovementAdvice,
  AdviceFix,
  ApplyFixResult,
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

function buildExportMarkdown(data: ImprovementAdvisorResult): string {
  const lines: string[] = [
    '# Test Improvement Report',
    `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
    `Signals: static analysis of the imported project source (no execution data) · ${data.scannedFiles} spec files scanned · ${data.analyzedCount} test blocks`,
    `Analyzed: ${data.analyzedCount} tests · Flagged: ${data.summary.flaggedTests} · Critical: ${data.summary.critical} · Warning: ${data.summary.warning} · Info: ${data.summary.info}`,
    `Estimated saving per run: ${formatSaving(data.summary.totalEstimatedTimeSavedMs)}`,
    '',
  ];
  for (const t of data.tests) {
    lines.push(`## ${t.testTitle}`);
    lines.push(`\`${t.relativePath}:${t.line}\` — score ${t.score}`);
    for (const i of t.issues) {
      lines.push(`- [${i.severity.toUpperCase()}] ${i.title}`);
      lines.push(`  - Why: ${i.detail}`);
      lines.push(`  - Recommendation: ${i.recommendation}`);
      if (i.fix) {
        if (i.fix.replacements?.length) {
          for (const part of i.fix.replacements) {
            lines.push(`  - Replace: \`${part.before.replace(/\n/g, '` ⏎ `')}\``);
            lines.push(`  - With:    \`${part.after.replace(/\n/g, '` ⏎ `')}\``);
          }
        } else if (i.fix.before && i.fix.after) {
          lines.push(`  - Replace: \`${i.fix.before.replace(/\n/g, '` ⏎ `')}\``);
          lines.push(`  - With:    \`${i.fix.after.replace(/\n/g, '` ⏎ `')}\``);
        } else if (i.fix.after) {
          lines.push(`  - Add after the final action: \`${i.fix.after.replace(/\n/g, '` ⏎ `')}\``);
        }
        if (i.fix.note) lines.push(`  - Note: ${i.fix.note}`);
      }
      lines.push(`  - Impact if implemented: ${i.impact}`);
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
  const [manualRefresh, setManualRefresh] = useState(0);
  /** Fixes applied this session (newest first) — drives the Undo banner. */
  const [applications, setApplications] = useState<Array<{ id: string; relativePath: string; title: string }>>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

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

  const applyFix = useCallback(
    async (advice: TestImprovementAdvice, issue: ImprovementIssue): Promise<ApplyFixResult> => {
      if (!project) return { ok: false, message: 'No project selected.' };
      const fix = issue.fix;
      if (!fix) return { ok: false, message: 'No fix payload on this issue.' };
      setApplyError(null);
      try {
        const res: ApplyFixResult = await window.pwControlCenter.applyAdvisorFix({
          projectId: project.id,
          relativePath: advice.relativePath,
          testFullTitle: advice.testTitle,
          issueId: issue.id,
          fix,
        });
        if (res?.ok) {
          setApplications((prev) => [
            { id: res.applicationId!, relativePath: advice.relativePath, title: issue.title },
            ...prev,
          ]);
          setManualRefresh((n) => n + 1); // finding should disappear on the fresh analysis
        } else {
          return { ok: false, message: res?.message || 'The fix was refused.' };
        }
        return res;
      } catch (err: any) {
        return { ok: false, message: err?.message || 'Apply failed.' };
      }
    },
    [project?.id]
  );

  const revertApplication = useCallback(
    async (application: { id: string; relativePath: string; title: string }) => {
      setApplyError(null);
      try {
        const res = await window.pwControlCenter.revertAdvisorFix(application.id);
        if (res?.ok) {
          setApplications((prev) => prev.filter((a) => a.id !== application.id));
          setManualRefresh((n) => n + 1); // issue returns after restore
        } else {
          setApplyError(res?.message || 'Revert failed.');
        }
      } catch (err: any) {
        setApplyError(err?.message || 'Revert failed.');
      }
    },
    []
  );

  const exportReport = () => {
    if (!data) return;
    const blob = new Blob([buildExportMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `test-improvement-report-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
            Statically reviews every spec inside your imported project — a local folder or a repository cloned from
            any version-control host — against Playwright best practices: hard waits, brittle locators, missing
            assertions, focused tests. Deterministic: no AI calls, no execution history — import and it knows.
            Every finding ships the exact code change; apply it to the spec with one click (a backup is kept).
          </p>
          <p className="text-[10px] mt-1.5 inline-flex items-center gap-1.5 font-semibold text-sky-300/90 bg-sky-500/10 border border-sky-500/25 rounded-md px-2 py-0.5">
            <FlaskConical className="w-3 h-3" />
            {data
              ? `Source-only analysis — ${data.scannedFiles} spec files scanned · ${data.analyzedCount} test blocks`
              : 'Source-only analysis — works on any imported project, no run needed'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={exportReport}
            disabled={!data || data.tests.length === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download a Markdown report — share it with the team"
          >
            <Download className="w-3.5 h-3.5" />
            Export report (.md)
          </button>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setManualRefresh((n) => n + 1)}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {loading ? 'Analyzing…' : 'Re-analyze'}
            </button>
            {data && (
              <span className="text-[9px] text-slate-500 tabular-nums">
                Last analyzed {new Date(data.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
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

      {applyError && (
        <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center justify-between gap-3">
          <span>{applyError}</span>
          <button onClick={() => setApplyError(null)} className="text-rose-200 hover:text-white font-semibold">Dismiss</button>
        </div>
      )}

      {applications.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Wrote to spec this session ({applications.length})
          </div>
          {applications.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 text-[11px] text-emerald-100/90">
              <span className="truncate min-w-0" title={a.title}>
                <span className="font-mono text-emerald-300">{a.relativePath}</span> — {a.title}
              </span>
              <button
                onClick={() => revertApplication(a)}
                title="Restore the exact original file contents (byte-identical)"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 font-semibold text-[10px]"
              >
                <Undo2 className="w-3 h-3" /> Undo
              </button>
            </div>
          ))}
        </div>
      )}

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

      <div className={`space-y-3 transition-opacity duration-200 ${loading ? 'opacity-50 pointer-events-none' : ''}`} aria-busy={loading}>
        {visibleTests.map((advice, idx) => (
          <AdviceCard
            key={advice.testId}
            rank={idx + 1}
            advice={advice}
            expanded={expandedId === advice.testId}
            onToggle={() => setExpandedId((prev) => (prev === advice.testId ? null : advice.testId))}
            onApplyFix={applyFix}
          />
        ))}
      </div>

      {data && data.tests.length > 0 && (
        <p className="text-[10px] text-slate-600 flex items-center gap-1.5 pt-1">
          <Gauge className="w-3.5 h-3.5" />
          Ranked by improvement score — critical 50 pts · warning 18 pts · info 5 pts, tie-broken by estimated time
          saved. Signals: spec source only ({data.scannedFiles} files · {data.analyzedCount} tests). Prepared{' '}
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
  onApplyFix: (advice: TestImprovementAdvice, issue: ImprovementIssue) => Promise<ApplyFixResult>;
}> = ({ rank, advice, expanded, onToggle, onApplyFix }) => {
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
              <span className="px-2 py-1 rounded-md bg-slate-800/70 border border-pw-border text-slate-300 font-mono">
                score {advice.score}
              </span>
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
            <IssueRow key={issue.id} issue={issue} advice={advice} onApplyFix={onApplyFix} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ── One issue ────────────────────────────────────────────────────────────── */
const IssueRow: React.FC<{
  issue: ImprovementIssue;
  advice: TestImprovementAdvice;
  onApplyFix: (advice: TestImprovementAdvice, issue: ImprovementIssue) => Promise<ApplyFixResult>;
}> = ({ issue, advice, onApplyFix }) => {
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
        {issue.fix && <FixBlock fix={issue.fix} issue={issue} advice={advice} onApplyFix={onApplyFix} />}
      </div>
    </div>
  );
};

/* ── Exact before → after code change + one-click Apply ───────────────────── */
const FixBlock: React.FC<{
  fix: AdviceFix;
  issue: ImprovementIssue;
  advice: TestImprovementAdvice;
  onApplyFix: (advice: TestImprovementAdvice, issue: ImprovementIssue) => Promise<ApplyFixResult>;
}> = ({ fix, issue, advice, onApplyFix }) => {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pairs: Array<{ before?: string; after: string }> = fix.replacements?.length
    ? fix.replacements.map((part) => ({ before: part.before, after: part.after }))
    : fix.after !== undefined
    ? [{ before: fix.before, after: fix.after }]
    : [];
  const applicable = pairs.some((pair) => !!pair.before) || fix.insertAtEndOfTest === true;

  const lines = (text?: string) => (text ? text.split('\n') : []);
  const Minus = ({ line }: { line: string }) => (
    <div className="flex gap-2 bg-rose-500/10 border-l-2 border-rose-500/60 px-2 py-0.5 text-rose-200 whitespace-pre-wrap break-all rounded-sm">
      <span className="text-rose-400 select-none">-</span>
      <span>{line}</span>
    </div>
  );
  const Plus = ({ line }: { line: string }) => (
    <div className="flex gap-2 bg-emerald-500/10 border-l-2 border-emerald-500/60 px-2 py-0.5 text-emerald-200 whitespace-pre-wrap break-all rounded-sm">
      <span className="text-emerald-400 select-none">+</span>
      <span>{line}</span>
    </div>
  );

  const confirmApply = async () => {
    setBusy(true);
    setError(null);
    const res = await onApplyFix(advice, issue);
    setBusy(false);
    if (res.ok) {
      setConfirming(false);
    } else {
      setError(res.message || 'The fix was refused.');
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-violet-500/25 bg-violet-500/5 overflow-hidden">
      <div className="px-2.5 pt-2 flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-violet-300">
          {fix.insertAtEndOfTest ? 'Additive change' : fix.replacements?.length ? 'Exact changes to apply' : 'Exact change to apply'}
        </span>
        {applicable && !confirming && (
          <button
            onClick={() => { setConfirming(true); setError(null); }}
            title={`Write this change into ${advice.relativePath}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold"
          >
            <Wand2 className="w-3 h-3" /> Apply fix
          </button>
        )}
      </div>

      <div className="p-2 font-mono text-[10px] leading-relaxed overflow-x-auto">
        {pairs.map((pair, i) => (
          <React.Fragment key={i}>
            {pairs.length > 1 && (
              <div className="text-[8px] uppercase tracking-widest text-violet-400/70 px-1 pb-0.5 pt-1 first:pt-0 select-none">
                change {i + 1} of {pairs.length}
              </div>
            )}
            {lines(pair.before).map((line, j) => <Minus key={`b-${j}`} line={line} />)}
            {lines(pair.after).map((line, j) => <Plus key={`a-${j}`} line={line} />)}
          </React.Fragment>
        ))}
      </div>

      {fix.note && <p className="px-2.5 pb-2 text-[9px] text-violet-200/70 leading-snug">{fix.note}</p>}

      {!applicable && (
        <p className="px-2.5 pb-2 text-[9px] text-slate-500 leading-snug border-t border-violet-500/10 pt-1.5">
          Structural restructure — no single safe mechanical edit, apply it by hand (the steps above are the script).
        </p>
      )}

      {confirming && (
        <div className="border-t border-violet-500/20 bg-violet-500/10 px-2.5 py-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-violet-100/90">
            Write {pairs.length > 1 ? `${pairs.length} changes` : 'this change'} into{' '}
            <span className="font-mono text-violet-200">{advice.relativePath}</span>? The original file is backed up in the app (Undo available after applying).
          </span>
          <button
            onClick={confirmApply}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {busy ? 'Applying…' : 'Confirm & write'}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={busy}
            className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="px-2.5 py-1.5 text-[9px] text-rose-300 bg-rose-500/10 border-t border-rose-500/20">{error}</p>}
    </div>
  );
};
