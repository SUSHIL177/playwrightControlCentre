import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectDiscoveryService } from '../main/services/ProjectDiscoveryService';
import { ExecutionEngineService } from '../main/services/ExecutionEngineService';
import { FailureIntelligenceService } from '../main/services/FailureIntelligenceService';
import { AnalyticsIntelligenceService } from '../main/services/AnalyticsIntelligenceService';
import { SchedulerAndReportService } from '../main/services/SchedulerAndReportService';
import { SettingsService } from '../main/services/SettingsService';
import { ArtifactCatalogService } from '../main/services/ArtifactCatalogService';
import { SpecAnalysisService } from '../main/services/SpecAnalysisService';
import { ImprovementAdvisorService } from '../main/services/ImprovementAdvisorService';
import { createDispatch, type DispatchServices, type DispatchHooks } from './dispatchCore';
import {
  clearLoginFailures,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  listUsers,
  loginLockedOut,
  recordLoginFailure,
  resolveSession,
  resetPassword,
  usersExist,
  verifyLogin,
  withTenant,
  type SessionInfo,
} from './auth';
import { openHub, tenantRootFor } from './hub';
import { defaultDataRoot } from '../main/platform/tenant';

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PACC_PORT || process.env.PORT || 8080);
const HOST = process.env.PACC_HOST || '0.0.0.0';
const DIST_ROOT = path.resolve(__dirname, '..', '..', 'dist');
const SECURE_COOKIES = process.env.PACC_SECURE_COOKIES === '1';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const MAX_SSE_PER_USER = 20;

const COOKIE_NAME = 'pacc_session';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

// ── Service composition (identical to the desktop app) ──────────────────────
const settingsService = new SettingsService();
const discoveryService = new ProjectDiscoveryService();
const executionService = new ExecutionEngineService();
const failureService = new FailureIntelligenceService(settingsService);
const analyticsService = new AnalyticsIntelligenceService();
const schedulerReportService = new SchedulerAndReportService(executionService);
const artifactService = new ArtifactCatalogService();
const specAnalysisService = new SpecAnalysisService();
const improvementAdvisorService = new ImprovementAdvisorService();

const services: DispatchServices = {
  discovery: discoveryService,
  execution: executionService,
  failure: failureService,
  analytics: analyticsService,
  schedulerReport: schedulerReportService,
  settings: settingsService,
  artifacts: artifactService,
  specAnalysis: specAnalysisService,
  improvement: improvementAdvisorService,
};

// ── SSE fan-out, strictly per tenant ─────────────────────────────────────────
const sseClients = new Map<string, Set<http.ServerResponse>>();
const sseSend = (userId: string, event: string, data: any) => {
  const set = sseClients.get(userId);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(msg);
    } catch {
      set.delete(res);
    }
  }
};

setInterval(() => {
  for (const set of sseClients.values()) {
    for (const res of set) {
      try {
        res.write(': ping\n\n');
      } catch {
        /* cleaned up on close */
      }
    }
  }
}, 25000).unref();

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function securityHeaders(res: http.ServerResponse, opts: { relaxedReportCsp?: boolean } = {}): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    opts.relaxedReportCsp
      ? "default-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob: http: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'"
      : // The SPA needs inline styles (Tailwind is a file) — scripts are external only.
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:"
  );
}

function sendJson(res: http.ServerResponse, status: number, payload: any): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendRedirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sessionCookie(token: string, maxAgeSec: number): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (SECURE_COOKIES) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      raw += chunk.toString('utf-8');
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function clientKey(req: http.IncomingMessage, username: string): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  const ip = (fwd.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
  return `${ip}|${username.toLowerCase()}`;
}

/** Hosted-mode POST guard: custom header required + Origin must match Host when present. */
function postGuard(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.headers['x-pacc-web'] !== '1') {
    sendJson(res, 403, { ok: false, error: 'Missing x-pacc-web header.' });
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== req.headers.host) {
        sendJson(res, 403, { ok: false, error: 'Origin mismatch.' });
        return false;
      }
    } catch {
      sendJson(res, 403, { ok: false, error: 'Bad Origin header.' });
      return false;
    }
  }
  return true;
}

function safeResolve(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

function isMimeExtension(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// ── Static pages ─────────────────────────────────────────────────────────────
const pageShell = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Playwright Automation Control Center</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0F172A;
           font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #E2E8F0; }
    .card { width: 100%; max-width: 380px; background: #1E293B; border: 1px solid #334155; border-radius: 16px;
            padding: 28px 26px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
    .logo .mark { width: 36px; height: 36px; border-radius: 10px; background: #2563EB; display: grid; place-items: center;
                  color: #fff; font-weight: 800; font-size: 18px; }
    h1 { font-size: 17px; margin: 0; }
    p.sub { color: #94A3B8; font-size: 12px; margin: 4px 0 18px; }
    label { display: block; font-size: 11px; font-weight: 600; color: #CBD5E1; margin: 12px 0 6px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155;
            background: #0F172A; color: #F1F5F9; font-size: 14px; outline: none; }
    input:focus { border-color: #38BDF8; }
    button { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 10px; background: #2563EB; color: #fff;
             font-weight: 700; font-size: 13px; cursor: pointer; }
    button:hover { background: #1D4ED8; }
    button:disabled { opacity: .6; cursor: wait; }
    .err { display: none; margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: rgba(244,63,94,.15);
           border: 1px solid rgba(244,63,94,.4); color: #FDA4AF; font-size: 12px; }
    .foot { margin-top: 16px; font-size: 10px; color: #64748B; text-align: center; }
  </style>
</head>
<body>
${body}
</body>
</html>`;

const LOGIN_HTML = pageShell('Sign in', `
  <form id="f" class="card" autocomplete="on">
    <div class="logo"><div class="mark">P</div><div><h1>Playwright Control Center</h1><p class="sub">Team workspace</p></div></div>
    <label for="u">Username</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus />
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required />
    <button id="b" type="submit">Sign in</button>
    <div id="err" class="err"></div>
    <div class="foot">Access is invite-only — ask your pacc admin for an account.</div>
  </form>
  <script>
    const f = document.getElementById('f');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = document.getElementById('b');
      const err = document.getElementById('err');
      b.disabled = true; err.style.display = 'none';
      try {
        const resp = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pacc-web': '1' },
          body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) { window.location.replace('/'); return; }
        err.textContent = data.error || 'Sign-in failed.';
        err.style.display = 'block';
      } catch (e2) {
        err.textContent = 'Server unreachable. Try again.';
        err.style.display = 'block';
      } finally { b.disabled = false; }
    });
  </script>`);

const SETUP_HTML = pageShell('Create admin account', `
  <form id="f" class="card" autocomplete="on">
    <div class="logo"><div class="mark">P</div><div><h1>Welcome to pacc</h1><p class="sub">Create the first administrator account</p></div></div>
    <label for="u">Admin username</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus />
    <label for="d">Display name (optional)</label>
    <input id="d" name="displayName" autocomplete="name" />
    <label for="p">Password (min 8 chars)</label>
    <input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required />
    <button id="b" type="submit">Create admin &amp; continue</button>
    <div id="err" class="err"></div>
    <div class="foot">This screen disappears forever once the first account exists.</div>
  </form>
  <script>
    const f = document.getElementById('f');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = document.getElementById('b');
      const err = document.getElementById('err');
      b.disabled = true; err.style.display = 'none';
      try {
        const resp = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pacc-web': '1' },
          body: JSON.stringify({
            username: document.getElementById('u').value,
            displayName: document.getElementById('d').value,
            password: document.getElementById('p').value,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) { window.location.replace('/'); return; }
        err.textContent = data.error || 'Setup failed.';
        err.style.display = 'block';
      } catch (e2) {
        err.textContent = 'Server unreachable. Try again.';
        err.style.display = 'block';
      } finally { b.disabled = false; }
    });
  </script>`);

const sendHtml = (res: http.ServerResponse, html: string) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
};

// ── Request handling ─────────────────────────────────────────────────────────
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();
  const relaxedReportCsp = pathname.startsWith('/reports/');
  securityHeaders(res, { relaxedReportCsp });

  const cookies = parseCookies(req);
  const session = await resolveSession(cookies[COOKIE_NAME]);

  // Public routes
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  if (pathname === '/api/capabilities') {
    sendJson(res, 200, {
      webMode: true,
      authenticated: Boolean(session),
      username: session?.user.username ?? null,
      role: session?.user.role ?? null,
      headedAvailable: false,
      nativeDialogs: false,
    });
    return;
  }
  if (pathname === '/api/login' && method === 'POST') {
    if (!postGuard(req, res)) return;
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { ok: false, error: 'Bad JSON body.' });
      return;
    }
    const username = String(body?.username || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!username || !password) {
      sendJson(res, 400, { ok: false, error: 'Username and password are required.' });
      return;
    }
    const key = clientKey(req, username);
    const lockedMs = await loginLockedOut(key);
    if (lockedMs > 0) {
      sendJson(res, 429, { ok: false, error: `Too many failed attempts. Try again in ${Math.ceil(lockedMs / 60000)} min.` });
      return;
    }
    const user = await verifyLogin(username, password);
    if (!user) {
      await recordLoginFailure(key);
      sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
      return;
    }
    await clearLoginFailures(key);
    const { token, maxAgeSec } = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, maxAgeSec));
    sendJson(res, 200, { ok: true, user: { username: user.username, role: user.role } });
    return;
  }
  if (pathname === '/api/setup' && method === 'POST') {
    if (!postGuard(req, res)) return;
    if (await usersExist()) {
      sendJson(res, 403, { ok: false, error: 'Setup already completed — an admin account exists.' });
      return;
    }
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { ok: false, error: 'Bad JSON body.' });
      return;
    }
    try {
      const admin = await createUser(String(body?.username || ''), String(body?.password || ''), 'admin', String(body?.displayName || ''));
      const { token, maxAgeSec } = await createSession(admin.id);
      res.setHeader('Set-Cookie', sessionCookie(token, maxAgeSec));
      sendJson(res, 200, { ok: true, user: { username: admin.username, role: admin.role } });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || 'Setup failed.' });
    }
    return;
  }
  if (pathname === '/api/logout' && method === 'POST') {
    if (!postGuard(req, res)) return;
    await destroySession(cookies[COOKIE_NAME]);
    res.setHeader('Set-Cookie', clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === '/login' && method === 'GET') {
    if (session) return sendRedirect(res, '/');
    if (!(await usersExist())) return sendRedirect(res, '/setup');
    return sendHtml(res, LOGIN_HTML);
  }
  if (pathname === '/setup' && method === 'GET') {
    if (await usersExist()) return sendRedirect(res, '/login');
    return sendHtml(res, SETUP_HTML);
  }

  // ── Everything below requires authentication ───────────────────────────────
  if (!session) {
    if (pathname.startsWith('/api/')) {
      sendJson(res, 401, { ok: false, error: 'Authentication required.' });
    } else {
      sendRedirect(res, '/login');
    }
    return;
  }

  if (pathname === '/api/me' && method === 'GET') {
    sendJson(res, 200, { username: session.user.username, role: session.user.role, displayName: session.user.displayName });
    return;
  }

  // ── Admin team management ──────────────────────────────────────────────────
  if (pathname.startsWith('/api/team/')) {
    if (session.user.role !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'Admin role required.' });
      return;
    }
    if (method !== 'GET' && !postGuard(req, res)) return;
    const sub = pathname.slice('/api/team/'.length);
    try {
      if (sub === 'users' && method === 'GET') {
        sendJson(res, 200, { users: await listUsers() });
        return;
      }
      if (sub === 'users' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const user = await createUser(String(body?.username || ''), String(body?.password || ''), body?.role === 'admin' ? 'admin' : 'member', String(body?.displayName || ''));
        sendJson(res, 200, { ok: true, user });
        return;
      }
      const resetMatch = sub.match(/^users\/([^/]+)\/reset$/);
      if (resetMatch && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        await resetPassword(resetMatch[1], String(body?.password || ''));
        sendJson(res, 200, { ok: true });
        return;
      }
      const delMatch = sub.match(/^users\/([^/]+)$/);
      if (delMatch && method === 'DELETE') {
        if (delMatch[1] === session.user.id) {
          sendJson(res, 400, { ok: false, error: 'You cannot delete your own account.' });
          return;
        }
        await deleteUser(delMatch[1]);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'Unknown team endpoint.' });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || 'Team operation failed.' });
    }
    return;
  }

  // ── RPC (all controller actions) ────────────────────────────────────────────
  if (pathname === '/api/rpc' && method === 'POST') {
    if (!postGuard(req, res)) return;
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { ok: false, error: 'Bad JSON body.' });
      return;
    }
    const rpcMethod = String(body?.method || '');
    const args = Array.isArray(body?.args) ? body.args : [];
    try {
      const result = await withTenant(session, async (ctx, db) => {
        const dispatch = createDispatch(services, {
          emitEvent: (channel, payload) => sseSend(ctx.userId, channel, payload),
          getMainWindow: () => null,
          isWeb: true,
        });
        return dispatch(rpcMethod, args);
      });
      sendJson(res, 200, { ok: true, result });
    } catch (err: any) {
      sendJson(res, 400, { ok: false, error: err?.message || String(err) });
    }
    return;
  }

  // ── SSE events (per tenant) ────────────────────────────────────────────────
  if (pathname === '/api/events' && method === 'GET') {
    const userSet = sseClients.get(session.user.id) ?? new Set();
    if (userSet.size >= MAX_SSE_PER_USER) {
      res.writeHead(429).end('Too many open event streams.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    userSet.add(res);
    sseClients.set(session.user.id, userSet);
    req.on('close', () => {
      userSet.delete(res);
      if (userSet.size === 0) sseClients.delete(session.user.id);
    });
    return;
  }

  // ── Archived Playwright reports (this tenant's data only) ─────────────────
  if (pathname.startsWith('/reports/') && method === 'GET') {
    const rest = pathname.slice('/reports/'.length);
    const slash = rest.indexOf('/');
    const batchId = slash === -1 ? rest : rest.slice(0, slash);
    const rel = slash === -1 ? 'index.html' : rest.slice(slash + 1) || 'index.html';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId)) {
      res.writeHead(404).end('Not found');
      return;
    }
    await withTenant(session, async (ctx, db) => {
      const row = db.prepare('SELECT id FROM execution_batches WHERE id = ?').get(batchId) as any;
      const execRoot = path.join(ctx.tenantRoot, 'executions');
      const reportDir = path.join(execRoot, batchId, 'html-report');
      // The batch must exist for THIS tenant and its archived folder must live inside the tenant root.
      if (!row || !fs.existsSync(reportDir)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Report not found.');
        return;
      }
      const target = safeResolve(reportDir, rel);
      if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': isMimeExtension(target), 'Cache-Control': 'private, max-age=60' });
      fs.createReadStream(target).pipe(res);
    });
    return;
  }

  // ── Artifact downloads (this tenant's projects only) ──────────────────────
  if (pathname.startsWith('/artifacts-file/') && method === 'GET') {
    const rest = pathname.slice('/artifacts-file/'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      res.writeHead(400).end('Bad path');
      return;
    }
    const projectId = decodeURIComponent(rest.slice(0, slash));
    const rel = rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/');
    try {
      await withTenant(session, async () => {
        const artifact = artifactService.getArtifactFile(projectId, rel);
        res.writeHead(200, {
          'Content-Type': artifact.mime,
          'Content-Length': String(artifact.sizeBytes),
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
          'Cache-Control': 'private, no-store',
        });
        fs.createReadStream(artifact.absolutePath).pipe(res);
      });
    } catch (err: any) {
      if (!res.headersSent) sendJson(res, 404, { ok: false, error: err?.message || 'Artifact not found.' });
    }
    return;
  }

  // ── SPA static assets / client routes ──────────────────────────────────────
  if (method === 'GET') {
    if (pathname.startsWith('/assets/')) return serveStatic(res, pathname, true);
    return serveStatic(res, '/index.html', false);
  }

  res.writeHead(405).end('Method not allowed');
}

function serveStatic(res: http.ServerResponse, urlPath: string, cacheImmutable: boolean): void {
  const rel = urlPath.replace(/^\/+/, '');
  const target = safeResolve(DIST_ROOT, rel);
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (!cacheImmutable) {
      const indexFile = safeResolve(DIST_ROOT, 'index.html');
      if (indexFile && fs.existsSync(indexFile)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        fs.createReadStream(indexFile).pipe(res);
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': isMimeExtension(target),
    'Cache-Control': cacheImmutable ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  fs.createReadStream(target).pipe(res);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  // Open the hub (accounts/sessions) and register every tenant's scheduled automation.
  const hub = await openHub();
  const userRows = hub.prepare('SELECT id FROM users').all() as any[];
  for (const row of userRows) {
    try {
      const tenantRoot = tenantRootFor(row.id);
      const { openUserDatabase } = await import('../main/database/db.js');
      const db = await openUserDatabase(tenantRoot, row.id);
      schedulerReportService.initPersistedSchedulesForTenant(
        { userId: row.id, username: '', role: 'member', tenantRoot, db },
        db,
        () => null
      );
    } catch (err) {
      console.error(`[pacc-web] Failed to arm schedules for tenant ${row.id}:`, err);
    }
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[pacc-web] Unhandled request error:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error.' });
      else res.end();
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[pacc-web] Playwright Automation Control Center listening on http://${HOST}:${PORT}`);
    console.log(`[pacc-web] Data directory: ${defaultDataRoot()}`);
    console.log('[pacc-web] Share the URL with your team. First run creates the admin account via /setup.');
  });

  const shutdown = () => {
    console.log('[pacc-web] Shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('[pacc-web] Fatal startup error:', err);
  process.exit(1);
});
