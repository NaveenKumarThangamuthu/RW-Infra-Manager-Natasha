"use client";
import { useMemo, useState } from "react";
import { useJson } from "../useJson";
import { money } from "../format";
import { Bar, ErrorBox, Loading, Empty } from "../Common";
import FilterBar, { uniq } from "../FilterBar";
import InspectButton from "../InspectButton";
import CsvButton from "../CsvButton";

interface Fn {
  arn: string; name: string; region: string; runtime: string; memoryMb: number;
  invocations: number; errors: number; durationAvgMs: number; gbSeconds: number;
}
interface Prov { resourceAndUsage: string; usageType: string; category: string; cost: number; unit: string }
interface LambdaResp {
  range: { Start: string; End: string };
  total: number;
  totalInvocations: number;
  totalErrors: number;
  metricsAvailable: boolean;
  functionCount: number;
  functions: Fn[];
  provisioning: Prov[];
}

function num(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function LambdaTab() {
  const { data, error, loading, reload } = useJson<LambdaResp>("/api/cost/lambda");
  const [region, setRegion] = useState("");
  const [runtime, setRuntime] = useState("");
  const [errorsOnly, setErrorsOnly] = useState("");
  const [q, setQ] = useState("");

  const functions = useMemo(() => data?.functions ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return functions.filter((f) => {
      if (region && f.region !== region) return false;
      if (runtime && f.runtime !== runtime) return false;
      if (errorsOnly === "Errors only" && f.errors <= 0) return false;
      if (needle && !f.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [functions, region, runtime, errorsOnly, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty text="No data." />;

  const maxInv = Math.max(1, ...filtered.map((f) => f.invocations));
  const shownInv = filtered.reduce((s, f) => s + f.invocations, 0);
  const shownErr = filtered.reduce((s, f) => s + f.errors, 0);

  const byCategory = new Map<string, number>();
  for (const p of data.provisioning) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + p.cost);
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="cards">
        <div className="card kpi kpi-accent">
          <div className="label">Total cost (14d)</div>
          <div className="value">{money(data.total)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Invocations (shown)</div>
          <div className="value">{data.metricsAvailable ? num(shownInv) : "—"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Errors (shown)</div>
          <div className="value">{data.metricsAvailable ? num(shownErr) : "—"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Functions (shown)</div>
          <div className="value">{filtered.length}</div>
        </div>
      </div>

      <FilterBar
        selects={[
          { key: "region", label: "Region", value: region, options: uniq(functions, (f) => f.region), onChange: setRegion },
          { key: "runtime", label: "Runtime", value: runtime, options: uniq(functions, (f) => f.runtime), onChange: setRuntime },
          { key: "errors", label: "Errors", value: errorsOnly, options: ["Errors only"], onChange: setErrorsOnly },
        ]}
        search={{ value: q, onChange: setQ, placeholder: "Function name…" }}
        shown={filtered.length}
        total={functions.length}
        onReset={() => { setRegion(""); setRuntime(""); setErrorsOnly(""); setQ(""); }}
      />

      <div className="panel">
        <div className="panel-head">
          <h2>Lambda — invocations &amp; usage per function</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <CsvButton
              rows={filtered}
              filename="lambda-functions.csv"
              columns={[
                { key: "name", label: "Function" },
                { key: "arn", label: "ARN" },
                { key: "region", label: "Region" },
                { key: "runtime", label: "Runtime" },
                { key: "memoryMb", label: "Memory (MB)" },
                { key: "invocations", label: "Invocations (14d)" },
                { key: "errors", label: "Errors (14d)" },
                { key: "durationAvgMs", label: "Avg duration (ms)" },
                { key: "gbSeconds", label: "Usage (GB-s)" },
              ]}
            />
            <button className="refresh" onClick={reload}>Refresh</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Function</th><th>Region</th><th className="num">Memory</th>
              <th className="num">Invocations</th><th style={{ width: "16%" }}>Share</th>
              <th className="num">Avg duration</th><th className="num">Errors</th><th className="num">Usage (GB-s)</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.arn}>
                <td>
                  <div>{f.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{f.runtime}</div>
                </td>
                <td className="mono">{f.region}</td>
                <td className="num">{f.memoryMb} MB</td>
                <td className="num">{num(f.invocations)}</td>
                <td><Bar value={f.invocations} max={maxInv} /></td>
                <td className="num">{f.durationAvgMs ? `${num(f.durationAvgMs, 1)} ms` : "—"}</td>
                <td className="num" style={{ color: f.errors > 0 ? "#fca5a5" : undefined }}>{num(f.errors)}</td>
                <td className="num">{num(f.gbSeconds, 1)}</td>
                <td className="row-actions">
                  <InspectButton
                    payload={{
                      kind: "lambda",
                      id: f.name,
                      label: f.arn,
                      region: f.region,
                      meta: {
                        Runtime: f.runtime,
                        Memory: `${f.memoryMb} MB`,
                        Invocations: num(f.invocations),
                        Errors: num(f.errors),
                        "Avg duration": f.durationAvgMs ? `${num(f.durationAvgMs, 1)} ms` : "—",
                        "Usage GB-s": num(f.gbSeconds, 1),
                      },
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty text="No functions match the current filters." />}
        {!data.metricsAvailable && functions.length > 0 && (
          <div className="note">
            ⚠️ Usage metrics are zero/unavailable — invocations, errors and duration need the{" "}
            <span className="mono">cloudwatch:GetMetricData</span> permission (and activity in the window).
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Cost by usage type (requests · duration · provisioned concurrency)</h2>
        <table>
          <thead><tr><th>Category</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {categories.map(([cat, cost]) => (
              <tr key={cat}><td>{cat}</td><td className="num">{money(cost)}</td></tr>
            ))}
          </tbody>
        </table>
        {categories.length === 0 && <Empty text="No Lambda cost in the last 14 days." />}
        <div className="note">
          Window: <span className="mono">{data.range.Start} → {data.range.End}</span> (last 14 days).
          Invocations, errors and duration come from <span className="mono">CloudWatch</span>; cost from
          Cost Explorer. Usage (GB-s) = duration × memory.
        </div>
      </div>
    </>
  );
}
