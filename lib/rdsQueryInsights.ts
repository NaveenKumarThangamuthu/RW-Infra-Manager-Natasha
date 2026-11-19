/**
 * Top-query analysis from MySQL performance_schema — READ ONLY.
 *
 * Runs the digest summary against the target RDS instance:
 *
 *   SELECT digest_text, count_star, sum_rows_examined, sum_timer_wait/1e12 AS sec
 *   FROM performance_schema.events_statements_summary_by_digest
 *   ORDER BY sum_rows_examined DESC LIMIT 15;
 *
 * The order can also be total time or average latency (`orderBy`), mapped
 * through a fixed column table so no caller input reaches the SQL text.
 *
 * rows_examined is the useful signal CloudWatch cannot give you: a statement
 * that examines millions of rows to return a handful is doing a scan, and that
 * is an index problem rather than a sizing problem.
 *
 * Credentials come from the encrypted secret store, per instance:
 *   RDS_<ID>_USER / RDS_<ID>_PASSWORD   (id upper-cased, non-alphanumerics -> _)
 * falling back to RDS_QUERY_USER / RDS_QUERY_PASSWORD for a shared read-only login.
 * Nothing is hardcoded and no credential is ever returned to the client.
 *
 * The account only needs SELECT on performance_schema. If it is missing, or the
 * instance is unreachable, the caller gets a structured `unavailable` result
 * with the reason — never a silent empty list, which would read as "no slow
 * queries" when in fact nothing was measured.
 */
import mysql from "mysql2/promise";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { getRdsClient } from "./aws";

export interface TopQuery {
  rank: number;
  digestText: string;
  countStar: number;
  sumRowsExamined: number;
  sumRowsSent: number;
  seconds: number;
  /** Average rows examined per execution. */
  rowsExaminedPerCall: number;
  /** Rows examined per row actually returned — the scan-ratio tell. */
  examinedPerSent: number | null;
  avgLatencyMs: number;
  noIndexUsedCount: number;
  fullScanRatio: number | null;
}

export interface QueryIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  evidence: string;
  action: string;
  digestText?: string;
}

export interface RdsQueryInsights {
  available: boolean;
  /** Why the analysis could not run, when available === false. */
  reason?: string;
  /** How to make it work, shown in the UI when unavailable. */
  remedy?: string;
  fetchedAt: string;
  instanceId: string;
  queries: TopQuery[];
  issues: QueryIssue[];
  /** performance_schema must be ON for any of this to mean anything. */
  performanceSchemaEnabled?: boolean;
}

export type QueryOrder = "rows" | "time" | "latency";

const ORDER_COLUMN: Record<QueryOrder, string> = {
  rows: "sum_rows_examined",
  time: "sum_timer_wait",
  latency: "avg_timer_wait",
};

export const isQueryOrder = (v: string | null): v is QueryOrder =>
  v != null && Object.prototype.hasOwnProperty.call(ORDER_COLUMN, v);

function credKey(instanceId: string): { user?: string; pass?: string } {
  const slug = instanceId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    user: process.env[`RDS_${slug}_USER`] ?? process.env.RDS_QUERY_USER,
    pass: process.env[`RDS_${slug}_PASSWORD`] ?? process.env.RDS_QUERY_PASSWORD,
  };
}

function truncate(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 3561015092442 → "3.56 trillion"; below a million, grouped digits. */
function big(v: number): string {
  const units: Array<[number, string]> = [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"]];
  const hit = units.find(([size]) => Math.abs(v) >= size);
  return hit ? `${(v / hit[0]).toFixed(2).replace(/\.?0+$/, "")} ${hit[1]}` : Math.round(v).toLocaleString("en-US");
}

/** Seconds as "45 s", "12 min" or "357 h". */
function span(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600).toLocaleString("en-US")} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

/** Milliseconds as "840 ms" or "2.8 s". */
const latency = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

function buildIssues(queries: TopQuery[]): QueryIssue[] {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const out: QueryIssue[] = [];

  // One issue per statement: every rule that fires for it is folded into a single card,
  // titled by the most severe one, so the same statement is not listed two or three times.
  for (const q of queries.slice(0, 10)) {
    const hits: Array<Omit<QueryIssue, "digestText">> = [];

    // A statement returning few rows while examining very many is the classic
    // missing-index signature.
    if (q.examinedPerSent != null && q.examinedPerSent > 1000 && q.sumRowsExamined > 1_000_000) {
      hits.push({
        severity: "critical",
        title: "Query scanning far more rows than it returns",
        evidence: `Examines ${big(q.examinedPerSent)} rows per row returned: ${big(q.sumRowsExamined)} rows examined across ${big(q.countStar)} calls.`,
        action: "Almost certainly a missing or unusable index. Run EXPLAIN on this statement and index the filtered columns.",
      });
    } else if (q.rowsExaminedPerCall > 100_000) {
      hits.push({
        severity: "warning",
        title: "Query examines a very large row set per call",
        evidence: `${big(q.rowsExaminedPerCall)} rows examined per call over ${big(q.countStar)} calls (${span(q.seconds)} in total).`,
        action: "Check that the filter can use an index and that one covers it; consider pagination or a narrower date range.",
      });
    }

    if (q.noIndexUsedCount > 0 && q.countStar > 0) {
      const pct = (q.noIndexUsedCount / q.countStar) * 100;
      if (pct >= 50) {
        hits.push({
          severity: "warning",
          title: "Query frequently runs without an index",
          evidence: `${pct.toFixed(0)}% of ${big(q.countStar)} calls used no index.`,
          action: "MySQL reports no index was used for most calls. Add a covering index for the WHERE and JOIN columns.",
        });
      }
    }

    if (q.avgLatencyMs > 1000 && q.countStar >= 10) {
      hits.push({
        severity: "warning",
        title: "Slow statement",
        evidence: `Average ${latency(q.avgLatencyMs)} over ${big(q.countStar)} calls (${span(q.seconds)} in total).`,
        action: "Over a second per call at this volume is a user-visible delay. Profile with EXPLAIN ANALYZE.",
      });
    }

    if (!hits.length) continue;
    hits.sort((a, b) => rank[a.severity] - rank[b.severity]);
    out.push({
      severity: hits[0].severity,
      title: hits[0].title,
      evidence: hits.map((h) => h.evidence).join(" "),
      action: hits[0].action,
      digestText: truncate(q.digestText),
    });
  }

  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

export async function getRdsQueryInsights(
  region: string,
  instanceId: string,
  orderBy: QueryOrder = "rows",
): Promise<RdsQueryInsights> {
  const base = {
    fetchedAt: new Date().toISOString(),
    instanceId,
    queries: [] as TopQuery[],
    issues: [] as QueryIssue[],
  };

  const { user, pass } = credKey(instanceId);
  if (!user || !pass) {
    const slug = instanceId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return {
      ...base,
      available: false,
      reason: "No database credentials configured for this instance.",
      remedy: `Add a read-only MySQL login to the secret store as RDS_${slug}_USER / RDS_${slug}_PASSWORD (or RDS_QUERY_USER / RDS_QUERY_PASSWORD for all instances). It needs only: GRANT SELECT ON performance_schema.* — no access to application data.`,
    };
  }

  // Resolve endpoint from AWS rather than trusting a hardcoded host.
  let host: string | undefined;
  let port = 3306;
  try {
    const d = await getRdsClient(region).send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId }),
    );
    const inst = (d.DBInstances ?? [])[0];
    host = inst?.Endpoint?.Address;
    port = inst?.Endpoint?.Port ?? 3306;
  } catch (e) {
    return { ...base, available: false, reason: `Could not resolve the RDS endpoint: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!host) return { ...base, available: false, reason: "RDS instance has no endpoint address (it may be stopped)." };

  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host,
      port,
      user,
      password: pass,
      connectTimeout: 8000,
      // RDS presents an AWS-issued certificate; verification needs the RDS CA
      // bundle installed. Encryption is still negotiated.
      ssl: { rejectUnauthorized: false },
    });

    const [psRows] = await conn.query<mysql.RowDataPacket[]>(
      "SHOW VARIABLES LIKE 'performance_schema'",
    );
    const psOn = String(psRows?.[0]?.Value ?? "").toUpperCase() === "ON";
    if (!psOn) {
      return {
        ...base,
        available: false,
        performanceSchemaEnabled: false,
        reason: "MySQL statement statistics (performance_schema) are switched off on this instance.",
        remedy: "Set performance_schema=1 in the DB parameter group and reboot. Without it MySQL collects no statement digests.",
      };
    }

    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT digest_text,
              count_star,
              sum_rows_examined,
              sum_rows_sent,
              sum_timer_wait/1e12 AS sec,
              sum_no_index_used
         FROM performance_schema.events_statements_summary_by_digest
        WHERE digest_text IS NOT NULL
        ORDER BY ${ORDER_COLUMN[orderBy]} DESC
        LIMIT 15`,
    );

    const queries: TopQuery[] = rows.map((r, i) => {
      const countStar = Number(r.count_star) || 0;
      const examined = Number(r.sum_rows_examined) || 0;
      const sent = Number(r.sum_rows_sent) || 0;
      const sec = Number(r.sec) || 0;
      const noIdx = Number(r.sum_no_index_used) || 0;
      return {
        rank: i + 1,
        digestText: String(r.digest_text ?? ""),
        countStar,
        sumRowsExamined: examined,
        sumRowsSent: sent,
        seconds: sec,
        rowsExaminedPerCall: countStar ? examined / countStar : 0,
        examinedPerSent: sent > 0 ? examined / sent : null,
        avgLatencyMs: countStar ? (sec / countStar) * 1000 : 0,
        noIndexUsedCount: noIdx,
        fullScanRatio: countStar ? noIdx / countStar : null,
      };
    });

    return {
      ...base,
      available: true,
      performanceSchemaEnabled: true,
      queries,
      issues: buildIssues(queries),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const denied = /denied|SELECT command denied|not allowed/i.test(msg);
    return {
      ...base,
      available: false,
      reason: msg,
      remedy: denied
        ? "The configured login cannot read performance_schema. Grant it: GRANT SELECT ON performance_schema.* TO '<user>'@'%';"
        : "Check that this host is allowed by the RDS security group and that the credentials are valid.",
    };
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
}
