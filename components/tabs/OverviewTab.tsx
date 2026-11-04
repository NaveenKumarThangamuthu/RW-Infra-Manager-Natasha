"use client";
import { useJson } from "../useJson";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";

interface CostItem { key: string; amount: number; unit: string }
interface OverviewResp {
  range: { Start: string; End: string };
  total: number;
  byService: CostItem[];
  byRegion: CostItem[];
}

export default function OverviewTab() {
  const { data, error, loading, reload } = useJson<OverviewResp>("/api/cost/overview");

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxService = Math.max(1, ...data.byService.map((s) => s.amount));
  const maxRegion = Math.max(1, ...data.byRegion.map((s) => s.amount));

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="label">Month-to-date total</div>
          <div className="value">{money(data.total)}</div>
        </div>
        <div className="card">
          <div className="label">Services with cost</div>
          <div className="value">{data.byService.length}</div>
        </div>
        <div className="card">
          <div className="label">Regions with cost</div>
          <div className="value">{data.byRegion.length}</div>
        </div>
        <div className="card">
          <div className="label">Period</div>
          <div className="value" style={{ fontSize: 15 }}>{data.range.Start} → {data.range.End}</div>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Cost by Service (month-to-date)</h2>
          <button className="refresh" onClick={reload}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr><th>Service</th><th style={{ width: "30%" }}>Share</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {data.byService.map((s) => (
              <tr key={s.key}>
                <td>{s.key}</td>
                <td><Bar value={s.amount} max={maxService} /></td>
                <td className="num">{money(s.amount, s.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.byService.length === 0 && <Empty text="No service cost this month yet." />}
      </div>

      <div className="panel">
        <h2>Cost by Region (month-to-date)</h2>
        <table>
          <thead>
            <tr><th>Region</th><th style={{ width: "30%" }}>Share</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {data.byRegion.map((r) => (
              <tr key={r.key}>
                <td className="mono">{r.key}</td>
                <td><Bar value={r.amount} max={maxRegion} /></td>
                <td className="num">{money(r.amount, r.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
