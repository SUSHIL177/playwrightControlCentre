/**
 * Hosted-mode capability detection. In the Electron desktop the renderer is served from
 * disk and window.pwControlCenter is injected by the preload; in web mode the same SPA is
 * served by the pacc web server, which exposes /api/capabilities (session-proven).
 */
export interface WebCapabilities {
  webMode: boolean;
  authenticated: boolean;
  username: string | null;
  role: 'admin' | 'member' | null;
  headedAvailable: boolean;
  nativeDialogs: boolean;
}

export const DESKTOP_CAPS: WebCapabilities = {
  webMode: false,
  authenticated: true,
  username: null,
  role: null,
  headedAvailable: true,
  nativeDialogs: true,
};

let cached: WebCapabilities | null = null;

export async function fetchCapabilities(force = false): Promise<WebCapabilities> {
  if (cached && !force) return cached;
  try {
    const resp = await fetch('/api/capabilities', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('capabilities unavailable');
    const data = (await resp.json()) as Partial<WebCapabilities>;
    cached = {
      webMode: Boolean(data.webMode),
      authenticated: Boolean(data.authenticated),
      username: data.username ?? null,
      role: (data.role as WebCapabilities['role']) ?? null,
      headedAvailable: data.headedAvailable !== false,
      nativeDialogs: data.nativeDialogs !== false,
    };
  } catch {
    cached = { ...DESKTOP_CAPS };
  }
  return cached;
}
