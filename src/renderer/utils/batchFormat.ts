import { ExecutionBatch } from '@shared/types';

/** Extracts the per-project run number from RUN-0007-20261123-071240-A3F9 style IDs. */
export const batchRunNumber = (id: string | undefined | null): number | null => {
  if (!id) return null;
  const match = /^RUN-(\d+)-/.exec(id);
  return match ? parseInt(match[1], 10) : null;
};

/** Compact axis/trend label: "#7 07:12" (falls back to time for legacy EXEC-* IDs). */
export const batchAxisLabel = (batch: Pick<ExecutionBatch, 'id' | 'startTime'>): string => {
  const run = batchRunNumber(batch.id);
  const dt = new Date(batch.startTime);
  const hm = Number.isNaN(dt.getTime())
    ? ''
    : dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return run !== null ? `#${run} ${hm}`.trim() : hm || batch.id.slice(-6);
};

/** Full human label: "Run #7 · Nov 23, 2026, 07:12:40" (legacy IDs fall back to date/time). */
export const batchFullLabel = (batch: Pick<ExecutionBatch, 'id' | 'startTime'>): string => {
  const run = batchRunNumber(batch.id);
  const dt = new Date(batch.startTime);
  if (Number.isNaN(dt.getTime())) return run !== null ? `Run #${run}` : batch.id;
  const date = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return run !== null ? `Run #${run} · ${date} · ${time}` : `${date} · ${time}`;
};

/** Card sub-label: "Run #7" or a short id fragment for legacy runs. */
export const batchShortLabel = (batch: Pick<ExecutionBatch, 'id'>): string => {
  const run = batchRunNumber(batch.id);
  return run !== null ? `Run #${run}` : batch.id;
};

export const statusAppearance = (status: ExecutionBatch['status']): { label: string; classes: string } => {
  switch (status) {
    case 'completed':
      return { label: 'PASSED', classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' };
    case 'failed':
      return { label: 'FAILED', classes: 'bg-rose-500/15 text-rose-300 border-rose-500/40' };
    case 'stopped':
      return { label: 'STOPPED', classes: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };
    case 'running':
      return { label: 'RUNNING', classes: 'bg-sky-500/15 text-sky-300 border-sky-500/40 animate-pulse' };
    default:
      return { label: String(status).toUpperCase(), classes: 'bg-slate-700 text-slate-300 border-pw-border' };
  }
};
