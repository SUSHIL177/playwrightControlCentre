import http from 'http';
import type { BrowserWindow } from 'electron';
import { ProjectDiscoveryService } from '../services/ProjectDiscoveryService';
import { ExecutionEngineService } from '../services/ExecutionEngineService';
import { FailureIntelligenceService } from '../services/FailureIntelligenceService';
import { AnalyticsIntelligenceService } from '../services/AnalyticsIntelligenceService';
import { SchedulerAndReportService } from '../services/SchedulerAndReportService';
import { SettingsService } from '../services/SettingsService';
import { ArtifactCatalogService } from '../services/ArtifactCatalogService';
import { SpecAnalysisService } from '../services/SpecAnalysisService';
import { ImprovementAdvisorService } from '../services/ImprovementAdvisorService';
import { createDispatch, type DispatchServices, type DispatchHooks } from '../../server/dispatchCore';

/**
 * Desktop bridge for the no-Electron fallback: serves the same RPC surface over HTTP
 * (127.0.0.1 only) so the renderer can run in a plain browser against the desktop
 * backend. The hosted multi-user server lives in src/server/webServer.ts and shares
 * the exact same dispatch table (dispatchCore.ts).
 */
export class LocalBridgeServer {
  private server: http.Server | null = null;
  private sseClients = new Set<http.ServerResponse>();
  private dispatch: (method: string, args: any[]) => Promise<any>;

  constructor(
    private discoveryService: ProjectDiscoveryService,
    private executionService: ExecutionEngineService,
    private failureService: FailureIntelligenceService,
    private analyticsService: AnalyticsIntelligenceService,
    private schedulerReportService: SchedulerAndReportService,
    private settingsService: SettingsService,
    private artifactService: ArtifactCatalogService,
    private specAnalysis: SpecAnalysisService,
    private improvement: ImprovementAdvisorService,
    private getMainWindow: () => BrowserWindow | null
  ) {
    const services: DispatchServices = {
      discovery: discoveryService,
      execution: executionService,
      failure: failureService,
      analytics: analyticsService,
      schedulerReport: schedulerReportService,
      settings: settingsService,
      artifacts: artifactService,
      specAnalysis,
      improvement,
    };
    const hooks: DispatchHooks = {
      emitEvent: (channel, payload) => this.broadcast(channel, payload),
      getMainWindow: this.getMainWindow,
      isWeb: false,
    };
    this.dispatch = createDispatch(services, hooks);
  }

  broadcast(event: string, data: any): void {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      res.write(msg);
    }
  }

  start(port = 17890): void {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`);

      if (urlObj.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
        return;
      }

      if (urlObj.pathname === '/api/rpc' && req.method === 'POST') {
        let bodyRaw = '';
        req.on('data', (chunk) => (bodyRaw += chunk));
        req.on('end', async () => {
          try {
            const { method, args = [] } = JSON.parse(bodyRaw || '{}');
            const result = await this.dispatch(method, args);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.server.listen(port, '127.0.0.1');
  }
}
