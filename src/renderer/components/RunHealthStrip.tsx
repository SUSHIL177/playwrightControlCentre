import React, { useEffect, useState } from 'react';
import { Cpu, MemoryStick, Gauge } from 'lucide-react';
import { RunHealthSnapshot } from '@shared/types';

/**
 * Compact host-health readout shown while a batch is executing —
 * CPU (busy, all cores), memory in use of total, and 1-minute load average.
 * Polls the bridge every 2s; renders nothing when idle.
 */
export const RunHealthStrip: React.FC<{ active: boolean }> = ({ active }) => {
  const [snap, setSnap] = useState<RunHealthSnapshot | null>(null);

  useEffect(() => {
    if (!active) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await window.pwControlCenter.getHealth();
        if (!cancelled) setSnap(res);
      } catch {
        /* bridge hiccup — keep last sample */
      }
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  if (!active || !snap) return null;

  const memGbUsed = (snap.memUsedMb / 1024).toFixed(1);
  const memGbTotal = (snap.memTotalMb / 1024).toFixed(0);
  const cpu = snap.cpuPercent;
  const cpuTone = cpu === null ? 'text-slate-300' : cpu >= 85 ? 'text-rose-300' : cpu >= 60 ? 'text-amber-300' : 'text-emerald-300';
  const memTone = snap.memPercent >= 90 ? 'text-rose-300' : snap.memPercent >= 75 ? 'text-amber-300' : 'text-sky-300';

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-pw-border bg-pw-navy/70 px-2 py-1 text-[10px] font-mono tabular-nums"
      title="Host health while the batch runs — CPU is busy % across all cores; memory is host RAM in use"
      aria-label="Host health"
    >
      <span className={`inline-flex items-center gap-1 ${cpuTone}`}>
        <Cpu className="w-3 h-3" />
        CPU {cpu === null ? '—' : `${cpu.toFixed(0)}%`}
      </span>
      <span className="text-slate-600">|</span>
      <span className={`inline-flex items-center gap-1 ${memTone}`}>
        <MemoryStick className="w-3 h-3" />
        RAM {memGbUsed}/{memGbTotal} GB
      </span>
      {snap.load1 > 0 && (
        <>
          <span className="text-slate-600">|</span>
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Gauge className="w-3 h-3" />
            load {snap.load1.toFixed(1)}
          </span>
        </>
      )}
    </div>
  );
};
