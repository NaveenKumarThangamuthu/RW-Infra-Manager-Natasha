"use client";
import { useMemo, useState } from "react";
import { useJson } from "../useJson";
import { useMonthParam, withMonth } from "../useMonth";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";
import FilterBar, { uniq } from "../FilterBar";

interface Bucket { category: string; amount: number }
interface UsageRow { usageType: string; category: string; amount: number; unit: string }
interface RegionRow { region: string; public: number; private: number; other: number; total: number }
interface DTResp {
  range: { Start: string; End: string };
  total: number;
  buckets: Bucket[];
  byUsageType: UsageRow[];
  byRegion: RegionRow[];
}

export default function DataTransferTab() {
  const month = useMonthParam();
  const { data, error, loading, reload } = useJson<DTResp>(withMonth("/api/cost/datatransfer", month));
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [q, setQ] = useState("");

  const byRegion = useMemo(() => data?.byRegion ?? [], [data]);
  const byUsageType = useMemo(() => data?.byUsageType ?? [], [data]);

  const regionsFiltered = useMemo(
    () => byRegion.filter((r) => !region || r.region === region),
    [byRegion, region],
  );
  const usageFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return byUsageType.filter((u) => {
      if (bucket && u.category !== bucket) return false;
      if (needle && !u.usageType.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [byUsageType, bucket, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const pub = data.buckets.find((b) => b.category === "Public IP / Internet")?.amount ?? 0;
  const priv = data.buckets.find((b) => b.category === "Private IP / Intra-AWS")?.amount ?? 0;
  const other = data.buckets.find((b) => b.category === "Other transfer")?.amount ?? 0;
  const maxUsage = Math.max(1, ...usageFiltered.map((u) => Math.abs(u.amount)));
  const maxRegion = Math.max(1, ...regionsFiltered.map((r) => Math.abs(r.total)));

  return (
    <>
      <div className="cards">
        <div className="card kpi"><div className="label">🌐 Public IP / Internet</div><div className="value">{money(pub)}</div></div>
        <div className="card kpi"><div className="label">🔒 Private IP / Intra-AWS</div><div className="value">{money(priv)}</div></div>
        <div className="card kpi"><div className="label">Other transfer</div><div className="value">{money(other)}</div></div>
        <div className="card kpi kpi-accent"><div className="label">Total data transfer</div><div className="value">{money(data.total)}</div></div>
      </div>

      <FilterBar
        selects={[
          { key: "region", label: "Region", value: region, options: uniq(byRegion, (r) => r.region), onChange: setRegion },
          { key: "bucket", label: "Bucket", value: bucket, options: uniq(byUsageType, (u) => u.category), onChange: setBucket },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Usage type…" }}
        shown={usageFiltered.length}
        total={byUsageType.length}
        onReset={() => { setRegion(""); setBucket(""); setQ(""); }}
      />

      <div className="panel">
        <div className="panel-head">
          <h2>By region — public vs private</h2>
          <button className="refresh" onClick={reload}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Region</th><th className="num">Public IP</th><th className="num">Private IP</th>
              <th className="num">Other</th><th style={{ width: "18%" }}>Total</th><th className="num">Total $</th>
            </tr>
          </thead>
          <tbody>
            {regionsFiltered.map((r) => (
              <tr key={r.region}>
                <td className="mono">{r.region}</td>
                <td className="num">{money(r.public)}</td>
                <td className="num">{money(r.private)}</td>
                <td className="num">{money(r.other)}</td>
                <td><Bar value={Math.abs(r.total)} max={maxRegion} /></td>
                <td className="num">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {regionsFiltered.length === 0 && <Empty text="No regions match the current filters." />}
      </div>

      <div className="panel">
        <h2>By usage type (raw — nothing hidden)</h2>
        <table>
          <thead>
            <tr><th>Usage type</th><th>Bucket</th><th style={{ width: "22%" }}>Share</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {usageFiltered.map((u) => (
              <tr key={u.usageType}>
                <td className="mono" style={{ fontSize: 12 }}>{u.usageType}</td>
                <td><span className="pill">{u.category.replace(" / Internet", "").replace(" / Intra-AWS", "")}</span></td>
                <td><Bar value={Math.abs(u.amount)} max={maxUsage} /></td>
                <td className="num">{money(u.amount, u.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {usageFiltered.length === 0 && <Empty text="No usage types match the current filters." />}
        <div className="note">
          AWS bills data transfer by <strong>usage type</strong>, not per IP. Period:{" "}
          <span className="mono">{data.range.Start} → {data.range.End}</span>.
        </div>
      </div>
    </>
  );
}
