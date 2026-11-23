import React, { useState } from 'react';
import { Sparkles, Wrench, Check, X, RotateCcw, PlayCircle, ShieldAlert } from 'lucide-react';
import { FailureAnalysisRecord, HealingProposal } from '@shared/types';

interface FailureAndHealingPageProps {
  mode: 'failures' | 'healing' | 'code-fix';
  failures: FailureAnalysisRecord[];
  proposals: HealingProposal[];
  latestBatchId?: string;
  onRefresh: () => Promise<void>;
}

export const FailureAndHealingPage: React.FC<FailureAndHealingPageProps> = ({
  mode,
  failures,
  proposals,
  latestBatchId,
  onRefresh,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<HealingProposal | null>(proposals[0] || null);
  const [editedCode, setEditedCode] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAnalyzeLatest = async () => {
    if (!latestBatchId) return;
    setBusyId('analyze');
    setActionError(null);
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
    try {
      const p = await window.pwControlCenter.generateHealingProposal(failureId);
      await onRefresh();
      setSelectedProposal(p);
      setEditedCode(p.proposedCode);
    } catch (err: any) {
      console.error('[ControlCenter] Proposal generation failed:', err);
      setActionError(err?.message || 'Unable to generate a healing proposal.');
    } finally {
      setBusyId(null);
    }
  };

  if (mode === 'failures') {
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">AI Failure Analysis & Root Cause Intelligence</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Differentiates genuine application defects from automation locator, timeout, or infrastructure failures.
            </p>
          </div>
          {latestBatchId && (
            <button
              onClick={handleAnalyzeLatest}
              disabled={busyId === 'analyze'}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {busyId === 'analyze' ? 'Analyzing...' : 'Analyze Latest Batch Failures'}
            </button>
          )}
        </div>

        {actionError && (
          <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
            {actionError}
          </div>
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
          All proposed changes require isolated validation and explicit QA approval. Automatic backups are created before writing.
        </p>
      </div>

      {actionError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {actionError}
        </div>
      )}

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
                    try {
                      const updated = await window.pwControlCenter.validateProposal(active.id);
                      setSelectedProposal(updated);
                      await onRefresh();
                    } catch (err: any) {
                      console.error('[ControlCenter] Validation failed:', err);
                      setActionError(err?.message || 'Validation run failed.');
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  {busyId === 'validate' ? 'Validating...' : 'Validate in Isolation'}
                </button>

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

            <div className="text-xs text-slate-400">
              Validation Status:{' '}
              <span className="font-semibold text-white uppercase">{active.validationStatus}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-1">Original Source Code</div>
                <textarea
                  readOnly
                  value={active.originalCode}
                  className="w-full h-80 bg-pw-navy border border-pw-border rounded-lg p-3 font-mono text-xs text-slate-300 focus:outline-none"
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-emerald-400 mb-1">Proposed Fix (Editable Before Apply)</div>
                <textarea
                  value={editedCode || active.proposedCode}
                  onChange={(e) => setEditedCode(e.target.value)}
                  className="w-full h-80 bg-pw-navy border border-emerald-500/40 rounded-lg p-3 font-mono text-xs text-emerald-200 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
