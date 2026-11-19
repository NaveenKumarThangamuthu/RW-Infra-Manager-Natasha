#!/usr/bin/env node
// Build a print-first HTML edition of the vulnerability report and render it
// to PDF with Playwright/Chromium.
//
// Unlike the web report this output carries no JavaScript, no search box, no
// filter controls and no pagination — every finding is laid out statically so
// the PDF is self-contained and complete on paper.
//
// Usage: node gen-vuln-pdf.mjs <findings.ndjson> <out.pdf> [out.print.html] [--html-only]
// Reads scan coverage from the VULN_REPORT_META environment variable when set.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

// --html-only writes the print HTML and skips Chromium, for fast layout iteration.
const htmlOnly = process.argv.includes("--html-only");
const [, , inPath, outPdf, outHtmlArg] = process.argv.filter((a) => a !== "--html-only");
if (!inPath || !outPdf) {
  console.error("usage: gen-vuln-pdf.mjs <findings.ndjson> <out.pdf> [out.print.html]");
  process.exit(1);
}
const outHtml = outHtmlArg || outPdf.replace(/\.pdf$/, "") + ".print.html";

// This edition is a CVE assessment: its headline, cover and tables all speak of
// known vulnerabilities from Trivy. Pattern-matched secrets belong to the web
// report, so any that arrive in the input are left out rather than counted as CVEs.
const inputRows = fs.readFileSync(inPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = inputRows.filter((r) => r.cat === "CVE");
if (rows.length !== inputRows.length) {
  console.log(`  note: left out ${inputRows.length - rows.length} non-CVE rows (this edition covers CVEs only)`);
}

const SEV_ORDER = ["CRIT", "HIGH", "MED", "LOW", "INFO"];
const SEV_LABEL = { CRIT: "Critical", HIGH: "High", MED: "Medium", LOW: "Low", INFO: "Info" };

// Stack split. Names carrying "Mule" are MuleSoft. Of the rest, only JVM-language
// repositories are Spring; everything else (React, Vue, Next.js, Python, scripts)
// is "Frontend / Other" rather than being mislabelled Spring. The language comes
// from the export (`lang`); an older export without it falls back to a name check.
const PLAT_ORDER = ["Spring", "Other", "Mule"];
const PLAT_LABEL = { Spring: "Spring", Other: "Frontend / Other", Mule: "Mule" };
const JVM_LANGS = new Set(["java", "kotlin", "groovy", "scala"]);
const NON_SPRING_NAME = /react|vue|angular|next|frontend|front-end|theme|dashboard|shopify|natasha|-ui\b|-web\b/i;
const repoLang = new Map();
for (const r of rows) if (r.lang !== undefined && !repoLang.has(r.repo)) repoLang.set(r.repo, r.lang);
const platformOf = (repo) => {
  if (/mule/i.test(repo)) return "Mule";
  if (!repoLang.has(repo)) return NON_SPRING_NAME.test(repo) ? "Other" : "Spring";
  const lang = repoLang.get(repo);
  return lang && JVM_LANGS.has(String(lang).toLowerCase()) ? "Spring" : "Other";
};
const platformRank = (repo) => PLAT_ORDER.indexOf(platformOf(repo));
for (const r of rows) r.plat = platformOf(r.repo);

// One number style and one date style for the whole report.
const fmt = (n) => Number(n || 0).toLocaleString("en-GB");
const fmtDate = (ymd) => {
  const d = new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? String(ymd)
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const bySev = Object.fromEntries(SEV_ORDER.map((s) => [s, rows.filter((r) => r.sev === s).length]));
const pct = (n) => (rows.length ? ((n / rows.length) * 100).toFixed(1) : "0.0");
const distinctCves = new Set(rows.filter((r) => r.cat === "CVE").map((r) => r.rule)).size;

// Scan-coverage context from refresh-vuln-report.sh (built from logs/rescan-all-state.json):
//   { date, targets, scanned, failed, skipped,
//     notScanned: [{ repo, branch, status, reason }], notOnGithub: [name] }
const meta = process.env.VULN_REPORT_META ? JSON.parse(process.env.VULN_REPORT_META) : null;
const notScanned = meta && Array.isArray(meta.notScanned) ? meta.notScanned : [];
const notOnGithub = meta && Array.isArray(meta.notOnGithub) ? meta.notOnGithub : [];
const scanDate = [...new Set(rows.map((r) => r.seen))].sort().pop() || "unknown";
const scanDay = fmtDate((meta && meta.date) || scanDate);
const generated = new Date().toLocaleString("en-GB", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

// Per-repo rollup: Spring block first, then Mule; ranked by Critical inside each.
const repoNames = [...new Set(rows.map((r) => r.repo))];
const repoRollup = repoNames
  .map((repo) => {
    const rs = rows.filter((r) => r.repo === repo);
    return {
      repo,
      platform: platformOf(repo),
      branch: rs[0]?.br ?? "",
      total: rs.length,
      crit: rs.filter((r) => r.sev === "CRIT").length,
      high: rs.filter((r) => r.sev === "HIGH").length,
      med: rs.filter((r) => r.sev === "MED").length,
      low: rs.filter((r) => r.sev === "LOW").length,
      findings: rs.slice().sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev) || String(a.rule).localeCompare(String(b.rule))),
    };
  })
  .sort((a, b) => platformRank(a.repo) - platformRank(b.repo) || b.crit - a.crit || b.high - a.high || b.total - a.total);

const platRollup = PLAT_ORDER.map((p) => {
  const rs = rows.filter((r) => r.plat === p);
  return {
    platform: p,
    repos: new Set(rs.map((r) => r.repo)).size,
    total: rs.length,
    crit: rs.filter((r) => r.sev === "CRIT").length,
    high: rs.filter((r) => r.sev === "HIGH").length,
  };
});

const topComponents = (() => {
  const m = new Map();
  for (const r of rows) {
    if (r.cat !== "CVE") continue;
    const after = String(r.title).split(":").slice(1).join(":").trim();
    const pkg = (after.replace(/\s+\S*\d[\w.+-]*$/, "").trim() || after || r.file || "unknown").slice(0, 60);
    if (pkg) m.set(pkg, (m.get(pkg) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 20);
})();

// Ranked by severity first, then by spread. Sorting on raw occurrence count
// alone buried every Critical: the most widespread Critical appears 69 times
// while the twentieth-placed Medium appears 70, so no Critical made the cut —
// useless for a table meant to drive remediation order.
const topCves = (() => {
  const m = new Map();
  for (const r of rows) {
    if (r.cat !== "CVE") continue;
    const k = r.rule + "|" + r.sev;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const all = [...m].map(([k, c]) => ({ rule: k.split("|")[0], sev: k.split("|")[1], count: c }));
  // Quota per severity so Critical leads without crowding High and Medium out
  // entirely — there are 45 distinct Criticals, enough to fill the whole table.
  const quota = { CRIT: 10, HIGH: 6, MED: 4, LOW: 0, INFO: 0 };
  return SEV_ORDER.flatMap((s) =>
    all
      .filter((x) => x.sev === s)
      .sort((a, b) => b.count - a.count)
      .slice(0, quota[s] ?? 0),
  );
})();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Vulnerability Report — RW Infrastructure</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
  :root{ --ink:#15202e; --dim:#5d6b82; --line:#c9d4e4; --soft:#f2f6fb;
         --crit:#c62234; --high:#c2621b; --med:#9a7b10; --low:#17795c; --accent:#1d4ed8; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ font:9.6pt/1.42 "Helvetica Neue",Helvetica,Arial,sans-serif; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  /* On paper the @page margins frame the content, so the wrapper is inert.
     On screen there are no page margins, so give it an A4-width sheet. */
  @media screen{
    body{ background:#e8edf4; }
    .sheet{ max-width:210mm; margin:0 auto; background:#fff; padding:16mm 14mm 20mm;
            box-shadow:0 1px 4px rgba(20,32,50,.14); }
  }
  h1,h2,h3{ margin:0; font-weight:700; letter-spacing:-.2px; }
  .page-break{ break-before:page; }

  /* ---------- cover ---------- */
  /* No fixed height: the cover block flows so Severity distribution and
     Platform split share page 1 with it. */
  .cover{ margin-bottom:7mm; }
  .cover-top{ border-top:4px solid var(--accent); padding-top:5mm; }
  .cover h1{ font-size:19pt; line-height:1.18; margin-bottom:3mm; }
  .cover .sub{ font-size:9.5pt; color:var(--dim); line-height:1.45; }
  /* All six metrics on a single row across the A4 content width. */
  .cover-stats{ display:grid; grid-template-columns:repeat(6,1fr); gap:2.5mm; margin-bottom:10mm; }
  .cover-exec{ margin:6mm 0 7mm; }
  .cover-exec h2{ font-size:12pt; }
  .cstat{ min-width:0; border:1px solid var(--line); border-radius:2mm; padding:3.5mm 2mm; text-align:center; }
  .cstat .n{ font-size:15pt; font-weight:700; line-height:1.1; }
  .cstat .l{ font-size:6pt; text-transform:uppercase; letter-spacing:.4px; color:var(--dim);
             margin-top:1.2mm; line-height:1.3; min-height:5.4mm; }
  .cstat.crit .n{ color:var(--crit); } .cstat.high .n{ color:var(--high); }
  .cstat.med .n{ color:var(--med); }  .cstat.low .n{ color:var(--low); }
  /* Cover header: report title on the left, publication metadata on the right. */
  .cover-head{ display:flex; justify-content:space-between; align-items:flex-start; gap:12mm;
               border-bottom:1.5px solid var(--line); padding-bottom:6mm; }
  .ch-left{ flex:1 1 auto; min-width:0; }
  /* Two-column grid so every label ends on one vertical line and every value
     starts on the next — labels and values align straight down the block. */
  .ch-right{ flex:0 0 auto; display:grid; grid-template-columns:auto auto;
             column-gap:2mm; row-gap:1.6mm; align-content:start; }
  .ch-right span{ text-align:right; color:var(--dim); font-size:8pt; white-space:nowrap; }
  .ch-right b{ text-align:left; color:var(--ink); font-weight:600; font-size:8.6pt; white-space:nowrap; }
  .cover-meta{ border-top:1px solid var(--line); padding-top:5mm; font-size:9pt; color:var(--dim); }
  .cover-meta b{ color:var(--ink); }


  /* ---------- sections ---------- */
  section{ margin-bottom:8mm; }
  h2{ font-size:13pt; margin:0 0 2.5mm; padding-bottom:1.6mm; border-bottom:2px solid var(--accent);
      break-after:avoid; }
  h3{ font-size:10.5pt; margin:5mm 0 2mm; }
  p.lede{ color:var(--dim); font-size:9pt; margin:0 0 3mm; }

  table{ width:100%; border-collapse:collapse; }
  thead{ display:table-header-group; }
  tr{ break-inside:avoid; }
  /* Never strand a lone row from a repo table at a page boundary. */
  tbody{ break-inside:auto; }
  table{ break-inside:auto; }
  th{ background:var(--soft); text-align:left; font-size:7.8pt; text-transform:uppercase;
      letter-spacing:.5px; color:var(--dim); padding:1.8mm 2mm; border-bottom:1.2px solid var(--line); }
  td{ padding:1.5mm 2mm; border-bottom:.5px solid var(--line); font-size:8.6pt; vertical-align:top; }
  .num{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .mono{ font-family:"SF Mono",Menlo,Consolas,monospace; font-size:8pt; }
  .dim{ color:var(--dim); }
  .wrap{ overflow-wrap:anywhere; }

  .sev{ font-weight:700; font-size:7.8pt; white-space:nowrap; }
  .sev.CRIT{ color:var(--crit); } .sev.HIGH{ color:var(--high); }
  .sev.MED{ color:var(--med); }   .sev.LOW{ color:var(--low); }  .sev.INFO{ color:var(--dim); }

  .plat{ font-size:7.6pt; font-weight:700; padding:.4mm 1.6mm; border-radius:1mm; white-space:nowrap; }
  .plat.Spring{ background:#e2f5ee; color:var(--low); }
  .plat.Mule{ background:#e4ebff; color:var(--accent); }
  .plat.Other{ background:#fbf3d6; color:var(--med); }

  tr.grouphead td{ background:var(--soft); font-size:8.2pt; font-weight:700; text-transform:uppercase;
                   letter-spacing:.6px; padding:2.2mm 2mm; border-top:1.5px solid var(--line); }
  tr.grouphead.Spring td{ color:var(--low); border-left:2.5px solid var(--low); }
  tr.grouphead.Mule td{ color:var(--accent); border-left:2.5px solid var(--accent); }
  tr.grouphead.Other td{ color:var(--med); border-left:2.5px solid var(--med); }
  .rownum{ display:inline-block; min-width:7mm; color:var(--dim); font-size:7.6pt; }

  /* Two analysis sections side by side; kept whole on one page. */
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:9mm; break-inside:avoid-page; align-items:start; }
  .grid2 > section{ min-width:0; margin-bottom:6mm; }

  /* severity bars — sized to fit a half-width column */
  .bar{ display:flex; align-items:center; gap:2mm; margin:1.4mm 0; }
  .bar .t{ width:15mm; font-size:8.2pt; color:var(--dim); flex:0 0 auto; }
  .bar .track{ flex:1 1 auto; min-width:0; height:4mm; background:var(--soft); border-radius:1mm; overflow:hidden; }
  .bar .fill{ height:100%; }
  .bar .v{ width:22mm; flex:0 0 auto; text-align:right; font-size:8pt; color:var(--dim); white-space:nowrap; }
  .bar .v b{ color:var(--ink); }

  /* Per-repo register. Blocks must be allowed to split across pages: forcing
     a whole repo to stay together pushed any block that did not fit onto the
     next page and left large white gaps at the foot of nearly every page.
     Instead the heading is kept with its first rows and rows never split. */
  .repo-block{ break-inside:auto; margin-bottom:5mm; }
  .repo-head{ display:flex; justify-content:space-between; align-items:baseline; gap:4mm;
              background:var(--soft); border-left:2.5px solid var(--accent); padding:2mm 2.5mm; margin-bottom:0;
              break-after:avoid; break-inside:avoid; }
  .repo-head .nm{ font-family:"SF Mono",Menlo,Consolas,monospace; font-size:8.8pt; font-weight:700; overflow-wrap:anywhere; }
  .repo-head .meta{ font-size:7.8pt; color:var(--dim); white-space:nowrap; }
  .note{ border:1px solid var(--line); border-left:3px solid var(--med); background:#fffdf5;
         padding:3mm 3.5mm; font-size:8.6pt; border-radius:1mm; margin-bottom:4mm; }
</style></head><body>
<div class="sheet">

<!-- ============ COVER ============ -->
<div class="cover">
  <div class="cover-top">
    <div class="cover-head">
      <div class="ch-left">
        <h1>Infrastructure<br>Vulnerability Report</h1>
        <div class="sub">Dependency &amp; configuration CVE assessment<br>${meta ? `of RW's ${fmt(meta.targets)} in-scope repositories` : `across ${fmt(repoRollup.length)} repositories with findings`}</div>
      </div>
      <div class="ch-right">
        <span>Prepared by :</span><b>Natasha — Infra Manager</b>
        <span>Scan date :</span><b>${esc(scanDay)}</b>
        <span>Generated :</span><b>${esc(generated)} IST</b>
        <span>Scanner :</span><b>Trivy — dependency &amp; configuration CVEs</b>
      </div>
    </div>

    <section class="cover-exec">
      <h2>Executive summary</h2>
      <p class="lede">
        A total of <b>${fmt(rows.length)}</b> known software vulnerabilities were identified in
        <b>${fmt(repoRollup.length)}</b>${meta ? ` of the <b>${fmt(meta.scanned)}</b> repositories scanned` : " repositories"}, spanning <b>${fmt(distinctCves)}</b> distinct CVEs.
        <b>${fmt(bySev.CRIT + bySev.HIGH)}</b> are rated Critical or High and warrant prioritised remediation.
        All findings originate in third-party dependencies and configuration, not in application logic, so the
        majority are addressable through version upgrades rather than code rewrites.
      </p>
      ${
        meta
          ? `<div class="note"><b>Scan coverage.</b> Scanned ${fmt(meta.scanned)} of ${fmt(meta.targets)} in-scope repositories on ${esc(scanDay)};
             ${fmt(repoRollup.length)} ${plural(repoRollup.length, "has", "have")} findings;
             ${fmt(meta.failed)} could not be scanned${meta.failed ? " (listed at the end of this report)" : ""}${meta.skipped ? `; ${fmt(meta.skipped)} empty ${plural(meta.skipped, "repository was", "repositories were")} skipped` : ""}.
             ${notOnGithub.length ? `${fmt(notOnGithub.length)} ${plural(notOnGithub.length, "repository", "repositories")} on the in-scope list ${plural(notOnGithub.length, "is", "are")} no longer active on GitHub (removed, renamed or archived).` : ""}
             Each repository was scanned on its configured scan branch at the then-current commit, and only findings
             confirmed present in this run are listed. Potential secrets flagged by pattern matching are reported
             in the web edition, not here.</div>`
          : ""
      }
    </section>

    <div class="cover-stats">
      <div class="cstat"><div class="n">${fmt(rows.length)}</div><div class="l">Total findings</div></div>
      <div class="cstat crit"><div class="n">${fmt(bySev.CRIT)}</div><div class="l">Critical</div></div>
      <div class="cstat high"><div class="n">${fmt(bySev.HIGH)}</div><div class="l">High</div></div>
      <div class="cstat med"><div class="n">${fmt(bySev.MED)}</div><div class="l">Medium</div></div>
      <div class="cstat low"><div class="n">${fmt(bySev.LOW)}</div><div class="l">Low</div></div>
      <div class="cstat"><div class="n">${fmt(distinctCves)}</div><div class="l">Distinct CVEs</div></div>
    </div>
  </div>
</div>

<!-- ===== PAGE 1 (continued): severity + platform ===== -->
<div class="grid2">
<section>
  <h2>Severity distribution</h2>
  ${SEV_ORDER.filter((s) => bySev[s] > 0)
    .map(
      (s) => `<div class="bar"><div class="t">${SEV_LABEL[s]}</div>
      <div class="track"><div class="fill" style="width:${pct(bySev[s])}%;background:var(--${s.toLowerCase()})"></div></div>
      <div class="v"><b>${fmt(bySev[s])}</b> &nbsp; ${pct(bySev[s])}%</div></div>`,
    )
    .join("\n")}
</section>

<section>
  <h2>Platform split</h2>
  <table>
    <thead><tr><th>Platform</th><th class="num">Repos</th><th class="num">Crit</th><th class="num">High</th><th class="num">Total</th></tr></thead>
    <tbody>
    ${platRollup
      .filter((p) => p.total > 0)
      .map(
        (p) => `<tr><td><span class="plat ${p.platform}">${PLAT_LABEL[p.platform]}</span></td>
        <td class="num">${fmt(p.repos)}</td><td class="num">${fmt(p.crit)}</td>
        <td class="num">${fmt(p.high)}</td><td class="num"><b>${fmt(p.total)}</b></td></tr>`,
      )
      .join("")}
    </tbody>
  </table>
</section>
</div>

<!-- ===== PAGE 2: components + CVEs, on their own page ===== -->
<div class="page-break"></div>
<div class="grid2">
<section>
  <h2>Most affected components</h2>
  <p class="lede">Dependencies carrying the most vulnerabilities — upgrading these clears the largest share of findings.</p>
  <table>
    <thead><tr><th>Component / package</th><th class="num">Findings</th></tr></thead>
    <tbody>${topComponents.map(([c, n]) => `<tr><td class="mono wrap">${esc(c)}</td><td class="num">${fmt(n)}</td></tr>`).join("")}</tbody>
  </table>
</section>

<section>
  <h2>Priority CVEs</h2>
  <p class="lede">Highest severity first; within each severity, the advisories affecting the most code.</p>
  <table>
    <thead><tr><th>CVE</th><th>Severity</th><th class="num">Count</th></tr></thead>
    <tbody>${topCves
      .map((c) => `<tr><td class="mono">${esc(c.rule)}</td><td><span class="sev ${esc(c.sev)}">${SEV_LABEL[c.sev] || esc(c.sev)}</span></td><td class="num">${fmt(c.count)}</td></tr>`)
      .join("")}</tbody>
  </table>
</section>
</div>

<!-- ============ REPOSITORY SUMMARY ============ -->
<div class="page-break"></div>
<section>
  <h2>All affected repositories (${fmt(repoRollup.length)})</h2>
  <p class="lede">Every repository with at least one finding, numbered 1–${fmt(repoRollup.length)}. Spring first, then Frontend / Other, then Mule; ranked by Critical, then High, within each group. Names containing “Mule” are MuleSoft; other Java repositories are Spring; the rest are Frontend / Other.</p>
  <table>
    <thead><tr><th>#&nbsp;Repository</th><th>Platform</th><th>Branch</th><th class="num">Crit</th><th class="num">High</th><th class="num">Med</th><th class="num">Low</th><th class="num">Total</th></tr></thead>
    <tbody>
    ${repoRollup
      .map((r, i) => {
        const prev = i > 0 ? repoRollup[i - 1].platform : null;
        const groupCount = repoRollup.filter((x) => x.platform === r.platform).length;
        const head =
          r.platform !== prev
            ? `<tr class="grouphead ${r.platform}"><td colspan="8">${PLAT_LABEL[r.platform]} — ${fmt(groupCount)} repositor${groupCount === 1 ? "y" : "ies"}</td></tr>\n`
            : "";
        return `${head}<tr><td class="mono wrap"><span class="rownum">${i + 1}</span>${esc(r.repo)}</td>
        <td><span class="plat ${r.platform}">${PLAT_LABEL[r.platform]}</span></td>
        <td class="dim" style="font-size:7.8pt">${esc(r.branch)}</td>
        <td class="num"><span class="sev CRIT">${r.crit ? fmt(r.crit) : "—"}</span></td>
        <td class="num"><span class="sev HIGH">${r.high ? fmt(r.high) : "—"}</span></td>
        <td class="num dim">${r.med ? fmt(r.med) : "—"}</td>
        <td class="num dim">${r.low ? fmt(r.low) : "—"}</td>
        <td class="num"><b>${fmt(r.total)}</b></td></tr>`;
      })
      .join("\n")}
    </tbody>
  </table>
</section>

<!-- ============ FULL REGISTER ============ -->
<div class="page-break"></div>
<section>
  <h2>Detailed findings register</h2>
  <p class="lede">All ${fmt(rows.length)} findings, grouped by repository in the same order as the summary above. Within each repository, findings are ordered by severity.</p>
</section>
${repoRollup
  .map(
    (r, i) => `<div class="repo-block">
  <div class="repo-head">
    <div class="nm">${i + 1}. ${esc(r.repo)}</div>
    <div class="meta"><span class="plat ${r.platform}">${PLAT_LABEL[r.platform]}</span> &nbsp; ${esc(r.branch)} &nbsp;·&nbsp;
      ${fmt(r.crit)} crit · ${fmt(r.high)} high · ${fmt(r.med)} med · ${fmt(r.low)} low &nbsp;·&nbsp; <b>${fmt(r.total)} total</b></div>
  </div>
  <table>
    <thead><tr><th style="width:15mm">Severity</th><th style="width:34mm">CVE</th><th>Vulnerable component</th><th style="width:50mm">File</th></tr></thead>
    <tbody>
    ${r.findings
      .map(
        (f) => `<tr><td><span class="sev ${f.sev}">${SEV_LABEL[f.sev] || f.sev}</span></td>
      <td class="mono">${esc(f.rule)}</td>
      <td class="wrap">${esc(String(f.title).split(":").slice(1).join(":").trim() || f.title)}</td>
      <td class="mono dim wrap">${esc(f.file)}${f.line ? ":" + f.line : ""}</td></tr>`,
      )
      .join("\n")}
    </tbody>
  </table>
</div>`,
  )
  .join("\n")}

${
  notScanned.length || notOnGithub.length
    ? `<div class="page-break"></div>
<section>
  <h2>Repositories not scanned in this run (${fmt(notScanned.length + notOnGithub.length)})</h2>
  <p class="lede">These in-scope repositories are not covered by the figures in this report. Any findings they had in earlier runs are not shown.</p>
  <table>
    <thead><tr><th>Repository</th><th>Branch</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>
    ${[
      ...notScanned.map((r) => `<tr><td class="mono wrap">${esc(r.repo)}</td><td class="dim">${esc(r.branch || "—")}</td><td>${r.status === "skipped" ? "Skipped" : "Not scanned"}</td><td class="wrap">${esc(r.reason || "Scan failed")}</td></tr>`),
      ...notOnGithub.map((n) => `<tr><td class="mono wrap">${esc(n)}</td><td class="dim">—</td><td>Not scanned</td><td class="wrap">On the in-scope list but no longer active on GitHub (removed, renamed or archived)</td></tr>`),
    ].join("\n")}
    </tbody>
  </table>
</section>`
    : ""
}

</div>
</body></html>`;

fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
console.log(`print HTML -> ${outHtml} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);

if (htmlOnly) {
  console.log("--html-only: skipped PDF render");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("file://" + path.resolve(outHtml), { waitUntil: "load", timeout: 180000 });
await page.emulateMedia({ media: "print" });
await page.pdf({
  path: outPdf,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#5d6b82;padding:0 12mm;
      font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:space-between;">
      <span>RW Infrastructure — Vulnerability Report · ${scanDay} · Confidential</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`,
  timeout: 300000,
});
await browser.close();

const kb = fs.statSync(outPdf).size / 1024;
console.log(`PDF -> ${outPdf} (${kb > 1024 ? (kb / 1024).toFixed(2) + " MB" : kb.toFixed(0) + " KB"})`);
console.log(`  findings=${rows.length} repos=${repoRollup.length} crit=${bySev.CRIT} high=${bySev.HIGH}`);
