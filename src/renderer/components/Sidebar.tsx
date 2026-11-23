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
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeRoute,
  onSelectRoute,
  failureCount,
  proposalCount,
  reportCount,
}) => {
  return (
    <aside className="w-64 shrink-0 bg-pw-slate border-r border-pw-border flex flex-col h-full select-none">
      <div className="h-14 px-4 flex items-center gap-3 border-b border-pw-border">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center font-bold text-slate-950 text-sm shadow">
          PW
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm text-white tracking-tight">Playwright</div>
          <div className="text-[11px] text-sky-400 font-medium">Control Center</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeRoute === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectRoute(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'failures' && failureCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-500/20 text-rose-300 font-semibold">
                  {failureCount}
                </span>
              )}
              {item.id === 'healing' && proposalCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500/20 text-amber-300 font-semibold">
                  {proposalCount}
                </span>
              )}
              {item.id === 'reports' && reportCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-sky-500/20 text-sky-300 font-semibold">
                  {reportCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
