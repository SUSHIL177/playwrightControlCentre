import { encryptSecret, decryptSecret } from '../platform/runtime';
import { AppSettings } from '../../shared/types';
import { getDb } from '../database/db';

const DEFAULT_SETTINGS: AppSettings = {
  defaultProjectId: '',
  defaultBrowser: 'chromium',
  defaultEnvironment: 'staging',
  defaultHeaded: false,
  defaultWorkers: 4,
  defaultRetries: 1,
  reportRetentionDays: 30,
  flakyMinRuns: 3,
  theme: 'dark',
  ai: {
    provider: 'heuristic_offline',
    apiKeyConfigured: false,
    model: 'gemini-2.5-flash',
    endpoint: '',
    analysisEnabled: true,
    healingEnabled: true,
  },
};

export class SettingsService {
  getSettings(): AppSettings {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'main_settings'`).get() as { value: string } | undefined;
    const hasKey = Boolean(db.prepare(`SELECT value FROM app_settings WHERE key = 'ai_api_key_enc'`).get());

    if (!row) {
      return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, apiKeyConfigured: hasKey } };
    }
    const parsed = JSON.parse(row.value) as AppSettings;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        ...(parsed.ai || {}),
        apiKeyConfigured: hasKey,
      },
    };
  }

  saveSettings(settings: AppSettings): AppSettings {
    const db = getDb();
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('main_settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(settings));
    return this.getSettings();
  }

  saveApiKey(rawApiKey: string): void {
    const db = getDb();
    if (!rawApiKey.trim()) {
      db.prepare(`DELETE FROM app_settings WHERE key = 'ai_api_key_enc'`).run();
      return;
    }
    const payload = encryptSecret(rawApiKey.trim());

    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('ai_api_key_enc', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(payload);
  }

  saveGitToken(rawToken: string): void {
    const db = getDb();
    const token = rawToken.trim();
    if (!token) {
      db.prepare(`DELETE FROM app_settings WHERE key = 'git_import_token_enc'`).run();
      return;
    }
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('git_import_token_enc', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(encryptSecret(token));
  }

  getGitToken(): string | null {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'git_import_token_enc'`).get() as { value: string } | undefined;
    if (!row) return null;
    return decryptSecret(row.value);
  }

  hasGitToken(): boolean {
    const db = getDb();
    return Boolean(db.prepare(`SELECT value FROM app_settings WHERE key = 'git_import_token_enc'`).get());
  }

  getApiKey(): string | null {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'ai_api_key_enc'`).get() as { value: string } | undefined;
    if (!row) return null;
    return decryptSecret(row.value);
  }
}
