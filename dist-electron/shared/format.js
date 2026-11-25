"use strict";
/**
 * Shared display formatting helpers.
 * Durations are always presented in MINUTES across the whole product (never seconds).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMinutes = formatMinutes;
exports.toMinutes = toMinutes;
/** Milliseconds → minutes with adaptive precision, always with the "min" unit. */
function formatMinutes(durationMs, maxDigits = 1) {
    if (!Number.isFinite(durationMs) || durationMs <= 0)
        return '0.0 min';
    const minutes = durationMs / 60_000;
    const digits = minutes >= 1 ? maxDigits : 2;
    return `${minutes.toFixed(digits)} min`;
}
/** Raw numeric minutes (no unit) — for CSV export / chart series. */
function toMinutes(durationMs, precision = 2) {
    if (!Number.isFinite(durationMs) || durationMs <= 0)
        return 0;
    return Number((durationMs / 60_000).toFixed(precision));
}
