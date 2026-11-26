import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FolderGit2,
  FolderTree,
  PlayCircle,
  TerminalSquare,
  Bug,
  Wrench,
  Activity,
  Globe,
  FileDiff,
  Sparkles,
  CalendarClock,
  FileBarChart2,
  History,
  FolderSearch,
  Settings,
  Users,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { NavRoute } from '@shared/types';

interface SidebarProps {
  activeRoute: NavRoute;
  onSelectRoute: (route: NavRoute) => void;
  failureCount: number;
  proposalCount: number;
  reportCount: number;
  /** Hosted mode extras */
  webMode?: boolean;
  isAdmin?: boolean;
  username?: string | null;
  onSignOut?: () => void;
}

const NAV_ITEMS: Array<{ id: NavRoute; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Project Configuration', icon: FolderGit2 },
  { id: 'explorer', label: 'Test Explorer', icon: FolderTree },
  { id: 'execution', label: 'Execution Center', icon: PlayCircle },
  { id: 'terminal', label: 'Live Terminal', icon: TerminalSquare },
  { id: 'failures', label: 'Failure Intelligence', icon: Bug },
  { id: 'healing', label: 'AI Self-Healing', icon: Wrench },
  { id: 'flaky', label: 'Flaky Intelligence', icon: Activity },
  { id: 'cross-browser', label: 'Cross-Browser', icon: Globe },
  { id: 'code-fix', label: 'Code Fix Review', icon: FileDiff },
  { id: 'improve', label: 'Test Advisor', icon: Sparkles },
  { id: 'scheduler', label: 'Regression Scheduler', icon: CalendarClock },
  { id: 'reports', label: 'Reports Center', icon: FileBarChart2 },
  { id: 'history', label: 'Execution History', icon: History },
  { id: 'artifacts', label: 'Test Artifacts', icon: FolderSearch },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'team', label: 'Team Access', icon: Users },
];

const badgeFor = (id: NavRoute, failureCount: number, proposalCount: number, reportCount: number): number | null => {
  if (id === 'failures') return failureCount;
  if (id === 'healing' || id === 'code-fix') return proposalCount;
  if (id === 'reports' || id === 'history') return reportCount;
  return null;
};

const badgeStyles = (id: NavRoute): string =>
  id === 'failures'
    ? 'bg-rose-500/20 text-rose-300'
    : id === 'healing' || id === 'code-fix'
    ? 'bg-amber-500/20 text-amber-300'
    : 'bg-sky-500/20 text-sky-300';

const STORAGE_KEY = 'pacc.sidebar.collapsed';

export const Sidebar: React.FC<SidebarProps> = ({
  activeRoute,
  onSelectRoute,
  failureCount,
  proposalCount,
  reportCount,
  webMode = false,
  isAdmin = false,
  username = null,
  onSignOut,
}) => {
  // Desktop icon-rail vs full width — user-controlled, persisted. Mobile is always icon-rail.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Smart collapse/expand: icon-only control, plus a ⌘/Ctrl+B shortcut —
  // ignored while the user is typing in an input/editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      toggleCollapsedRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsedRef = React.useRef<() => void>(() => {});

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — keep in-memory state */
      }
      return next;
    });
  };
  toggleCollapsedRef.current = toggleCollapsed;

  const items = NAV_ITEMS.filter((item) => item.id !== 'team' || (webMode && isAdmin));
  const labelCls = collapsed ? 'hidden' : 'hidden md:inline';
  const badgeCls = collapsed ? 'hidden' : 'hidden md:inline-block';
  const rowCls = collapsed ? 'justify-center' : 'justify-center md:justify-between';

  return (
    <aside
      className={`${
        collapsed ? 'w-14' : 'w-14 md:w-64'
      } shrink-0 bg-pw-slate border-r border-pw-border flex flex-col h-full select-none transition-all duration-200`}
    >
      <div
        className={`h-14 px-2 flex items-center gap-3 border-b border-pw-border ${
          collapsed ? 'justify-center' : 'justify-center md:justify-start md:px-4'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center font-bold text-slate-950 text-sm shadow shrink-0">
          PW
        </div>
        <div className={`leading-tight ${collapsed ? 'hidden' : 'hidden md:block'}`}>
          <div className="font-semibold text-sm text-white tracking-tight">Playwright</div>
          <div className="text-[11px] text-sky-400 font-medium">Control Center</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5 md:px-2 space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          const count = badgeFor(item.id, failureCount, proposalCount, reportCount);
          return (
            <button
              key={item.id}
              onClick={() => onSelectRoute(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center ${rowCls} px-2 md:px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 border border-transparent hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate justify-center md:justify-start">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
                <span className={`truncate ${labelCls}`}>{item.label}</span>
              </span>
              {count !== null && count > 0 && (
                <span className={`${badgeCls} px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${badgeStyles(item.id)}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse / expand toggle */}
      <div className="border-t border-pw-border p-2 shrink-0">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar (\u2318B)' : 'Collapse sidebar (\u2318B)'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={`w-full flex items-center gap-2.5 px-2 md:px-3 py-2 rounded-md text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors ${
            collapsed ? 'justify-center' : 'justify-center md:justify-start'
          }`}
        >
          <span className="relative flex items-center justify-center">
            {collapsed ? (
              <ChevronsRight className="w-4 h-4 shrink-0 transition-transform duration-200" />
            ) : (
              <ChevronsLeft className="w-4 h-4 shrink-0 transition-transform duration-200" />
            )}
          </span>
        </button>
      </div>

      {webMode && (
        <div className="border-t border-pw-border p-2 md:p-3 shrink-0">
          {collapsed ? (
            <button
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="w-full p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <>
              <div className="hidden md:flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Signed in</div>
                  <div className="text-xs font-semibold text-slate-200 truncate">{username || '…'}</div>
                </div>
                <button
                  onClick={onSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="md:hidden w-full p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex justify-center"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
