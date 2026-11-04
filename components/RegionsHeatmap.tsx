"use client";
import { useMemo } from "react";
import { useJson } from "./useJson";
import { useMonthParam, withMonth } from "./useMonth";
import { money } from "./format";
import { Sparkles } from "lucide-react";

interface RegionRow { region: string; total: number; services: Array<{ service: string; cost: number }> }
interface RegionsResp { total?: number; regions?: RegionRow[] }

function heatColor(pct: number): string {
  // 0 → dark navy · 1 → hot violet
  if (pct <= 0) return "rgba(21,28,54,0.5)";
  if (pct < 0.05) return "rgba(56,189,248,0.10)";
  if (pct < 0.15) return "rgba(129,140,248,0.20)";
  if (pct < 0.30) return "rgba(129,140,248,0.35)";
  if (pct < 0.50) return "rgba(167,139,250,0.55)";
  if (pct < 0.70) return "rgba(192,132,252,0.70)";
  return "rgba(244,114,182,0.85)";
}

export default function RegionsHeatmap() {
  const month = useMonthParam();
  const { data } = useJson<RegionsResp>(withMonth("/api/cost/regions", month));

  const { services, matrix, max, regionTotals, serviceTotals } = useMemo(() => {
    const regions = data?.regions ?? [];
    const svcSet = new Set<string>();
    for (const r of regions) for (const s of r.services) svcSet.add(s.service);
    const topServices = [...svcSet]
      .map((svc) => {
        const total = regions.reduce((a, r) => a + (r.services.find((s) => s.service === svc)?.cost ?? 0), 0);
        return { svc, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const services = topServices.map((s) => s.svc);
    const serviceTotals = topServices.map((s) => s.total);

    const matrix: number[][] = regions.map((r) =>
      services.map((svc) => r.services.find((s) => s.service === svc)?.cost ?? 0)
    );
    const max = Math.max(0.01, ...matrix.flat());
    const regionTotals = regions.map((r) => r.total);
    return { services, matrix, max, regionTotals, serviceTotals };
  }, [data]);

  const regions = data?.regions ?? [];
  if (regions.length === 0) return null;

  const biggest = regions[0];
  const topService = services[0];

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Region × service heatmap</h2>
          <span className="chip">{regions.length} regions · top {services.length} services · {money(data?.total ?? 0)} MTD</span>
        </div>
        <div className="regions-heatmap-wrap">
          <table className="regions-heatmap">
            <thead>
              <tr>
                <th className="regions-heatmap-corner">Region ↓ / Service →</th>
                {services.map((svc) => (
                  <th key={svc} className="regions-heatmap-svc" title={svc}>{svc.length > 18 ? svc.slice(0, 16) + "…" : svc}</th>
                ))}
                <th className="regions-heatmap-total">Row total</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r, i) => (
                <tr key={r.region}>
                  <th className="regions-heatmap-region mono">{r.region}</th>
                  {matrix[i].map((v, j) => (
                    <td key={j}
                        className="regions-heatmap-cell"
                        style={{ background: heatColor(v / max) }}
                        title={`${r.region} · ${services[j]}: ${money(v)}`}>
                      {v > 0 ? <span className="regions-heatmap-cellval tab-num">{money(v)}</span> : <span className="muted">—</span>}
                    </td>
                  ))}
                  <td className="regions-heatmap-cell regions-heatmap-total"><strong className="tab-num">{money(regionTotals[i])}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="regions-heatmap-region">Column total</th>
                {serviceTotals.map((v, j) => (
                  <td key={j} className="regions-heatmap-total"><strong className="tab-num">{money(v)}</strong></td>
                ))}
                <td className="regions-heatmap-total"><strong className="tab-num">{money(data?.total ?? 0)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="regions-heatmap-legend muted small">
          <span>Legend:</span>
          {[0.05, 0.15, 0.3, 0.5, 0.7, 0.9].map((frac) => (
            <span key={frac} className="regions-heatmap-legend-swatch" style={{ background: heatColor(frac) }} />
          ))}
          <span>low ← concentration → high</span>
        </div>
      </div>

      {biggest && topService && (
        <div className="fable-triage">
          <div className="fable-triage-head"><Sparkles size={13} /> Fable regional insight <span className="model-chip">claude-fable-5</span></div>
          <div className="fable-triage-fix">
            <strong>{biggest.region}</strong> concentrates {((biggest.total / (data?.total ?? 1)) * 100).toFixed(0)}% of the bill ({money(biggest.total)}).
            Top service overall: <strong>{topService}</strong>. Look for cross-region traffic pairs on the Data Transfer page if this concentration surprises you.
          </div>
        </div>
      )}
    </>
  );
}
