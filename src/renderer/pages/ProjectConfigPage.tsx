import React, { useState } from 'react';
import { FolderOpen, RefreshCw, Trash2, CheckCircle2, AlertTriangle, XCircle, GitBranch, KeyRound, Loader2, ShieldCheck, Info } from 'lucide-react';
import { ProjectConfig } from '@shared/types';
import { DESKTOP_CAPS, fetchCapabilities, type WebCapabilities } from '../webMode';

interface ProjectConfigPageProps {
  projects: ProjectConfig[];
  activeProject: ProjectConfig | null;
  onSelectProject: (p: ProjectConfig) => void;
  onRefreshProjects: () => Promise<void>;
}

export const ProjectConfigPage: React.FC<ProjectConfigPageProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onRefreshProjects,
}) => {
  const [manualPath, setManualPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [caps, setCaps] = useState<WebCapabilities>(DESKTOP_CAPS);
  const [gitUrl, setGitUrl] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [rememberToken, setRememberToken] = useState(false);
  const [useSavedToken, setUseSavedToken] = useState(false);
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitNote, setGitNote] = useState<string | null>(null);

  React.useEffect(() => {
    fetchCapabilities().then(setCaps).catch(() => undefined);
    window.pwControlCenter
      .hasGitToken?.()
      .then((v: boolean) => setHasSavedToken(Boolean(v)))
      .catch(() => setHasSavedToken(false));
  }, []);

  const handleBrowse = async () => {
    setError(null);
    try {
      const selected = await window.pwControlCenter.browseDirectory();
      if (selected) {
        setManualPath(selected);
        await handleImport(selected);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to open folder picker.');
    }
  };

  const handleGitImport = async () => {
    setError(null);
    setGitNote(null);
    const url = gitUrl.trim();
    if (!url) return;
    setGitLoading(true);
    try {
      const imported = await window.pwControlCenter.importProjectFromGit({
        url,
        branch: gitBranch.trim() || undefined,
        token: useSavedToken ? undefined : gitToken || undefined,
        useSavedToken,
        rememberToken,
      });
      await onRefreshProjects();
      onSelectProject(imported);
      setGitUrl('');
      setGitToken('');
      setGitBranch('');
      if (rememberToken) setHasSavedToken(true);
      setGitNote('Repository cloned into your workspace and project imported.');
    } catch (e: any) {
      setError(e?.message || 'Git import failed.');
    } finally {
      setGitLoading(false);
    }
  };

  const handleImport = async (targetPath = manualPath) => {
    const cleanedPath = targetPath.trim().replace(/^["']+|["']+$/g, '');
    if (!cleanedPath) return;
    setLoading(true);
    setError(null);
    try {
      const imported = await window.pwControlCenter.importProject(cleanedPath);
      await onRefreshProjects();
      onSelectProject(imported);
      setManualPath('');
    } catch (e: any) {
      setError(e.message || 'Failed to import project.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-white">Project Import & Framework Discovery</h1>
        <p className="text-xs text-slate-400 mt-1">
          Non-destructive discovery of existing Playwright + TypeScript frameworks. Original configs and fixtures remain untouched.
        </p>
      </div>

      <div className="bg-pw-panel border border-pw-border rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder={caps.webMode ? '/srv/pacc-work/my-playwright-framework' : 'D:\Projects\my-playwright-framework'}
            className="flex-1 bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
          />
          {!caps.webMode && (
            <button
              onClick={handleBrowse}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold flex items-center gap-2"
            >
              <FolderOpen className="w-4 h-4" /> Browse Folder
            </button>
          )}
          <button
            onClick={() => handleImport()}
            disabled={loading || !manualPath.trim()}
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold"
          >
            {loading ? 'Discovering...' : 'Import Project'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs">
            {error}
          </div>
        )}
        {caps.webMode && (
          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Hosted mode: local paths are limited to clones inside your own workspace. Importing from GitHub/GitLab/Azure DevOps below is the recommended path.
          </p>
        )}
      </div>

      {/* ── Import from Git ─────────────────────────────────────────────── */}
      <div className="bg-pw-panel border border-pw-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-sky-400" /> Import from Git
            </h2>
            <p className="text-[11px] text-slate-400 mt-1">
              Shallow clone over HTTPS into this instance, then discover tests. Works with GitHub, GitLab and Azure DevOps. Private repos need a personal access token.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
            <ShieldCheck className="w-3 h-3" /> Token is used once for the clone — never logged
          </span>
        </div>

        <input
          value={gitUrl}
          onChange={(e) => setGitUrl(e.target.value)}
          placeholder="https://github.com/your-org/your-playwright-framework.git"
          className="w-full bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
        />
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <KeyRound className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={useSavedToken ? '' : gitToken}
              disabled={useSavedToken}
              onChange={(e) => setGitToken(e.target.value)}
              placeholder={useSavedToken ? 'Using saved token from this instance' : 'Personal access token (private repos only)'}
              autoComplete="off"
              className="w-full bg-pw-navy border border-pw-border rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-60"
            />
          </div>
          <input
            value={gitBranch}
            onChange={(e) => setGitBranch(e.target.value)}
            placeholder="Branch (default: repo default)"
            className="sm:w-48 bg-pw-navy border border-pw-border rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
          />
          <button
            onClick={handleGitImport}
            disabled={gitLoading || !gitUrl.trim()}
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-2 justify-center"
          >
            {gitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
            {gitLoading ? 'Cloning…' : 'Clone & Import'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
          {hasSavedToken && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useSavedToken}
                onChange={(e) => setUseSavedToken(e.target.checked)}
                className="accent-sky-500"
              />
              Use saved token
            </label>
          )}
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberToken}
              onChange={(e) => setRememberToken(e.target.checked)}
              className="accent-sky-500"
            />
            Remember token (encrypted) on this instance
          </label>
        </div>
        {gitNote && <p className="text-[11px] text-emerald-300">{gitNote}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map((p) => {
          const isSelected = activeProject?.id === p.id;
          return (
            <div
              key={p.id}
              onClick={() => onSelectProject(p)}
              className={`bg-pw-panel border rounded-xl p-5 cursor-pointer transition-all ${
                isSelected ? 'border-sky-500 ring-1 ring-sky-500/40' : 'border-pw-border hover:border-slate-500'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">{p.name}</h3>
                    {p.validationStatus === 'valid' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {p.validationStatus === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                    {p.validationStatus === 'invalid' && <XCircle className="w-4 h-4 text-rose-400" />}
                  </div>
                  <p className="text-xs font-mono text-slate-400 mt-1 break-all">{p.rootPath}</p>
                </div>

                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={async () => {
                      await window.pwControlCenter.rescanProject(p.id);
                      await onRefreshProjects();
                    }}
                    title="Re-scan Project"
                    className="p-1.5 rounded hover:bg-slate-700 text-slate-300"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      await window.pwControlCenter.deleteProject(p.id);
                      await onRefreshProjects();
                    }}
                    title="Remove Project"
                    className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                <div className="bg-pw-navy/70 p-2 rounded">
                  <span className="text-slate-400">Playwright:</span>{' '}
                  <span className="text-sky-300 font-mono">{p.playwrightVersion}</span>
                </div>
                <div className="bg-pw-navy/70 p-2 rounded">
                  <span className="text-slate-400">Node.js:</span>{' '}
                  <span className="text-slate-200 font-mono">{p.nodeVersion}</span>
                </div>
                <div className="bg-pw-navy/70 p-2 rounded">
                  <span className="text-slate-400">Test Dir:</span>{' '}
                  <span className="text-emerald-300 font-mono">{p.testDir}</span>
                </div>
                <div className="bg-pw-navy/70 p-2 rounded">
                  <span className="text-slate-400">Browsers:</span>{' '}
                  <span className="text-slate-200">{p.browsersInstalled.join(', ')}</span>
                </div>
              </div>

              {p.validationMessages.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2.5">
                  {p.validationMessages.map((msg, idx) => (
                    <li key={idx}>• {msg}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
