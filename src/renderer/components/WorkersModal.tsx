import React, { useEffect, useState } from 'react';
import { X, Play, Loader2, Cpu } from 'lucide-react';

interface WorkersModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  defaultWorkers?: number;
  onConfirm: (workers: number) => void;
  onClose: () => void;
}

const PRESETS = [1, 2, 4, 8];

/**
 * "Run Full Regression" no longer silently assumes 4 workers — the user picks
 * parallelism here before the batch is launched.
 */
export const WorkersModal: React.FC<WorkersModalProps> = ({
  open,
  title = 'Run Full Regression Suite',
  description = 'Choose how many Playwright workers should run in parallel for this batch.',
  confirmLabel = 'Start Regression Run',
  busy = false,
  defaultWorkers = 4,
  onConfirm,
  onClose,
}) => {
  const [workers, setWorkers] = useState(defaultWorkers);

  useEffect(() => {
    if (open) setWorkers(defaultWorkers);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md bg-pw-panel border border-pw-border rounded-2xl shadow-2xl p-6 space-y-5">
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
            onClick={() => onConfirm(clamped)}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            {confirmLabel} ({clamped} {clamped === 1 ? 'worker' : 'workers'})
          </button>
        </div>
      </div>
    </div>
  );
};
