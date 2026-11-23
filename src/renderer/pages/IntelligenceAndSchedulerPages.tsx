import React, { useEffect, useState } from 'react';
import { CalendarPlus, Trash2, KeyRound, Save } from 'lucide-react';
import { AppSettings, FlakyTestMetric, ProjectConfig, ScheduleConfig } from '@shared/types';

export const FlakyAndPerformancePage: React.FC<{
  mode: 'flaky' | 'cross-browser' | 'performance';
  project: ProjectConfig | null;
  /** Bumped by the app whenever an execution batch completes — forces telemetry refetch. */
  refreshKey?: number;
}> = ({ mode, project, refreshKey = 0 }) => {
  const [flakyList, setFlakyList] = useState<FlakyTestMetric[]>([]);
  const [matrix, setMatrix] = useState<any[]>([]);
  const [perf, setPerf] = useState<{ slowTests: any[]; folderDurations: any[] }>({ slowTests: [], folderDurations: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    setLoadError(null);
    const request: Promise<any> =
      mode === 'flaky'
        ? window.pwControlCenter.getFlakyTests(project.id)
        : mode === 'cross-browser'
        ? window.pwControlCenter.getCrossBrowserMatrix(project.id)
        : window.pwControlCenter.getPerformanceBottlenecks(project.id);

    request
      .then((data) => {
        if (mode === 'flaky') setFlakyList(Array.isArray(data) ? data : []);
        else if (mode === 'cross-browser') setMatrix(Array.isArray(data) ? data : []);
        else setPerf(data && Array.isArray(data.slowTests) ? data : { slowTests: [], folderDurations: [] });
      })
      .catch((err) => {
        console.error('[ControlCenter] Failed to load intelligence telemetry:', err);
        setLoadError(err?.message || 'Failed to load telemetry for this project.');
      })
      .finally(() => setLoading(false));
  }, [mode, project, refreshKey]);

  if (!project) return <div className="p-8 text-slate-400">Import a project first.</div>;

  const errorBanner = loadError ? (
    <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">{loadError}</div>
  ) : null;

  if (mode === 'flaky') {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold text-white">Flaky Test Intelligence</h1>
        <p className="text-xs text-slate-400">
          Identifies tests exhibiting inconsistent pass/fail or retry behavior across minimum configured runs.
        </p>
        {errorBanner}
        <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-pw-slate text-slate-400 border-b border-pw-border">
              <tr>
                <th className="p-3">Test Name</th>
                <th className="p-3">Runs</th>
                <th className="p-3">Pass / Fail</th>
                <th className="p-3">Retries</th>
                <th className="p-3">Flakiness %</th>
                <th className="p-3">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pw-border/50">
              {flakyList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    {loading ? 'Loading flaky test telemetry…' : 'No flaky tests detected above threshold yet. Run multiple regression batches to build stability telemetry.'}
                  </td>
                </tr>
              ) : (
                flakyList.map((f) => (
                  <tr key={f.testId}>
                    <td className="p-3 font-medium text-white">{f.testTitle}</td>
                    <td className="p-3">{f.totalRuns}</td>
                    <td className="p-3">
                      <span className="text-emerald-400">{f.passCount}</span> /{' '}
                      <span className="text-rose-400">{f.failCount}</span>
                    </td>
                    <td className="p-3 text-amber-300">{f.retryCount}</td>
                    <td className="p-3 font-bold text-amber-400">{f.flakinessRate}%</td>
                    <td className="p-3 uppercase text-[11px] text-sky-300">{f.trend.replace('_', ' ')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (mode === 'cross-browser') {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold text-white">Cross-Browser Execution Matrix</h1>
        {errorBanner}
        <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-pw-slate text-slate-400 border-b border-pw-border">
              <tr>
                <th className="p-3">Test Case</th>
                <th className="p-3">Chromium</th>
                <th className="p-3">Firefox</th>
                <th className="p-3">WebKit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pw-border/50">
              {matrix.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-500">
                    {loading ? 'Loading cross-browser telemetry…' : 'No cross-browser runs recorded yet. Execute a batch to populate the matrix.'}
                  </td>
                </tr>
              ) : (
                matrix.map((row) => (
                  <tr key={row.testId}>
                    <td className="p-3 text-white font-medium">{row.testTitle}</td>
                    <td className="p-3 uppercase text-[11px]">{row.chromium?.status || '—'}</td>
                    <td className="p-3 uppercase text-[11px]">{row.firefox?.status || '—'}</td>
                    <td className="p-3 uppercase text-[11px]">{row.webkit?.status || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-white">Test Performance Intelligence & Bottlenecks</h1>
      {errorBanner}
      <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-pw-slate text-slate-400 border-b border-pw-border">
            <tr>
              <th className="p-3">Slowest Test Case</th>
              <th className="p-3">Browser</th>
              <th className="p-3">Avg Duration</th>
              <th className="p-3">Max Duration</th>
              <th className="p-3">Total Retries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pw-border/50">
            {perf.slowTests.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-500">
                  {loading ? 'Loading performance telemetry…' : 'No execution timings recorded yet. Execute a batch to identify bottlenecks.'}
                </td>
              </tr>
            ) : (
              perf.slowTests.map((t, idx) => (
                <tr key={idx}>
                  <td className="p-3 text-white font-medium">{t.testTitle}</td>
                  <td className="p-3 text-slate-300">{t.browser}</td>
                  <td className="p-3 text-amber-300 font-mono">{(t.avgDurationMs / 1000).toFixed(2)}s</td>
                  <td className="p-3 text-rose-300 font-mono">{(t.maxDurationMs / 1000).toFixed(2)}s</td>
                  <td className="p-3">{t.totalRetries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SchedulerPage: React.FC<{ project: ProjectConfig | null; refreshKey?: number }> = ({ project, refreshKey = 0 }) => {
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);
  const [name, setName] = useState('Nightly Full Regression');
  const [cronExpr, setCronExpr] = useState('0 2 * * *');
  const [environment, setEnvironment] = useState('staging');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    window.pwControlCenter
      .listSchedules()
      .then((list) => {
        setSchedules(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        console.error('[ControlCenter] Failed to load schedules:', err);
        setError(err?.message || 'Failed to load schedules.');
      });

  useEffect(() => {
    load();
  }, [refreshKey]);

  if (!project) return <div className="p-8 text-slate-400">Import a project first.</div>;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <h1 className="text-xl font-bold text-white">Persistent Regression Scheduler</h1>
      {error && (
        <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">{error}</div>
      )}
      <div className="bg-pw-panel border border-pw-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Schedule Name"
          className="bg-pw-navy border border-pw-border rounded px-3 py-2 text-white"
        />
        <input
          value={cronExpr}
          onChange={(e) => setCronExpr(e.target.value)}
          placeholder="Cron (e.g. 0 2 * * *)"
          className="bg-pw-navy border border-pw-border rounded px-3 py-2 text-sky-300 font-mono"
        />
        <input
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          placeholder="Environment"
          className="bg-pw-navy border border-pw-border rounded px-3 py-2 text-white"
        />
        <button
          onClick={async () => {
            setError(null);
            try {
              await window.pwControlCenter.saveSchedule({
                projectId: project.id,
                name,
                cronExpression: cronExpr,
                frequencyLabel: cronExpr,
                environment,
                browsers: ['chromium'],
                mode: 'full',
                workers: 4,
                headed: false,
                enabled: true,
                webhookUrl: webhookUrl.trim() ? webhookUrl.trim() : undefined,
              });
              load();
            } catch (err: any) {
              setError(err?.message || 'Failed to save schedule.');
            }
          }}
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-1.5 sm:col-span-2 lg:col-span-1"
        >
          <CalendarPlus className="w-4 h-4" /> Create Schedule
        </button>
        <input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="Optional Slack / Microsoft Teams Webhook URL"
          className="md:col-span-4 bg-pw-navy border border-pw-border rounded px-3 py-2 text-slate-200"
        />
      </div>

      <div className="space-y-2">
        {schedules.length === 0 && (
          <div className="bg-pw-panel border border-pw-border rounded-lg p-6 text-center text-slate-500 text-xs">
            No schedules yet. Create a cron schedule above to persist nightly regressions across app restarts.
          </div>
        )}
        {schedules.map((s) => (
          <div
            key={s.id}
            className="bg-pw-panel border border-pw-border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div>
              <div className="font-bold text-white">{s.name}</div>
              <div className="text-slate-400 font-mono mt-0.5">
                Cron: {s.cronExpression} • Env: {s.environment} • Last Run: {s.lastRunAt || 'Never'}
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await window.pwControlCenter.deleteSchedule(s.id);
                  load();
                } catch (err: any) {
                  setError(err?.message || 'Failed to delete schedule.');
                }
              }}
              title="Delete schedule"
              className="p-2 text-rose-400 hover:bg-rose-500/20 rounded"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    window.pwControlCenter
      .getSettings()
      .then(setSettings)
      .catch((err) => {
        console.error('[ControlCenter] Failed to load settings:', err);
        setLoadError(err?.message || 'Failed to load settings.');
      });
  }, []);

  if (loadError) {
    return <div className="p-6 text-rose-300 text-xs">Unable to load settings: {loadError}</div>;
  }

  if (!settings) return null;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-bold text-white">Application & AI Provider Settings</h1>

      <div className="bg-pw-panel border border-pw-border rounded-xl p-5 space-y-4 text-xs">
        <h2 className="text-sm font-semibold text-sky-400">AI Failure Intelligence & Self-Healing Provider</h2>
        <p className="text-slate-400">
          Credentials are encrypted using Windows DPAPI via Electron safeStorage. Core test execution and reporting work offline without an API key.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-slate-400 mb-1">AI Provider</label>
            <select
              value={settings.ai.provider}
              onChange={(e) =>
                setSettings({ ...settings, ai: { ...settings.ai, provider: e.target.value as any } })
              }
              className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-white"
            >
              <option value="heuristic_offline">Deterministic Offline Engine (No API Key)</option>
              <option value="gemini">Google Gemini API</option>
              <option value="openai">OpenAI / Compatible API</option>
              <option value="ollama">Ollama Local LLM</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Model Name</label>
            <input
              value={settings.ai.model}
              onChange={(e) => setSettings({ ...settings, ai: { ...settings.ai, model: e.target.value } })}
              className="w-full bg-pw-navy border border-pw-border rounded px-3 py-2 text-white font-mono"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={settings.ai.apiKeyConfigured ? '•••••••••••••••• (Key stored securely)' : 'Enter API Key'}
              className="w-full bg-pw-navy border border-pw-border rounded pl-8 pr-3 py-2 text-white"
            />
          </div>
          <button
            onClick={async () => {
              const updated = await window.pwControlCenter.saveApiKey(apiKeyInput);
              setSettings(updated);
              setApiKeyInput('');
              setSavedNotice(true);
            }}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold"
          >
            Store Credential
          </button>
        </div>

        <button
          onClick={async () => {
            const updated = await window.pwControlCenter.saveSettings(settings);
            setSettings(updated);
            setSavedNotice(true);
          }}
          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-2"
        >
          <Save className="w-4 h-4" /> Save Settings
        </button>

        {savedNotice && <div className="text-emerald-400">Settings persisted securely.</div>}
      </div>
    </div>
  );
};
