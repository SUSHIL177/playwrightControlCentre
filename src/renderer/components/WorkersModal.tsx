import React, { useEffect, useState } from 'react';
import { X, Play, Loader2, Cpu, Check, Globe } from 'lucide-react';
import { BrowserType } from '@shared/types';

interface WorkersModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  defaultWorkers?: number;
  defaultBrowsers?: BrowserType[];
  onConfirm: (workers: number, browsers: BrowserType[]) => void;
  onClose: () => void;
}

const PRESETS = [1, 2, 4, 8];

const BROWSER_CHOICES: Array<{ id: BrowserType; label: string; engine: string; dot: string }> = [
  { id: 'chromium', label: 'Chromium', engine: 'Chrome / Edge', dot: 'bg-emerald-400' },
  { id: 'firefox', label: 'Firefox', engine: 'Gecko engine', dot: 'bg-orange-400' },
  { id: 'webkit', label: 'WebKit', engine: 'Safari engine', dot: 'bg-sky-400' },
];

/**
 * "Run Full Regression" no longer silently assumes 4 workers or one implicit browser —
 * the user picks parallelism and the target engines here before the batch is launched.
 * The selection is pushed to the executor, which overrides whatever projects the imported
 * playwright.config.ts declares.
 */
export const WorkersModal: React.FC<WorkersModalProps> = ({
  open,
  title = 'Run Full Regression Suite',
  description = 'Choose how many Playwright workers run in parallel and which browsers to pin for this batch.',
  confirmLabel = 'Start Regression Run',
  busy = false,
  defaultWorkers = 4,
  defaultBrowsers = ['chromium'],
  onConfirm,
  onClose,
}) => {
  const [workers, setWorkers] = useState(defaultWorkers);
  const [browsers, setBrowsers] = useState<BrowserType[]>(defaultBrowsers);

  useEffect(() => {
    if (open) {
      setWorkers(defaultWorkers);
      setBrowsers(defaultBrowsers.length > 0 ? defaultBrowsers : ['chromium']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultWorkers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  const clamped = Math.max(1, Math.min(32, Math.floor(Number(workers) || 1)));
  const browsersValid = browsers.length > 0;

  const toggleBrowser = (id: BrowserType) =>
    setBrowsers((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md bg-pw-panel border border-pw-border rounded-2xl shadow-2xl p-6 space-y-5 animate-pacc-pop">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-400" /> {title}
            </h2>
            <p className="text-[11px] text-slate-400 mt-1">{description}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Browser selection — overrides the imported project's playwright.config.ts */}
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" /> Browsers
          </div>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Browsers to run">
            {BROWSER_CHOICES.map((b) => {
              const selected = browsers.includes(b.id);
              return (
                <button
                  key={b.id}
                  onClick={() => toggleBrowser(b.id)}
                  aria-pressed={selected}
                  className={`relative flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition-all duration-150 ${
                    selected
                      ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                      : 'border-pw-border text-slate-400 hover:text-slate-100 hover:border-slate-600'
                  }`}
                >
                  {selected && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Check className="w-3 h-3 text-slate-950" strokeWidth={3.5} />
                    </span>
                  )}
                  <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />
                  <span className={`text-xs font-bold ${selected ? 'text-emerald-300' : ''}`}>{b.label}</span>
                  <span className="text-[9px] text-slate-500 leading-none">{b.engine}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            Pins the run to the selected engines — replaces the <code className="text-slate-400">projects</code> declared in the
            imported <code className="text-slate-400">playwright.config.ts</code> for this batch only.
          </p>
          {!browsersValid && (
            <p className="text-[10px] text-rose-400 font-semibold mt-1">Select at least one browser to start the run.</p>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Parallel workers</div>
          <div className="flex items-center gap-2">
            {PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setWorkers(n)}
                className={`w-11 h-11 rounded-xl border text-sm font-bold transition-colors ${
                  clamped === n
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                    : 'border-pw-border text-slate-400 hover:text-slate-100 hover:border-slate-500'
                }`}
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={32}
              value={workers}
              onChange={(e) => setWorkers(Number(e.target.value))}
              aria-label="Custom worker count"
              className="w-20 h-11 bg-pw-navy border border-pw-border rounded-xl px-3 text-center text-sm font-bold text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            1–32 workers. Higher values run tests faster but need more CPU/memory on the machine executing the suite.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => browsersValid && !busy && onConfirm(clamped, browsers)}
            disabled={busy || !browsersValid}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            {confirmLabel} ({clamped} {clamped === 1 ? 'worker' : 'workers'} · {browsers.length} {browsers.length === 1 ? 'browser' : 'browsers'})
          </button>
        </div>
      </div>
    </div>
  );
};
