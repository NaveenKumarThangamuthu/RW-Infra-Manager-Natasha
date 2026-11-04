"use client";
import { useJson } from "./useJson";
import { money } from "./format";
import { Zap, TrendingUp, AlertTriangle, Timer, Sparkles } from "lucide-react";

interface FnRow { arn: string; name: string; region: string; runtime: string; invocations: number; errors: number; durationAvgMs: number; gbSeconds: number }
interface UsageRow { category: string; cost: number }
interface LambdaResp { functions?: FnRow[]; provisioning?: UsageRow[]; total?: number }

const CAT_COLOR: Record<string, string> = {
  "Duration (GB-s)": "#a78bfa",
  "Requests": "#38bdf8",
  "Provisioned Concurrency": "#f472b6",
  "Lambda@Edge": "#34d399",
  "Other": "#94a3b8",
};

export default function LambdaBreakdown() {
  const { data } = useJson<LambdaResp>("/api/cost/lambda");
  if (!data) return null;

  const fns = data.functions ?? [];
  const usage = data.provisioning ?? [];
  const totalInv = fns.reduce((a, f) => a + f.invocations, 0);
  const totalErrors = fns.reduce((a, f) => a + f.errors, 0);
  const totalGbs = fns.reduce((a, f) => a + f.gbSeconds, 0);
  const avgDurationMs = fns.length > 0 ? fns.reduce((a, f) => a + f.durationAvgMs, 0) / fns.length : 0;
  const errRate = totalInv > 0 ? (totalErrors / totalInv) * 100 : 0;

  // Aggregate usage by category
  const byCat = new Map<string, number>();
  for (const u of usage) byCat.set(u.category, (byCat.get(u.category) ?? 0) + u.cost);
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const usageMax = Math.max(1, ...catRows.map(([, v]) => v));

  const topInv = [...fns].sort((a, b) => b.invocations - a.invocations)[0];
  const topErr = [...fns].sort((a, b) => b.errors - a.errors).find((f) => f.errors > 0);

  return (
    <>
      <div className="cards" style={{ marginTop: 12 }}>
        <div className="card kpi kpi-accent">
          <div className="kpi-head-row">
            <div className="label">Total invocations</div>
            <TrendingUp size={13} color="#c4b5fd" />
          </div>
          <div className="value tab-num">{totalInv.toLocaleString()}</div>
          <div className="kpi-foot muted small">across {fns.length} function{fns.length === 1 ? "" : "s"} · 14d</div>
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">Errors</div>
            <AlertTriangle size={13} color={errRate > 1 ? "#fca5a5" : "#facc15"} />
          </div>
          <div className="value tab-num">{totalErrors.toLocaleString()}</div>
          <div className="kpi-foot muted small">{errRate.toFixed(2)}% error rate</div>
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">GB-seconds</div>
            <Zap size={13} color="#f59e0b" />
          </div>
          <div className="value tab-num">{Math.round(totalGbs).toLocaleString()}</div>
          <div className="kpi-foot muted small">duration × memory</div>
        </div>
        <div className="card kpi">
          <div className="kpi-head-row">
            <div className="label">Avg duration</div>
            <Timer size={13} color="#38bdf8" />
          </div>
          <div className="value tab-num">{avgDurationMs.toFixed(0)} ms</div>
          <div className="kpi-foot muted small">mean per invocation</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Cost by usage type</h2>
          <span className="chip">{money(data.total ?? 0)} last 14 days</span>
        </div>
        {catRows.length === 0 ? (
          <div className="empty">No usage-type breakdown yet.</div>
        ) : (
          <div className="lambda-usage-breakdown">
            {catRows.map(([cat, cost]) => {
              const color = CAT_COLOR[cat] ?? "#94a3b8";
              const pct = (cost / usageMax) * 100;
              return (
                <div key={cat} className="lambda-usage-row">
                  <div className="lambda-usage-head">
                    <span className="cat-swatch-dot" style={{ background: color }} />
                    <span className="lambda-usage-label">{cat}</span>
                    <span className="lambda-usage-cost tab-num">{money(cost)}</span>
                  </div>
                  <div className="lambda-usage-bar">
                    <div className="lambda-usage-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(topInv || topErr) && (
        <div className="fable-triage">
          <div className="fable-triage-head"><Sparkles size={13} /> Fable Lambda insight <span className="model-chip">claude-fable-5</span></div>
          <div className="fable-triage-fix">
            {topInv && <><strong>{topInv.name}</strong> handles the most traffic ({topInv.invocations.toLocaleString()} invocations · {topInv.region}). </>}
            {topErr
              ? <>Errors concentrated in <strong>{topErr.name}</strong> ({topErr.errors.toLocaleString()} in 14d). Check its CloudWatch log group first.</>
              : <>No error hotspots — Lambda fleet is healthy.</>}
          </div>
        </div>
      )}
    </>
  );
}
