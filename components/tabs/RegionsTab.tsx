"use client";
import { useMemo, useState } from "react";
import { useJson } from "../useJson";
import { useMonthParam, withMonth } from "../useMonth";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";
import FilterBar, { uniq } from "../FilterBar";

interface RegionEntry {
  region: string;
  total: number;
  services: { service: string; cost: number }[];
}
interface RegionsResp { range: { Start: string; End: string }; total: number; regions: RegionEntry[] }

export default function RegionsTab() {
  const month = useMonthParam();
  const { data, error, loading, reload } = useJson<RegionsResp>(withMonth("/api/cost/regions", month));
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");

  const regions = useMemo(() => data?.regions ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return regions
      .filter((r) => !region || r.region === region)
      .map((r) => ({
        ...r,
        services: needle ? r.services.filter((s) => s.service.toLowerCase().includes(needle)) : r.services,
      }))
      .filter((r) => r.services.length > 0);
  }, [regions, region, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxRegion = Math.max(1, ...filtered.map((r) => r.total));

  return (
    <>
      <FilterBar
        selects={[
          { key: "region", label: "Region", value: region, options: uniq(regions, (r) => r.region), onChange: setRegion },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Service name…" }}
        shown={filtered.length}
        total={regions.length}
        onReset={() => { setRegion(""); setQ(""); }}
      />

      <div className="panel">
        <div className="panel-head">
          <h2>Region × Service breakdown (month-to-date) — {money(data.total)}</h2>
          <button className="refresh" onClick={reload}>Refresh</button>
        </div>
        {filtered.map((r) => (
          <div key={r.region} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong className="mono">{r.region}</strong>
              <span>{money(r.total)}</span>
            </div>
            <Bar value={r.total} max={maxRegion} />
            <table style={{ marginTop: 8 }}>
              <tbody>
                {r.services.map((s) => (
                  <tr key={s.service}>
                    <td>{s.service}</td>
                    <td className="num">{money(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {filtered.length === 0 && <Empty text="No regions match the current filters." />}
      </div>
    </>
  );
}
