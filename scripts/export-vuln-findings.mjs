#!/usr/bin/env node
// Export the current vulnerability findings as NDJSON for the report
// generators (scripts/gen-vuln-report.mjs and scripts/gen-vuln-pdf.mjs).
//
// Only findings SEEN BY THE LATEST SCAN BATCH are exported. The `finding`
// table is an upsert-by-fingerprint ledger, so rows from older scans linger
// after the underlying issue is fixed; filtering on lastSeenAt is what makes
// the report reflect reality instead of history. (This is the same filter that
// produced findings-fresh.ndjson for the 2026-10-26 edition by hand.)
//
// Categories default to CVE + SECRET, matching the published report scope.
// IAC / SPRING_HYGIENE / OTHER are tracked in the DB but are not CVE
// assessment material, so they stay out unless explicitly asked for.
//
// Usage: node export-vuln-findings.mjs <out.ndjson> [--cats CVE,SECRET] [--since <ISO>] [--all-time]
//
//   --since <ISO>  export only findings seen at or after this instant. The
//                  refresh script passes the scan run's own start time
//                  (startedAt in logs/rescan-all-state.json), so the report
//                  holds exactly what that run saw. Without it the cutoff is
//                  guessed from scan_job (anything within 12h of the newest
//                  job), which also pulls in earlier runs from the same day.
//
// Emits one JSON object per line with the short keys both generators read:
//   repo, br, branch, cat, scn, sev, rule, title, file, line, seen, lang
// `seen` is the day in IST; `lang` is the repository's main language on GitHub.

import fs from "node:fs";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const USAGE = "usage: export-vuln-findings.mjs <out.ndjson> [--cats CVE,SECRET] [--since <ISO>] [--all-time]";
const VALUE_FLAGS = ["--cats", "--since"];
const outPath = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1]));
if (!outPath) {
  console.error(USAGE);
  process.exit(1);
}
const sinceArg = args.indexOf("--since");
let SINCE = null;
if (sinceArg >= 0) {
  SINCE = new Date(args[sinceArg + 1] ?? "");
  if (Number.isNaN(SINCE.getTime())) {
    console.error(`--since needs an ISO date-time, got "${args[sinceArg + 1] ?? ""}"\n${USAGE}`);
    process.exit(1);
  }
}
const catArg = args.indexOf("--cats");
const CATS = (catArg >= 0 && args[catArg + 1] ? args[catArg + 1] : "CVE,SECRET")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const ALL_TIME = args.includes("--all-time");

// Mirror lib/db.ts resolution: DATABASE_URL wins, otherwise MYSQL_* parts.
// The tables hold UTC date-times. Without `timezone: "Z"` mysql2 reads them as
// host-local time (IST here), which put the cutoff and the `seen` day 5h30 off.
function conn() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      timezone: "Z",
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, "") || "billing",
    };
  }
  if (!process.env.MYSQL_USER) {
    console.error("no DATABASE_URL and no MYSQL_USER — cannot reach the database");
    process.exit(1);
  }
  return {
    timezone: "Z",
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "billing",
  };
}

const c = await mysql.createConnection(conn());
const q = async (sql, p = []) => (await c.query(sql, p))[0];

// Cutoff: the run's own start time when given; otherwise the latest scan batch
// (jobs are launched in a burst, so anything that started within 12h of the
// newest job is taken to be the same run).
let cutoff = null;
if (SINCE) {
  cutoff = SINCE;
} else if (!ALL_TIME) {
  const [row] = await q(
    "SELECT MIN(startedAt) cutoff FROM scan_job WHERE startedAt >= (SELECT MAX(startedAt) FROM scan_job) - INTERVAL 12 HOUR",
  );
  cutoff = row?.cutoff ?? null;
}

const placeholders = CATS.map(() => "?").join(",");
const where = [
  "f.suppressedAt IS NULL",
  `f.category IN (${placeholders})`,
];
const params = [...CATS];
if (cutoff) {
  where.push("f.lastSeenAt >= ?");
  params.push(cutoff);
}

const rows = await q(
  `SELECT f.repoFullName, f.branch, f.category, f.scanner, f.severity,
          f.ruleId, f.title, f.file, f.line, f.lastSeenAt, r.language
     FROM finding f
     LEFT JOIN repo r ON r.fullName = f.repoFullName
    WHERE ${where.join(" AND ")}
    ORDER BY f.repoFullName, f.severity, f.ruleId`,
  params,
);

// Day in IST as YYYY-MM-DD, so a scan that runs at 03:30 IST is not dated the day before.
const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (d) => (d instanceof Date ? istDay.format(d) : String(d ?? "").slice(0, 10));
// The scanner works in a throwaway clone; keep only the path inside the repository.
const repoPath = (f) => String(f ?? "").replace(/^\/tmp\/natasha-scan-\d+-[^/]+\//, "");
const out = fs.createWriteStream(outPath, { encoding: "utf8" });
for (const r of rows) {
  out.write(
    JSON.stringify({
      repo: r.repoFullName,
      br: r.branch,
      branch: r.branch, // gen-vuln-pdf.mjs reads `branch`, the web report reads `br`
      cat: r.category,
      scn: r.scanner,
      sev: r.severity,
      rule: r.ruleId,
      title: r.title,
      file: repoPath(r.file),
      line: r.line ?? 0,
      seen: day(r.lastSeenAt),
      lang: r.language ?? null,
    }) + "\n",
  );
}
await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));

const bySev = {};
const repos = new Set();
for (const r of rows) {
  bySev[r.severity] = (bySev[r.severity] || 0) + 1;
  repos.add(r.repoFullName);
}
console.log(
  `exported ${rows.length} findings · repos=${repos.size} cats=${CATS.join("+")} ` +
    `cutoff=${cutoff ? new Date(cutoff).toISOString() : "none (all time)"}${SINCE ? " (--since)" : ""} ` +
    `sev=${JSON.stringify(bySev)} -> ${outPath}`,
);
if (rows.length === 0) {
  console.error("refusing to call this a report: zero findings exported");
  await c.end();
  process.exit(2);
}
await c.end();
