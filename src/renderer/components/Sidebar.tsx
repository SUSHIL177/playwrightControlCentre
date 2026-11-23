import React from 'react';
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
  Gauge,
  CalendarClock,
  FileBarChart2,
  History,
  FolderSearch,
  Settings,
} from 'lucide-react';
import { NavRoute } from '@shared/types';

interface SidebarProps {
  activeRoute: NavRoute;
  onSelectRoute: (route: NavRoute) => void;
  failureCount: number;
  proposalCount: number;
  reportCount: number;
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
  { id: 'performance', label: 'Performance Intel', icon: Gauge },
  { id: 'scheduler', label: 'Regression Scheduler', icon: CalendarClock },
  { id: 'reports', label: 'Reports Center', icon: FileBarChart2 },
  { id: 'history', label: 'Execution History', icon: History },
  { id: 'artifacts', label: 'Test Artifacts', icon: FolderSearch },
  { id: 'settings', label: 'Settings', icon: Settings },
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

export const Sidebar: React.FC<SidebarProps> = ({
  activeRoute,
  onSelectRoute,
  failureCount,
  proposalCount,
  reportCount,
}) => {
  return (
    <aside className="w-14 md:w-64 shrink-0 bg-pw-slate border-r border-pw-border flex flex-col h-full select-none transition-all duration-200">
      <div className="h-14 px-2 md:px-4 flex items-center gap-3 border-b border-pw-border justify-center md:justify-start">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center font-bold text-slate-950 text-sm shadow shrink-0">
          PW
        </div>
        <div className="leading-tight hidden md:block">
          <div className="font-semibold text-sm text-white tracking-tight">Playwright</div>
          <div className="text-[11px] text-sky-400 font-medium">Control Center</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5 md:px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          const count = badgeFor(item.id, failureCount, proposalCount, reportCount);
          return (
            <button
              key={item.id}
              onClick={() => onSelectRoute(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`w-full flex items-center justify-center md:justify-between px-2 md:px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 border border-transparent hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate justify-center md:justify-start">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
                <span className="truncate hidden md:inline">{item.label}</span>
              </span>
              {count !== null && count > 0 && (
                <span
                  className={`hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${badgeStyles(item.id)}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
