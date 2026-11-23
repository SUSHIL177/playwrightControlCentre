import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

if (!window.pwControlCenter) {
  const BRIDGE_URL = 'http://127.0.0.1:17890';
  const rpc = async (method: string, ...args: any[]) => {
    const resp = await fetch(`${BRIDGE_URL}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Bridge RPC failed');
    return data.result;
  };

  let evtSource: EventSource | null = null;
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const subscribe = (event: string, cb: (payload: any) => void) => {
    if (!evtSource) {
      evtSource = new EventSource(`${BRIDGE_URL}/api/events`);
      ['exec:log-event', 'exec:completed-event', 'tests:changed-event', 'healing:progress-event'].forEach((evName) => {
        evtSource!.addEventListener(evName, (e: MessageEvent) => {
          const parsed = JSON.parse(e.data);
          listeners.get(evName)?.forEach((fn) => fn(parsed));
        });
      });
    }
    const set = listeners.get(event) || new Set();
    set.add(cb);
    listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  };

  window.pwControlCenter = {
    browseDirectory: () => rpc('browseDirectory'),
    importProject: (p: string) => rpc('importProject', p),
    listProjects: () => rpc('listProjects'),
    deleteProject: (id: string) => rpc('deleteProject', id),
    rescanProject: (id: string) => rpc('rescanProject', id),
    getTestTree: (id: string) => rpc('getTestTree', id),
    listTests: (id: string) => rpc('listTests', id),
    startWatchingTests: async () => true,
    onTestsChanged: (cb: any) => subscribe('tests:changed-event', cb),
    startExecution: (opts: any) => rpc('startExecution', opts),
    stopExecution: () => rpc('stopExecution'),
    getActiveExecutionStatus: () => rpc('getActiveExecutionStatus'),
    onTerminalLog: (cb: any) => subscribe('exec:log-event', cb),
    onExecutionCompleted: (cb: any) => subscribe('exec:completed-event', cb),
    listExecutionBatches: (id: string) => rpc('listExecutionBatches', id),
    getExecutionResults: (id: string) => rpc('getExecutionResults', id),
    compareBatches: (a: string, b: string) => rpc('compareBatches', a, b),
    deleteBatch: (id: string) => rpc('deleteBatch', id),
    openReportInBrowser: (p: string) => rpc('openReportInBrowser', p),
    startReportHosting: (p: string) => rpc('startReportHosting', p),
    revealReportInFolder: (p: string) => rpc('revealReportInFolder', p),
    listArtifacts: (id: string) => rpc('listArtifacts', id),
    previewArtifact: (id: string, rel: string) => rpc('previewArtifact', id, rel),
    openArtifact: (id: string, rel: string) => rpc('openArtifact', id, rel),
    revealArtifact: (id: string, rel: string) => rpc('revealArtifact', id, rel),
    analyzeBatchFailures: (id: string) => rpc('analyzeBatchFailures', id),
    listFailures: (id: string) => rpc('listFailures', id),
    reclassifyFailure: (id: string, c: any, cls: any) => rpc('reclassifyFailure', id, c, cls),
    generateHealingProposal: (id: string) => rpc('generateHealingProposal', id),
    validateProposal: (id: string, code?: string) => rpc('validateProposal', id, code),
    runProposalHeaded: (id: string, code?: string) => rpc('runProposalHeaded', id, code),
    approveAndApplyProposal: (id: string, code?: string) => rpc('approveAndApplyProposal', id, code),
    onHealingProgress: (cb: any) => subscribe('healing:progress-event', cb),
    rejectProposal: (id: string) => rpc('rejectProposal', id),
    rollbackProposal: (id: string) => rpc('rollbackProposal', id),
    listProposals: (id: string) => rpc('listProposals', id),
    getFlakyTests: (id: string, min?: number) => rpc('getFlakyTests', id, min),
    getCrossBrowserMatrix: (id: string) => rpc('getCrossBrowserMatrix', id),
    getPerformanceBottlenecks: (id: string) => rpc('getPerformanceBottlenecks', id),
    listSchedules: () => rpc('listSchedules'),
    saveSchedule: (cfg: any) => rpc('saveSchedule', cfg),
    deleteSchedule: (id: string) => rpc('deleteSchedule', id),
    getSettings: () => rpc('getSettings'),
    saveSettings: (s: any) => rpc('saveSettings', s),
    saveApiKey: (k: string) => rpc('saveApiKey', k),
  } as any;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
