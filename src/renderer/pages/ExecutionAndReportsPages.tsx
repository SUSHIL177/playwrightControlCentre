import React, { useState } from 'react';
import { Play, RotateCcw, ExternalLink, Share2, Trash2 } from 'lucide-react';
import { BrowserType, ExecutionBatch, ProjectConfig } from '@shared/types';

export const ExecutionCenterPage: React.FC<{
  project: ProjectConfig | null;
  batches: ExecutionBatch[];
  onStartExecution: (opts: any) => void;
}> = ({ project, batches, onStartExecution }) => {
  const [browsers, setBrowsers] = useState<BrowserType[]>(['chromium']);
  const [headed, setHeaded] = useState(false);
  const [workers, setWorkers] = useState(4);
  const [retries, setRetries] = useState(1);
  const [tag, setTag] = useState('@smoke');
  const [environment, setEnvironment] = useState('staging');
  const [description, setDescription] = useState('');

  if (!project) return <div className="p-8 text-slate-400">Import a project first.</div>;

  const latestFailedBatch = batches.find((b) => b.failed > 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Test Execution Center</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Runtime overrides apply strictly to this process without mutating your original playwright.config.ts.
          </p>
        </div>

        {latestFailedBatch && (
          <button
            onClick={() =>
              onStartExecution({
                mode: 'failed',
                parentExecutionId: latestFailedBatch.id,
                browsers,
                headed,
                workers,
                retries: 0,
                environment,
                description: `Rerun Failed from ${latestFailedBatch.id}`,
              })
            }
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Rerun Failed Tests ({latestFailedBatch.failed})
          </button>
        )}
      </div>

      <div className="bg-pw-panel border border-pw-border rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div>
          <label className="block text-slate-400 mb-1">Environment (TEST_ENV)</label>
          <input
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-100"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Parallel Workers</label>
          <input
            type="number"
            min={1}
            max={32}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value))}
            className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-100"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Retries Override</label>
          <input
            type="number"
            min={0}
            max={5}
            value={retries}
            onChange={(e) => setRetries(Number(e.target.value))}
            className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-100"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Tag Filter (@smoke, @regression)</label>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Execution Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Release Candidate Smoke Run"
            className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-100"
          />
        </div>
        <div className="flex flex-col justify-between">
          <span className="text-slate-400">Browsers & Mode</span>
          <div className="flex items-center gap-2 mt-1">
            {(['chromium', 'firefox', 'webkit'] as BrowserType[]).map((b) => (
              <button
                key={b}
                onClick={() =>
                  setBrowsers((prev) =>
                    prev.includes(b) ? (prev.length > 1 ? prev.filter((x) => x !== b) : prev) : [...prev, b]
                  )
                }
                className={`px-2.5 py-1.5 rounded border capitalize ${
                  browsers.includes(b) ? 'bg-sky-500/20 border-sky-500 text-sky-300' : 'border-pw-border text-slate-400'
                }`}
              >
                {b}
              </button>
            ))}
            <label className="flex items-center gap-1 text-slate-200 ml-2 cursor-pointer">
              <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} />
              Headed
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() =>
            onStartExecution({
              mode: 'full',
              browsers,
              headed,
              workers,
              retries,
              environment,
              description: description || 'Full Regression Suite',
            })
          }
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2"
        >
          <Play className="w-4 h-4 fill-current" /> Run Full Regression Suite
        </button>

        <button
          onClick={() =>
            onStartExecution({
              mode: 'tag',
              tag,
              browsers,
              headed,
              workers,
              retries,
              environment,
              description: description || `Tag Run (${tag})`,
            })
          }
          className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-2"
        >
          <Play className="w-4 h-4 fill-current" /> Run By Tag ({tag})
        </button>
      </div>
    </div>
  );
};

export const ReportsAndHistoryPage: React.FC<{
  batches: ExecutionBatch[];
  onRefresh: () => Promise<void>;
  onRerunFailed: (batchId: string) => void;
}> = ({ batches, onRefresh, onRerunFailed }) => {
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Native Playwright HTML Reports & Execution History</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Preserves authentic Playwright HTML reports with full traces, screenshots, videos, and step timelines.
          </p>
        </div>
        {hostedUrl && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-mono">
            Hosted LAN URL: {hostedUrl}
          </div>
        )}
      </div>

      {reportError && (
        <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
          {reportError}
        </div>
      )}

      <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-pw-slate text-slate-400 border-b border-pw-border">
            <tr>
              <th className="p-3">Execution ID</th>
              <th className="p-3">Description</th>
              <th className="p-3">Env / Browsers</th>
              <th className="p-3">Passed</th>
              <th className="p-3">Failed</th>
              <th className="p-3">Flaky</th>
              <th className="p-3">Duration</th>
              <th className="p-3 text-right">Native Report & Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pw-border/50">
            {batches.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">
                  No stored execution reports yet. Run a test batch to generate and persist a native Playwright HTML report.
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-800/40">
                  <td className="p-3 font-mono text-sky-300">{b.id}</td>
                  <td className="p-3 text-white font-medium">{b.description}</td>
                  <td className="p-3 text-slate-300">
                    {b.environment} • {b.browsers.join(', ')}
                  </td>
                  <td className="p-3 text-emerald-400 font-semibold">{b.passed}</td>
                  <td className="p-3 text-rose-400 font-semibold">{b.failed}</td>
                  <td className="p-3 text-amber-400 font-semibold">{b.flaky}</td>
                  <td className="p-3 text-slate-300">{(b.durationMs / 1000).toFixed(1)}s</td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={async () => {
                        setReportError(null);
                        try {
                          await window.pwControlCenter.openReportInBrowser(b.htmlReportPath);
                        } catch (e: any) {
                          setReportError(e.message || 'Unable to open HTML report.');
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium"
                    >
                      <ExternalLink className="w-3 h-3" /> HTML Report
                    </button>
                    <button
                      onClick={async () => {
                        const url = await window.pwControlCenter.startReportHosting(b.htmlReportPath);
                        setHostedUrl(url);
                      }}
                      title="Host report over LAN"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                    >
                      <Share2 className="w-3 h-3" /> Share
                    </button>
                    {b.failed > 0 && (
                      <button
                        onClick={() => onRerunFailed(b.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-600/20 text-rose-300 hover:bg-rose-600/40"
                      >
                        <RotateCcw className="w-3 h-3" /> Rerun Failed
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await window.pwControlCenter.deleteBatch(b.id);
                        await onRefresh();
                      }}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
