import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Share2,
  Trash2,
  FolderOpen,
  FileBarChart2,
  Play,
  CheckCircle2,
  XCircle,
  StopCircle,
  Loader2,
} from 'lucide-react';
import { BrowserType } from '@shared/types';
import { ExecutionBatch } from '@shared/types';
import { DESKTOP_CAPS, fetchCapabilities, type WebCapabilities } from '../webMode';
import { batchFullLabel, batchShortLabel, statusAppearance } from '../utils/batchFormat';
import { formatMinutes } from '@shared/format';
import { WorkersModal } from '../components/WorkersModal';

type StatusFilter = 'all' | 'completed' | 'failed' | 'stopped';

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Passed' },
  { id: 'failed', label: 'Failed' },
  { id: 'stopped', label: 'Stopped' },
];

export const ReportsCenterPage: React.FC<{
  batches: ExecutionBatch[];
  onRefresh: () => Promise<void>;
  onRunSuite: (workers: number, browsers: BrowserType[]) => void;
}> = ({ batches, onRefresh, onRunSuite }) => {
  const [workersModalOpen, setWorkersModalOpen] = useState(false);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [caps, setCaps] = useState<WebCapabilities>(DESKTOP_CAPS);
  useEffect(() => {
    fetchCapabilities().then(setCaps).catch(() => undefined);
  }, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const counts = useMemo(() => {
    const acc: Record<StatusFilter, number> = { all: batches.length, completed: 0, failed: 0, stopped: 0 };
    for (const b of batches) {
      if (b.status === 'completed') acc.completed += 1;
      else if (b.status === 'failed') acc.failed += 1;
      else if (b.status === 'stopped') acc.stopped += 1;
    }
    return acc;
  }, [batches]);

  const visible = useMemo(
    () => (statusFilter === 'all' ? batches : batches.filter((b) => b.status === statusFilter)),
    [batches, statusFilter]
  );

  const withBatchAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
    } catch (err: any) {
      setActionError(err?.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileBarChart2 className="w-5 h-5 text-sky-400" /> Reports Center
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Archived native Playwright HTML reports — open, share over LAN, or reveal them in Explorer. Each card is one execution.
          </p>
        </div>
        {hostedUrl && (
          <a
            href={hostedUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-mono break-all hover:bg-emerald-500/25"
          >
            {caps.webMode ? 'Report URL' : 'Hosted LAN URL'}: {hostedUrl}
          </a>
        )}
      </div>

      {actionError && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {actionError}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-full border font-medium transition-colors ${
              statusFilter === f.id
                ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                : 'border-pw-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-pw-panel border border-pw-border rounded-xl p-8 text-center space-y-3">
          <FileBarChart2 className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">
            {batches.length === 0
              ? 'No archived reports yet. Run a batch — the native Playwright HTML report is archived automatically.'
              : 'No reports match this filter.'}
          </p>
          {batches.length === 0 && (
            <button
              onClick={() => setWorkersModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" /> Run Full Regression
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {visible.map((b) => {
            const appearance = statusAppearance(b.status);
            const total = Math.max(b.totalTests, 1);
            const pct = (n: number) => `${(n / total) * 100}%`;
            return (
              <div
                key={b.id}
                className="bg-pw-panel border border-pw-border rounded-xl p-4 space-y-3 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        {batchShortLabel(b)}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${appearance.classes}`}>
                        {appearance.label}
                      </span>
                    </div>
                    <h3 className="font-semibold text-white text-sm mt-1.5 truncate" title={b.description}>
                      {b.description}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">{batchFullLabel(b)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold text-white">{formatMinutes(b.durationMs)}</div>
                    <div className="text-[10px] uppercase text-slate-500">duration</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-slate-800">env: {b.environment}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800">mode: {b.mode}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800">{b.browsers.join(', ')}</span>
                  {b.tag && <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">{b.tag}</span>}
                </div>

                {/* Result tally bar */}
                <div className="space-y-1">
                  <div className="h-2.5 w-full flex rounded-full overflow-hidden bg-slate-800">
                    {b.passed > 0 && <div style={{ width: pct(b.passed) }} className="bg-emerald-500" />}
                    {b.failed > 0 && <div style={{ width: pct(b.failed) }} className="bg-rose-500" />}
                    {b.flaky > 0 && <div style={{ width: pct(b.flaky) }} className="bg-amber-400" />}
                    {b.skipped > 0 && <div style={{ width: pct(b.skipped) }} className="bg-slate-500" />}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
                    <span className="text-emerald-400">✓ {b.passed} passed</span>
                    <span className="text-rose-400">✗ {b.failed} failed</span>
                    <span className="text-amber-400">~ {b.flaky} flaky</span>
                    <span className="text-slate-400">- {b.skipped} skipped</span>
                    <span className="ml-auto">{b.totalTests} tests</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-pw-border/60 flex-wrap">
                  <code className="text-[10px] text-slate-500 font-mono truncate max-w-[40%]" title={b.id}>
                    {b.id}
                  </code>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() =>
                        withBatchAction(b.id, async () => {
                          await window.pwControlCenter.openReportInBrowser(b.htmlReportPath);
                        })
                      }
                      disabled={busyId === b.id}
                      title="Open archived HTML report in your browser"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-[11px] font-semibold"
                    >
                      {busyId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                      Open Report
                    </button>
                    <button
                      onClick={() =>
                        withBatchAction(b.id, async () => {
                          const url = await window.pwControlCenter.startReportHosting(b.htmlReportPath);
                          setHostedUrl(url);
                          if (caps.webMode && typeof url === 'string' && url.startsWith('/')) window.open(url, '_blank', 'noopener');
                        })
                      }
                      disabled={busyId === b.id}
                      title={caps.webMode ? 'Open the archived report' : 'Host this report on your LAN (port 9323)'}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-[11px] font-medium"
                    >
                      <Share2 className="w-3 h-3" /> Share
                    </button>
                    {!caps.webMode && (
                      <button
                        onClick={() =>
                          withBatchAction(b.id, async () => {
                            await window.pwControlCenter.revealReportInFolder(b.htmlReportPath);
                          })
                        }
                        disabled={busyId === b.id}
                        title="Reveal report.html in the folder"
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium"
                      >
                        <FolderOpen className="w-3 h-3" /> Folder
                      </button>
                    )}
                    <button
                      onClick={() =>
                        withBatchAction(b.id, async () => {
                          if (!window.confirm(`Delete ${batchShortLabel(b)} (${b.description}) and all of its results?`)) return;
                          await window.pwControlCenter.deleteBatch(b.id);
                          await onRefresh();
                        })
                      }
                      disabled={busyId === b.id}
                      title="Delete batch + results + failure analyses (cascade)"
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-rose-400 hover:bg-rose-500/15 disabled:opacity-50 text-[11px] font-medium"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
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
          onRunSuite(workers, browsers);
        }}
        onClose={() => setWorkersModalOpen(false)}
      />
    </div>
  );
};
