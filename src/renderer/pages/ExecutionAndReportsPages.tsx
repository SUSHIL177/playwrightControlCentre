import React, { useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

