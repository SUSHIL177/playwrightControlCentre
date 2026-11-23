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
import { ExecutionCenterPage, ReportsAndHistoryPage } from './pages/ExecutionAndReportsPages';
import { FlakyAndPerformancePage, SchedulerPage, SettingsPage } from './pages/IntelligenceAndSchedulerPages';

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

  const loadProjects = useCallback(async () => {
    const list = await window.pwControlCenter.listProjects();
    setProjects(list);
    if (list.length > 0 && !activeProject) {
      setActiveProject(list[0]);
    } else if (list.length === 0) {
      setActiveProject(null);
      setRoute('projects');
    }
  }, [activeProject]);

  const loadProjectData = useCallback(async (projectId: string) => {
    const [tree, tests, batchList, failureList, proposalList] = await Promise.all([
      window.pwControlCenter.getTestTree(projectId),
      window.pwControlCenter.listTests(projectId),
      window.pwControlCenter.listExecutionBatches(projectId),
      window.pwControlCenter.listFailures(projectId),
      window.pwControlCenter.listProposals(projectId),
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
    const unsubDone = window.pwControlCenter.onExecutionCompleted(async () => {
      setIsRunning(false);
      if (activeProject) {
        await loadProjectData(activeProject.id);
      }
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
      await window.pwControlCenter.startExecution({
        projectId: activeProject.id,
        ...opts,
      });
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
        <header className="h-14 px-5 bg-pw-slate/90 border-b border-pw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Active Framework:</span>
            <select
              value={activeProject?.id || ''}
              onChange={(e) => {
                const found = projects.find((p) => p.id === e.target.value) || null;
                setActiveProject(found);
              }}
              className="bg-pw-navy border border-pw-border rounded-lg px-3 py-1.5 text-xs font-semibold text-white min-w-[240px]"
            >
              {projects.length === 0 && <option value="">No project imported</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.playwrightVersion})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-mono">
              Tests: {allTests.length}
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-sky-300 font-mono">
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
            <FlakyAndPerformancePage mode={route} project={activeProject} />
          )}

          {route === 'scheduler' && <SchedulerPage project={activeProject} />}

          {(route === 'reports' || route === 'history') && (
            <ReportsAndHistoryPage
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
