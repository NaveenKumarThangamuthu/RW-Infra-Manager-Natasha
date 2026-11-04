"use client";
import { useMemo, useState } from "react";
import { useJson } from "../useJson";
import { useMonthParam, withMonth } from "../useMonth";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";
import FilterBar from "../FilterBar";

interface CostItem { key: string; amount: number; unit: string }
interface BillResp {
  range: { Start: string; End: string };
  total: number;
  recordTotal: number;
  services: CostItem[];
  byRecordType: CostItem[];
}

export default function BillTab() {
  const month = useMonthParam();
  const { data, error, loading, reload } = useJson<BillResp>(withMonth("/api/cost/bill", month));
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");

  const services = useMemo(() => data?.services ?? [], [data]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return services.filter((s) => {
      if (kind === "Charges only" && s.amount < 0) return false;
      if (kind === "Credits only" && s.amount >= 0) return false;
      if (needle && !s.key.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [services, kind, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxSvc = Math.max(1, ...filtered.map((s) => Math.abs(s.amount)));
  const shownTotal = filtered.reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <div className="cards">
        <div className="card kpi kpi-accent">
          <div className="label">Total bill (month-to-date)</div>
          <div className="value">{money(data.total)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Service line items</div>
          <div className="value">{data.services.length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Period</div>
          <div className="value" style={{ fontSize: 15 }}>{data.range.Start} → {data.range.End}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>By record type (reconciles to total)</h2>
          <button className="refresh" onClick={reload}>Refresh</button>
        </div>
        <table>
          <thead><tr><th>Record type</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {data.byRecordType.map((r) => (
              <tr key={r.key}><td>{r.key}</td><td className="num">{money(r.amount, r.unit)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><strong>Net total</strong></td><td className="num"><strong>{money(data.recordTotal)}</strong></td></tr>
          </tfoot>
        </table>
      </div>

      <FilterBar
        selects={[
          { key: "kind", label: "Type", value: kind, options: ["Charges only", "Credits only"], onChange: setKind },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Service name…" }}
        shown={filtered.length}
        total={services.length}
        onReset={() => { setKind(""); setQ(""); }}
      />

      <div className="panel">
        <h2>Services ({filtered.length}) — {money(shownTotal)} shown</h2>
        <table>
          <thead>
            <tr><th>Service</th><th style={{ width: "30%" }}>Share</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.key}>
                <td>{s.key}</td>
                <td><Bar value={Math.abs(s.amount)} max={maxSvc} /></td>
                <td className="num">{money(s.amount, s.unit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td><strong>Total (shown)</strong></td><td /><td className="num"><strong>{money(shownTotal)}</strong></td></tr>
          </tfoot>
        </table>
        {filtered.length === 0 && <Empty text="No services match the current filters." />}
        <div className="note">
          Negative amounts are credits/refunds. With no filters this matches the AWS Billing console
          “Bills” page for the same period.
        </div>
      </div>
    </>
  );
}
