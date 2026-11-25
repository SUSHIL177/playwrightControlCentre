"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const runtime_1 = require("../platform/runtime");
const db_1 = require("../database/db");
const DEFAULT_SETTINGS = {
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
class SettingsService {
    getSettings() {
        const db = (0, db_1.getDb)();
        const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'main_settings'`).get();
        const hasKey = Boolean(db.prepare(`SELECT value FROM app_settings WHERE key = 'ai_api_key_enc'`).get());
        if (!row) {
            return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, apiKeyConfigured: hasKey } };
        }
        const parsed = JSON.parse(row.value);
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
    saveSettings(settings) {
        const db = (0, db_1.getDb)();
        db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('main_settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(settings));
        return this.getSettings();
    }
    saveApiKey(rawApiKey) {
        const db = (0, db_1.getDb)();
        if (!rawApiKey.trim()) {
            db.prepare(`DELETE FROM app_settings WHERE key = 'ai_api_key_enc'`).run();
            return;
        }
        const payload = (0, runtime_1.encryptSecret)(rawApiKey.trim());
        db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('ai_api_key_enc', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(payload);
    }
    saveGitToken(rawToken) {
        const db = (0, db_1.getDb)();
        const token = rawToken.trim();
        if (!token) {
            db.prepare(`DELETE FROM app_settings WHERE key = 'git_import_token_enc'`).run();
            return;
        }
        db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('git_import_token_enc', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run((0, runtime_1.encryptSecret)(token));
    }
    getGitToken() {
        const db = (0, db_1.getDb)();
        const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'git_import_token_enc'`).get();
        if (!row)
            return null;
        return (0, runtime_1.decryptSecret)(row.value);
    }
    hasGitToken() {
        const db = (0, db_1.getDb)();
        return Boolean(db.prepare(`SELECT value FROM app_settings WHERE key = 'git_import_token_enc'`).get());
    }
    getApiKey() {
        const db = (0, db_1.getDb)();
        const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'ai_api_key_enc'`).get();
        if (!row)
            return null;
        return (0, runtime_1.decryptSecret)(row.value);
    }
}
exports.SettingsService = SettingsService;
