import React, { useCallback, useEffect, useState } from 'react';
import {
  DiscoveredTest,
  ExecutionBatch,
  FailureAnalysisRecord,
  FolderNode,
  HealingProposal,
  NavRoute,
  ProjectConfig,
  TerminalLogChunk,
} from '@shared/types';
import { Sidebar } from './components/Sidebar';
import { LiveTerminalPanel } from './components/LiveTerminalPanel';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectConfigPage } from './pages/ProjectConfigPage';
import { TestExplorerPage } from './pages/TestExplorerPage';
import { FailureAndHealingPage } from './pages/FailureAndHealingPage';
import { ExecutionCenterPage } from './pages/ExecutionAndReportsPages';
import { ReportsCenterPage } from './pages/ReportsCenterPage';
import { ExecutionHistoryPage } from './pages/ExecutionHistoryPage';
import { ArtifactsPage } from './pages/ArtifactsPage';
import { FlakyAndPerformancePage, SchedulerPage, SettingsPage } from './pages/IntelligenceAndSchedulerPages';

async function safeInvoke<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err: any) {
    console.error(`[ControlCenter] ${label} failed:`, err);
    return fallback;
  }
}

export default function App() {
  const [route, setRoute] = useState<NavRoute>('dashboard');
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [testTree, setTestTree] = useState<FolderNode[]>([]);
  const [allTests, setAllTests] = useState<DiscoveredTest[]>([]);
  const [batches, setBatches] = useState<ExecutionBatch[]>([]);
  const [failures, setFailures] = useState<FailureAnalysisRecord[]>([]);
  const [proposals, setProposals] = useState<HealingProposal[]>([]);
  const [logs, setLogs] = useState<TerminalLogChunk[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [executionVersion, setExecutionVersion] = useState(0);

  const loadProjects = useCallback(async () => {
    try {
      const list: ProjectConfig[] = await window.pwControlCenter.listProjects();
      setProjects(list);
      setActiveProject((current) => {
        if (current && list.some((p: ProjectConfig) => p.id === current.id)) {
          return current;
        }
        if (list.length > 0) return list[0];
        setRoute('projects');
        return null;
      });
    } catch (err) {
      console.error('[ControlCenter] Failed to load projects:', err);
    }
  }, []);

  const loadProjectData = useCallback(async (projectId: string) => {
    // Load each feed independently so one failing module never blocks the rest
    // (Dashboard, Test Explorer, Reports & History all share this refresh path).
    const [tree, tests, batchList, failureList, proposalList] = await Promise.all([
      safeInvoke('getTestTree', window.pwControlCenter.getTestTree(projectId), [] as FolderNode[]),
      safeInvoke('listTests', window.pwControlCenter.listTests(projectId), [] as DiscoveredTest[]),
      safeInvoke('listExecutionBatches', window.pwControlCenter.listExecutionBatches(projectId), [] as ExecutionBatch[]),
      safeInvoke('listFailures', window.pwControlCenter.listFailures(projectId), [] as FailureAnalysisRecord[]),
      safeInvoke('listProposals', window.pwControlCenter.listProposals(projectId), [] as HealingProposal[]),
    ]);
    setTestTree(tree);
    setAllTests(tests);
    setBatches(batchList);
    setFailures(failureList);
    setProposals(proposalList);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!activeProject) return;
    loadProjectData(activeProject.id);
    window.pwControlCenter.startWatchingTests(activeProject.id);

    const unsubChanged = window.pwControlCenter.onTestsChanged((pid) => {
      if (pid === activeProject.id) loadProjectData(pid);
    });
    return () => {
      unsubChanged();
    };
  }, [activeProject, loadProjectData]);

  useEffect(() => {
    const unsubLog = window.pwControlCenter.onTerminalLog((chunk) => {
      setLogs((prev) => [...prev.slice(-2000), chunk]);
    });
    const unsubDone = window.pwControlCenter.onExecutionCompleted(async (completedBatch: ExecutionBatch | undefined) => {
      setIsRunning(false);
      // Auto-populate Failure Intelligence after a run so the failure chart and Sidebar badge
      // are fresh. Stay offline-safe: only auto-analyze with the deterministic local engine;
      // when an external AI provider is configured we leave analysis to the manual button.
      if (completedBatch && completedBatch.failed > 0 && activeProject && completedBatch.projectId === activeProject.id) {
        try {
          const settings = await window.pwControlCenter.getSettings().catch(() => null);
          const autoAnalyzeSafe = !settings || settings.ai.provider === 'heuristic_offline' || !settings.ai.analysisEnabled;
          if (autoAnalyzeSafe) {
            await window.pwControlCenter.analyzeBatchFailures(completedBatch.id);
          }
        } catch (err) {
          console.error('[ControlCenter] Auto failure analysis failed:', err);
        }
      }
      if (activeProject) {
        await loadProjectData(activeProject.id);
      }
      // Bump a version counter so analytics modules (Flaky / Cross-Browser / Performance /
      // Scheduler) re-fetch their telemetry instead of showing stale, mount-time data.
      setExecutionVersion((v) => v + 1);
    });
    return () => {
      unsubLog();
      unsubDone();
    };
  }, [activeProject, loadProjectData]);

  const handleStartExecution = async (opts: any) => {
    if (!activeProject) return;
    setIsRunning(true);
    try {
      const started = await window.pwControlCenter.startExecution({
        projectId: activeProject.id,
        ...opts,
      });
      // Optimistically show the freshly created (running) batch so Reports & Dashboard
      // reflect the new run immediately; the completion event re-syncs with real totals.
      if (started && started.id) {
        setBatches((prev) => [started, ...prev.filter((b) => b.id !== started.id)]);
      }
    } catch (err: any) {
      setIsRunning(false);
      setLogs((prev) => [
        ...prev,
        {
          executionId: 'ERR',
          stream: 'stderr',
          text: `[Execution Error] ${err.message}\n`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-pw-navy text-slate-100 overflow-hidden">
      <Sidebar
        activeRoute={route}
        onSelectRoute={setRoute}
        failureCount={failures.length}
        proposalCount={proposals.filter((p) => p.status === 'pending').length}
        reportCount={batches.length}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="min-h-14 px-4 sm:px-5 py-2 bg-pw-slate/90 border-b border-pw-border flex flex-wrap gap-y-2 items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span className="text-xs text-slate-400 hidden sm:inline">Active Framework:</span>
            <select
              value={activeProject?.id || ''}
              onChange={(e) => {
                const found = projects.find((p) => p.id === e.target.value) || null;
                setActiveProject(found);
              }}
              className="bg-pw-navy border border-pw-border rounded-lg px-3 py-1.5 text-xs font-semibold text-white min-w-0 w-44 sm:w-auto sm:min-w-[240px] max-w-[60vw] truncate"
            >
              {projects.length === 0 && <option value="">No project imported</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.playwrightVersion})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 text-xs flex-wrap">
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-mono whitespace-nowrap">
              Tests: {allTests.length}
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-sky-300 font-mono whitespace-nowrap">
              Reports: {batches.length}
            </span>
            <span
              className={`px-2.5 py-1 rounded font-semibold ${
                isRunning ? 'bg-emerald-500/20 text-emerald-300 animate-pulse' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isRunning ? 'EXECUTING' : 'IDLE'}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {route === 'dashboard' && (
            <DashboardPage
              project={activeProject}
              tests={allTests}
              batches={batches}
              failures={failures}
              onRefresh={async () => {
                if (activeProject) await loadProjectData(activeProject.id);
              }}
              onQuickRun={() =>
                handleStartExecution({
                  mode: 'full',
                  browsers: ['chromium'],
                  headed: false,
                  workers: 4,
                  description: 'Full Regression Suite',
                })
              }
            />
          )}

          {route === 'projects' && (
            <ProjectConfigPage
              projects={projects}
              activeProject={activeProject}
              onSelectProject={setActiveProject}
              onRefreshProjects={loadProjects}
            />
          )}

          {route === 'explorer' && (
            <TestExplorerPage
              project={activeProject}
              tree={testTree}
              allTests={allTests}
              onRefreshData={async () => {
                if (activeProject) await loadProjectData(activeProject.id);
              }}
              onExecute={handleStartExecution}
            />
          )}

          {route === 'execution' && (
            <ExecutionCenterPage
              project={activeProject}
              batches={batches}
              onStartExecution={handleStartExecution}
            />
          )}

          {route === 'terminal' && (
            <LiveTerminalPanel
              logs={logs}
              isRunning={isRunning}
              onClear={() => setLogs([])}
              onStopExecution={() => window.pwControlCenter.stopExecution()}
              fullPage
            />
          )}

          {(route === 'failures' || route === 'healing' || route === 'code-fix') && (
            <FailureAndHealingPage
              mode={route}
              failures={failures}
              proposals={proposals}
              latestBatchId={batches[0]?.id}
              onRefresh={async () => {
                if (activeProject) await loadProjectData(activeProject.id);
              }}
            />
          )}

          {(route === 'flaky' || route === 'cross-browser' || route === 'performance') && (
            <FlakyAndPerformancePage mode={route} project={activeProject} refreshKey={executionVersion} />
          )}

          {route === 'scheduler' && <SchedulerPage project={activeProject} refreshKey={executionVersion} />}

          {route === 'reports' && (
            <ReportsCenterPage
              batches={batches}
              onRefresh={async () => {
                if (activeProject) await loadProjectData(activeProject.id);
              }}
              onRunSuite={() =>
                handleStartExecution({
                  mode: 'full',
                  browsers: ['chromium'],
                  headed: false,
                  workers: 4,
                  description: 'Full Regression Suite',
                })
              }
            />
          )}

          {route === 'history' && (
            <ExecutionHistoryPage
              batches={batches}
              onRefresh={async () => {
                if (activeProject) await loadProjectData(activeProject.id);
              }}
              onRerunFailed={(batchId) =>
                handleStartExecution({
                  mode: 'failed',
                  parentExecutionId: batchId,
                  browsers: ['chromium'],
                  headed: false,
                  workers: 4,
                  description: `Rerun Failed from ${batchId}`,
                })
              }
            />
          )}

          {route === 'artifacts' && <ArtifactsPage project={activeProject} refreshKey={executionVersion} />}

          {route === 'settings' && <SettingsPage />}
        </main>

        {route !== 'terminal' && (
          <LiveTerminalPanel
            logs={logs}
            isRunning={isRunning}
            onClear={() => setLogs([])}
            onStopExecution={() => window.pwControlCenter.stopExecution()}
          />
        )}
      </div>
    </div>
  );
}
