/**
 * Date convention (confirmed by leadership, 2026-10-16):
 *   - Calendar days, no workday calendar.
 *   - Dates are inclusive. A task that starts on D with a duration of N days
 *     occupies D .. D+N-1, and its finish day is fully consumed.
 *
 * Dates are ISO "YYYY-MM-DD" strings with no time component, and all
 * arithmetic is done in UTC so that the result never depends on the server's
 * or the browser's timezone.
 */

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toUtcMs(value) !== null;
}

function toUtcMs(date: IsoDate): number | null {
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  // Rejects impossible dates such as 2026-02-30.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

function mustParse(date: IsoDate): number {
  const ms = toUtcMs(date);
  if (ms === null || !ISO_DATE.test(date)) throw new Error(`Invalid ISO date: ${date}`);
  return ms;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new Error(`Day offset must be an integer: ${days}`);
  return new Date(mustParse(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Signed number of calendar days from `from` to `to` (to - from). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((mustParse(to) - mustParse(from)) / MS_PER_DAY);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b; // ISO strings sort lexically in date order.
}

/** Inclusive finish for a task of `durationDays` (>= 1) starting on `start`. */
export function finishFromStart(start: IsoDate, durationDays: number): IsoDate {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error(`Duration must be a whole number of days >= 1: ${durationDays}`);
  }
  return addDays(start, durationDays - 1);
}

/** Inclusive duration in days between a start and finish date. */
export function inclusiveDuration(start: IsoDate, finish: IsoDate): number {
  return diffDays(start, finish) + 1;
}

/**
 * Earliest start for a finish-to-start successor. The predecessor's finish
 * day is consumed, so the successor can start the next day, plus any lag.
 */
export function earliestStartAfter(predecessorFinish: IsoDate, lagDays: number): IsoDate {
  return addDays(predecessorFinish, 1 + lagDays);
}

/**
 * Today's calendar date in an IANA time zone (the organization's or the
 * project's), so "overdue" flips at local midnight, not UTC midnight.
 */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days remaining until `target`, counted from `today`. */
export function daysUntil(target: IsoDate, today: IsoDate): number {
  return diffDays(today, target);
}
