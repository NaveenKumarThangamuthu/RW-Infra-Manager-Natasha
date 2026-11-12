/**
 * Turns sampled search slow-log rows into redacted "query shapes" and
 * rule-based findings (no AI). Query bodies can carry business identifiers,
 * so every leaf value is replaced by "?" before anything leaves the server.
 */

export interface SlowRow {
  at: string; index: string; tookMs: number; totalHits: string | null; searchType: string | null; level: string | null; source: string | null;
}
export interface SlowShape {
  index: string; shape: string; example: string; count: number; maxMs: number; medianMs: number; lastSeen: string;
  sizes: number[]; froms: number[]; flags: string[];
}
export interface SlowFinding { severity: "critical" | "warning" | "info"; title: string; evidence: string; action: string }

export const FLAG = {
  deepPaging: "deep paging",
  leadingWildcard: "leading wildcard",
  wildcard: "wildcard",
  regexp: "regexp",
  script: "script",
  heavyAggs: "heavy aggregation",
} as const;

export const SHAPE_MAX_CHARS = 600;
const EXAMPLE_MAX_CHARS = 4000;
const MAX_SHAPES = 30;
const MAX_VALUES_SEEN = 5;
export const DEEP_PAGING_RESULTS = 10_000;
export const HEAVY_AGG_MS = 5_000;
export const VERY_SLOW_MS = 30_000;
export const SPIKE_SHARE = 0.5;
export const SPIKE_MIN_TOTAL = 500;
export const ONE_INDEX_SHARE = 0.5;
const UNREADABLE = "(query text could not be read)";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/** The slow log stores the body as JSON with escaped quotes; accept it either way. */
export function parseSource(raw: string | null): Json | undefined {
  if (!raw) return undefined;
  for (const text of [raw, raw.replace(/\\"/g, '"')]) {
    try { return JSON.parse(text) as Json; } catch { /* try the next form */ }
  }
  return undefined;
}

/** Keys and structure kept, every leaf value replaced by "?". `collapse` folds arrays of same-shaped items. */
function strip(v: Json, collapse: boolean): Json {
  if (Array.isArray(v)) {
    const items = v.map((x) => strip(x, collapse));
    if (!collapse) return items;
    const seen = new Set(items.map((x) => JSON.stringify(x)));
    return seen.size === 1 && items.length ? [items[0]] : items;
  }
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x, collapse)]));
  return "?";
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const num = (v: Json | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Walk every node; call fn(key, value) for each object entry. */
function walk(v: Json | undefined, fn: (k: string, x: Json) => void) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) { fn(k, x); walk(x, fn); }
}

const LEADING_WILD = /^[*?]/;
const QS_LEADING_WILD = /(^|[\s:(])[*?]/;

function rowFlags(q: Json | undefined, tookMs: number): string[] {
  if (!isObj(q)) return [];
  const flags = new Set<string>();
  const size = num(q.size), from = num(q.from) ?? 0;
  if (size != null && (size >= DEEP_PAGING_RESULTS || size + from > DEEP_PAGING_RESULTS)) flags.add(FLAG.deepPaging);
  walk(q.query, (k, x) => {
    if (k === "regexp") flags.add(FLAG.regexp);
    if (k === "wildcard") {
      flags.add(FLAG.wildcard);
      walk({ w: x }, (_, y) => { if (typeof y === "string" && LEADING_WILD.test(y)) flags.add(FLAG.leadingWildcard); });
    }
    if (k === "query_string" && isObj(x) && typeof x.query === "string" && QS_LEADING_WILD.test(x.query)) flags.add(FLAG.leadingWildcard);
  });
  for (const part of [q.query, q.sort]) walk(part, (k) => { if (k === "script" || k === "_script" || k === "script_score") flags.add(FLAG.script); });
  if (size === 0 && (q.aggs || q.aggregations) && tookMs > HEAVY_AGG_MS) flags.add(FLAG.heavyAggs);
  return Array.from(flags);
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Group the sampled rows by index + normalised shape. Also returns the shape text per row. */
export function buildShapes(rows: SlowRow[]): { shapes: SlowShape[]; rowShape: string[] } {
  const groups = new Map<string, { index: string; shape: string; example: string; tooks: number[]; lastSeen: string; sizes: Set<number>; froms: Set<number>; flags: Set<string> }>();
  const rowShape: string[] = [];
  for (const r of rows) {
    const q = parseSource(r.source);
    const full = q === undefined ? UNREADABLE : JSON.stringify(strip(q, true));
    rowShape.push(cut(full, SHAPE_MAX_CHARS));
    const key = `${r.index}\u0000${full}`;
    let g = groups.get(key);
    if (!g) {
      const example = q === undefined ? UNREADABLE : cut(JSON.stringify(strip(q, false)), EXAMPLE_MAX_CHARS);
      g = { index: r.index, shape: cut(full, SHAPE_MAX_CHARS), example, tooks: [], lastSeen: r.at, sizes: new Set(), froms: new Set(), flags: new Set() };
      groups.set(key, g);
    }
    g.tooks.push(r.tookMs);
    if (r.at > g.lastSeen) g.lastSeen = r.at;
    if (isObj(q)) {
      const size = num(q.size), from = num(q.from);
      if (size != null && g.sizes.size < MAX_VALUES_SEEN) g.sizes.add(size);
      if (from != null && g.froms.size < MAX_VALUES_SEEN) g.froms.add(from);
    }
    for (const f of rowFlags(q, r.tookMs)) g.flags.add(f);
  }
  const shapes = Array.from(groups.values())
    .map((g) => ({
      index: g.index, shape: g.shape, example: g.example, count: g.tooks.length, maxMs: Math.max(...g.tooks), medianMs: median(g.tooks),
      lastSeen: g.lastSeen, sizes: Array.from(g.sizes).sort((a, b) => a - b), froms: Array.from(g.froms).sort((a, b) => a - b), flags: Array.from(g.flags),
    }))
    .sort((a, b) => b.count - a.count || b.maxMs - a.maxMs)
    .slice(0, MAX_SHAPES);
  return { shapes, rowShape };
}

const IST_MS = 330 * 60_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (v: number) => String(v).padStart(2, "0");
const istDay = (ts: number) => { const t = new Date(ts + IST_MS); return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const istTime = (ts: number) => { const t = new Date(ts + IST_MS); return `${istDay(ts)}, ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())} IST`; };
const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface FindingInput {
  windowHours: number; total: number; maxMs: number | null; interval: string;
  trend: Array<[number, number]>; byIndex: Array<{ index: string; count: number }>; shapes: SlowShape[]; rows: SlowRow[];
}

function spike(x: FindingInput): SlowFinding | null {
  if (x.total <= SPIKE_MIN_TOTAL || !x.trend.length) return null;
  // Up to a day: compare histogram buckets. Longer windows: compare IST days.
  const buckets = x.windowHours <= 24
    ? x.trend.map(([ts, n]) => ({ label: `the ${x.interval} from ${istTime(ts)}`, n }))
    : Array.from(x.trend.reduce((m, [ts, n]) => m.set(istDay(ts), (m.get(istDay(ts)) ?? 0) + n), new Map<string, number>()))
      .map(([d, n]) => ({ label: d, n }));
  const top = buckets.reduce((a, b) => (b.n > a.n ? b : a));
  if (top.n / x.total <= SPIKE_SHARE) return null;
  return {
    severity: "warning", title: "Burst of slow searches",
    evidence: `${top.n.toLocaleString("en-US")} of ${x.total.toLocaleString("en-US")} slow searches (${pct(top.n / x.total)}) were logged in ${x.windowHours <= 24 ? top.label : `one day, ${top.label}`}.`,
    action: "Check what ran then: a report, a batch job, a re-index or a deployment.",
  };
}

function flagged(x: FindingInput, flags: string[]) {
  const g = x.shapes.filter((s) => s.flags.some((f) => flags.includes(f)));
  const n = g.reduce((a, s) => a + s.count, 0);
  const idx = Array.from(new Set(g.map((s) => s.index)));
  return { n, where: idx.slice(0, 3).join(", ") + (idx.length > 3 ? ` and ${idx.length - 3} more` : "") };
}

export function buildFindings(x: FindingInput): SlowFinding[] {
  const out: SlowFinding[] = [];
  if (x.maxMs != null && x.maxMs > VERY_SLOW_MS) {
    const over = x.rows.filter((r) => r.tookMs > VERY_SLOW_MS);
    const worst = x.rows[0];
    out.push({
      severity: "critical", title: "Searches took over 30 seconds",
      evidence: `${over.length || "Some"} search${over.length === 1 ? "" : "es"} over 30 s; the slowest took ${secs(x.maxMs)}${worst ? ` on ${worst.index} at ${istTime(new Date(worst.at).getTime())}` : ""}.`,
      action: "Searches this long hold threads and memory. Find the pattern below and add a narrower filter or a request timeout.",
    });
  }
  const s = spike(x);
  if (s) out.push(s);
  const rules: Array<[string[], string, string, string]> = [
    [[FLAG.deepPaging], "Deep paging", "asked for 10,000 or more results through size or from", "Page with search_after (or a point in time) instead of from/size, and fetch fewer results per page."],
    [[FLAG.leadingWildcard, FLAG.wildcard, FLAG.regexp], "Wildcard or pattern matching", "used wildcard, leading-wildcard or regexp matching", "Leading wildcards scan every term in the field. Match on an exact keyword, a prefix, or an n-gram field instead."],
    [[FLAG.script], "Scripts in queries or sorting", "ran a script for every matching document", "Store the computed value when indexing, or sort on a plain field."],
    [[FLAG.heavyAggs], "Slow aggregation-only searches", `were aggregation-only and took over ${HEAVY_AGG_MS / 1000} s`, "Filter to a shorter time range before aggregating, or keep pre-computed totals."],
  ];
  for (const [flags, title, what, action] of rules) {
    const f = flagged(x, flags);
    if (f.n) out.push({ severity: "warning", title, evidence: `${f.n} of the ${x.rows.length} slowest sampled searches ${what} (${f.where}).`, action });
  }
  const top = x.byIndex[0];
  if (top && x.total > 0 && top.count / x.total > ONE_INDEX_SHARE) {
    out.push({
      severity: "info", title: "Most slow searches hit one index",
      evidence: `${top.index} accounts for ${pct(top.count / x.total)} (${top.count.toLocaleString("en-US")} of ${x.total.toLocaleString("en-US")}).`,
      action: "Start tuning there: check its shard size, its mapping and the query patterns below.",
    });
  }
  return out;
}
