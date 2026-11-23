import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileCode2,
  Play,
  Search,
  CheckSquare,
  Square,
  Tag,
  RefreshCw,
} from 'lucide-react';
import { BrowserType, DiscoveredTest, FolderNode, ProjectConfig } from '@shared/types';

interface TestExplorerPageProps {
  project: ProjectConfig | null;
  tree: FolderNode[];
  allTests: DiscoveredTest[];
  onRefreshData: () => Promise<void>;
  onExecute: (opts: {
    mode: 'folder' | 'spec' | 'tests' | 'tag';
    targetPaths?: string[];
    testIds?: string[];
    tag?: string;
    browsers: BrowserType[];
    headed: boolean;
    workers: number;
  }) => void;
}

export const TestExplorerPage: React.FC<TestExplorerPageProps> = ({
  project,
  tree,
  allTests,
  onRefreshData,
  onExecute,
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeSpec, setActiveSpec] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [browsers, setBrowsers] = useState<BrowserType[]>(['chromium']);
  const [headed, setHeaded] = useState(false);
  const [workers, setWorkers] = useState<number>(4);
  const [scanning, setScanning] = useState(false);

  // Automatically trigger discovery if a project is open but has 0 tests cached
  useEffect(() => {
    if (project && allTests.length === 0 && !scanning) {
      setScanning(true);
      window.pwControlCenter
        .rescanProject(project.id)
        .then(() => onRefreshData())
        .finally(() => setScanning(false));
    }
  }, [project?.id]);

  const effectiveTree = useMemo<FolderNode[]>(() => {
    if (tree.length > 0) return tree;
    if (allTests.length === 0) return [];

    const folderMap = new Map<string, FolderNode>();
    const specMap = new Map<string, any>();

    for (const t of allTests) {
      const folderKey = t.folderPath || 'tests';
      let fNode = folderMap.get(folderKey);
      if (!fNode) {
        fNode = {
          name: folderKey.split('/').pop() || folderKey,
          relativePath: folderKey,
          fullPath: folderKey,
          testCount: 0,
          children: [],
          specs: [],
        };
        folderMap.set(folderKey, fNode);
      }
      fNode.testCount += 1;

      let sNode = specMap.get(t.relativePath);
      if (!sNode) {
        sNode = {
          name: t.relativePath.split('/').pop() || t.relativePath,
          relativePath: t.relativePath,
          fullPath: t.filePath,
          testCount: 0,
          tests: [],
        };
        specMap.set(t.relativePath, sNode);
        fNode.specs.push(sNode);
      }
      sNode.tests.push(t);
      sNode.testCount += 1;
    }

    return Array.from(folderMap.values());
  }, [tree, allTests]);

  useEffect(() => {
    const collectPaths = (nodes: FolderNode[], acc: Set<string>) => {
      for (const n of nodes) {
        acc.add(n.relativePath);
        if (n.children.length > 0) collectPaths(n.children, acc);
      }
    };
    const next = new Set<string>();
    collectPaths(effectiveTree, next);
    setExpandedPaths(next);
  }, [effectiveTree]);

  const availableTags = useMemo(() => {
    const s = new Set<string>();
    allTests.forEach((t) => t.tags.forEach((tag) => s.add(tag)));
    return Array.from(s);
  }, [allTests]);

  const displayedTests = useMemo(() => {
    return allTests.filter((t) => {
      if (activeSpec && t.relativePath !== activeSpec) return false;
      if (activeFolder && !t.folderPath.startsWith(activeFolder)) return false;
      if (selectedTag && !t.tags.includes(selectedTag)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.relativePath.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [allTests, activeFolder, activeSpec, selectedTag, searchQuery]);

  if (!project) {
    return <div className="p-8 text-slate-400">Import a Playwright project to explore discovered test suites.</div>;
  }

  const toggleExpand = (relPath: string) => {
    const next = new Set(expandedPaths);
    if (next.has(relPath)) next.delete(relPath);
    else next.add(relPath);
    setExpandedPaths(next);
  };

  const toggleSelectTest = (id: string) => {
    const next = new Set(selectedTestIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTestIds(next);
  };

  const toggleBrowser = (b: BrowserType) => {
    if (browsers.includes(b)) {
      if (browsers.length > 1) setBrowsers(browsers.filter((x) => x !== b));
    } else {
      setBrowsers([...browsers, b]);
    }
  };

  const handleRescan = async () => {
    setScanning(true);
    try {
      await window.pwControlCenter.rescanProject(project.id);
      await onRefreshData();
    } finally {
      setScanning(false);
    }
  };

  const renderFolder = (node: FolderNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.relativePath);
    const isSelectedFolder = activeFolder === node.relativePath && !activeSpec;

    return (
      <div key={node.relativePath}>
        <div
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            toggleExpand(node.relativePath);
            setActiveFolder(node.relativePath);
            setActiveSpec(null);
          }}
          className={`flex items-center justify-between py-1.5 pr-2 rounded cursor-pointer text-xs ${
            isSelectedFolder ? 'bg-sky-500/20 text-sky-300' : 'text-slate-300 hover:bg-slate-800/70'
          }`}
        >
          <span className="flex items-center gap-1.5 truncate">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
            <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate font-medium">{node.name}</span>
          </span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
            {node.testCount}
          </span>
        </div>

        {isExpanded && (
          <div>
            {node.children.map((child) => renderFolder(child, depth + 1))}
            {node.specs.map((spec) => {
              const isSpecSelected = activeSpec === spec.relativePath;
              return (
                <div
                  key={spec.relativePath}
                  style={{ paddingLeft: `${(depth + 1) * 14 + 14}px` }}
                  onClick={() => {
                    setActiveSpec(spec.relativePath);
                    setActiveFolder(null);
                  }}
                  className={`flex items-center justify-between py-1 pr-2 text-xs rounded cursor-pointer ${
                    isSpecSelected
                      ? 'bg-sky-500/20 text-sky-300 font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <FileCode2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="truncate">{spec.name}</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{spec.testCount}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 border-r border-pw-border bg-pw-slate/60 flex flex-col">
        <div className="p-3 border-b border-pw-border flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Test Suite Hierarchy
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRescan}
              disabled={scanning}
              title="Re-scan spec files"
              className="text-slate-400 hover:text-sky-400"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => {
                setActiveFolder(null);
                setActiveSpec(null);
                setSearchQuery('');
                setSelectedTag('');
              }}
              className="text-[11px] text-sky-400 hover:underline"
            >
              All ({allTests.length})
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {scanning ? (
            <div className="p-4 text-xs text-sky-300 animate-pulse">Scanning Playwright specs...</div>
          ) : effectiveTree.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">
              No folders discovered yet. Click the refresh icon above to scan <span className="font-mono">{project.testDir}</span>.
            </div>
          ) : (
            effectiveTree.map((node) => renderFolder(node))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-pw-border bg-pw-panel/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spec, test, or @tag..."
                className="bg-pw-navy border border-pw-border rounded-lg pl-8 pr-3 py-1 text-xs text-slate-100 w-60 focus:outline-none focus:border-sky-500"
              />
            </div>

            {availableTags.length > 0 && (
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="bg-pw-navy border border-pw-border rounded-lg px-2.5 py-1 text-xs text-slate-200"
              >
                <option value="">All Tags</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              {(['chromium', 'firefox', 'webkit'] as BrowserType[]).map((b) => (
                <button
                  key={b}
                  onClick={() => toggleBrowser(b)}
                  className={`px-2 py-1 rounded border text-[11px] capitalize ${
                    browsers.includes(b)
                      ? 'bg-sky-500/20 border-sky-500 text-sky-300'
                      : 'border-pw-border text-slate-400'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <span>Workers:</span>
              <input
                type="number"
                min={1}
                max={32}
                value={workers}
                onChange={(e) => setWorkers(Math.max(1, Number(e.target.value)))}
                className="w-14 bg-pw-navy border border-pw-border rounded px-2 py-0.5 text-xs text-white text-center"
              />
            </label>

            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} />
              Headed
            </label>

            {selectedTestIds.size > 0 && (
              <button
                onClick={() =>
                  onExecute({
                    mode: 'tests',
                    testIds: Array.from(selectedTestIds),
                    browsers,
                    headed,
                    workers,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Run Selected ({selectedTestIds.size})
              </button>
            )}

            {activeSpec && (
              <button
                onClick={() =>
                  onExecute({
                    mode: 'spec',
                    targetPaths: [activeSpec],
                    browsers,
                    headed,
                    workers,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Run Spec
              </button>
            )}

            {activeFolder && (
              <button
                onClick={() =>
                  onExecute({
                    mode: 'folder',
                    targetPaths: [activeFolder],
                    browsers,
                    headed,
                    workers,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Run Folder
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-pw-slate sticky top-0 text-slate-400 border-b border-pw-border">
              <tr>
                <th className="p-2.5 w-8"></th>
                <th className="p-2.5">Test Case</th>
                <th className="p-2.5">Spec File</th>
                <th className="p-2.5">Tags</th>
                <th className="p-2.5">Last Status</th>
                <th className="p-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pw-border/50">
              {displayedTests.map((t) => {
                const checked = selectedTestIds.has(t.id);
                return (
                  <tr key={t.id} className="hover:bg-slate-800/40">
                    <td className="p-2.5">
                      <button onClick={() => toggleSelectTest(t.id)} className="text-slate-400 hover:text-sky-400">
                        {checked ? <CheckSquare className="w-4 h-4 text-sky-400" /> : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="p-2.5 font-medium text-slate-100">{t.fullTitle}</td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-400">
                      {t.relativePath}:{t.line}
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-wrap gap-1">
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px]"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <StatusBadge status={t.lastStatus} />
                    </td>
                    <td className="p-2.5 text-right">
                      <button
                        onClick={() =>
                          onExecute({
                            mode: 'tests',
                            testIds: [t.id],
                            browsers,
                            headed,
                            workers,
                          })
                        }
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white text-[11px] font-medium"
                      >
                        Run
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) return <span className="text-slate-500 text-[11px]">Not run</span>;
  const styles: Record<string, string> = {
    passed: 'bg-emerald-500/20 text-emerald-300',
    failed: 'bg-rose-500/20 text-rose-300',
    timedOut: 'bg-rose-500/20 text-rose-300',
    flaky: 'bg-amber-500/20 text-amber-300',
    skipped: 'bg-slate-700 text-slate-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${styles[status] || styles.skipped}`}>
      {status}
    </span>
  );
};
