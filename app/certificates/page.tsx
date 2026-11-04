"use client";
import { useMemo, useState } from "react";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import {
  ExternalLink, RefreshCw, FileKey, ShieldAlert, ShieldCheck, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Sparkles, Clock, Building2,
} from "lucide-react";

type Severity = "expired" | "crit" | "warn" | "healthy" | "unknown";

interface CertRow {
  id: number;
  distributor: string;
  filename: string;
  driveFileId: string;
  owner: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  parsedAt: string;
  daysLeft: number;
  status: string;
  errorMessage: string | null;
  severity: Severity;
}

interface Kpis {
  total: number;
  expired: number;
  crit: number;
  warn: number;
  healthy: number;
  unknown: number;
  lastScan: string | null;
}

interface Resp {
  kpis: Kpis;
  items: CertRow[];
  byDistributor: Record<string, CertRow[]>;
}

const SEV_ORDER: Severity[] = ["expired", "crit", "warn", "unknown", "healthy"];

const SEV_COLORS: Record<Severity, string> = {
  expired: "#f87171",
  crit:    "#fb923c",
  warn:    "#fbbf24",
  unknown: "#94a3b8",
  healthy: "#6ee7b7",
};

function severityClass(s: Severity): string {
  return `sev-${s}`;
}
function worstSeverity(rows: CertRow[]): Severity {
  for (const s of SEV_ORDER) if (rows.some((r) => r.severity === s)) return s;
  return "healthy";
}
function subjectCn(subject: string): string {
  const m = subject.match(/CN=([^,]+)/i);
  return m ? m[1].trim() : "(no CN)";
}
function subjectOrg(subject: string): string {
  const m = subject.match(/O=([^,]+)/i);
  return m ? m[1].trim() : "";
}
function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function distInitials(name: string): string {
  const cleaned = name.replace(/[_-]/g, " ").split(" ").filter(Boolean);
  const first = cleaned[0]?.[0] ?? "?";
  const second = cleaned[cleaned.length - 1]?.[0] ?? "";
  return (first + second).toUpperCase().slice(0, 2);
}
function distColor(name: string): string {
  // Stable hue from distributor name → premium neon palette.
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const palette = ["#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#f472b6", "#22d3ee", "#facc15"];
  return palette[h % palette.length];
}

type SortKey = "distributor" | "filename" | "owner" | "expires" | "days" | "severity";

export default function CertificatesPage() {
  const { data, error, reload } = useJson<Resp>("/api/certificates");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  async function forceRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const r = await fetch("/api/certificates/refresh", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const fableInsight = useMemo(() => {
    if (!data) return null;
    if (data.kpis.total === 0) return null;
    const soon = data.items
      .filter((i) => i.severity === "crit" || i.severity === "expired")
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const warnList = data.items
      .filter((i) => i.severity === "warn")
      .sort((a, b) => a.daysLeft - b.daysLeft);
    if (soon.length === 0 && warnList.length === 0) {
      return {
        tone: "ok" as const,
        headline: `Fleet healthy — every cert has ≥90 days runway.`,
        detail: `All ${data.kpis.total} certs across your ${Object.keys(data.byDistributor).length} distributors are outside the alert window. Next check: daily 00:30 / 12:30 UTC cron.`,
        action: null,
      };
    }
    if (soon.length === 0) {
      const top = warnList[0];
      return {
        tone: "warn" as const,
        headline: `${warnList.length} cert${warnList.length > 1 ? "s" : ""} in the 90-day window — nothing urgent yet.`,
        detail: `Earliest is ${top.distributor}/${top.filename} (${top.owner === "RW" ? "RW-side" : "partner"}) at ${top.daysLeft}d — renewal ideal 30 days before ${fmtDate(top.notAfter)}.`,
        action: `Watch — Telegram alert will fire when it crosses 30 days.`,
      };
    }
    const top = soon[0];
    const others = soon.length - 1 + warnList.length;
    return {
      tone: "crit" as const,
      headline: `${top.distributor}/${top.filename} expires in ${top.daysLeft} days.`,
      detail: `Owner: ${top.owner === "RW" ? "RW (self-signed)" : `Partner (${subjectOrg(top.subject) || "unknown"})`}. Impact: AS2 EDI flow with this distributor drops after ${fmtDate(top.notAfter)}.${others > 0 ? ` ${others} other cert${others > 1 ? "s" : ""} in the 90-day window.` : ""}`,
      action: top.owner === "RW"
        ? `Action: rotate the RW-side cert & upload the new .cer to the same Drive folder — Natasha auto-picks it up.`
        : `Action: request renewal from the partner's IT (email in the cert's subject line) and drop the new file into the same Drive folder.`,
    };
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (filter !== "all") items = items.filter((i) => i.severity === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.distributor.toLowerCase().includes(q) ||
          i.filename.toLowerCase().includes(q) ||
          i.subject.toLowerCase().includes(q) ||
          i.issuer.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const compare = (a: CertRow, b: CertRow): number => {
      switch (sortKey) {
        case "distributor": return a.distributor.localeCompare(b.distributor) * dir;
        case "filename":    return a.filename.localeCompare(b.filename) * dir;
        case "owner":       return a.owner.localeCompare(b.owner) * dir;
        case "expires":     return (a.notAfter < b.notAfter ? -1 : a.notAfter > b.notAfter ? 1 : 0) * dir;
        case "days":        return (a.daysLeft - b.daysLeft) * dir;
        case "severity":    return (SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)) * dir;
      }
    };
    return [...items].sort(compare);
  }, [data, filter, search, sortKey, sortDir]);

  const selectedCert = useMemo(
    () => (selectedId != null ? data?.items.find((i) => i.id === selectedId) ?? null : null),
    [selectedId, data]
  );

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  if (data.kpis.total === 0) {
    return (
      <div style={{ padding: 20 }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">🛡 Certificates</h1>
            <p className="page-subline">AS2 EDI certificates from the Drive folder tree.</p>
          </div>
          <div className="page-head-actions">
            <button className="btn primary" onClick={forceRefresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} /> {refreshing ? "Scanning…" : "Scan Drive now"}
            </button>
          </div>
        </div>
        <Empty text="No certificates scanned yet. Click 'Scan Drive now' to walk the Drive folder tree and parse every .cer/.crt file." />
      </div>
    );
  }

  const distributors = Object.keys(data.byDistributor).sort();

  return (
    <div className="cert-page">
      {/* HERO */}
      <div className="cert-hero">
        <div className="cert-hero-glow-a" />
        <div className="cert-hero-glow-b" />
        <div className="cert-hero-inner">
          <div className="cert-hero-title-row">
            <div className="cert-hero-title-block">
              <div className="cert-hero-eyebrow">
                <ShieldCheck size={12} /> AS2 EDI CERTIFICATES
              </div>
              <h1 className="cert-hero-title">
                <span className="cert-hero-title-grad">Certificate</span> vault
              </h1>
              <p className="cert-hero-subline">
                {data.kpis.total} certs across <b>{distributors.length}</b> distributors ·
                last scan <span className="cert-hero-strong">{relTime(data.kpis.lastScan)}</span>
                {data.kpis.crit + data.kpis.expired > 0 && (
                  <> · <span className="cert-hero-alert">{data.kpis.crit + data.kpis.expired} urgent</span></>
                )}
              </p>
            </div>
            <div className="cert-hero-actions">
              <button className="btn primary cert-refresh-btn" onClick={forceRefresh} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? "spin" : ""} />
                {refreshing ? "Scanning Drive…" : "Refresh all"}
              </button>
            </div>
          </div>

          {/* HERO BODY — donut + KPI stack */}
          <div className="cert-hero-body">
            <SeverityDonut kpis={data.kpis} />
            <div className="cert-kpi-stack">
              <PremiumKpi label="Total" value={data.kpis.total} tone="mint" icon={<ShieldCheck size={14} />} />
              <PremiumKpi label="Expired" value={data.kpis.expired} tone={data.kpis.expired > 0 ? "red" : "muted"} icon={<ShieldAlert size={14} />} />
              <PremiumKpi label="≤ 30 days" value={data.kpis.crit} tone={data.kpis.crit > 0 ? "orange" : "muted"} icon={<Clock size={14} />} />
              <PremiumKpi label="≤ 90 days" value={data.kpis.warn} tone={data.kpis.warn > 0 ? "amber" : "muted"} icon={<Clock size={14} />} />
              <PremiumKpi label="Healthy" value={data.kpis.healthy} tone="mint" icon={<ShieldCheck size={14} />} />
              {data.kpis.unknown > 0 && (
                <PremiumKpi label="Parse err" value={data.kpis.unknown} tone="grey" icon={<ShieldAlert size={14} />} />
              )}
            </div>
          </div>

          {/* FABLE INSIGHT */}
          {fableInsight && (
            <div className={`cert-fable ${`cert-fable-${fableInsight.tone}`}`}>
              <div className="cert-fable-head">
                <Sparkles size={13} /> <span>Fable insight</span>
                <span className="cert-fable-model">claude-fable-5</span>
              </div>
              <div className="cert-fable-headline">{fableInsight.headline}</div>
              <div className="cert-fable-detail">{fableInsight.detail}</div>
              {fableInsight.action && <div className="cert-fable-action">→ {fableInsight.action}</div>}
            </div>
          )}
        </div>
      </div>

      {/* DISTRIBUTOR CARDS */}
      <div className="cert-section-head">
        <h2 className="cert-section-title2"><Building2 size={14} /> Distributors</h2>
        <div className="cert-section-sub">{distributors.length} folders in Drive · one card per partner</div>
      </div>
      <div className="cert-dist-grid">
        {distributors.map((d) => {
          const rows = data.byDistributor[d];
          const worst = worstSeverity(rows);
          const rw = rows.filter((r) => r.owner === "RW");
          const partner = rows.filter((r) => r.owner === "PARTNER");
          const minDays = rows.reduce((acc, r) => (r.status === "success" ? Math.min(acc, r.daysLeft) : acc), Infinity);
          const nextExp = rows.reduce<CertRow | null>((acc, r) => {
            if (r.status !== "success") return acc;
            if (!acc || r.notAfter < acc.notAfter) return r;
            return acc;
          }, null);
          const color = distColor(d);
          return (
            <div key={d} className={`cert-dist-card-2 cert-worst-${worst}`}>
              <div className="cert-dist-strip" style={{ background: `linear-gradient(135deg, ${color}, ${color}80)` }}>
                <div className="cert-dist-initials">{distInitials(d)}</div>
                <div className={`cert-dist-status-dot ${severityClass(worst)}`} />
              </div>
              <div className="cert-dist-card-body">
                <div className="cert-dist-name-2">{d}</div>
                <div className="cert-dist-days-row">
                  <div className={`cert-dist-days-num cert-days-${worst}`}>
                    {minDays === Infinity ? "—" : minDays < 0 ? "expired" : minDays}
                    {minDays !== Infinity && minDays >= 0 && <span className="cert-dist-days-unit">d</span>}
                  </div>
                  <div className="cert-dist-days-label">next expiry</div>
                </div>
                <div className="cert-dist-owner-row-2">
                  {rw.length > 0 && <OwnerChip label="RW" count={rw.length} rows={rw} colorHex="#6ee7b7" />}
                  {partner.length > 0 && <OwnerChip label="Partner" count={partner.length} rows={partner} colorHex="#38bdf8" />}
                </div>
                {nextExp && (
                  <div className="cert-dist-next-action">
                    <span className="cert-dist-next-label">next:</span>
                    <span className="cert-dist-next-file">{nextExp.filename}</span>
                    <span className="cert-dist-next-date">{fmtDate(nextExp.notAfter)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DETAILS TABLE */}
      <div className="cert-section-head">
        <h2 className="cert-section-title2"><FileKey size={14} /> All certificates</h2>
        <div className="cert-section-sub">{filteredItems.length} of {data.items.length} shown · click a row for details</div>
      </div>
      <div className="cert-table-panel-2">
        <div className="cert-table-toolbar">
          <div className="cert-search-box">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by distributor, filename, CN, or issuer…"
              className="cert-search-input"
            />
          </div>
          <div className="cert-filter-chips-2">
            {(["all", "expired", "crit", "warn", "healthy", "unknown"] as const).map((f) => {
              const n = f === "all" ? data.items.length : data.items.filter((i) => i.severity === f).length;
              return (
                <button
                  key={f}
                  className={`cert-filter-chip-2 ${filter === f ? "active" : ""} chip-${f}`}
                  onClick={() => setFilter(f)}
                >
                  <span className="chip-dot" style={{ background: SEV_COLORS[f as Severity] || "#a78bfa" }} />
                  {f === "all" ? "All" :
                   f === "expired" ? "Expired" :
                   f === "crit" ? "≤30d" :
                   f === "warn" ? "≤90d" :
                   f === "healthy" ? "Healthy" : "Parse err"}
                  <span className="chip-count">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="cert-table-wrap-2">
          <table className="cert-table-2">
            <thead>
              <tr>
                <ThSort label="Distributor" k="distributor" cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <ThSort label="File" k="filename"    cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <ThSort label="Owner" k="owner"      cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <th>Common name</th>
                <th>Issuer</th>
                <ThSort label="Expires" k="expires"  cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <ThSort label="Days" k="days"        cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <ThSort label="Status" k="severity"  cur={sortKey} dir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((r) => (
                <tr
                  key={r.id}
                  className={`cert-row-2 cert-row-${r.severity} ${selectedId === r.id ? "cert-row-active" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <td className="mono-sm">{r.distributor}</td>
                  <td className="mono-sm">
                    <FileKey size={11} className="cert-file-ico" /> {r.filename}
                  </td>
                  <td>
                    <span className={`cert-owner-pill-2 ${r.owner === "RW" ? "cert-owner-rw" : "cert-owner-partner"}`}>
                      {r.owner === "RW" ? "🟢 RW" : "🔵 Partner"}
                    </span>
                  </td>
                  <td>{subjectCn(r.subject)}</td>
                  <td className="cert-issuer-cell">{subjectCn(r.issuer)}</td>
                  <td className="mono-sm">{fmtDate(r.notAfter)}</td>
                  <td className={`mono-sm cert-days-${r.severity}`}>
                    {r.status === "success" ? `${r.daysLeft}d` : "—"}
                  </td>
                  <td>
                    <span className={`cert-status-pill-2 ${severityClass(r.severity)}`}>
                      {r.severity === "healthy" ? "healthy" :
                       r.severity === "warn"    ? "warn" :
                       r.severity === "crit"    ? "≤30d" :
                       r.severity === "expired" ? "expired" : "error"}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <a
                      href={`https://drive.google.com/file/d/${r.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cert-drive-link-2"
                    >
                      Drive <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={9} className="cert-empty-row">No certificates match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCert && (
        <CertDrawer cert={selectedCert} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function PremiumKpi({ label, value, tone, icon }: { label: string; value: number; tone: "mint" | "red" | "orange" | "amber" | "muted" | "grey"; icon: React.ReactNode }) {
  return (
    <div className={`cert-pkpi cert-pkpi-${tone}`}>
      <div className="cert-pkpi-ico">{icon}</div>
      <div className="cert-pkpi-vlabel">
        <div className="cert-pkpi-value">{value}</div>
        <div className="cert-pkpi-label">{label}</div>
      </div>
    </div>
  );
}

function SeverityDonut({ kpis }: { kpis: Kpis }) {
  const total = kpis.total || 1;
  const segments = [
    { key: "expired" as const, value: kpis.expired, color: SEV_COLORS.expired },
    { key: "crit" as const,    value: kpis.crit,    color: SEV_COLORS.crit },
    { key: "warn" as const,    value: kpis.warn,    color: SEV_COLORS.warn },
    { key: "healthy" as const, value: kpis.healthy, color: SEV_COLORS.healthy },
    { key: "unknown" as const, value: kpis.unknown, color: SEV_COLORS.unknown },
  ].filter((s) => s.value > 0);

  const R = 62, INNER = 42, CX = 80, CY = 80;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.map((s) => {
    const frac = s.value / total;
    const len = frac * CIRC;
    const el = {
      color: s.color,
      dasharray: `${len} ${CIRC - len}`,
      dashoffset: -acc,
      key: s.key,
    };
    acc += len;
    return el;
  });

  const worstCount = kpis.expired + kpis.crit + kpis.warn;
  const percentHealthy = Math.round((kpis.healthy / total) * 100);

  return (
    <div className="cert-donut-wrap">
      <svg viewBox="0 0 160 160" className="cert-donut">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={20} />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={20}
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.dashoffset}
            transform={`rotate(-90 ${CX} ${CY})`}
            style={{ transition: "stroke-dasharray 400ms" }}
          />
        ))}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="26" fontWeight={700} fill="#e5e7eb" fontFamily="ui-monospace, monospace">
          {kpis.total}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" fontSize="9.5" fill="#94a3b8" letterSpacing="1.2">
          CERTIFICATES
        </text>
      </svg>
      <div className="cert-donut-side">
        <div className="cert-donut-headline">
          {worstCount === 0
            ? `${percentHealthy}% healthy`
            : `${worstCount} need${worstCount === 1 ? "s" : ""} attention`}
        </div>
        <div className="cert-donut-legend">
          {segments.map((s) => (
            <div key={s.key} className="cert-donut-leg">
              <span className="cert-donut-leg-dot" style={{ background: s.color }} />
              <span className="cert-donut-leg-label">
                {s.key === "expired" ? "Expired" :
                 s.key === "crit" ? "≤30 days" :
                 s.key === "warn" ? "≤90 days" :
                 s.key === "healthy" ? "Healthy" : "Parse err"}
              </span>
              <span className="cert-donut-leg-value">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OwnerChip({ label, count, rows, colorHex }: { label: string; count: number; rows: CertRow[]; colorHex: string }) {
  const worst = worstSeverity(rows);
  const minDays = rows.reduce((acc, r) => (r.status === "success" ? Math.min(acc, r.daysLeft) : acc), Infinity);
  return (
    <div className="cert-owner-chip">
      <div className="cert-owner-chip-dot" style={{ background: colorHex }} />
      <div className="cert-owner-chip-info">
        <div className="cert-owner-chip-label">{label}</div>
        <div className={`cert-owner-chip-days cert-days-${worst}`}>
          {minDays === Infinity ? "—" : `${minDays}d`}
        </div>
      </div>
      <div className="cert-owner-chip-count">×{count}</div>
    </div>
  );
}

function ThSort({ label, k, cur, dir, onSort }: { label: string; k: SortKey; cur: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey, d: "asc" | "desc") => void }) {
  const active = cur === k;
  const nextDir: "asc" | "desc" = active && dir === "asc" ? "desc" : "asc";
  return (
    <th className={`cert-th-sort ${active ? "active" : ""}`} onClick={() => onSort(k, nextDir)}>
      <div className="cert-th-sort-inner">
        {label}
        {active ? (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="cert-th-sort-idle" />}
      </div>
    </th>
  );
}

function CertDrawer({ cert, onClose }: { cert: CertRow; onClose: () => void }) {
  const cn = subjectCn(cert.subject);
  const org = subjectOrg(cert.subject) || "—";
  const issuerCn = subjectCn(cert.issuer);
  const issuerOrg = subjectOrg(cert.issuer) || "—";
  return (
    <>
      <div className="cert-drawer-scrim" onClick={onClose} />
      <div className={`cert-drawer cert-drawer-${cert.severity}`}>
        <div className="cert-drawer-head">
          <div>
            <div className="cert-drawer-eyebrow">{cert.distributor}</div>
            <div className="cert-drawer-title">{cert.filename}</div>
          </div>
          <button className="cert-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className={`cert-drawer-status-bar cert-status-pill-2 ${severityClass(cert.severity)}`}>
          {cert.severity === "expired" ? "⛔ EXPIRED " + Math.abs(cert.daysLeft) + " days ago" :
           cert.severity === "crit"    ? "🔴 " + cert.daysLeft + " days left" :
           cert.severity === "warn"    ? "🟡 " + cert.daysLeft + " days left" :
           cert.severity === "healthy" ? "🟢 " + cert.daysLeft + " days left" : "❓ parse failed"}
        </div>
        <div className="cert-drawer-body">
          <DrawerField label="Owner" value={cert.owner === "RW" ? "🟢 RW (self-signed by Restaurantware)" : "🔵 Partner"} />
          <DrawerField label="Common name" value={cn} mono />
          <DrawerField label="Organisation" value={org} />
          <DrawerField label="Issuer CN" value={issuerCn} mono />
          <DrawerField label="Issuer Organisation" value={issuerOrg} />
          <DrawerField label="Valid from" value={fmtDate(cert.notBefore)} mono />
          <DrawerField label="Valid to" value={fmtDate(cert.notAfter)} mono />
          <DrawerField label="SHA-256 fingerprint" value={cert.fingerprintSha256} mono wrap />
          <DrawerField label="Google Drive file id" value={cert.driveFileId} mono />
          <DrawerField label="Last parsed" value={relTime(cert.parsedAt)} />
          {cert.errorMessage && <DrawerField label="Error" value={cert.errorMessage} mono wrap />}
        </div>
        <div className="cert-drawer-actions">
          <a
            className="btn primary"
            href={`https://drive.google.com/file/d/${cert.driveFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={13} /> Open in Drive
          </a>
        </div>
      </div>
    </>
  );
}

function DrawerField({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="cert-drawer-field">
      <div className="cert-drawer-field-label">{label}</div>
      <div className={`cert-drawer-field-value ${mono ? "mono-sm" : ""} ${wrap ? "wrap" : ""}`}>{value}</div>
    </div>
  );
}
