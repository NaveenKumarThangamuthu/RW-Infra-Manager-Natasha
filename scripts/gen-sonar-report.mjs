#!/usr/bin/env node
// Sonar summary report generator.
// Reads Google Sheet Summary tab -> for each (repo, branch) row, hits SonarQube's
// /api/measures/component and /api/issues/search, writes one HTML per unique
// "Branch Name" bucket + an index page.
//
// Env in .env (persistent):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN, SONAR_TOKEN, SONAR_URL
// Falls back to /tmp/srv.env + /tmp/gdrive-refresh-token.txt during migration.

import fs from "node:fs";
import path from "node:path";

const SHEET_ID = "1C-e0rNlL-PRx6gMGyu62RA-oOpOjDBJnnpzhqMQBGAg";
const SHEET_TAB = "Summary";
const SONAR_URL = "http://192.168.16.202:9000";
const SONAR_TOKEN = process.env.SONAR_TOKEN || "";
const OUT_DIR = process.env.SONAR_OUT_DIR || path.resolve(process.cwd(), "public/sonar-reports/" + isoDate());

function isoDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function loadEnv(p) {
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    env[s.slice(0, i)] = s.slice(i + 1).replace(/^['"]|['"]$/g, "");
  }
  return env;
}

async function mintAccessToken(clientId, clientSecret, refresh) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("oauth: " + JSON.stringify(j));
  return j.access_token;
}

async function fetchSheet(accessToken) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "follow" });
  if (!r.ok) throw new Error("sheet " + r.status);
  return r.text();
}

// Parse CSV taking quoted fields into account.
function parseCsv(txt) {
  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (inQ) {
      if (c === '"' && txt[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

// git url -> repo name (basename minus .git)
function repoNameFromUrl(url) {
  const m = String(url || "").match(/([^\/]+?)(\.git)?$/);
  return m ? m[1] : "";
}

async function sonarListProjects() {
  const projects = [];
  let page = 1;
  const auth = "Basic " + Buffer.from(SONAR_TOKEN + ":").toString("base64");
  while (true) {
    const r = await fetch(`${SONAR_URL}/api/projects/search?ps=100&p=${page}`, {
      headers: { Authorization: auth },
    });
    if (!r.ok) throw new Error("sonar/projects " + r.status);
    const j = await r.json();
    projects.push(...(j.components || []));
    const total = j.paging?.total ?? projects.length;
    if (projects.length >= total) break;
    page++;
  }
  return projects;
}

const METRIC_KEYS = "bugs,vulnerabilities,code_smells,security_hotspots,coverage,ncloc,duplicated_lines_density,sqale_index,reliability_rating,security_rating,sqale_rating";

async function sonarMeasures(projectKey) {
  const auth = "Basic " + Buffer.from(SONAR_TOKEN + ":").toString("base64");
  const r = await fetch(`${SONAR_URL}/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${METRIC_KEYS}`, {
    headers: { Authorization: auth },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("sonar/measures " + r.status + " for " + projectKey);
  const j = await r.json();
  const out = {};
  for (const m of j.component?.measures || []) out[m.metric] = m.value;
  return out;
}

async function sonarLastAnalysis(projectKey) {
  const auth = "Basic " + Buffer.from(SONAR_TOKEN + ":").toString("base64");
  const r = await fetch(`${SONAR_URL}/api/project_analyses/search?project=${encodeURIComponent(projectKey)}&ps=1`, {
    headers: { Authorization: auth },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.analyses?.[0]?.date || null;
}

async function sonarQualityGate(projectKey) {
  const auth = "Basic " + Buffer.from(SONAR_TOKEN + ":").toString("base64");
  const r = await fetch(`${SONAR_URL}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`, {
    headers: { Authorization: auth },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.projectStatus?.status || null;
}

// Pull a page of OPEN issues for a project. Returns {issues, severityBreakdown, typeBreakdown, total}.
async function sonarIssues(projectKey, pageSize = 100) {
  const auth = "Basic " + Buffer.from(SONAR_TOKEN + ":").toString("base64");
  const url = `${SONAR_URL}/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&resolved=false&ps=${pageSize}&s=SEVERITY&asc=false&facets=severities,types`;
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const j = await r.json();
  const facetOf = (name) => {
    const f = (j.facets || []).find((x) => x.property === name);
    return Object.fromEntries((f?.values || []).map((v) => [v.val, v.count]));
  };
  return {
    total: j.total ?? 0,
    issues: j.issues || [],
    severityBreakdown: facetOf("severities"),  // BLOCKER/CRITICAL/MAJOR/MINOR/INFO
    typeBreakdown: facetOf("types"),           // BUG/VULNERABILITY/CODE_SMELL
  };
}

function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) { return num(n).toLocaleString("en-IN"); }
function pct(v) {
  if (v === undefined || v === null || v === "") return "—";
  return `${Number(v).toFixed(1)}%`;
}
function ratingLetter(v) {
  if (v === undefined || v === null || v === "") return "—";
  // Sonar returns ratings as float strings like "1.0" .. "5.0"
  const n = Math.round(Number(v));
  const map = { 1: "A", 2: "B", 3: "C", 4: "D", 5: "E" };
  return map[n] || "—";
}

function html(strings, ...values) {
  const escapeHtml = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? (values[i]?.__raw ? values[i].__raw : escapeHtml(values[i])) : ""), "");
}
const raw = (s) => ({ __raw: s });

function pageHead(title) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Natasha Infra Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#f8fafc; --page:#ffffff; --panel:#ffffff; --panel-2:#f1f5f9;
  --border:#e2e8f0; --border-strong:#cbd5e1;
  --text:#0f172a; --text-2:#334155; --muted:#64748b; --muted-soft:#94a3b8;
  --brand:#1d4ed8; --brand-2:#312e81;
  --ok:#16a34a; --ok-bg:#dcfce7; --warn:#d97706; --warn-bg:#fef3c7; --danger:#dc2626; --danger-bg:#fee2e2;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size:14.5px; line-height:1.55; overflow-x:hidden; }
.wrap { max-width:1320px; margin:0 auto; padding:0 24px 60px; }

/* Report header — cover-style (full-bleed, no negative margin) */
.report-header {
  background: linear-gradient(135deg, #eef2ff 0%, #ffffff 60%, #f0fdfa 100%);
  border-bottom: 1px solid var(--border);
  padding: 40px 24px 32px;
  margin: 0 0 32px;
  width: 100%;
}
.header-inner { max-width:1320px; margin:0 auto; display:flex; justify-content:space-between; align-items:flex-start; gap:24px; flex-wrap:wrap; }
.brand-block { display:flex; align-items:center; gap:14px; }
.brand-logo {
  width:52px; height:52px; border-radius:12px;
  background: linear-gradient(135deg, #4f46e5, #06b6d4);
  color:#fff; display:inline-flex; align-items:center; justify-content:center;
  font-family:"Inter"; font-weight:800; font-size:22px; letter-spacing:-0.02em;
  box-shadow: 0 8px 20px -8px rgba(79,70,229,0.5);
}
.brand-text { line-height:1.15; }
.brand-name { font-weight:700; font-size:16px; color:var(--text); letter-spacing:-0.01em; }
.brand-tag { font-size:12px; color:var(--muted); }
.report-meta { text-align:right; color:var(--muted); font-size:12px; }
.report-meta strong { color:var(--text-2); font-weight:600; }
.report-title { margin-top:24px; }
.report-title .eyebrow { text-transform:uppercase; font-size:11px; letter-spacing:.14em; color:var(--brand); font-weight:700; margin-bottom:8px; }
.report-title h1 { font-size:34px; line-height:1.1; margin:0 0 8px; font-weight:800; letter-spacing:-0.025em; color:var(--text); }
.report-title .lede { color:var(--text-2); font-size:15px; max-width:820px; line-height:1.5; }
.prepared-by { margin-top:18px; display:inline-flex; align-items:center; gap:8px; font-size:12.5px; color:var(--muted); background:rgba(29,78,216,0.06); border:1px solid rgba(29,78,216,0.15); padding:6px 12px; border-radius:999px; }
.prepared-by strong { color:var(--brand); font-weight:600; }

/* KPI cards */
h1 { font-size:22px; margin:0 0 4px; font-weight:700; }
.sub { color:var(--muted); font-size:13.5px; margin-bottom:22px; }
.kpi-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:14px; margin-bottom:24px; }
.kpi { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px 18px; box-shadow: 0 1px 2px rgba(15,23,42,0.03); }
.kpi-label { color:var(--muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px; font-weight:600; }
.kpi-hint { color:var(--muted); font-size:11px; line-height:1.4; margin-top:6px; font-weight:400; }
.kpi-val { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; color:var(--text); }

/* Panels */
.panel { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:22px 24px 6px; margin-bottom:22px; box-shadow: 0 1px 2px rgba(15,23,42,0.03); }
.panel h2 { font-size:17px; margin:0 0 8px; font-weight:700; color:var(--text); letter-spacing:-0.01em; }
.panel .desc { color:var(--muted); font-size:13px; margin:-4px 0 14px; line-height:1.5; max-width:820px; }

/* Tables */
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; font-size:13.5px; table-layout: fixed; }
th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); vertical-align:middle; overflow: hidden; text-overflow: ellipsis; }
th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; background:var(--panel-2); }
td.num, th.num { text-align:right; }
tr:hover td { background:#f8fafc; }
tr:last-child td { border-bottom:0; }
/* Service breakdown — explicit column widths so nothing wraps oddly */
.svc-table { table-layout: fixed; }
.svc-table col.c-health   { width: 110px; }
.svc-table col.c-service  { width: auto; }
.svc-table col.c-branch   { width: 130px; }
.svc-table col.c-gate     { width: 78px; }
.svc-table col.c-sev      { width: 62px; }
.svc-table col.c-issue    { width: 62px; }
.svc-table col.c-cov      { width: 70px; }
.svc-table col.c-loc      { width: 84px; }
.svc-table col.c-ratings  { width: 108px; }
.svc-table td, .svc-table th { padding: 10px 8px; font-size: 12.5px; white-space: nowrap; }
.svc-table td:nth-child(2) { white-space: normal; word-break: break-word; }
.svc-table td:nth-child(2) a { font-weight: 600; }
.svc-table .health {
  white-space: nowrap; font-size: 10.5px; padding: 3px 8px; gap: 5px;
}
/* Ratings cell — 3 chips on one row, always */
.svc-table td:last-child { white-space: nowrap; }
.svc-table td:last-child .rating { margin-right: 2px; width: 22px; height: 22px; font-size: 11.5px; }
.svc-table td:last-child .rating:last-child { margin-right: 0; }

/* Health & rating chips */
.health { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:11.5px; font-weight:600; }
.health-good     { color:#166534; background:var(--ok-bg); border:1px solid #86efac; }
.health-fair     { color:#92400e; background:var(--warn-bg); border:1px solid #fcd34d; }
.health-poor     { color:#b91c1c; background:var(--danger-bg); border:1px solid #fca5a5; }
.health-critical { color:#7c2d12; background:#fed7aa; border:1px solid #fb923c; }
.health .dot { width:8px; height:8px; border-radius:50%; }
.health-good .dot { background:var(--ok); }
.health-fair .dot { background:var(--warn); }
.health-poor .dot { background:var(--danger); }
.health-critical .dot { background:#ea580c; }
.pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:600; border:1px solid; }
.pill.ok { color:#166534; border-color:#86efac; background:var(--ok-bg); }
.pill.error { color:#b91c1c; border-color:#fca5a5; background:var(--danger-bg); }
.pill.warn { color:#92400e; border-color:#fcd34d; background:var(--warn-bg); }
.rating { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:6px; font-weight:800; font-size:12px; color:#fff; }
.rating.A { background:#16a34a; }
.rating.B { background:#65a30d; }
.rating.C { background:#d97706; }
.rating.D { background:#ea580c; }
.rating.E { background:#dc2626; }
.rating.na { background:#94a3b8; }

/* Mono + accents */
.mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace; font-size:12.5px; color:var(--text-2); }
.foot { color:var(--muted); font-size:12px; margin-top:32px; padding-top:20px; border-top:1px solid var(--border); text-align:center; }
.foot strong { color:var(--text-2); font-weight:600; }
a { color:var(--brand); text-decoration:none; }
a:hover { text-decoration:underline; }
.not-scanned td { color:var(--muted); font-style:italic; }
.small { font-size:11.5px; color:var(--muted); }

/* Repo grid */
.repo-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:10px; }
.repo-grid a { display:block; padding:11px 14px; background:var(--panel-2); border:1px solid var(--border); border-radius:10px; text-decoration:none; color:var(--text); font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.repo-grid a:hover { border-color:var(--brand); color:var(--brand); background:#eef2ff; }
.repo-grid a .small { display:block; margin-top:3px; color:var(--muted); font-weight:400; }

/* Severity / type chips */
.sev { display:inline-block; padding:3px 9px; border-radius:6px; font-size:11px; font-weight:700; letter-spacing:.02em; }
.sev.BLOCKER  { background:#450a0a; color:#fff; }
.sev.CRITICAL { background:#dc2626; color:#fff; }
.sev.MAJOR    { background:#ea580c; color:#fff; }
.sev.MINOR    { background:#0284c7; color:#fff; }
.sev.INFO     { background:#94a3b8; color:#fff; }
.typechip { display:inline-block; padding:3px 9px; border-radius:6px; font-size:11px; font-weight:600; border:1px solid; }
.typechip.VULNERABILITY   { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
.typechip.BUG             { background:#fef2f2; color:#b91c1c; border-color:#fecaca; }
.typechip.CODE_SMELL      { background:#fef3c7; color:#92400e; border-color:#fcd34d; }
.typechip.SECURITY_HOTSPOT{ background:#ede9fe; color:#6d28d9; border-color:#c4b5fd; }
.issue-table td { vertical-align:top; }
.issue-table .msg { color:var(--text); max-width:520px; }
.issue-table .file { color:var(--muted); font-family:"JetBrains Mono", ui-monospace, SFMono-Regular, monospace; font-size:11.5px; }

/* Glossary */
.glossary { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:14px; }
.glossary-item { padding:14px 16px; background:var(--panel-2); border-radius:10px; border:1px solid var(--border); }
.glossary-item .term { font-weight:700; font-size:13.5px; color:var(--text); margin-bottom:4px; }
.glossary-item .def { color:var(--muted); font-size:12.5px; line-height:1.5; }

/* Executive summary callout */
.exec-summary { background: linear-gradient(135deg, #eef2ff 0%, #ffffff 100%); border: 1px solid #c7d2fe; border-radius:14px; padding:22px 26px; margin-bottom:24px; }
.exec-summary h2 { font-size:16px; margin:0 0 10px; font-weight:700; color:var(--brand-2); letter-spacing:-0.01em; text-transform:uppercase; letter-spacing:.06em; font-size:11.5px; }
.exec-summary p { margin:8px 0; color:var(--text-2); font-size:14px; line-height:1.6; }
.exec-summary strong { color:var(--text); }

@media (max-width: 720px) {
  .report-header { padding:26px 20px 22px; }
  .report-title h1 { font-size:26px; }
  .header-inner { flex-direction:column; }
  .report-meta { text-align:left; }
}

/* Print styles — PDF export */
@media print {
  @page { size: A4 landscape; margin: 14mm 10mm; }
  html, body { background: #fff !important; font-size: 10.5px; }
  a { color: var(--brand); text-decoration: none; }
  .wrap { max-width: none; padding: 0; }
  .report-header {
    background: linear-gradient(135deg, #eef2ff 0%, #ffffff 60%, #f0fdfa 100%) !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    padding: 18px 20px 14px; margin: 0 0 16px;
    page-break-after: avoid; break-after: avoid;
  }
  .report-title { margin-top: 12px; }
  .report-title h1 { font-size: 22px; }
  .report-title .lede { font-size: 12px; }
  .exec-summary, .panel, .kpi-row, .kpi, .glossary-item {
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    page-break-inside: avoid; break-inside: avoid;
  }
  .exec-summary { padding: 12px 16px; margin-bottom: 14px; }
  .kpi-row { grid-template-columns: repeat(7, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpi { padding: 8px 10px; }
  .kpi-val { font-size: 16px; }
  .kpi-hint { font-size: 9.5px; }
  .panel { padding: 12px 14px 4px; margin-bottom: 14px; box-shadow: none; }
  .panel h2 { font-size: 13px; margin-bottom: 4px; }
  .panel .desc { font-size: 10.5px; margin-bottom: 8px; }
  .svc-table td, .svc-table th { padding: 5px 6px; font-size: 9.5px; }
  .svc-table col.c-health { width: 84px; }
  .svc-table col.c-branch { width: 92px; }
  .svc-table col.c-gate { width: 56px; }
  .svc-table col.c-sev { width: 46px; }
  .svc-table col.c-issue { width: 46px; }
  .svc-table col.c-cov { width: 52px; }
  .svc-table col.c-loc { width: 68px; }
  .svc-table col.c-ratings { width: 82px; }
  .svc-table td:last-child .rating { width: 18px; height: 18px; font-size: 10px; margin-right: 1px; }
  .health { font-size: 9px; padding: 2px 6px; }
  .sev, .typechip, .pill { font-size: 9px; padding: 1px 5px; }
  .rating { font-weight: 800; }
  .glossary { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .glossary-item { padding: 8px 10px; }
  .glossary-item .term { font-size: 11px; }
  .glossary-item .def { font-size: 9.5px; line-height: 1.35; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  table { table-layout: fixed; }
  .foot { border-top: 1px solid var(--border); padding-top: 10px; }
  /* prevent long chains of orphan rows */
  .svc-table tbody tr:nth-child(30n) { page-break-after: auto; }
}
</style></head><body>
<div class="report-header"><div class="header-inner">
  <div class="brand-block">
    <div class="brand-logo">N</div>
    <div class="brand-text">
      <div class="brand-name">Natasha Infra Manager</div>
      <div class="brand-tag">Restaurantware · Engineering intelligence</div>
    </div>
  </div>
  <div class="report-meta">
    Report ID · SONAR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}<br>
    Prepared on <strong>${new Date().toISOString().slice(0,10)}</strong><br>
    Data source · SonarQube (Community Edition)
  </div>
</div></div>
<div class="wrap">`;
}
const PAGE_FOOT = `<div class="foot"><strong>Prepared by Natasha Infra Manager</strong> · Data pulled directly from the internal SonarQube server · Confidential · For internal stakeholder review only</div></div></body></html>`;

function repoSlug(row) {
  const b = String(row.branch || "unspecified").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const r = String(row.repo).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `repo-${r}--${b}`;
}

// Plain-English health label from measures + open issues.
function repoHealth(row) {
  if (!row.sonarProject) return { key: "unknown", label: "Not scanned", cls: "" };
  const m = row.measures || {};
  const sev = row.issues?.severityBreakdown || {};
  const gate = row.gate;
  const blockers = num(sev.BLOCKER);
  const critical = num(sev.CRITICAL);
  const vulns = num(m.vulnerabilities);
  if (gate === "ERROR" || blockers > 0 || vulns > 3) return { key: "critical", label: "Urgent", cls: "health-critical" };
  if (critical > 200) return { key: "poor", label: "High risk", cls: "health-poor" };
  if (critical > 20 || num(m.bugs) > 20) return { key: "fair", label: "Some risk", cls: "health-fair" };
  return { key: "good", label: "Healthy", cls: "health-good" };
}

function glossaryPanel() {
  const items = [
    ["Bugs", "Places in the code that will misbehave at runtime (crashes, wrong results, etc.). Every bug is a real defect that will hit customers eventually."],
    ["Vulnerabilities", "Security weaknesses. An attacker could exploit these to compromise data or the service. Highest business risk."],
    ["Security hotspots", "Code that touches sensitive things (auth, secrets, crypto) and needs a security review — not necessarily broken yet, but worth a human look."],
    ["Code smells", "Maintainability issues — hard-to-read code, unused variables, over-complex methods. Doesn't break anything today but slows the team down over time."],
    ["Quality gate", "Sonar's pass/fail verdict on the last analysis. ERROR means the code failed one of your team's quality thresholds."],
    ["Lines of code (NCLOC)", "Number of real source lines (blank lines and comments excluded). A rough measure of how big the codebase is."],
    ["Coverage", "Share of source lines that are exercised by automated tests. Higher is safer to change."],
    ["Ratings (A → E)", "Sonar's 5-grade summary. A means clean, E means many issues. Three ratings shown: Reliability, Security, Maintainability."],
    ["Severity (Blocker / Critical / Major / Minor / Info)", "How urgent the issue is. Blockers will break production; Info items are informational only."],
  ];
  return `<div class="panel"><h2>What the metrics mean</h2>
    <div class="desc">A quick glossary — please read once before scanning the tables below.</div>
    <div class="glossary">${items.map(([term, def]) => `<div class="glossary-item"><div class="term">${term}</div><div class="def">${def}</div></div>`).join("")}</div>
  </div>`;
}

function healthDistribution(rows) {
  const buckets = { good: 0, fair: 0, poor: 0, critical: 0, unknown: 0 };
  for (const r of rows) buckets[repoHealth(r).key]++;
  return buckets;
}

function execSummary(rows, contextLabel) {
  const t = totals(rows);
  const d = healthDistribution(rows);
  const worst = rows
    .filter((r) => r.sonarProject)
    .slice()
    .sort((a, b) => (num(b.issues?.severityBreakdown?.CRITICAL) + num(b.issues?.severityBreakdown?.BLOCKER) * 10) -
                    (num(a.issues?.severityBreakdown?.CRITICAL) + num(a.issues?.severityBreakdown?.BLOCKER) * 10))
    .slice(0, 3)
    .map((r) => r.repo);
  const scannedTotal = rows.length ? Math.round((t.scanned / rows.length) * 100) : 0;
  const health = d.critical + d.poor > 0 ? "requires attention" : d.fair > d.good ? "is fair but improving" : "is broadly healthy";
  return `<div class="exec-summary">
    <h2>Executive summary</h2>
    <p>Across <strong>${rows.length} services</strong> in the ${contextLabel} bucket, <strong>${t.scanned} (${scannedTotal}%)</strong> are actively scanned by SonarQube; <strong>${t.notScanned} are not yet enrolled</strong>. Overall code health <strong>${health}</strong>.</p>
    <p>The scanned code base holds <strong>${fmt(t.bugs)} known bugs</strong>, <strong>${fmt(t.vulns)} security vulnerabilities</strong> and <strong>${fmt(t.hotspots)} security hotspots</strong>, together with <strong>${fmt(t.smells)} maintainability issues</strong>. Repository health breaks down as <strong>${d.critical} needing urgent attention</strong>, <strong>${d.poor} at high risk</strong>, ${d.fair} with some risk, and ${d.good} healthy.${worst.length ? ` Top services to prioritise: <strong>${worst.join(", ")}</strong>.` : ""}</p>
    <p class="small">Prepared by Natasha Infra Manager for internal stakeholder review. Data pulled live from the SonarQube server on ${new Date().toISOString().slice(0,10)}.</p>
  </div>`;
}

function renderRow(row) {
  if (!row.sonarProject) {
    return `<tr class="not-scanned"><td><span class="health">Not scanned</span></td><td><a href="${repoSlug(row)}.html">${row.repo}</a></td><td class="mono">${row.branch}</td><td colspan="10">Service not yet enrolled in SonarQube</td></tr>`;
  }
  const m = row.measures || {};
  const sev = row.issues?.severityBreakdown || {};
  const rBug = ratingLetter(m.reliability_rating);
  const rSec = ratingLetter(m.security_rating);
  const rMaint = ratingLetter(m.sqale_rating);
  const qg = row.gate || "—";
  const gateCls = qg === "OK" ? "ok" : qg === "ERROR" ? "error" : "warn";
  const gateLabel = qg === "OK" ? "Passed" : qg === "ERROR" ? "Failed" : qg;
  const href = `${repoSlug(row)}.html`;
  const h = repoHealth(row);
  return `<tr>
    <td><span class="health ${h.cls}"><span class="dot"></span>${h.label}</span></td>
    <td><a href="${href}">${row.repo}</a></td>
    <td class="mono">${row.branch}</td>
    <td><span class="pill ${gateCls}">${gateLabel}</span></td>
    <td class="num"><span class="sev BLOCKER">${fmt(sev.BLOCKER || 0)}</span></td>
    <td class="num"><span class="sev CRITICAL">${fmt(sev.CRITICAL || 0)}</span></td>
    <td class="num">${fmt(m.bugs)}</td>
    <td class="num">${fmt(m.vulnerabilities)}</td>
    <td class="num">${fmt(m.security_hotspots)}</td>
    <td class="num">${fmt(m.code_smells)}</td>
    <td class="num">${pct(m.coverage)}</td>
    <td class="num">${fmt(m.ncloc)}</td>
    <td><span class="rating ${rBug === "—" ? "na" : rBug}">${rBug}</span> <span class="rating ${rSec === "—" ? "na" : rSec}">${rSec}</span> <span class="rating ${rMaint === "—" ? "na" : rMaint}">${rMaint}</span></td>
  </tr>`;
}

function renderRepoDetail(row) {
  const m = row.measures || {};
  const rBug = ratingLetter(m.reliability_rating);
  const rSec = ratingLetter(m.security_rating);
  const rMaint = ratingLetter(m.sqale_rating);
  const qg = row.gate || "—";
  const gateCls = qg === "OK" ? "ok" : qg === "ERROR" ? "error" : "warn";
  const sonarLink = row.sonarProject
    ? `<a href="${SONAR_URL}/dashboard?id=${encodeURIComponent(row.sonarProject)}" target="_blank" rel="noopener">Open in SonarQube ↗</a>`
    : `<span class="small">(no Sonar project)</span>`;
  const lastAnalysis = row.lastAnalysis ? new Date(row.lastAnalysis).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
  const notScanned = !row.sonarProject;
  const inner = notScanned
    ? `<div class="panel"><h2>Not in SonarQube</h2><p>Repo <span class="mono">${row.repo}</span> (branch <span class="mono">${row.branch}</span>) does not currently have a matching project on ${SONAR_URL}. Set up an analyzer or update the project key to match this name.</p></div>`
    : `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-label">Quality gate</div><div class="kpi-val"><span class="pill ${gateCls}">${qg === "OK" ? "Passed" : qg === "ERROR" ? "Failed" : qg}</span></div><div class="kpi-hint">Sonar's automated pass/fail verdict</div></div>
        <div class="kpi"><div class="kpi-label">Bugs</div><div class="kpi-val">${fmt(m.bugs)}</div><div class="kpi-hint">Runtime defects that can hit customers</div></div>
        <div class="kpi"><div class="kpi-label">Vulnerabilities</div><div class="kpi-val">${fmt(m.vulnerabilities)}</div><div class="kpi-hint">Known security weaknesses</div></div>
        <div class="kpi"><div class="kpi-label">Security hotspots</div><div class="kpi-val">${fmt(m.security_hotspots)}</div><div class="kpi-hint">Sensitive code needing human review</div></div>
        <div class="kpi"><div class="kpi-label">Code smells</div><div class="kpi-val">${fmt(m.code_smells)}</div><div class="kpi-hint">Maintainability issues</div></div>
        <div class="kpi"><div class="kpi-label">Test coverage</div><div class="kpi-val">${pct(m.coverage)}</div><div class="kpi-hint">Share of code exercised by automated tests</div></div>
        <div class="kpi"><div class="kpi-label">Lines of code</div><div class="kpi-val">${fmt(m.ncloc)}</div><div class="kpi-hint">Source lines (blank & comments excluded)</div></div>
      </div>
      <div class="panel"><h2>Ratings</h2>
        <table>
          <thead><tr><th>Dimension</th><th>Rating</th></tr></thead>
          <tbody>
            <tr><td>Reliability</td><td><span class="rating ${rBug === "—" ? "na" : rBug}">${rBug}</span></td></tr>
            <tr><td>Security</td><td><span class="rating ${rSec === "—" ? "na" : rSec}">${rSec}</span></td></tr>
            <tr><td>Maintainability</td><td><span class="rating ${rMaint === "—" ? "na" : rMaint}">${rMaint}</span></td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel"><h2>Sonar project</h2>
        <table>
          <tbody>
            <tr><th>Project key</th><td class="mono">${row.sonarProject}</td></tr>
            <tr><th>Last analysis</th><td>${lastAnalysis}</td></tr>
            <tr><th>Technical debt (SQALE)</th><td>${m.sqale_index ? fmt(m.sqale_index) + " min" : "—"}</td></tr>
            <tr><th>Link</th><td>${sonarLink}</td></tr>
          </tbody>
        </table>
      </div>
      ${renderIssueBreakdown(row)}
      ${renderIssueList(row)}`;
  const h = repoHealth(row);
  return pageHead(`${row.repo} — Code Quality`)
    + `<div class="report-title"><div class="eyebrow">SERVICE REPORT</div><h1>${row.repo}</h1><div class="lede">Detailed code health snapshot for the <span class="mono">${row.repo}</span> service on the <strong>${row.branch}</strong> branch. Numbers pulled live from SonarQube.</div><div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><span class="health ${h.cls}"><span class="dot"></span>${h.label}</span><a href="index.html" class="small">← Portfolio overview</a></div></div>`
    + inner
    + PAGE_FOOT;
}

function renderIssueBreakdown(row) {
  const iss = row.issues;
  if (!iss || iss.total === 0) return "";
  const sev = iss.severityBreakdown || {};
  const typ = iss.typeBreakdown || {};
  const SEV_ORDER = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
  const TYP_ORDER = ["BUG", "VULNERABILITY", "SECURITY_HOTSPOT", "CODE_SMELL"];
  return `<div class="panel"><h2>Open issues — ${fmt(iss.total)} total</h2>
    <table>
      <thead><tr><th>By severity</th><th class="num">Count</th></tr></thead>
      <tbody>
        ${SEV_ORDER.map((s) => `<tr><td><span class="sev ${s}">${s}</span></td><td class="num">${fmt(sev[s] || 0)}</td></tr>`).join("")}
      </tbody>
    </table>
    <div style="height:10px"></div>
    <table>
      <thead><tr><th>By type</th><th class="num">Count</th></tr></thead>
      <tbody>
        ${TYP_ORDER.map((t) => `<tr><td><span class="typechip ${t}">${t.replace("_", " ")}</span></td><td class="num">${fmt(typ[t] || 0)}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function shortFile(component, projectKey) {
  const s = String(component || "").replace(`${projectKey}:`, "");
  return s || "—";
}

function renderIssueList(row) {
  const iss = row.issues;
  if (!iss || !iss.issues || iss.issues.length === 0) return "";
  const shown = iss.issues.slice(0, 100);
  const rows = shown.map((i) => `<tr>
    <td><span class="sev ${i.severity}">${i.severity}</span></td>
    <td><span class="typechip ${i.type}">${(i.type || "").replace("_", " ")}</span></td>
    <td class="msg">${(i.message || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>
    <td class="file">${shortFile(i.component, row.sonarProject)}${i.line ? ":" + i.line : ""}</td>
    <td class="mono">${(i.rule || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>
  </tr>`).join("");
  const more = iss.total > shown.length
    ? `<div class="small" style="margin-top:8px">Showing first ${shown.length} of ${fmt(iss.total)} open issues. <a href="${SONAR_URL}/project/issues?id=${encodeURIComponent(row.sonarProject)}&resolved=false" target="_blank" rel="noopener">See all in SonarQube ↗</a></div>`
    : "";
  return `<div class="panel"><h2>Top issues (highest severity first)</h2>
    <table class="issue-table">
      <thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>File</th><th>Rule</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${more}
  </div>`;
}

function renderTable(rows) {
  return `<table class="svc-table">
    <colgroup>
      <col class="c-health"><col class="c-service"><col class="c-branch"><col class="c-gate">
      <col class="c-sev"><col class="c-sev">
      <col class="c-issue"><col class="c-issue"><col class="c-issue"><col class="c-issue">
      <col class="c-cov"><col class="c-loc"><col class="c-ratings">
    </colgroup>
    <thead><tr>
      <th>Health</th><th>Service</th><th>Branch</th><th>Gate</th>
      <th class="num">Blocker</th><th class="num">Critical</th>
      <th class="num">Bugs</th><th class="num">Vulns</th><th class="num">Hotspots</th><th class="num">Smells</th>
      <th class="num">Coverage</th><th class="num">Lines of code</th>
      <th>Ratings</th>
    </tr></thead>
    <tbody>${rows.map(renderRow).join("")}</tbody>
  </table>`;
}

function totals(rows) {
  const t = { bugs: 0, vulns: 0, hotspots: 0, smells: 0, ncloc: 0, scanned: 0, notScanned: 0 };
  for (const r of rows) {
    if (!r.sonarProject) { t.notScanned++; continue; }
    t.scanned++;
    t.bugs += num(r.measures?.bugs);
    t.vulns += num(r.measures?.vulnerabilities);
    t.hotspots += num(r.measures?.security_hotspots);
    t.smells += num(r.measures?.code_smells);
    t.ncloc += num(r.measures?.ncloc);
  }
  return t;
}

function kpiRow(t) {
  return `<div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Services scanned</div><div class="kpi-val">${t.scanned}</div><div class="kpi-hint">Services with active SonarQube coverage</div></div>
    <div class="kpi"><div class="kpi-label">Not yet scanned</div><div class="kpi-val">${t.notScanned}</div><div class="kpi-hint">Services awaiting Sonar onboarding</div></div>
    <div class="kpi"><div class="kpi-label">Bugs</div><div class="kpi-val">${fmt(t.bugs)}</div><div class="kpi-hint">Defects that can misbehave in production</div></div>
    <div class="kpi"><div class="kpi-label">Vulnerabilities</div><div class="kpi-val">${fmt(t.vulns)}</div><div class="kpi-hint">Known security weaknesses</div></div>
    <div class="kpi"><div class="kpi-label">Security hotspots</div><div class="kpi-val">${fmt(t.hotspots)}</div><div class="kpi-hint">Sensitive code that needs human review</div></div>
    <div class="kpi"><div class="kpi-label">Maintainability issues</div><div class="kpi-val">${fmt(t.smells)}</div><div class="kpi-hint">Code smells — slow the team over time</div></div>
    <div class="kpi"><div class="kpi-label">Lines of code</div><div class="kpi-val">${fmt(t.ncloc)}</div><div class="kpi-hint">Total production source lines (no comments)</div></div>
  </div>`;
}

function branchSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unspecified";
}

async function main() {
  if (!SONAR_TOKEN) { console.error("SONAR_TOKEN env is required"); process.exit(1); }
  // Prefer live process.env (populated when the wrapper sources .env). Fall
  // back to loading .env / /tmp/srv.env directly if the caller ran us bare.
  const envPath = fs.existsSync(path.resolve(process.cwd(), ".env")) ? path.resolve(process.cwd(), ".env") : "/tmp/srv.env";
  const fileEnv = fs.existsSync(envPath) ? loadEnv(envPath) : {};
  const clientId = process.env.GOOGLE_CLIENT_ID || fileEnv.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || fileEnv.GOOGLE_CLIENT_SECRET;
  let refresh = process.env.GDRIVE_REFRESH_TOKEN || fileEnv.GDRIVE_REFRESH_TOKEN || "";
  if (!refresh) {
    // Legacy /tmp file, kept as one-shot fallback during migration.
    try { refresh = fs.readFileSync("/tmp/gdrive-refresh-token.txt", "utf8").trim(); } catch { /* ignore */ }
  }
  if (!clientId || !clientSecret || !refresh) {
    console.error("Missing Google OAuth credentials — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN in .env");
    process.exit(1);
  }
  const access = await mintAccessToken(clientId, clientSecret, refresh);

  console.log("[1/4] Fetching sheet");
  const csv = await fetchSheet(access);
  const [head, ...rows] = parseCsv(csv);
  const H = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const urlIdx = H["github url"], brIdx = H["branch name"], nameIdx = H["service name"];
  const versionIdx = H["version"];
  // Filter: SONAR_VERSION_FILTER="3" restricts to Version=3 (3.0) rows. Default = "3".
  const versionFilter = (process.env.SONAR_VERSION_FILTER ?? "3").trim();

  console.log("[2/4] Listing sonar projects");
  const projects = await sonarListProjects();
  const byKey = new Map();
  const byNorm = new Map(); // normalized name -> project
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const p of projects) {
    byKey.set(p.key, p);
    byNorm.set(norm(p.key), p);
    if (p.name) byNorm.set(norm(p.name), p);
  }

  console.log("[3/4] Querying measures");
  const enriched = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r.length || !r[urlIdx]) continue;
    // Apply version filter (only when the sheet column exists).
    if (versionFilter && versionIdx !== undefined) {
      const v = (r[versionIdx] || "").trim();
      if (v !== versionFilter) continue;
    }
    const repo = repoNameFromUrl(r[urlIdx]);
    const branch = (r[brIdx] || "").trim() || "unspecified";
    const key = repo + "@" + branch;
    if (seen.has(key)) continue;
    seen.add(key);

    const proj = byNorm.get(norm(repo)) || null;
    let measures = null, gate = null, lastAnalysis = null, issues = null;
    if (proj) {
      try {
        measures = await sonarMeasures(proj.key);
        gate = await sonarQualityGate(proj.key);
        lastAnalysis = await sonarLastAnalysis(proj.key);
        issues = await sonarIssues(proj.key, 100);
      } catch (e) { console.warn(" ", repo, "-", e.message); }
    }
    enriched.push({ repo, branch, sonarProject: proj?.key || null, measures, gate, lastAnalysis, issues });
    process.stdout.write(".");
  }
  console.log("\n[4/4] Writing HTML to", OUT_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Bucket normalisation — collapse near-synonymous branches into a single report.
  const BRANCH_BUCKET = {
    "production": "production",
    "feat/env/prod": "production",
    "feat/env/production": "production",
    "prod": "production",
    "master": "production",
    "main": "production",
  };
  const bucket = (b) => BRANCH_BUCKET[String(b).toLowerCase()] || b;

  // Write one HTML per repo/branch row FIRST so branch/index tables can link into them.
  for (const row of enriched) {
    const fname = repoSlug(row) + ".html";
    fs.writeFileSync(path.join(OUT_DIR, fname), renderRepoDetail(row));
  }

  // Group by branch bucket
  const byBranch = new Map();
  for (const row of enriched) {
    const b = bucket(row.branch);
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b).push(row);
  }

  // Write per-branch pages
  const branchLinks = [];
  for (const [branch, rowsInBranch] of [...byBranch.entries()].sort()) {
    const t = totals(rowsInBranch);
    const slug = branchSlug(branch);
    const fname = `branch-${slug}.html`;
    branchLinks.push({ branch, fname, count: rowsInBranch.length, ...t });
    const scope = versionFilter ? `RW ${versionFilter}.0` : "RW-TEAM-AI";
    const body = pageHead(`Code Quality Report — ${branch}`)
      + `<div class="report-title"><div class="eyebrow">${versionFilter ? `RW ${versionFilter}.0 · ` : ""}${branch === "production" ? "PRODUCTION SERVICES" : branch.toUpperCase()}</div><h1>Code Quality Report</h1><div class="lede">A live snapshot of code health, defect load and security posture across the ${branch} services in the ${scope} portfolio. Prepared for stakeholder review.</div><div class="prepared-by">Prepared by <strong>Natasha Infra Manager</strong></div></div>`
      + execSummary(rowsInBranch, branch)
      + kpiRow(t)
      + `<div class="panel"><h2>Service-by-service breakdown</h2><div class="desc">One row per service. Click any service name to open its detailed report. Health status is Natasha's composite verdict, combining Sonar's quality gate and the count of open critical / blocker issues.</div>${renderTable(rowsInBranch)}</div>`
      + glossaryPanel()
      + PAGE_FOOT;
    fs.writeFileSync(path.join(OUT_DIR, fname), body);
  }

  // Index page
  const allTotals = totals(enriched);
  const portfolioScope = versionFilter ? `RW ${versionFilter}.0` : "RW-TEAM-AI";
  let idx = pageHead("Code Quality Report — Portfolio")
    + `<div class="report-title"><div class="eyebrow">${versionFilter ? `RW ${versionFilter}.0 · ` : ""}PORTFOLIO OVERVIEW</div><h1>Code Quality Report</h1><div class="lede">A single-pane view of code health across every ${portfolioScope} service listed on the Summary sheet. Grouped by deployment branch, ranked by risk. Prepared for stakeholder review.</div><div class="prepared-by">Prepared by <strong>Natasha Infra Manager</strong></div></div>`
    + execSummary(enriched, "full portfolio")
    + kpiRow(allTotals)
    + `<div class="panel"><h2>Branches at a glance</h2><div class="desc">Each row is one deployment branch. Numbers roll up across every service on that branch.</div><table><thead><tr><th>Branch</th><th class="num">Services</th><th class="num">Scanned</th><th class="num">Bugs</th><th class="num">Vulns</th><th class="num">Hotspots</th><th class="num">Smells</th><th class="num">Lines</th><th>Detailed report</th></tr></thead><tbody>`;
  for (const l of branchLinks) {
    idx += `<tr><td><strong>${l.branch}</strong></td><td class="num">${l.count}</td><td class="num">${l.scanned}</td><td class="num">${fmt(l.bugs)}</td><td class="num">${fmt(l.vulns)}</td><td class="num">${fmt(l.hotspots)}</td><td class="num">${fmt(l.smells)}</td><td class="num">${fmt(l.ncloc)}</td><td><a href="${l.fname}">Open branch report →</a></td></tr>`;
  }
  idx += `</tbody></table></div>`;
  idx += `<div class="panel"><h2>All services (single view)</h2><div class="desc">Every service across every branch, in one table. Click a service name to open its detailed report.</div>${renderTable(enriched)}</div>`;
  idx += glossaryPanel();
  idx += PAGE_FOOT;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), idx);

  // Emit a lean JSON that Natasha's /sonar page can render server-side.
  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    versionFilter: versionFilter || null,
    scope: versionFilter ? `RW ${versionFilter}.0` : "RW-TEAM-AI",
    totals: totals(enriched),
    healthDistribution: healthDistribution(enriched),
    branches: branchLinks.map((l) => ({ branch: l.branch, count: l.count, scanned: l.scanned, bugs: l.bugs, vulns: l.vulns, hotspots: l.hotspots, smells: l.smells, ncloc: l.ncloc })),
    services: enriched.map((r) => ({
      repo: r.repo,
      branch: r.branch,
      sonarProject: r.sonarProject,
      gate: r.gate,
      lastAnalysis: r.lastAnalysis,
      health: repoHealth(r),
      measures: r.measures || null,
      severityBreakdown: r.issues?.severityBreakdown || null,
      typeBreakdown: r.issues?.typeBreakdown || null,
      totalIssues: r.issues?.total ?? 0,
      topIssues: (r.issues?.issues || []).slice(0, 25).map((i) => ({
        severity: i.severity, type: i.type, message: i.message, rule: i.rule,
        component: (i.component || "").replace(`${r.sonarProject}:`, ""), line: i.line || null,
      })),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "latest-data.json"), JSON.stringify(jsonPayload));
  // Convenience: mirror to top-level "latest" filename too so callers don't need the date.
  fs.writeFileSync(path.resolve(OUT_DIR, "..", "latest-data.json"), JSON.stringify(jsonPayload));

  // Also symlink /latest
  const latestLink = path.resolve(OUT_DIR, "..", "latest");
  try { fs.rmSync(latestLink, { recursive: true, force: true }); } catch {}
  try { fs.symlinkSync(path.basename(OUT_DIR), latestLink); } catch (e) { console.warn("symlink", e.message); }

  console.log("\nWrote", branchLinks.length + 1, "files to", OUT_DIR);
  console.log("Index:", path.join(OUT_DIR, "index.html"));
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
