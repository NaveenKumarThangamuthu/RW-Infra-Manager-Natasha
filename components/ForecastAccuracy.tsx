"use client";
import { useJson } from "./useJson";
import { TrendingUp, Target, Info } from "lucide-react";

interface Resp { series: { month: string; amount: number }[] }

/**
 * Forecast accuracy widget — back-tests the dashboard's projection model on
 * the last N months and reports the typical |% error|.
 *
 * Model: predicts each month as the 3-month moving average of the prior
 * months (or all months prior to it when fewer than 3 are available). This
 * tracks steady-growth accounts more honestly than the naive "prev == cur".
 */
function mape(actuals: number[]): { mape: number | null; lookbackMonths: number } {
  if (actuals.length < 3) return { mape: null, lookbackMonths: actuals.length };
  const errs: number[] = [];
  for (let i = 2; i < actuals.length; i++) {
    const window = actuals.slice(Math.max(0, i - 3), i);
    if (window.length === 0) continue;
    const forecast = window.reduce((a, b) => a + b, 0) / window.length;
    const actual = actuals[i];
    if (forecast > 0) errs.push(Math.abs(actual - forecast) / forecast);
  }
  if (errs.length === 0) return { mape: null, lookbackMonths: actuals.length };
  const m = errs.reduce((a, b) => a + b, 0) / errs.length;
  return { mape: +(m * 100).toFixed(1), lookbackMonths: actuals.length };
}

export default function ForecastAccuracy() {
  const { data, loading } = useJson<Resp>("/api/cost/monthly-total");
  if (loading) return null;

  // Need at least 3 months for the 3-MA back-test
  if (!data || data.series.length < 3) {
    return (
      <div className="forecast-accuracy forecast-accuracy-empty">
        <div className="fa-head">
          <Info size={14} className="ico-inline" />
          <span className="fa-title">Forecast variance</span>
        </div>
        <span className="muted small">Needs 3+ months of history — currently {data?.series.length ?? 0}.</span>
      </div>
    );
  }

  const recent = data.series.slice(-6).map((p) => p.amount);
  const { mape: err, lookbackMonths } = mape(recent);
  if (err == null) return null;

  let confidence = "high";
  if (err > 25) confidence = "low";
  else if (err > 12) confidence = "medium";

  return (
    <div className="forecast-accuracy" title="3-month moving-average back-test on the last 6 months of monthly totals">
      <div className="fa-head">
        <Target size={14} className="ico-inline" />
        <span className="fa-title">Forecast variance</span>
      </div>
      <div className="fa-body">
        <div className="fa-stat">
          <span className="fa-stat-label">Typical MoM ±</span>
          <span className="fa-stat-val tab-num">{err}%</span>
        </div>
        <span className={`fa-conf fa-conf-${confidence}`}>
          <TrendingUp size={11} /> {confidence} confidence
        </span>
        <span className="muted small">3-MA back-test · {lookbackMonths} mo</span>
      </div>
    </div>
  );
}
