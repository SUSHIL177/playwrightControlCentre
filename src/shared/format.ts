/**
 * Shared display formatting helpers.
 * Durations are always presented in MINUTES across the whole product (never seconds).
 */

/** Milliseconds → minutes with adaptive precision, always with the "min" unit. */
export function formatMinutes(durationMs: number, maxDigits = 1): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0.0 min';
  const minutes = durationMs / 60_000;
  const digits = minutes >= 1 ? maxDigits : 2;
  return `${minutes.toFixed(digits)} min`;
}

/** Raw numeric minutes (no unit) — for CSV export / chart series. */
export function toMinutes(durationMs: number, precision = 2): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Number((durationMs / 60_000).toFixed(precision));
}
