import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Copy, Search, ChevronUp, ChevronDown, Square } from 'lucide-react';
import { TerminalLogChunk } from '@shared/types';

interface LiveTerminalPanelProps {
  logs: TerminalLogChunk[];
  isRunning: boolean;
  onClear: () => void;
  onStopExecution: () => void;
  fullPage?: boolean;
}

const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_REGEX, '');
}

export const LiveTerminalPanel: React.FC<LiveTerminalPanelProps> = ({
  logs,
  isRunning,
  onClear,
  onStopExecution,
  fullPage = false,
}) => {
  const [expanded, setExpanded] = useState(fullPage);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'errors' | 'passed'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const cleanedLogs = logs.map((entry) => ({
    ...entry,
    cleanText: stripAnsi(entry.text),
  }));

  const filteredLogs = cleanedLogs.filter((entry) => {
    if (search && !entry.cleanText.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'errors') {
      return entry.stream === 'stderr' || /Error:|✘|failed|timedOut/i.test(entry.cleanText);
    }
    if (filter === 'passed') {
      return /✓|passed/i.test(entry.cleanText);
    }
    return true;
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(filteredLogs.map((l) => l.cleanText).join(''));
  };

  return (
    <div
      className={`bg-[#070B14] border-t border-pw-border flex flex-col ${
        fullPage ? 'h-full' : expanded ? 'h-80' : 'h-36'
      } transition-all`}
    >
      <div className="h-9 px-3 bg-pw-slate border-b border-pw-border flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            PLAYWRIGHT LIVE TERMINAL
          </span>
          <div className="flex items-center gap-1 text-[11px]">
            {(['all', 'errors', 'passed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 rounded capitalize ${
                  filter === f ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter output..."
              className="bg-pw-navy border border-pw-border rounded pl-7 pr-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 w-44"
            />
          </div>

          <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-600"
            />
            Auto-scroll
          </label>

          {isRunning && (
            <button
              onClick={onStopExecution}
              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1"
            >
              <Square className="w-3 h-3 fill-current" /> Stop
            </button>
          )}

          <button onClick={handleCopy} title="Copy Output" className="p-1 text-slate-400 hover:text-white">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClear} title="Clear Terminal" className="p-1 text-slate-400 hover:text-white">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {!fullPage && (
            <button
              onClick={() => setExpanded(!expanded)}
              title={expanded ? 'Collapse' : 'Expand'}
              className="p-1 text-slate-400 hover:text-white"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 italic">
            Ready. Start a Playwright execution batch to stream live stdout/stderr output here...
          </div>
        ) : (
          filteredLogs.map((chunk, idx) => {
            const isErr = chunk.stream === 'stderr' || /Error:|✘|failed|timedOut/i.test(chunk.cleanText);
            const isSys = chunk.stream === 'system';
            const isPassLine = /^\s*✓/m.test(chunk.cleanText);

            return (
              <span
                key={idx}
                className={
                  isSys
                    ? 'text-sky-400 font-semibold'
                    : isErr
                    ? 'text-rose-400'
                    : isPassLine
                    ? 'text-emerald-400'
                    : 'text-slate-200'
                }
              >
                {chunk.cleanText}
              </span>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
