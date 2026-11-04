"use client";
import { useMemo, useState } from "react";
import { useJson } from "../useJson";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";
import FilterBar, { uniq } from "../FilterBar";
import InspectButton from "../InspectButton";
import CsvButton from "../CsvButton";

interface Topic { arn: string; name: string; cost: number; unit: string }
interface Usage { resourceAndUsage: string; usageType: string; cost: number; unit: string }
interface SnsResp {
  range: { Start: string; End: string };
  total: number; topics: Topic[]; usage: Usage[];
}

function regionOf(arn: string): string {
  // arn:aws:sns:<region>:<acct>:<topic>
  const parts = arn.split(":");
  return parts.length > 3 ? parts[3] : "-";
}

export default function SnsTab() {
  const { data, error, loading, reload } = useJson<SnsResp>("/api/cost/sns");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");

  const topics = useMemo(() => data?.topics ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return topics.filter((t) => {
      if (region && regionOf(t.arn) !== region) return false;
      if (needle && !`${t.name} ${t.arn}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [topics, region, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxTopic = Math.max(1, ...filtered.map((t) => t.cost));
  const shownTotal = filtered.reduce((s, t) => s + t.cost, 0);

  return (
    <>
      <FilterBar
        selects={[
          { key: "region", label: "Region", value: region, options: uniq(topics, (t) => regionOf(t.arn)), onChange: setRegion },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Topic name or ARN…" }}
        shown={filtered.length}
        total={topics.length}
        onReset={() => { setRegion(""); setQ(""); }}
      />

      <div className="panel">
        <div className="panel-head">
          <h2>SNS cost per topic — {money(shownTotal)} shown</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <CsvButton
              rows={filtered}
              filename="sns-topics.csv"
              columns={[
                { key: "name", label: "Topic" },
                { key: "arn", label: "ARN" },
                { key: "cost", label: "Cost (14d $)" },
              ]}
            />
            <button className="refresh" onClick={reload}>Refresh</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Topic</th><th>Region</th><th>ARN</th>
              <th style={{ width: "20%" }}>Share</th>
              <th className="num">Cost</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.arn}>
                <td>{t.name}</td>
                <td className="mono">{regionOf(t.arn)}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>{t.arn}</td>
                <td><Bar value={t.cost} max={maxTopic} /></td>
                <td className="num">{money(t.cost, t.unit)}</td>
                <td className="row-actions">
                  <InspectButton
                    payload={{
                      kind: "sns",
                      id: t.name,
                      label: t.arn,
                      region: regionOf(t.arn),
                      cost14d: t.cost,
                      meta: { ARN: t.arn },
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty text="No topics match the current filters." />}
      </div>

      <div className="panel">
        <h2>Cost by usage type (delivery channels)</h2>
        <table>
          <thead><tr><th>Resource / Usage type</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {data.usage.map((u) => (
              <tr key={u.resourceAndUsage}>
                <td className="mono" style={{ fontSize: 11.5 }}>{u.resourceAndUsage}</td>
                <td className="num">{money(u.cost, u.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note">
          Window: <span className="mono">{data.range.Start} → {data.range.End}</span> (last 14 days).
          Usage types distinguish delivery channels (SMS, HTTP/S, email, mobile push, API requests).
        </div>
      </div>
    </>
  );
}
