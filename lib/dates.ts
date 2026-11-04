/** Date helpers for Cost Explorer. CE end dates are EXCLUSIVE. */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Start of the current month -> tomorrow (exclusive end), as YYYY-MM-DD. */
export function currentMonthRange(): { Start: string; End: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { Start: iso(start), End: iso(end) };
}

/** True if "YYYY-MM" refers to the current calendar month (UTC). */
export function isCurrentMonthKey(key?: string): boolean {
  if (!key) return true;
  const now = new Date();
  const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return key === cur;
}

/**
 * Range for a given "YYYY-MM" month. For the current month the end is tomorrow
 * (exclusive, month-to-date); for past months it's the first day of the next
 * month. Falls back to the current month if the key is missing/invalid.
 */
export function monthRange(key?: string): { Start: string; End: string } {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return currentMonthRange();
  if (isCurrentMonthKey(key)) return currentMonthRange();

  const [y, m] = key.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1)); // first day of next month
  return { Start: iso(start), End: iso(end) };
}

/**
 * Last N days ending tomorrow (exclusive). Resource-level cost data via
 * GetCostAndUsageWithResources is only retained for ~14 days, so we cap at 14.
 */
export function lastNDaysRange(days = 14): { Start: string; End: string } {
  const capped = Math.min(days, 14);
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - capped);
  return { Start: iso(start), End: iso(end) };
}

/** First day of the month n months ago -> tomorrow (exclusive). */
export function trailingMonthsRange(n = 12): { Start: string; End: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { Start: iso(start), End: iso(end) };
}

/** Returns the "YYYY-MM" key for the current month (UTC). */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Given a "YYYY-MM" key (or undefined = current), return the previous month's key. */
export function prevMonthKey(key?: string): string {
  const base = key && /^\d{4}-\d{2}$/.test(key) ? key : currentMonthKey();
  const [y, m] = base.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Tomorrow -> first day of next month (exclusive), for the spend forecast. */
export function restOfMonthRange(): { Start: string; End: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  // If today is the last day of the month, forecast the next full month instead.
  if (start >= end) {
    const nextStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    return { Start: iso(nextStart), End: iso(nextEnd) };
  }
  return { Start: iso(start), End: iso(end) };
}
