"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const electron_1 = require("electron");
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
        const payload = electron_1.safeStorage.isEncryptionAvailable()
            ? electron_1.safeStorage.encryptString(rawApiKey.trim()).toString('base64')
            : Buffer.from(rawApiKey.trim(), 'utf-8').toString('base64');
        db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('ai_api_key_enc', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(payload);
    }
    getApiKey() {
        const db = (0, db_1.getDb)();
        const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'ai_api_key_enc'`).get();
        if (!row)
            return null;
        const buf = Buffer.from(row.value, 'base64');
        return electron_1.safeStorage.isEncryptionAvailable() ? electron_1.safeStorage.decryptString(buf) : buf.toString('utf-8');
    }
}
exports.SettingsService = SettingsService;
