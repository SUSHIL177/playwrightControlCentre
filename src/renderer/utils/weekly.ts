import { ExecutionBatch } from '@shared/types';
import { toMinutes } from '@shared/format';

export interface WeekBucket {
  /** Monday 00:00 local epoch ms — stable key. */
  key: number;
  /** "Nov 3" — week start (x-axis). */
  label: string;
  /** "Nov 3 – Nov 9, 2026" — tooltip/table range. */
  rangeLabel: string;
  runs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  passPct: number;
  avgDurationMin: number;
}

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const MAX_WEEK_LIMIT = 26;
export const WEEK_PRESETS = [2, 4, 8, 12] as const;

export function startOfMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - offset);
  return x;
}

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Bucket batches into Monday-start weeks. Either pass `weeks` (preset: N most recent
 * weeks including the current one) or an explicit `from`/`to` date range — custom ranges
 * are clamped to `maxWeeks` so the view never explodes.
 */
export function buildWeekBuckets(
  batches: ExecutionBatch[],
  opts: { weeks?: number; from?: string; to?: string; maxWeeks?: number } = {}
): WeekBucket[] {
  const cap = Math.max(1, Math.min(MAX_WEEK_LIMIT, opts.maxWeeks ?? MAX_WEEK_LIMIT));
  const currentMonday = startOfMonday(new Date());

  // Parse custom range inputs (yyyy-mm-dd from <input type="date">)
  let rangeStart = startOfMonday(new Date(currentMonday.getTime() - ((Math.max(1, Math.min(cap, opts.weeks ?? 4))) - 1) * WEEK_MS));
  let rangeEnd = currentMonday;
  if (opts.from || opts.to) {
    const parsedFrom = opts.from ? startOfMonday(new Date(`${opts.from}T00:00:00`)) : null;
    const parsedTo = opts.to ? startOfMonday(new Date(`${opts.to}T00:00:00`)) : null;
    if (parsedTo && !Number.isNaN(+parsedTo)) rangeEnd = parsedTo;
    if (parsedFrom && !Number.isNaN(+parsedFrom)) rangeStart = parsedFrom;
    else rangeStart = startOfMonday(new Date(rangeEnd.getTime() - (cap - 1) * WEEK_MS));
    if (rangeStart.getTime() > rangeEnd.getTime()) rangeStart = new Date(rangeEnd.getTime());
    // Weekly limit clamp — newest weeks win when the range is too wide.
    const weeksSpan = Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / WEEK_MS) + 1;
    if (weeksSpan > cap) {
      rangeStart = new Date(rangeEnd.getTime() - (cap - 1) * WEEK_MS);
    }
  }

  const buckets: WeekBucket[] = [];
  for (let cur = new Date(rangeStart); cur.getTime() <= rangeEnd.getTime(); cur = new Date(cur.getTime() + WEEK_MS)) {
    const end = new Date(cur.getTime() + WEEK_MS - DAY_MS);
    buckets.push({
      key: cur.getTime(),
      label: fmtDay(cur),
      rangeLabel: `${fmtDay(cur)} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      runs: 0,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      passPct: 0,
      avgDurationMin: 0,
    });
  }

  const byKey = new Map(buckets.map((b) => [b.key, b] as const));
  for (const b of batches) {
    const dt = new Date(b.startTime);
    if (Number.isNaN(+dt)) continue;
    const week = startOfMonday(dt).getTime();
    const bucket = byKey.get(week);
    if (!bucket) continue;
    bucket.runs += 1;
    bucket.total += b.totalTests;
    bucket.passed += b.passed;
    bucket.failed += b.failed;
    bucket.skipped += b.skipped;
    bucket.flaky += b.flaky;
    bucket.avgDurationMin += b.durationMs;
  }

  for (const bucket of buckets) {
    bucket.passPct = bucket.total > 0 ? Math.round((bucket.passed / bucket.total) * 100) : 0;
    bucket.avgDurationMin = bucket.runs > 0 ? toMinutes(bucket.avgDurationMin / bucket.runs) : 0;
  }
  return buckets;
}

export { isoDate };
