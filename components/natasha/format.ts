/** Formatting helpers shared by the redesigned screens (ported from the design's data layer). */
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function usd(v: number | null | undefined, digits = 2): string {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const num = (v: number) => Math.round(v).toLocaleString("en-US");

/** 12345 → 12k, 1106 → 1,106: compact only from 10k up, as the design's tiles show. */
export function compact(v: number): string {
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`;
  return num(v);
}

export function axisUsd(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1000) return `${s}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(".0", "")}k`;
  return `${s}$${Number.isInteger(a) ? a : a.toFixed(1)}`;
}

export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 60_000) : null;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  let v = n / 1024;
  for (const u of ["KB", "MB", "GB"]) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TB`;
}

/** "2026-10" → "Oct 2026"; anything else passes through. */
export function monthLabel(key: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(key ?? "");
  return m ? `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}` : (key ?? "");
}

export const STALE_MINUTES = 36 * 60;
/** Older than maxMinutes (default 36 h, the twice-daily snapshot cadence plus slack). */
export const isStale = (iso: string | null | undefined, maxMinutes: number = STALE_MINUTES) => {
  const m = ageMinutes(iso);
  return m == null || m > maxMinutes;
};

/** "2026-11-18" or a full ISO timestamp → "18 Nov". Reads the calendar day as written, with no time-zone shift. */
export function dayLabel(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}` : "—";
}

const IST = "Asia/Kolkata";
function istParts(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  const t = iso instanceof Date ? iso : new Date(iso ?? NaN);
  return Number.isFinite(t.getTime()) ? t.toLocaleString("en-GB", { timeZone: IST, hour12: false, ...opts }) : "—";
}
/** "19 Nov 2026, 11:26 IST" */
export const istDateTime = (iso: string | Date | null | undefined) => {
  const s = istParts(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return s === "—" ? s : `${s} IST`;
};
/** "19 Nov 2026" in IST */
export const istDate = (iso: string | Date | null | undefined) => istParts(iso, { day: "numeric", month: "short", year: "numeric" });
/** "11:26:16" in IST (put "IST" in the column header) */
export const istTime = (iso: string | Date | null | undefined) => istParts(iso, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** 3561015092442 → "3.56 trillion"; below a million falls back to grouped digits. */
export function compactCount(v: number): string {
  const a = Math.abs(v);
  const units: Array<[number, string]> = [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"]];
  const hit = units.find(([size]) => a >= size);
  return hit ? `${(v / hit[0]).toFixed(2).replace(/\.?0+$/, "")} ${hit[1]}` : num(v);
}

export const CATEGORY_META: Array<{ key: string; color: string; blurb: string }> = [
  { key: "2.0", color: "var(--c20)", blurb: "Legacy V2 workloads" },
  { key: "3.0", color: "var(--c30)", blurb: "Current V3 platform" },
  { key: "Infra", color: "var(--cinfra)", blurb: "Shared platform services" },
  { key: "Dev", color: "var(--cdev)", blurb: "Development + staging" },
  { key: "Shared", color: "var(--cshared)", blurb: "Cross-team services" },
  { key: "Not using", color: "var(--cunused)", blurb: "Candidates to shut off" },
  { key: "Other", color: "var(--cother)", blurb: "Uncategorised" },
];

const SERVICE_SHORT: Record<string, string> = {
  "Amazon Relational Database Service": "RDS",
  "EC2 - Other": "EC2 · Other",
  "Amazon Elastic Compute Cloud - Compute": "EC2 · Compute",
  "Amazon Virtual Private Cloud": "VPC",
  AmazonCloudWatch: "CloudWatch",
  "Amazon Simple Storage Service": "S3",
  "Amazon Simple Email Service": "SES",
  "Amazon Simple Notification Service": "SNS",
  "Amazon Simple Queue Service": "SQS",
  "Amazon GuardDuty": "GuardDuty",
  "Amazon API Gateway": "API Gateway",
  "Amazon Route 53": "Route 53",
  "AWS Lambda": "Lambda",
};
export const shortService = (name: string) => SERVICE_SHORT[name] ?? name.replace(/^(Amazon|AWS)\s+/, "");
