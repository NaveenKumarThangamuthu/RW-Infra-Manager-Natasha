"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bar, Empty, ErrorBox } from "@/components/Common";
import { money } from "@/components/format";
import { useJson } from "@/components/useJson";
import { TrendingUp, TrendingDown, Minus, Tag as TagIcon } from "lucide-react";
import DailyTrend from "@/components/DailyTrend";
import { toCsv, downloadCsv } from "@/components/csv";
import CategoryTabs from "@/components/CategoryTabs";

interface RosterRow {
  matchKey: string; label: string; region: string; instanceType: string; services: string;
  cost14d: number; compute: number; dataTransfer: number; ebs: number; eip: number;
}
interface BudgetView {
  projection: number;
  budget: number | null;
  pctConsumed: number | null;
  status: "ok" | "warn" | "over" | "unset";
  deltaPctVsBudget: number | null;
}
interface Resp {
  ok: boolean;
  category: string;
  currentMonth: string;
  prevMonth: string;
  summary: {
    serverCount: number;
    total14d: number;
    monthly: { current: number; previous: number; deltaPct: number | null };
    budget: BudgetView;
    monthProgress: { dayOfMonth: number; daysInMonth: number };
  };
  roster: RosterRow[];
  trend: Array<{ date: string; amount: number }>;
  snapshotAt: string | null;
}

function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct == null) return <span className="delta delta-na">new</span>;
  if (Math.abs(deltaPct) < 0.5) return <span className="delta delta-flat"><Minus size={11} />flat</span>;
  const up = deltaPct > 0;
  return (
    <span className={`delta ${up ? "delta-bad" : "delta-good"}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? "+" : ""}{deltaPct.toFixed(1)}%
    </span>
  );
}

export default function TagPage() {
  const params = useParams<{ category: string }>();
  const category = decodeURIComponent(params.category);
  const { data, error, loading } = useJson<Resp>(`/api/cost/by-tag/${encodeURIComponent(category)}`);
  const [exporting, setExporting] = useState(false);

  // Force the document title to reflect the category for tab/share clarity.
  useEffect(() => { document.title = `${category} — Natasha Infra Manager`; }, [category]);

  if (loading) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">Categories</h1></div>
        <CategoryTabs active={category} />
        <div className="cards">
          {[0,1,2,3].map((i) => <div key={i} className="card skel skel-card" />)}
        </div>
      </>
    );
  }
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const max14d = Math.max(1, ...data.roster.map((r) => r.cost14d));

  function onExport() {
    if (!data) return;
    setExporting(true);
    const csv = toCsv(data.roster, [
      { key: "matchKey", label: "Instance ID" },
      { key: "label", label: "Label" },
      { key: "region", label: "Region" },
      { key: "instanceType", label: "Type" },
      { key: "services", label: "Services" },
      { key: "compute", label: "Compute (14d $)" },
      { key: "dataTransfer", label: "Data Transfer (14d $)" },
      { key: "ebs", label: "EBS (14d $)" },
      { key: "eip", label: "EIP (14d $)" },
      { key: "cost14d", label: "Total 14d $" },
    ]);
    downloadCsv(`tag-${data.category}-roster.csv`, csv);
    setTimeout(() => setExporting(false), 600);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <TagIcon size={20} className="ico-inline" />
            Categories
          </h1>
          <p className="page-sub">
            {data.category} · {data.summary.serverCount} server{data.summary.serverCount === 1 ? "" : "s"} ·
            14-day spend {money(data.summary.total14d)} ·
            current month {money(data.summary.monthly.current)}
          </p>
        </div>
        <div className="row-actions">
          <Link href="/ec2" className="btn-ghost">Open in EC2</Link>
          <button className="btn-csv" onClick={onExport} disabled={exporting}>{exporting ? "Exported ✓" : "Export CSV"}</button>
        </div>
      </div>
      <CategoryTabs active={data.category} />

      <div className="cards">
        <div className="card kpi kpi-accent">
          <div className="label">Current month ({data.currentMonth})</div>
          <div className="value tab-num">{money(data.summary.monthly.current)}</div>
          <div className="kpi-foot">
            <DeltaBadge deltaPct={data.summary.monthly.deltaPct} />
            <span className="muted small">vs {data.prevMonth} ({money(data.summary.monthly.previous)})</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">14-day spend</div>
          <div className="value tab-num">{money(data.summary.total14d)}</div>
          <div className="kpi-foot muted small">across {data.roster.length} instance{data.roster.length === 1 ? "" : "s"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Servers in this category</div>
          <div className="value tab-num">{data.summary.serverCount}</div>
          <div className="kpi-foot muted small">{[...new Set(data.roster.map((r) => r.region).filter(Boolean))].join(" · ") || "—"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Avg cost per server</div>
          <div className="value tab-num">{money(data.summary.total14d / Math.max(1, data.roster.length))}</div>
          <div className="kpi-foot muted small">last 14 days</div>
        </div>
      </div>

      {data.summary.budget.budget != null && (
        <div className={`budget-card budget-${data.summary.budget.status}`}>
          <div className="budget-head">
            <div>
              <div className="budget-label">Monthly budget · {data.category}</div>
              <div className="budget-amt tab-num">{money(data.summary.budget.budget)}<span className="muted small"> / mo</span></div>
            </div>
            <div className="budget-progress-wrap">
              <div
                className="budget-progress"
                style={{ width: `${Math.min(100, data.summary.budget.pctConsumed ?? 0)}%` }}
                title={`${(data.summary.budget.pctConsumed ?? 0).toFixed(1)}% of budget consumed`}
              />
              <div
                className="budget-month-marker"
                style={{ left: `${(data.summary.monthProgress.dayOfMonth / data.summary.monthProgress.daysInMonth) * 100}%` }}
                title={`Day ${data.summary.monthProgress.dayOfMonth} of ${data.summary.monthProgress.daysInMonth}`}
              />
            </div>
            <div className="budget-stats">
              <div>
                <div className="budget-stat-label">Consumed</div>
                <div className="budget-stat-val tab-num">{(data.summary.budget.pctConsumed ?? 0).toFixed(1)}%</div>
              </div>
              <div>
                <div className="budget-stat-label">Projected EOM</div>
                <div className="budget-stat-val tab-num">{money(data.summary.budget.projection)}</div>
              </div>
              {data.summary.budget.deltaPctVsBudget != null && (
                <div>
                  <div className="budget-stat-label">vs Budget</div>
                  <div className={`budget-stat-val tab-num budget-delta-${data.summary.budget.status}`}>
                    {data.summary.budget.deltaPctVsBudget > 0 ? "+" : ""}{data.summary.budget.deltaPctVsBudget.toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {data.summary.budget.budget == null && (
        <div className="note budget-empty">
          No budget set for <strong>{data.category}</strong>. Set <code>TAG_BUDGETS_JSON</code> in <code>/tmp/srv.env</code> to enable budget tracking.
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Daily spend — last {data.trend.length} day{data.trend.length === 1 ? "" : "s"}</h2>
          <span className="chip">{data.category} only</span>
        </div>
        <DailyTrend points={data.trend} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Instances</h2>
          <span className="chip">sorted by 14-day cost</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Instance</th>
              <th>Type</th>
              <th>Region</th>
              <th style={{ width: "30%" }}>14-day cost share</th>
              <th className="num">Compute</th>
              <th className="num">DT</th>
              <th className="num">EBS</th>
              <th className="num">EIP</th>
              <th className="num">Total 14d</th>
            </tr>
          </thead>
          <tbody>
            {data.roster.map((r) => (
              <tr key={r.matchKey}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                    <span className="mono small">{r.matchKey}</span>
                    <span className="muted small">{r.label || "—"}</span>
                  </div>
                </td>
                <td className="mono small">{r.instanceType || "—"}</td>
                <td className="mono small">{r.region || "—"}</td>
                <td><Bar value={r.cost14d} max={max14d} /></td>
                <td className="num">{money(r.compute)}</td>
                <td className="num">{money(r.dataTransfer)}</td>
                <td className="num">{money(r.ebs)}</td>
                <td className="num">{money(r.eip)}</td>
                <td className="num">{money(r.cost14d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.roster.length === 0 && <Empty text={`No instances tagged "${data.category}" yet.`} />}
      </div>

      {data.snapshotAt && (
        <div className="note">
          Per-instance costs from snapshot taken{" "}
          <span className="mono">{new Date(data.snapshotAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>.
        </div>
      )}
    </>
  );
}
