import { dayLabel } from "@/components/natasha/format";

/** Cost Explorer end dates are exclusive: the last day actually covered is the day before. */
export function lastDayOf(range: { Start: string; End: string }): string {
  const end = new Date(`${range.End.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return range.End;
  end.setUTCDate(end.getUTCDate() - 1);
  const last = end.toISOString().slice(0, 10);
  return last < range.Start ? range.Start.slice(0, 10) : last;
}

/** { Start: "2026-11-01", End: "2026-11-20" } → "1 – 19 Nov 2026" (or "1 – 19 Nov" with `year: false`). */
export function periodText(range: { Start: string; End: string }, opts: { year?: boolean } = {}): string {
  const last = lastDayOf(range);
  const from = dayLabel(range.Start);
  const to = dayLabel(last);
  const sameMonth = range.Start.slice(0, 7) === last.slice(0, 7);
  return `${sameMonth ? from.split(" ")[0] : from} – ${to}${opts.year === false ? "" : ` ${last.slice(0, 4)}`}`;
}

/** Number of days the range covers. */
export function periodDays(range: { Start: string; End: string }): number {
  const ms = new Date(`${range.End.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${range.Start.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000)) : 1;
}
