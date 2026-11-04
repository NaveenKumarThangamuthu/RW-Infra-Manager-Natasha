"use client";
import { useState } from "react";
import { useJson } from "./useJson";
import { useMonthParam, withMonth } from "./useMonth";
import { money } from "./format";
import { Bar, ErrorBox, Empty } from "./Common";
import DonutChart, { type DonutSegment } from "./DonutChart";
import LineChart from "./LineChart";
import DailyTrend from "./DailyTrend";
import AnomalyFeed from "./AnomalyFeed";
import ForecastAccuracy from "./ForecastAccuracy";
import AIBrief from "./AIBrief";
import SnapshotAgeChip from "./SnapshotAgeChip";
import Sparkline from "./Sparkline";
import HomeGreeting from "./HomeGreeting";
import ThreeThings from "./ThreeThings";
import RecentActivity from "./RecentActivity";
import FableInsights from "./FableInsights";
import CategoryTiles from "./CategoryTiles";
import CategoryDailyChart from "./CategoryDailyChart";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface DeltaItem { key: string; amount: number; unit: string; prev: number; deltaPct: number | null }
interface DailyPoint { date: string; amount: number }
interface SummaryResp {
  month: string | null;
  range: { Start: string; End: string };
  isCurrentMonth: boolean;
  mtdTotal: number;
  last7: number;
  avgPerDay: number;
  projectedMonth: number | null;
  forecastRest: number | null;
  topServices: DeltaItem[];
  topRegions: DeltaItem[];
  trend: DailyPoint[];
  prev?: { month: string; total: number; deltaPct: number | null };
  stale?: boolean;
  asOf?: string;
}

interface Bucket { category: string; amount: number; unit?: string }
interface TagSplitResp { snapshotAt: string | null; buckets: Bucket[]; projectionFactor: number }

const CAT_COLORS: Record<string, string> = {
  "2.0": "#38bdf8",
  "3.0": "#a78bfa",
  Infra: "#f59e0b",
  Dev: "#f472b6",
  Shared: "#34d399",
  "Not using": "#64748b",
  Other: "#94a3b8",
};

function DeltaBadge({ deltaPct, inverse = false }: { deltaPct: number | null; inverse?: boolean }) {
  if (deltaPct == null) return <span className="delta delta-na">new</span>;
  if (Math.abs(deltaPct) < 0.5) {
    return <span className="delta delta-flat"><Minus size={11} />flat</span>;
  }
  const up = deltaPct > 0;
  // For cost: up = bad (red). inverse=true would flip the semantics.
  const tone = up ? (inverse ? "delta-good" : "delta-bad") : (inverse ? "delta-bad" : "delta-good");
  const sign = up ? "+" : "";
  return (
    <span className={`delta ${tone}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {sign}{deltaPct.toFixed(1)}%
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="cards">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card skel skel-card" />)}
      </div>
      <div className="panel">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel skel-row" />)}
      </div>
    </>
  );
}

function CostSplitDonut({ view }: { view: "14d" | "month" }) {
  const { data, error, loading } = useJson<TagSplitResp>("/api/cost/tag-split");

  if (loading) return <div className="skel skel-donut" />;
  if (error) return <Empty text="Cost split unavailable." />;
  if (!data || data.buckets.length === 0) {
    return <Empty text="No tag snapshot yet — run a refresh to populate." />;
  }

  const factor = view === "month" ? (data.projectionFactor ?? 1) : 1;
  const segments: DonutSegment[] = data.buckets
    .filter((b) => CAT_COLORS[b.category] && b.amount > 0)
    .map((b) => ({ label: b.category, value: b.amount * factor, color: CAT_COLORS[b.category] }));

  return <DonutChart segments={segments} centerSub={view === "month" ? "EC2 by tag · expected /mo" : "EC2 by tag · 14d"} />;
}

interface MonthlyTotalResp { series: { month: string; amount: number }[] }
function TotalCostTrend() {
  const { data, error, loading } = useJson<MonthlyTotalResp>("/api/cost/monthly-total");
  if (loading) return <div className="skel skel-donut" />;
  if (error || !data || data.series.length === 0) return <Empty text="No monthly history yet." />;
  return (
    <LineChart
      labels={data.series.map((p) => p.month)}
      series={[{ label: "Total cost", color: "#38bdf8", values: data.series.map((p) => p.amount) }]}
    />
  );
}

interface DtTrendResp { series: { month: string; public: number; private: number }[] }
function DataTransferTrend() {
  const { data, error, loading } = useJson<DtTrendResp>("/api/cost/datatransfer-trend");
  if (loading) return <div className="skel skel-donut" />;
  if (error || !data || data.series.length === 0) return <Empty text="No data-transfer history yet." />;
  return (
    <LineChart
      labels={data.series.map((p) => p.month)}
      series={[
        { label: "Public (Internet egress / Public IPv4)", color: "#f59e0b", values: data.series.map((p) => p.public) },
        { label: "Private (Intra-AWS / cross-AZ)", color: "#34d399", values: data.series.map((p) => p.private) },
      ]}
    />
  );
}

export default function Dashboard() {
  const month = useMonthParam();
  const [splitView, setSplitView] = useState<"14d" | "month">("14d");
  const { data, error, loading, reload } = useJson<SummaryResp>(withMonth("/api/cost/summary", month));

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxSvc = Math.max(1, ...data.topServices.map((s) => s.amount));
  const maxReg = Math.max(1, ...data.topRegions.map((s) => s.amount));
  const totalDelta = data.prev?.deltaPct ?? null;

  return (
    <>
      {data.stale && (
        <div className="stale-banner">
          ⚠️ AWS session expired — showing the last saved data
          {data.asOf ? ` from ${new Date(data.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}.
          Daily trend &amp; forecast need a live connection; re-login to refresh.
        </div>
      )}

      <HomeGreeting />

      <div className="home-hero-grid">
        <div className="cards home-hero-kpis">
        <div className="card kpi kpi-accent">
          <div className="kpi-head-row">
            <div className="label">{data.isCurrentMonth ? "Month-to-date" : "Total for month"}</div>
            <Sparkline points={data.trend.map((t) => t.amount)} color="#c4b5fd" />
          </div>
          <div className="value tab-num">{money(data.mtdTotal)}</div>
          {data.prev && (
            <div className="kpi-foot">
              <DeltaBadge deltaPct={totalDelta} />
              <span className="muted small">vs {data.prev.month} ({money(data.prev.total)})</span>
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">Forecast (total this month)</div>
            <Sparkline points={data.trend.map((t) => t.amount)} color="#38bdf8" />
          </div>
          <div className="value tab-num">{data.forecastRest != null ? money(data.forecastRest) : "—"}</div>
          {data.projectedMonth != null && data.prev && data.prev.total > 0 && (
            <div className="kpi-foot">
              <DeltaBadge deltaPct={+(((data.projectedMonth - data.prev.total) / data.prev.total) * 100).toFixed(1)} />
              <span className="muted small">projected vs {data.prev.month}</span>
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">Last 7 days</div>
            <Sparkline points={data.trend.slice(-7).map((t) => t.amount)} color="#34d399" />
          </div>
          <div className="value tab-num">{money(data.last7)}</div>
          <div className="kpi-foot muted small">
            avg {money(data.last7 / Math.max(1, Math.min(7, data.trend.length)))} / day
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">Avg / day</div>
            <Sparkline points={data.trend.map((t) => t.amount)} color="#f472b6" />
          </div>
          <div className="value tab-num">{money(data.avgPerDay)}</div>
          <div className="kpi-foot muted small">
            over {data.trend.length} day{data.trend.length === 1 ? "" : "s"}
          </div>
        </div>
        </div>
        <ThreeThings />
      </div>

      <AIBrief />

      <CategoryTiles />

      <FableInsights />

      <ForecastAccuracy />

      <CategoryDailyChart />

      <AnomalyFeed />

      <RecentActivity />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2>Cost split by tag<SnapshotAgeChip source="ec2-health" /></h2>
            <div className="modetoggle">
              <button className={splitView === "14d" ? "active" : ""} onClick={() => setSplitView("14d")}>Last 14 days</button>
              <button className={splitView === "month" ? "active" : ""} onClick={() => setSplitView("month")}>Expected /mo</button>
            </div>
          </div>
          <CostSplitDonut view={splitView} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Daily spend — last {data.trend.length} days</h2>
            <button className="refresh" onClick={reload}>Refresh</button>
          </div>
          <DailyTrend points={data.trend} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2>Top services (MTD)</h2>
            {data.prev && <span className="chip">vs {data.prev.month}</span>}
          </div>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ width: "30%" }}>Share</th>
                <th className="num">Δ</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.topServices.map((s) => (
                <tr key={s.key}>
                  <td>{s.key}</td>
                  <td><Bar value={s.amount} max={maxSvc} /></td>
                  <td className="num"><DeltaBadge deltaPct={s.deltaPct} /></td>
                  <td className="num">{money(s.amount, s.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.topServices.length === 0 && <Empty text="No service cost yet." />}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Top regions (MTD)</h2>
            {data.prev && <span className="chip">vs {data.prev.month}</span>}
          </div>
          <table>
            <thead>
              <tr>
                <th>Region</th>
                <th style={{ width: "30%" }}>Share</th>
                <th className="num">Δ</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.topRegions.map((r) => (
                <tr key={r.key}>
                  <td className="mono">{r.key}</td>
                  <td><Bar value={r.amount} max={maxReg} /></td>
                  <td className="num"><DeltaBadge deltaPct={r.deltaPct} /></td>
                  <td className="num">{money(r.amount, r.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.topRegions.length === 0 && <Empty text="No regional cost yet." />}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2>Total cost — last 12 months</h2>
            <span className="chip">monthly</span>
          </div>
          <TotalCostTrend />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Data transfer — Public vs Private</h2>
            <span className="chip">last 12 months</span>
          </div>
          <DataTransferTrend />
        </div>
      </div>

      <div className="note">
        Period: <span className="mono">{data.range.Start} → {data.range.End}</span>.
        {data.isCurrentMonth && data.forecastRest == null && " (Forecast unavailable — Cost Explorer needs more history.)"}
        {!data.isCurrentMonth && " Showing a past month — forecast does not apply."}
      </div>
    </>
  );
}
