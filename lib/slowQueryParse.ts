/**
 * Pure parsing helpers for the Slow queries page: log-line prefix, failed SQL statements, timed
 * operations, service-call timeout targets, redaction and the rule-based (no AI) notes. No I/O.
 * Every string that leaves here for the browser goes through `redact()` or `scrub()`: log lines
 * carry customer emails, IPs, quoted values and whole DTO dumps.
 */

// Line prefix (two logback layouts).
const PREFIX = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{3})Z?\s+(?:(\w+)\s+\d+\s+---\s+\[\s*([^\]]+)\]\s+(\S+)\s+:|(\w+)\s+\[([^\]]+)\]\s+(\S+)\s+-)\s/;
// Failed statement, its table and the driver's reason.
const SQL = /SQL \[([\s\S]*?)\](?=;|\s*$|\s+nested|\s)/;
const TABLE = /\b(?:INTO|UPDATE|FROM|JOIN)\s+`?([\w.]+)`?/i;
const CAUSE = /\];\s*([^;]+?)(?:;|$)/;
// Timed operations.
const TIMING = /\[TIMING\]\s+(.+?)\s+took\s+(\d+)\s*ms/;
const DURATION = /-\s+(.+?)\.?\s+Duration:\s*([\d.]+)\s*sec/;
// Target of a service-call timeout.
const READ_TIMEOUT = /Read timed out executing (GET|POST|PUT|DELETE|PATCH) https?:\/\/[^/\s]+(\/[^\s?]*)/;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const QUOTED = /'[^']*'/g;
// A token is a long base64/hex run that contains a digit; plain words such as Java class names stay.
const TOKEN = /[A-Za-z0-9+/=_-]{24,}/g;
const HAS_DIGIT = /\d/;
const MESSAGE_MAX = 600;
const STATEMENT_MAX = 400;
const REINGEST_MS = 24 * 3_600_000;

export type StatementKind = "duplicate" | "lockWait" | "deadlock" | "foreignKey" | "other";
export type Severity = "critical" | "warning" | "info";

export interface RawLine { message: string; service: string; at: string | null; host?: string | null }
export interface ParsedPrefix { loggedAt: string | null; level: string | null; logger: string | null; body: string }
export interface StatementGroup { statement: string; table: string | null; reason: string; kind: StatementKind; count: number; services: string[]; lastAt: string | null }
export interface TimeoutTarget { method: string; path: string; count: number; services: string[] }
export interface OperationRow { operation: string; service: string; unit: "ms"; n: number; p50: number; p95: number; max: number }
export interface Note { severity: Severity; title: string; evidence: string; action: string }

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Emails, IPv4 addresses and quoted literals only: for statements, reasons and names. */
export function scrub(s: string): string {
  return s.replace(EMAIL, "<email>").replace(IPV4, "<ip>").replace(QUOTED, "'?'");
}

/** Full redaction for a log message before it is returned to the browser. */
export function redact(message: string): string {
  const dto = [message.indexOf("ResultDTO ["), message.indexOf("DTO [")].filter((i) => i >= 0);
  const head = dto.length ? message.slice(0, Math.min(...dto)) : message;
  const clean = scrub(head).replace(TOKEN, (m) => (HAS_DIGIT.test(m) ? "<token>" : m));
  return cut(clean.trim(), MESSAGE_MAX);
}

export function parsePrefix(message: string): ParsedPrefix {
  const m = PREFIX.exec(message);
  if (!m) return { loggedAt: null, level: null, logger: null, body: message };
  return {
    loggedAt: m[1].replace(",", "."),
    level: m[2] ?? m[5] ?? null,
    logger: m[4] ?? m[7] ?? null,
    body: message.slice(m[0].length),
  };
}

/** True when the line's own time is more than 24 h older than its ingest time. */
export function isReingested(loggedAt: string | null, ingestedAt: string | null): boolean {
  if (!loggedAt || !ingestedAt) return false;
  // The prefix carries no zone; read it as UTC. The 24 h threshold absorbs the IST offset.
  const logged = Date.parse(`${loggedAt.replace(" ", "T")}Z`);
  const ingested = Date.parse(ingestedAt);
  return Number.isFinite(logged) && Number.isFinite(ingested) && ingested - logged > REINGEST_MS;
}

function statementKind(text: string): StatementKind {
  if (/Duplicate entry/i.test(text)) return "duplicate";
  if (/Lock wait timeout/i.test(text)) return "lockWait";
  if (/Deadlock found/i.test(text)) return "deadlock";
  if (/foreign key constraint fails/i.test(text)) return "foreignKey";
  return "other";
}

function causeOf(message: string): string {
  const m = CAUSE.exec(message);
  const raw = (m?.[1] ?? "").split(/\s+at (?:org|com|java|jdk|sun)\./)[0];
  return cut(scrub(raw).replace(/^nested exception is\s+/i, "").replace(/^[\w.$]+(?:Exception|Error):\s*/, "").trim(), 240);
}

export function groupStatements(lines: RawLine[]): StatementGroup[] {
  const groups = new Map<string, StatementGroup & { svc: Set<string> }>();
  for (const line of lines) {
    const sql = SQL.exec(line.message);
    if (!sql) continue;
    const statement = cut(scrub(sql[1].replace(/\s+/g, " ").trim()), STATEMENT_MAX);
    const reason = causeOf(line.message);
    const kind = statementKind(line.message);
    const key = `${kind}|${statement}`;
    let g = groups.get(key);
    if (!g) {
      const table = TABLE.exec(sql[1])?.[1] ?? null;
      g = { statement, table, reason, kind, count: 0, services: [], lastAt: null, svc: new Set() };
      groups.set(key, g);
    }
    g.count++;
    g.svc.add(line.service);
    if (line.at && (!g.lastAt || line.at > g.lastAt)) g.lastAt = line.at;
  }
  return Array.from(groups.values())
    .map(({ svc, ...g }) => ({ ...g, services: Array.from(svc).sort() }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summariseOperations(lines: RawLine[]): OperationRow[] {
  const ops = new Map<string, { operation: string; service: string; values: number[] }>();
  for (const line of lines) {
    const t = TIMING.exec(line.message);
    const d = t ? null : DURATION.exec(line.message);
    if (!t && !d) continue;
    const operation = cut(scrub((t ? t[1] : d![1]).trim()), 160);
    const ms = t ? Number(t[2]) : Math.round(Number(d![2]) * 1000);
    if (!Number.isFinite(ms)) continue;
    const key = `${line.service}|${operation}`;
    const row = ops.get(key) ?? { operation, service: line.service, values: [] };
    row.values.push(ms);
    ops.set(key, row);
  }
  return Array.from(ops.values())
    .map(({ operation, service, values }) => {
      const s = values.sort((a, b) => a - b);
      return { operation, service, unit: "ms" as const, n: s.length, p50: percentile(s, 0.5), p95: percentile(s, 0.95), max: s[s.length - 1] };
    })
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 40);
}

export function timeoutTargets(lines: RawLine[]): TimeoutTarget[] {
  const targets = new Map<string, { method: string; path: string; count: number; svc: Set<string> }>();
  for (const line of lines) {
    const m = READ_TIMEOUT.exec(line.message);
    if (!m) continue;
    // Numeric, UUID and long hex segments are ids; fold them so one endpoint is one row.
    const path = cut(scrub(m[2]).replace(/\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,})(?=\/|$)/gi, "/{id}"), 200);
    const key = `${m[1]} ${path}`;
    const t = targets.get(key) ?? { method: m[1], path, count: 0, svc: new Set<string>() };
    t.count++;
    t.svc.add(line.service);
    targets.set(key, t);
  }
  return Array.from(targets.values())
    .map(({ svc, ...t }) => ({ ...t, services: Array.from(svc).sort() }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export interface NoteInput {
  totals: Record<string, number>;
  kindServices: Record<string, Array<{ service: string; count: number }>>;
  groups: StatementGroup[];
  targets: TimeoutTarget[];
  operations: OperationRow[];
}

const names = (xs: string[], n = 3) => (xs.length > n ? `${xs.slice(0, n).join(", ")} +${xs.length - n}` : xs.join(", ")) || "unknown service";
const topServices = (input: NoteInput, kind: string) => (input.kindServices[kind] ?? []).map((s) => s.service);
const tablesOf = (groups: StatementGroup[], kind: StatementKind) => Array.from(new Set(groups.filter((g) => g.kind === kind && g.table).map((g) => g.table!)));

const LOCK_RULES: Array<{ kind: "lockWait" | "deadlock"; title: string; noun: string; action: string }> = [
  { kind: "lockWait", title: "Lock wait timeouts", noun: "lock wait timeout",
    action: "A long transaction is holding rows on this table. Look for a missing index on the WHERE columns of the blocking statement and shorten the transaction." },
  { kind: "deadlock", title: "Deadlocks", noun: "deadlock",
    action: "Two writers take locks in a different order. Make the lock order consistent and retry the transaction on deadlock." },
];

function lockNotes(input: NoteInput): Note[] {
  return LOCK_RULES.filter((r) => (input.totals[r.kind] ?? 0) > 0).map((r) => {
    const n = input.totals[r.kind], tables = tablesOf(input.groups, r.kind);
    return {
      severity: "warning", title: `${r.title}${tables.length ? ` on ${names(tables, 2)}` : ""}`, action: r.action,
      evidence: `${n.toLocaleString("en-US")} ${r.noun}${n === 1 ? "" : "s"} from ${names(topServices(input, r.kind))}.`,
    };
  });
}

function statementNotes(groups: StatementGroup[]): Note[] {
  const out: Note[] = [];
  for (const g of groups.filter((x) => x.kind === "duplicate" && x.count >= 20).slice(0, 3)) {
    out.push({
      severity: "warning", title: `Same insert repeated${g.table ? ` on ${g.table}` : ""}`,
      evidence: `${g.count} duplicate-key failures in the sampled statements from ${names(g.services)}.`,
      action: "The consumer is not idempotent. Use INSERT … ON DUPLICATE KEY UPDATE, or check for the row before inserting.",
    });
  }
  for (const g of groups.filter((x) => x.kind === "foreignKey").slice(0, 2)) {
    const parent = /REFERENCES\s+`?([\w.]+)`?/i.exec(g.reason)?.[1];
    out.push({
      severity: "warning", title: `Foreign key failure${g.table ? ` on ${g.table}` : ""}`,
      evidence: `${g.count} insert${g.count === 1 ? "" : "s"} rejected${parent ? `: parent row missing in ${parent}` : ""} (${names(g.services)}).`,
      action: "The child row is written before its parent. Fix the queue ordering between these tables.",
    });
  }
  return out;
}

function trafficNotes(input: NoteInput): Note[] {
  const out: Note[] = [];
  const pool = (input.totals.connPool ?? 0) + (input.totals.tooMany ?? 0);
  if (pool > 0) {
    out.push({
      severity: "critical", title: "Connection pool exhausted",
      evidence: `${pool.toLocaleString("en-US")} "connection not available" or "too many connections" errors from ${names([...topServices(input, "connPool"), ...topServices(input, "tooMany")])}.`,
      action: "Requests are waiting for a database connection. Look for leaked connections or long transactions, then size the pool against max_connections.",
    });
  }
  const mongo = input.totals.mongoNoServer ?? 0;
  if (mongo > 100) {
    out.push({
      severity: "critical", title: "MongoDB host unreachable",
      evidence: `${mongo.toLocaleString("en-US")} "no server chosen" lines from ${names(topServices(input, "mongoNoServer"))}.`,
      action: "These services cannot reach their MongoDB host. Check the instance is up and that its security group allows them.",
    });
  }
  const sampled = input.targets.reduce((n, t) => n + t.count, 0);
  const top = input.targets[0];
  if (top && sampled > 0 && top.count / sampled >= 0.5) {
    out.push({
      severity: "warning", title: `Slow downstream endpoint ${top.method} ${top.path}`,
      evidence: `${Math.round((top.count / sampled) * 100)}% of ${sampled} sampled service-call timeouts hit this endpoint, called by ${names(top.services)}.`,
      action: "This endpoint is the bottleneck, not the callers. Profile it, and give the Feign clients a timeout and retry policy that matches it.",
    });
  }
  for (const op of input.operations.filter((o) => o.p95 >= 1000).slice(0, 3)) {
    out.push({
      severity: "warning", title: `Slow operation ${op.operation}`,
      evidence: `p95 ${op.p95.toLocaleString("en-US")} ms, max ${op.max.toLocaleString("en-US")} ms over ${op.n} sampled calls in ${op.service}.`,
      action: "Over a second at p95 is user-visible. Trace this operation to find the slow call inside it.",
    });
  }
  return out;
}

export function buildNotes(input: NoteInput): Note[] {
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return [...trafficNotes(input), ...lockNotes(input), ...statementNotes(input.groups)]
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}
