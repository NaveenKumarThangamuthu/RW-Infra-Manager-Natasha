/** Response types and display constants shared by the Slow queries screen. */
import { MONTHS_SHORT } from "@/components/natasha/format";

export type { Kind, KindResult, LogsResp, Range, SampleEntry, SamplesResp } from "@/lib/slowQueryLogs";
export type { Note, OperationRow, StatementGroup, StatementKind, TimeoutTarget } from "@/lib/slowQueryParse";
import type { Kind, Range } from "@/lib/slowQueryLogs";
import type { StatementKind } from "@/lib/slowQueryParse";

export const RANGE_OPTIONS: Range[] = ["1h", "6h", "24h"];
export const RANGE_LABEL: Record<Range, string> = { "1h": "last hour", "6h": "last 6 hours", "24h": "last 24 hours" };

export const KIND_COLOR: Record<Kind, string> = {
  sqlFailed: "var(--danger)",
  deadlock: "var(--orange)",
  lockWait: "var(--warning)",
  readTimeout: "var(--info)",
  mongoNoServer: "var(--brand)",
  connPool: "var(--danger)",
  linkFailure: "var(--orange)",
  tooMany: "var(--warning)",
};

export const KIND_HINT: Partial<Record<Kind, string>> = {
  readTimeout: "Feign HTTP calls between services, not database calls.",
  mongoNoServer: "MongoDB driver could not reach a server.",
  sqlFailed: "Statements that MySQL rejected (Spring PreparedStatementCallback).",
};

export const STATEMENT_KIND: Record<StatementKind, { label: string; color: string; kind: Kind }> = {
  duplicate: { label: "Duplicate key", color: "var(--warning)", kind: "sqlFailed" },
  lockWait: { label: "Lock wait", color: "var(--orange)", kind: "lockWait" },
  deadlock: { label: "Deadlock", color: "var(--danger)", kind: "deadlock" },
  foreignKey: { label: "Foreign key", color: "var(--info)", kind: "sqlFailed" },
  other: { label: "Other", color: "var(--muted-fg)", kind: "sqlFailed" },
};

export const SEVERITY_COLOR = { critical: "var(--danger)", warning: "var(--warning)", info: "var(--info)" } as const;

export interface SampleTarget { kind: Kind; service: string | null }

const IST_MS = 330 * 60_000;
const p2 = (v: number) => String(v).padStart(2, "0");

/** ISO → "09:30" (IST) for chart axes, plus "Nov 12, 09:30 IST" for tooltips. */
export function istLabels(isos: string[]): { labels: string[]; full: string[] } {
  const parts = isos.map((iso) => {
    const t = new Date(new Date(iso).getTime() + IST_MS);
    const hm = `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
    return { hm, full: `${MONTHS_SHORT[t.getUTCMonth()]} ${t.getUTCDate()}, ${hm} IST` };
  });
  return { labels: parts.map((p) => p.hm), full: parts.map((p) => p.full) };
}

export function ms(v: number): string {
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

export const latencyColor = (v: number) => (v >= 3000 ? "var(--danger)" : v >= 1000 ? "var(--warning)" : "var(--fg)");
