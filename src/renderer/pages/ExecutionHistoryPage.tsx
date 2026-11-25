import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  History,
  Download,
  Trash2,
  GitCompareArrows,
  Loader2,
  XCircle,
  CheckCircle2,
  MinusCircle,
  RotateCcw,
} from 'lucide-react';
import { ExecutionBatch, TestExecutionResult, TestStatus } from '@shared/types';
import { batchFullLabel, batchShortLabel, statusAppearance } from '../utils/batchFormat';
import { formatMinutes, toMinutes } from '@shared/format';

interface CompareResult {
  newlyFailing: any[];
  fixedTests: any[];
  consistentlyFailing: any[];
}

const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-rose-500/15 text-rose-300',
  timedOut: 'bg-rose-500/15 text-rose-300',
  flaky: 'bg-amber-500/15 text-amber-300',
  skipped: 'bg-slate-700 text-slate-300',
  running: 'bg-sky-500/15 text-sky-300',
  pending: 'bg-slate-700 text-slate-300',
};

const SmallStatusPill: React.FC<{ status: TestStatus | string }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[status] || STATUS_STYLES.skipped}`}>
    {status}
  </span>
);

const toCsv = (batchId: string, rows: TestExecutionResult[]): string => {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Run', 'Test Title', 'Full Title', 'File', 'Browser', 'Status', 'Duration (min)', 'Retry', 'Error'];
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    lines.push(
      [batchId, r.testTitle, r.fullTitle, r.filePath, r.browser, r.status, toMinutes(r.durationMs), r.retry, r.errorMessage || '']
        .map(esc)
        .join(',')
    );
  }
  return lines.join('\r\n');
};

export const ExecutionHistoryPage: React.FC<{
  batches: ExecutionBatch[];
  onRefresh: () => Promise<void>;
  onRerunFailed: (batchId: string) => void;
}> = ({ batches, onRefresh, onRerunFailed }) => {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [resultsMap, setResultsMap] = useState<Record<string, TestExecutionResult[]>>({});
  const [resultsLoading, setResultsLoading] = useState<Record<string, boolean>>({});
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // Sensible default pair: previous run (A) vs latest run (B)
  useEffect(() => {
    if (batches.length >= 2) {
      setCompareA((prev) => prev || batches[1].id);
      setCompareB((prev) => prev || batches[0].id);
    } else {
      setCompareA('');
      setCompareB('');
      setCompareResult(null);
    }
  }, [batches]);

  const batchOptionLabel = (b: ExecutionBatch) =>
    `${batchFullLabel(b)} — ${b.description} (${b.passed}P/${b.failed}F)`;

  const toggleExpand = async (id: string) => {
    const next = !expanded[id];
    setExpanded((p) => ({ ...p, [id]: next }));
    if (next && !resultsMap[id]) {
      setResultsLoading((p) => ({ ...p, [id]: true }));
      setActionError(null);
      try {
        const rows = await window.pwControlCenter.getExecutionResults(id);
        setResultsMap((p) => ({ ...p, [id]: Array.isArray(rows) ? rows : [] }));
      } catch (err: any) {
        setActionError(err?.message || 'Unable to load results for this batch.');
      } finally {
        setResultsLoading((p) => ({ ...p, [id]: false }));
      }
    }
  };

  const runCompare = async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setComparing(true);
    setActionError(null);
    try {
      const result = await window.pwControlCenter.compareBatches(compareA, compareB);
      setCompareResult(result);
    } catch (err: any) {
      setActionError(err?.message || 'Comparison failed.');
    } finally {
      setComparing(false);
    }
  };

  const exportCsv = (batch: ExecutionBatch) => {
    const rows = resultsMap[batch.id];
    if (!rows) return;
    const blob = new Blob([toCsv(batch.id, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${batch.id}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (batch: ExecutionBatch) => {
    if (!window.confirm(`Delete ${batchShortLabel(batch)} (${batch.description}) and all of its results?`)) return;
    setBusyId(batch.id);
    setActionError(null);
    try {
      await window.pwControlCenter.deleteBatch(batch.id);
      setResultsMap((p) => {
        const next = { ...p };
        delete next[batch.id];
        return next;
      });
      await onRefresh();
    } catch (err: any) {
      setActionError(err?.message || 'Unable to delete the batch.');
    } finally {
      setBusyId(null);
    }
  };

  const batchLabel = (id: string) => {
    const b = batches.find((x) => x.id === id);
    return b ? batchFullLabel(b) : id;
  };

  const compareSummary = useMemo(() => {
    if (!compareResult) return null;
    return {
      newlyFailing: compareResult.newlyFailing || [],
      fixedTests: compareResult.fixedTests || [],
      consistentlyFailing: compareResult.consistentlyFailing || [],
    };
  }, [compareResult]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-sky-400" /> Execution History
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Every run with per-test drilling, batch comparison and CSV export — the analytical companion to Reports Center.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {actionError}
        </div>
      )}

      {/* Compare runs */}
      <div className="bg-pw-panel border border-pw-border rounded-xl p-4 flex flex-wrap items-end gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300 font-semibold pb-1.5">
          <GitCompareArrows className="w-4 h-4 text-sky-400" /> Compare Runs
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-slate-500">Baseline (older)</span>
          <select
            value={compareA}
            onChange={(e) => setCompareA(e.target.value)}
            className="bg-pw-navy border border-pw-border rounded-lg px-3 py-2 text-slate-100 max-w-[260px]"
          >
            <option value="">Select baseline…</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchOptionLabel(b)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-slate-500">Candidate (newer)</span>
          <select
            value={compareB}
            onChange={(e) => setCompareB(e.target.value)}
            className="bg-pw-navy border border-pw-border rounded-lg px-3 py-2 text-slate-100 max-w-[260px]"
          >
            <option value="">Select candidate…</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchOptionLabel(b)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={runCompare}
          disabled={!compareA || !compareB || compareA === compareB || comparing}
          className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold inline-flex items-center gap-2"
        >
          {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />}
          Compare
        </button>
        {compareResult && (
          <button onClick={() => setCompareResult(null)} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white">
            Clear
          </button>
        )}
      </div>

      {compareSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <CompareBox
            title={`Newly Failing (${compareSummary.newlyFailing.length})`}
            tone="rose"
            icon={<XCircle className="w-4 h-4" />}
            items={compareSummary.newlyFailing.map((r) => r.test_title || r.testTitle)}
            footnote={`regressed between baseline and ${batchLabel(compareB)}`}
          />
          <CompareBox
            title={`Fixed (${compareSummary.fixedTests.length})`}
            tone="emerald"
            icon={<CheckCircle2 className="w-4 h-4" />}
            items={compareSummary.fixedTests.map((r) => r.test_title || r.testTitle)}
            footnote="failing in baseline, passing in candidate"
          />
          <CompareBox
            title={`Consistently Failing (${compareSummary.consistentlyFailing.length})`}
            tone="amber"
            icon={<MinusCircle className="w-4 h-4" />}
            items={compareSummary.consistentlyFailing.map((r) => r.test_title || r.testTitle)}
            footnote="failing in both runs"
          />
        </div>
      )}

      <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[1020px] text-left border-collapse text-xs">
          <thead className="bg-pw-slate text-slate-400 border-b border-pw-border">
            <tr>
              <th className="p-3 w-10"></th>
              <th className="p-3">Run</th>
              <th className="p-3">Description</th>
              <th className="p-3">Env / Mode</th>
              <th className="p-3">Browsers</th>
              <th className="p-3 text-center">P / F / Flaky / Skip</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pw-border/50">
            {batches.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  No executions recorded yet. Run a batch from the Execution Center and it will appear here with full per-test detail.
                </td>
              </tr>
            ) : (
              batches.map((b) => {
                const isOpen = !!expanded[b.id];
                const appearance = statusAppearance(b.status);
                const rows = resultsMap[b.id];
                return (
                  <React.Fragment key={b.id}>
                    <tr className="hover:bg-slate-800/40 align-top">
                      <td className="p-3">
                        <button
                          onClick={() => toggleExpand(b.id)}
                          title={isOpen ? 'Collapse per-test results' : 'Expand per-test results'}
                          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-sky-400"
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="font-mono font-bold text-sky-300 text-[11px]">{batchShortLabel(b)}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
                          {new Date(b.startTime).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="p-3 text-white font-medium max-w-[220px]">
                        <span className="line-clamp-2" title={b.description}>{b.description}</span>
                      </td>
                      <td className="p-3 text-slate-300 whitespace-nowrap">{b.environment} · {b.mode}</td>
                      <td className="p-3 text-slate-300 whitespace-nowrap">{b.browsers.join(', ')}</td>
                      <td className="p-3 text-center font-mono whitespace-nowrap">
                        <span className="text-emerald-400">{b.passed}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-rose-400">{b.failed}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-amber-400">{b.flaky}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-400">{b.skipped}</span>
                      </td>
                      <td className="p-3 text-slate-300 whitespace-nowrap">{formatMinutes(b.durationMs)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${appearance.classes}`}>
                          {appearance.label}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {b.failed > 0 && (
                            <button
                              onClick={() => onRerunFailed(b.id)}
                              title="Re-run only the failed tests from this batch"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-600/20 text-rose-300 hover:bg-rose-600/40 text-[11px] font-medium"
                            >
                              <RotateCcw className="w-3 h-3" /> Re-run Failed
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(b)}
                            disabled={busyId === b.id}
                            title="Delete batch + results + failure analyses (cascade)"
                            className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                          >
                            {busyId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-pw-navy/40">
                        <td colSpan={9} className="p-0">
                          <div className="p-4 space-y-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                                Per-test results {rows ? `(${rows.length})` : ''}
                              </span>
                              {rows && rows.length > 0 && (
                                <button
                                  onClick={() => exportCsv(b)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                                >
                                  <Download className="w-3.5 h-3.5" /> Export CSV
                                </button>
                              )}
                            </div>
                            {resultsLoading[b.id] ? (
                              <div className="p-4 text-center text-slate-500 animate-pulse">Loading per-test results…</div>
                            ) : !rows || rows.length === 0 ? (
                              <div className="p-4 text-center text-slate-500">No stored per-test results for this batch.</div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-pw-border/60">
                                <table className="w-full min-w-[860px] text-left text-[11px]">
                                  <thead className="bg-slate-800/60 text-slate-400">
                                    <tr>
                                      <th className="p-2">Status</th>
                                      <th className="p-2">Test</th>
                                      <th className="p-2">File</th>
                                      <th className="p-2">Browser</th>
                                      <th className="p-2">Duration</th>
                                      <th className="p-2">Retry</th>
                                      <th className="p-2">Error (first line)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-pw-border/40">
                                    {rows.map((r) => (
                                      <tr key={r.id} className="hover:bg-slate-800/30">
                                        <td className="p-2"><SmallStatusPill status={r.status} /></td>
                                        <td className="p-2 text-slate-100 font-medium max-w-[260px]" title={r.fullTitle}>{r.testTitle}</td>
                                        <td className="p-2 font-mono text-slate-400 max-w-[220px] truncate" title={r.filePath}>{r.filePath}</td>
                                        <td className="p-2 text-slate-300">{r.browser}</td>
                                        <td className="p-2 text-slate-300 whitespace-nowrap">{formatMinutes(r.durationMs)}</td>
                                        <td className="p-2 text-slate-400">{r.retry}</td>
                                        <td className="p-2 font-mono text-rose-300 max-w-[280px] truncate" title={r.errorMessage || ''}>
                                          {r.errorMessage ? r.errorMessage.split('\n')[0] : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CompareBox: React.FC<{
  title: string;
  tone: 'rose' | 'emerald' | 'amber';
  icon: React.ReactNode;
  items: string[];
  footnote: string;
}> = ({ title, tone, icon, items, footnote }) => {
  const toneClasses = {
    rose: 'border-rose-500/40 text-rose-300',
    emerald: 'border-emerald-500/40 text-emerald-300',
    amber: 'border-amber-500/40 text-amber-300',
  }[tone];

  return (
    <div className="bg-pw-panel border border-pw-border rounded-xl p-3 space-y-1.5 min-h-[110px]">
      <div className={`flex items-center gap-2 font-semibold ${toneClasses}`}>{icon}{title}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-slate-500">None — {footnote}.</div>
      ) : (
        <>
          <ul className="text-[11px] text-slate-300 space-y-0.5 max-h-36 overflow-y-auto">
            {items.slice(0, 25).map((t, i) => (
              <li key={i} className="truncate" title={t}>• {t}</li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-500">{footnote}{items.length > 25 ? ` (showing 25 of ${items.length})` : ''}</div>
        </>
      )}
    </div>
  );
};
