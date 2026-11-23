import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderSearch,
  Search,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  FileVideo,
  FileArchive,
  File as FileIcon,
  FileQuestion,
  ExternalLink,
  FolderOpen,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { ArtifactFile, ArtifactKind, ArtifactPreview, ProjectConfig } from '@shared/types';

type KindFilter = 'all' | ArtifactKind;

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'archive', label: 'Archives' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'other', label: 'Other' },
];

const KIND_ICONS: Record<ArtifactKind, React.FC<{ className?: string }>> = {
  text: FileText,
  image: ImageIcon,
  video: FileVideo,
  archive: FileArchive,
  pdf: FileIcon,
  other: FileQuestion,
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

export const ArtifactsPage: React.FC<{
  project: ProjectConfig | null;
  /** Bump from App.tsx on execution completion to auto-rescan. */
  refreshKey: number;
}> = ({ project, refreshKey }) => {
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [selected, setSelected] = useState<ArtifactFile | null>(null);
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [newPaths, setNewPaths] = useState<Set<string>>(new Set());
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);

  const knownPathsRef = useRef<Set<string> | null>(null);
  const projectId = project?.id ?? null;

  const scan = useCallback(
    async (announceNew: boolean) => {
      if (!projectId) {
        setArtifacts([]);
        setSelected(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data: ArtifactFile[] = await window.pwControlCenter.listArtifacts(projectId);
        const list = Array.isArray(data) ? data : [];
        const prev = knownPathsRef.current;
        if (announceNew && prev) {
          setNewPaths(new Set(list.filter((a) => !prev.has(a.relativePath)).map((a) => a.relativePath)));
        } else if (!prev) {
          setNewPaths(new Set());
        }
        knownPathsRef.current = new Set(list.map((a) => a.relativePath));
        setArtifacts(list);
        setLastScanAt(new Date());
        setSelected((current) => {
          // Always hand back the FRESH list entry so downstream consumers (mtime display
          // and the preview effect, which keys off `selected`) reflect what is on disk
          // right now — not the snapshot from when the file was first clicked.
          if (current) {
            const fresh = list.find((a) => a.relativePath === current.relativePath);
            if (fresh) return fresh;
          }
          return list[0] ?? null;
        });
      } catch (err: any) {
        setError(err?.message || 'Unable to scan the project folder.');
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  // Initial scan + auto-rescan when an execution completes (refreshKey bumps).
  const isFirstScanRef = useRef(true);
  useEffect(() => {
    if (isFirstScanRef.current) {
      isFirstScanRef.current = false;
      scan(false);
    } else {
      scan(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  // Preview the currently selected artifact.
  useEffect(() => {
    let cancelled = false;
    if (!projectId || !selected) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    window.pwControlCenter
      .previewArtifact(projectId, selected.relativePath)
      .then((p: ArtifactPreview) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(err?.message || 'Preview unavailable for this file.');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (kind !== 'all' && a.kind !== kind) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.relativePath.toLowerCase().includes(q);
    });
  }, [artifacts, query, kind]);

  const groups = useMemo(() => {
    const byFolder = new Map<string, ArtifactFile[]>();
    for (const a of filtered) {
      const key = a.folderPath || '.';
      const bucket = byFolder.get(key);
      if (bucket) bucket.push(a);
      else byFolder.set(key, [a]);
    }
    return Array.from(byFolder.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const kindCounts = useMemo(() => {
    const acc: Record<KindFilter, number> = { all: artifacts.length, text: 0, image: 0, video: 0, archive: 0, pdf: 0, other: 0 };
    for (const a of artifacts) acc[a.kind] += 1;
    return acc;
  }, [artifacts]);

  const totalBytes = useMemo(() => artifacts.reduce((sum, a) => sum + a.sizeBytes, 0), [artifacts]);

  const fire = async (action: 'open' | 'reveal') => {
    if (!project || !selected) return;
    try {
      if (action === 'open') await window.pwControlCenter.openArtifact(project.id, selected.relativePath);
      else await window.pwControlCenter.revealArtifact(project.id, selected.relativePath);
    } catch (err: any) {
      setError(err?.message || 'Operation failed.');
    }
  };

  if (!project) {
    return (
      <div className="p-8">
        <div className="max-w-md mx-auto text-center space-y-3 bg-pw-panel border border-pw-border rounded-xl p-8">
          <FolderSearch className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">Import or select a project to browse the artifacts your tests write into it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 h-full flex flex-col gap-4 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FolderSearch className="w-5 h-5 text-sky-400" /> Test Artifacts
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Everything your suite wrote into <span className="font-mono text-slate-300">{project.name}</span> — data exports,
            downloads, JSON/CSV payloads, traces, screenshots. Read-only catalog.
          </p>
        </div>
        <button
          onClick={() => scan(true)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Rescan
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 shrink-0">
        <span className="px-2 py-1 rounded bg-slate-800">{artifacts.length} files</span>
        <span className="px-2 py-1 rounded bg-slate-800">{formatBytes(totalBytes)}</span>
        <span className="px-2 py-1 rounded bg-slate-800">{groups.length} folders</span>
        {lastScanAt && (
          <span className="px-2 py-1 rounded bg-slate-800">
            scanned {lastScanAt.toLocaleTimeString(undefined, { hour12: false })}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-emerald-400/90"><ShieldCheck className="w-3.5 h-3.5" /> Read-only — nothing is modified or executed</span>
      </div>

      {error && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs shrink-0">{error}</div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left: list */}
        <div className="lg:w-[46%] xl:w-[42%] flex flex-col gap-2 min-h-0 bg-pw-panel border border-pw-border rounded-xl p-3">
          <div className="relative shrink-0">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search file name or path…"
              className="w-full bg-pw-navy border border-pw-border rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-600"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setKind(f.id)}
                className={`px-2 py-1 rounded-full border text-[10px] font-semibold transition-colors ${
                  kind === f.id
                    ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                    : 'border-pw-border text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label} ({kindCounts[f.id]})
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-pw-border/60 divide-y divide-pw-border/40">
            {loading && artifacts.length === 0 ? (
              <div className="p-6 text-center text-slate-500 animate-pulse text-xs">Scanning project folder…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                {artifacts.length === 0
                  ? 'No files found. Artifacts appear after your tests write them into the project folder (check playwright.config / test output paths).'
                  : 'No files match this filter.'}
              </div>
            ) : (
              groups.map(([folder, files]) => {
                const collapsed = !!collapsedFolders[folder];
                return (
                  <div key={folder}>
                    <button
                      onClick={() => setCollapsedFolders((p) => ({ ...p, [folder]: !collapsed }))}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-slate-800/50 hover:bg-slate-800 text-[10px] uppercase tracking-wider text-slate-400 font-semibold text-left"
                    >
                      {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span className="font-mono normal-case truncate">{folder}</span>
                      <span className="ml-auto shrink-0">{files.length}</span>
                    </button>
                    {!collapsed &&
                      files.map((a) => {
                        const Icon = KIND_ICONS[a.kind];
                        const active = selected?.relativePath === a.relativePath;
                        const isNew = newPaths.has(a.relativePath);
                        return (
                          <button
                            key={a.relativePath}
                            onClick={() => setSelected(a)}
                            title={a.relativePath}
                            className={`w-full flex items-center gap-2 pl-8 pr-2 py-1.5 text-left text-xs transition-colors ${
                              active ? 'bg-sky-500/10 text-sky-200' : 'text-slate-300 hover:bg-slate-800/50'
                            }`}
                          >
                            <Icon className="w-4 h-4 shrink-0 text-slate-500" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {a.name}
                                {isNew && (
                                  <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 align-middle">
                                    NEW
                                  </span>
                                )}
                              </span>
                              <span className="block text-[10px] text-slate-500">
                                {formatBytes(a.sizeBytes)} · {new Date(a.modifiedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0 flex flex-col bg-pw-panel border border-pw-border rounded-xl min-h-[280px]">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-pw-border shrink-0 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate" title={selected.relativePath}>
                    {selected.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">{selected.relativePath}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => fire('open')}
                    title="Open with the default application"
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => fire('reveal')}
                    title="Reveal in folder"
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-3">
                {previewLoading ? (
                  <div className="p-6 text-center text-slate-500 animate-pulse text-xs">Loading preview…</div>
                ) : previewError ? (
                  <div className="p-6 text-center space-y-3">
                    <FileQuestion className="w-10 h-10 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-400">{previewError}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => fire('open')}
                        className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open with default app
                      </button>
                      <button
                        onClick={() => fire('reveal')}
                        className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium inline-flex items-center gap-1.5"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Reveal in folder
                      </button>
                    </div>
                  </div>
                ) : preview?.contentType === 'image' && preview.dataUrl ? (
                  <div className="flex items-center justify-center p-2">
                    <img src={preview.dataUrl} alt={selected.name} className="max-w-full max-h-full rounded-lg border border-pw-border" />
                  </div>
                ) : preview?.contentType === 'text' ? (
                  <>
                    {preview.truncated && (
                      <div className="mb-2 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]">
                        Showing first 512 KB of {formatBytes(selected.sizeBytes)} — open with default app to see the rest.
                      </div>
                    )}
                    <pre className="text-[11px] leading-relaxed font-mono text-slate-200 whitespace-pre-wrap break-words bg-pw-navy/60 border border-pw-border/60 rounded-lg p-3">
                      {preview.text}
                    </pre>
                  </>
                ) : (
                  <div className="p-6 text-center text-slate-500 text-xs">Select a file to preview.</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 p-8">
              <ImageIcon className="w-10 h-10 text-slate-700" />
              <p className="text-xs">Select a file on the left to preview it here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
