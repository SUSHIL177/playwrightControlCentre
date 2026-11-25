import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Trash2, KeyRound, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';

interface TeamUser {
  id: string;
  username: string;
  displayName: string | null;
  role: 'admin' | 'member';
}

const headers = { 'Content-Type': 'application/json', 'x-pacc-web': '1' };

/**
 * Hosted-mode admin page: the signed-in admin creates and maintains team accounts.
 * Only rendered for web sessions with the admin role — the server enforces the same.
 */
export const TeamPage: React.FC = () => {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');

  const refresh = async () => {
    setError(null);
    try {
      const resp = await fetch('/api/team/users', { headers, credentials: 'same-origin' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Failed to load users.');
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    withBusy(async () => {
      const resp = await fetch('/api/team/users', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || undefined,
          role: newRole,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Failed to create user.');
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRole('member');
    });

  const handleReset = (user: TeamUser) =>
    withBusy(async () => {
      const password = window.prompt(`New password for ${user.username} (min 8 chars)`);
      if (!password) return;
      const resp = await fetch(`/api/team/users/${encodeURIComponent(user.id)}/reset`, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Reset failed.');
    });

  const handleDelete = (user: TeamUser) =>
    withBusy(async () => {
      if (!window.confirm(`Delete ${user.username} and ALL of their data (workspace, runs, history)? This cannot be undone.`)) return;
      const resp = await fetch(`/api/team/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        headers,
        credentials: 'same-origin',
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Delete failed.');
    });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" /> Team Access
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Invite-only team accounts. Everyone gets a private workspace on this instance — own projects, runs, history and
            settings. Nothing is shared between users.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Per-user isolation enforced server-side
        </span>
      </div>

      {error && (
        <div className="px-4 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Create account */}
      <div className="bg-pw-panel border border-pw-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-sky-400" /> Create account
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="username (lowercase, 3–32)"
            autoCapitalize="none"
            spellCheck={false}
            className="bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
          />
          <input
            value={newDisplayName}
            onChange={(e) => setNewDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Temporary password (min 8 chars)"
            autoComplete="new-password"
            className="bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
          />
          <div className="flex gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
              className="flex-1 bg-pw-navy border border-pw-border rounded-lg px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={busy || newUsername.trim().length < 3 || newPassword.length < 8}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Add
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Share the credentials with the teammate over a secure channel — they can change the password after signing in (reset by an admin).
        </p>
      </div>

      {/* Existing accounts */}
      <div className="bg-pw-panel border border-pw-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-pw-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Accounts ({users.length})</h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
        </div>
        <ul className="divide-y divide-pw-border">
          {users.map((u) => (
            <li key={u.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-100">{u.username}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      u.role === 'admin' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {u.role}
                  </span>
                </div>
                {u.displayName && <div className="text-[11px] text-slate-500">{u.displayName}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReset(u)}
                  disabled={busy}
                  title="Set a new password"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium disabled:opacity-50"
                >
                  <KeyRound className="w-3.5 h-3.5" /> Reset password
                </button>
                <button
                  onClick={() => handleDelete(u)}
                  disabled={busy}
                  title="Delete account and all data"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 text-[11px] font-medium disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
