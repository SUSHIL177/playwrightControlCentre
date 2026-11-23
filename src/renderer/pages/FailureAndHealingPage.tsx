import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Wrench, Check, X, RotateCcw, PlayCircle, ShieldAlert,
  ChevronDown, ChevronRight, Terminal, FlaskConical, AlertTriangle,
  Eye, Loader2, Trash2,
} from 'lucide-react';
import { FailureAnalysisRecord, HealingProposal, HealingProgressEvent, NavRoute } from '@shared/types';

interface FailureAndHealingPageProps {
  mode: 'failures' | 'healing' | 'code-fix';
  failures: FailureAnalysisRecord[];
  proposals: HealingProposal[];
  latestBatchId?: string;
  onRefresh: () => Promise<void>;
  /** Switch routes (used to jump to the proposal screen right after generation). */
  onNavigate?: (route: NavRoute) => void;
  /** Launch a headed spec run through the normal execution engine (post-approval). */
  onRunHeadedSpec?: (absoluteSpecPath: string) => void;
}

export const FailureAndHealingPage: React.FC<FailureAndHealingPageProps> = ({
  mode,
  failures,
  proposals,
  latestBatchId,
  onRefresh,
  onNavigate,
  onRunHeadedSpec,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<HealingProposal | null>(proposals[0] || null);
  const [editedCode, setEditedCode] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const [progressLog, setProgressLog] = useState<HealingProgressEvent[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [leftTab, setLeftTab] = useState<'diff' | 'original'>('diff');

  useEffect(() => {
    if (typeof window.pwControlCenter?.onHealingProgress !== 'function') return;
    const unsub = window.pwControlCenter.onHealingProgress((evt) => {
      if (!evt || !evt.message) return;
      setProgressLog((prev) => [...prev.slice(-399), evt]);
    });
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const appendLocal = (message: string) =>
    setProgressLog((prev) => [
      ...prev.slice(-399),
      { phase: 'done', message, stream: 'system', timestamp: new Date().toISOString() },
    ]);

  const handleAnalyzeLatest = async () => {
    if (!latestBatchId) return;
    setBusyId('analyze');
    setActionError(null);
    setProgressLog([]);
    try {
      await window.pwControlCenter.analyzeBatchFailures(latestBatchId);
      await onRefresh();
    } catch (err: any) {
      console.error('[ControlCenter] Failure analysis failed:', err);
      setActionError(err?.message || 'Failure analysis failed. Check the batch logs.');
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateProposal = async (failureId: string) => {
    setBusyId(failureId);
    setActionError(null);
    setProgressLog([]);
    try {
      const p = await window.pwControlCenter.generateHealingProposal(failureId);
      await onRefresh();
      setSelectedProposal(p);
      setEditedCode(p.proposedCode);
      setLogOpen(true);
      // Jump straight to the Self-Healing view — logs stream live there while the
      // background validation (auto-started on generate) runs to completion.
      onNavigate?.('healing');
    } catch (err: any) {
      console.error('[ControlCenter] Proposal generation failed:', err);
      setActionError(err?.message || 'Unable to generate a healing proposal.');
    } finally {
      setBusyId(null);
    }
  };

  const handleHealAll = async () => {
    const eligible = failures.filter((f) => f.healingEligible);
    if (eligible.length === 0 || batchRunning) return;
    const existing = new Set(proposals.map((p) => p.failureId));
    const targets = eligible.filter((f) => !existing.has(f.id));
    const skipped = eligible.length - targets.length;

    setBatchRunning(true);
    setBusyId('heal-all');
    setActionError(null);
    setProgressLog([]);
    appendLocal(
      `Self-Heal All started — ${targets.length} eligible failure(s) to heal and auto-validate` +
        (skipped > 0 ? ` (${skipped} skipped: proposal already exists)` : '') +
        '.'
    );

    let healed = 0;
    let failed = 0;
    for (const f of targets) {
      appendLocal(`▶ ${f.testTitle}`);
      try {
        await window.pwControlCenter.generateHealingProposal(f.id);
        healed += 1;
      } catch (err: any) {
        failed += 1;
        appendLocal(`✗ ${err?.message || 'Unable to heal this failure.'}`);
      }
    }
    appendLocal(
      `Self-Heal All complete — ${healed} fix(es) generated & auto-validated, ${failed} failed${skipped > 0 ? `, ${skipped} already had proposals` : ''}. Review and accept each fix in AI Self-Healing.`
    );
    try {
      await onRefresh();
    } finally {
      setBatchRunning(false);
      setBusyId(null);
    }
    if (healed > 0) onNavigate?.('healing');
  };

  const handleWatchHeaded = async () => {
    if (!active) return;
    setBusyId('headed');
    setActionError(null);
    try {
      const res = await window.pwControlCenter.runProposalHeaded(active.id, editedCode || active.proposedCode);
      appendLocal(
        res?.exitCode === 0
          ? 'Headed run PASSED with the fix applied (spec restored afterwards).'
          : `Headed run finished with exit code ${res?.exitCode ?? 'spawn error'} (spec restored afterwards).`
      );
    } catch (err: any) {
      console.error('[ControlCenter] Headed run failed:', err);
      setActionError(err?.message || 'Headed run failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (mode === 'failures') {
    const eligibleCount = failures.filter((f) => f.healingEligible).length;
    return (
      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">AI Failure Analysis & Root Cause Intelligence</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Differentiates genuine application defects from automation locator, timeout, or infrastructure failures.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {eligibleCount > 0 && (
              <button
                onClick={handleHealAll}
                disabled={batchRunning || busyId !== null}
                title="Generate and auto-validate a fix for every healing-eligible failure"
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-wait text-white text-xs font-semibold flex items-center gap-2"
              >
                {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                {batchRunning ? 'Self-Healing…' : `Self-Heal All Eligible (${eligibleCount})`}
              </button>
            )}
            {latestBatchId && (
              <button
                onClick={handleAnalyzeLatest}
                disabled={busyId === 'analyze' || batchRunning}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {busyId === 'analyze' ? 'Analyzing...' : 'Analyze Latest Batch Failures'}
              </button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
            {actionError}
          </div>
        )}

        {(progressLog.length > 0 || batchRunning) && (
          <ProgressPanel log={progressLog} busy={batchRunning || busyId !== null} onClear={() => setProgressLog([])} />
        )}

        {failures.length === 0 ? (
          <div className="bg-pw-panel border border-pw-border rounded-xl p-8 text-center text-sm text-slate-400">
            No analyzed failure records yet. Execute tests — failures are analyzed automatically after each run — or click{' '}
            <strong className="text-sky-400">Analyze Latest Batch Failures</strong>.
          </div>
        ) : (
          <div className="space-y-4">
            {failures.map((f) => (
              <div key={f.id} className="bg-pw-panel border border-pw-border rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300">
                        {f.category}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-sky-300">
                        {f.classification} ({Math.round(f.confidence * 100)}% confidence)
                      </span>
                    </div>
                    <h3 className="font-bold text-white text-sm mt-2">{f.testTitle}</h3>
                    <p className="text-xs font-mono text-slate-400 break-all">{f.filePath}</p>
                  </div>

                  {f.healingEligible ? (
                    <button
                      onClick={() => handleGenerateProposal(f.id)}
                      disabled={busyId === f.id}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      {busyId === f.id ? 'Generating...' : 'Generate Safe Self-Heal Fix'}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      Protected from Auto-Heal (App/Env Defect)
                    </span>
                  )}
                </div>

                <div className="bg-pw-navy rounded-lg p-3 text-xs space-y-1.5">
                  <div>
                    <span className="text-slate-400 font-semibold">Probable Root Cause: </span>
                    <span className="text-slate-200">{f.probableRootCause}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold">Recommended Action: </span>
                    <span className="text-emerald-300">{f.recommendedAction}</span>
                  </div>
                  <pre className="mt-2 p-2.5 bg-black/50 rounded text-rose-300 font-mono text-[11px] overflow-x-auto">
                    {f.errorMessage}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = selectedProposal || proposals[0] || null;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">AI Self-Healing & Code Fix Approval Center</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Candidate fixes are validated automatically against the real spec before you review them. Approving makes a backup
          and writes the fix — or watch the run headed before deciding. Rollback restores the backup anytime.
        </p>
      </div>

      {actionError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {actionError}
        </div>
      )}

      <ProgressPanel log={progressLog} busy={busyId !== null} onClear={() => setProgressLog([])} />

      {!active ? (
        <div className="bg-pw-panel border border-pw-border rounded-xl p-8 text-center text-sm text-slate-400">
          No healing proposals generated yet. Generate a fix from <strong className="text-sky-400">Failure Intelligence</strong>.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="space-y-2">
            {proposals.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setSelectedProposal(p);
                  setEditedCode(p.proposedCode);
                }}
                className={`p-3 rounded-lg border cursor-pointer text-xs ${
                  active.id === p.id ? 'bg-sky-500/15 border-sky-500' : 'bg-pw-panel border-pw-border'
                }`}
              >
                <div className="font-semibold text-white truncate">{p.testTitle}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Status: <span className="text-amber-300 uppercase">{p.status}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-3 bg-pw-panel border border-pw-border rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-white text-sm">{active.testTitle}</h3>
                <p className="text-xs text-sky-300 mt-0.5">{active.explanation}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    setBusyId('validate');
                    setActionError(null);
                    setProgressLog([]);
                    try {
                      const updated = await window.pwControlCenter.validateProposal(active.id, editedCode || active.proposedCode);
                      setSelectedProposal(updated);
                      await onRefresh();
                    } catch (err: any) {
                      console.error('[ControlCenter] Validation failed:', err);
                      setActionError(err?.message || 'Validation run failed.');
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  {busyId === 'validate' ? 'Validating...' : 'Re-validate (edited code)'}
                </button>

                {active.status === 'approved' ? (
                  <button
                    onClick={() => onRunHeadedSpec?.(active.targetFilePath)}
                    disabled={busyId !== null}
                    title="Launch the healed spec in a headed browser through the execution engine"
                    className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Run Headed
                  </button>
                ) : (
                  <button
                    onClick={handleWatchHeaded}
                    disabled={busyId !== null}
                    title="Write the candidate fix to the spec, run it in a HEADED browser, then restore the file — nothing is saved"
                    className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    {busyId === 'headed' ? 'Watching...' : 'Watch Headed (tentative)'}
                  </button>
                )}

                <button
                  onClick={async () => {
                    setActionError(null);
                    try {
                      const updated = await window.pwControlCenter.approveAndApplyProposal(
                        active.id,
                        editedCode || active.proposedCode
                      );
                      setSelectedProposal(updated);
                      await onRefresh();
                    } catch (err: any) {
                      console.error('[ControlCenter] Apply failed:', err);
                      setActionError(err?.message || 'Failed to apply the proposed fix.');
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Approve & Apply
                </button>

                {active.status === 'approved' && (
                  <button
                    onClick={async () => {
                      setActionError(null);
                      try {
                        const updated = await window.pwControlCenter.rollbackProposal(active.id);
                        setSelectedProposal(updated);
                        await onRefresh();
                      } catch (err: any) {
                        console.error('[ControlCenter] Rollback failed:', err);
                        setActionError(err?.message || 'Failed to roll back the applied fix.');
                      }
                    }}
                    className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Rollback
                  </button>
                )}

                <button
                  onClick={async () => {
                    setActionError(null);
                    try {
                      await window.pwControlCenter.rejectProposal(active.id);
                      await onRefresh();
                    } catch (err: any) {
                      console.error('[ControlCenter] Reject failed:', err);
                      setActionError(err?.message || 'Failed to reject the proposal.');
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 text-xs font-semibold flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-pw-border bg-pw-navy/60 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <FlaskConical className="w-4 h-4 text-indigo-300" />
                {active.validationStatus === 'validated_pass' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold">
                    <Check className="w-3 h-3" /> VALIDATION PASSED
                  </span>
                ) : active.validationStatus === 'validated_fail' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold">
                    <X className="w-3 h-3" /> VALIDATION FAILED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-pw-border text-[11px] font-bold">
                    NOT VALIDATED YET
                  </span>
                )}
                <span className="text-[10px] text-slate-500">
                  Proposal generated by the deterministic local healing engine (no external AI model). Validation runs the
                  target spec through the project's local Playwright CLI with <code className="text-slate-400">--workers=1 --retries=0</code>;
                  on failure the spec file is restored automatically.
                </span>
              </div>

              {active.validationLog && (
                <div>
                  <button
                    onClick={() => setLogOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    {logOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <Terminal className="w-3.5 h-3.5" /> Validation Log ({active.validationLog.length.toLocaleString()} chars)
                  </button>
                  {logOpen && (
                    <pre className="mt-2 max-h-64 overflow-auto text-[10px] leading-snug font-mono text-slate-300 bg-black/60 border border-pw-border/60 rounded-lg p-3 whitespace-pre-wrap break-words">
                      {active.validationLog}
                    </pre>
                  )}
                  {active.validationLog.includes('CRITICAL: failed to restore') && (
                    <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-500/50 text-rose-300 text-[11px]">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      The spec could not be restored to its original content after validation. Check the log above and
                      revert the file manually (git status / git checkout).
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold text-slate-400">
                    {leftTab === 'diff' ? 'Highlighted Changes (original → proposed)' : 'Original Source Code'}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] font-semibold">
                    <button
                      onClick={() => setLeftTab('diff')}
                      className={`px-2 py-1 rounded border transition-colors ${
                        leftTab === 'diff'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                          : 'border-pw-border text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Highlight Diff
                    </button>
                    <button
                      onClick={() => setLeftTab('original')}
                      className={`px-2 py-1 rounded border transition-colors ${
                        leftTab === 'original'
                          ? 'bg-slate-700 border-slate-500 text-slate-100'
                          : 'border-pw-border text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Original
                    </button>
                  </div>
                </div>
                {leftTab === 'diff' ? (
                  <DiffView original={active.originalCode} proposed={editedCode || active.proposedCode} />
                ) : (
                  <textarea
                    readOnly
                    value={active.originalCode}
                    className="w-full h-96 bg-pw-navy border border-pw-border rounded-lg p-3 font-mono text-xs text-slate-300 focus:outline-none"
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-emerald-400 mb-1">Proposed Fix (Editable Before Apply)</div>
                <textarea
                  value={editedCode || active.proposedCode}
                  onChange={(e) => setEditedCode(e.target.value)}
                  spellCheck={false}
                  className="w-full h-96 bg-pw-navy border border-emerald-500/40 rounded-lg p-3 font-mono text-xs text-emerald-200 focus:outline-none leading-relaxed"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type DiffRow = {
  type: 'same' | 'add' | 'remove' | 'fold';
  text: string;
  numA?: number;
  numB?: number;
  foldCount?: number;
};

/**
 * Minimal O(n+changed) line diff for spec files: trim common prefix/suffix, treat the
 * differing middle as a remove-block followed by an add-block, fold long identical runs.
 * Good enough — and fast — for "which lines did the healer touch".
 */
const buildLineDiff = (original: string, proposed: string): DiffRow[] => {
  const a = original.split('\n');
  const b = proposed.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ type: 'same', text: a[i], numA: i + 1, numB: i + 1 });
  for (let i = start; i < endA; i++) rows.push({ type: 'remove', text: a[i], numA: i + 1 });
  for (let j = start; j < endB; j++) rows.push({ type: 'add', text: b[j], numB: j + 1 });
  for (let i = endA, j = endB; i < a.length; i++, j++) {
    rows.push({ type: 'same', text: a[i], numA: i + 1, numB: j + 1 });
  }

  // Fold identical runs longer than 10 lines to first 4 … last 2.
  const folded: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== 'same') {
      folded.push(rows[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].type === 'same') j += 1;
    const run = rows.slice(i, j);
    if (run.length > 10) {
      folded.push(...run.slice(0, 4));
      folded.push({ type: 'fold', text: '', foldCount: run.length - 6 });
      folded.push(...run.slice(-2));
    } else {
      folded.push(...run);
    }
    i = j;
  }
  return folded;
};

const DiffView: React.FC<{ original: string; proposed: string }> = ({ original, proposed }) => {
  const rows = buildLineDiff(original, proposed);
  const addCount = rows.filter((r) => r.type === 'add').length;
  const removeCount = rows.filter((r) => r.type === 'remove').length;

  return (
    <div className="w-full h-96 bg-pw-navy border border-pw-border rounded-lg overflow-hidden flex flex-col">
      <div className="px-3 py-1.5 border-b border-pw-border/60 flex items-center gap-2 text-[10px] font-mono text-slate-500 shrink-0">
        <span className="text-rose-400">-{removeCount} removed</span>
        <span className="text-emerald-400">+{addCount} added</span>
        <span className="ml-auto">{rows.filter((r) => r.type === 'fold').length > 0 ? 'identical sections folded' : ''}</span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-snug">
        {rows.map((row, idx) => {
          if (row.type === 'fold') {
            return (
              <div key={idx} className="px-3 py-1 text-center text-slate-600 bg-slate-900/40 border-y border-pw-border/40 select-none">
                ⋯ {row.foldCount} identical line{row.foldCount === 1 ? '' : 's'} ⋯
              </div>
            );
          }
          const palette =
            row.type === 'add'
              ? 'bg-emerald-500/10 text-emerald-200'
              : row.type === 'remove'
              ? 'bg-rose-500/10 text-rose-200'
              : 'text-slate-400';
          const gutter =
            row.type === 'add' ? 'text-emerald-500' : row.type === 'remove' ? 'text-rose-500' : 'text-slate-700';
          const sign = row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' ';
          return (
            <div key={idx} className={`flex items-stretch ${palette}`}>
              <span className="w-8 shrink-0 text-right pr-1 select-none text-slate-600 border-r border-pw-border/40">
                {row.numA ?? ''}
              </span>
              <span className="w-8 shrink-0 text-right pr-1 select-none text-slate-600 border-r border-pw-border/40">
                {row.numB ?? ''}
              </span>
              <span className={`w-5 shrink-0 text-center select-none ${gutter}`}>{sign}</span>
              <span className="whitespace-pre-wrap break-all pr-2">{row.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ProgressPanel: React.FC<{
  log: HealingProgressEvent[];
  busy: boolean;
  onClear: () => void;
}> = ({ log, busy, onClear }) => {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const lineClass = (evt: HealingProgressEvent): string => {
    if (evt.stream === 'stderr' || evt.phase === 'error') return 'text-rose-300';
    if (evt.stream === 'stdout') return 'text-slate-300';
    if (evt.phase === 'done') return 'text-emerald-300';
    if (evt.phase === 'spawn' || evt.phase === 'headed') return 'text-sky-300';
    return 'text-slate-400';
  };

  return (
    <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-pw-border bg-pw-slate/40">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 min-w-0">
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
          ) : (
            <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
          )}
          <span className="truncate">Self-Heal Activity — live log</span>
          {log.length > 0 && <span className="text-slate-500 font-normal shrink-0">({log.length} lines)</span>}
        </div>
        <button
          onClick={onClear}
          title="Clear the activity log"
          aria-label="Clear the activity log"
          className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div
        ref={boxRef}
        className="max-h-44 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words"
      >
        {log.length === 0 ? (
          <div className="text-slate-600 italic">
            Logs stream here while a fix is generated, validated in the background, or watched headed — nothing is hidden.
          </div>
        ) : (
          log.map((evt, idx) => (
            <div key={idx} className={lineClass(evt)}>
              <span className="text-slate-600 select-none">
                {new Date(evt.timestamp).toLocaleTimeString(undefined, { hour12: false })}{' '}
              </span>
              {evt.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
