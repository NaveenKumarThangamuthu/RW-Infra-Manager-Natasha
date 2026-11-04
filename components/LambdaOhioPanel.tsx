"use client";
import { useMemo, useState } from "react";
import { useJson } from "@/components/useJson";
import { ErrorBox, Loading, Empty } from "@/components/Common";
import RefreshButton from "@/components/RefreshButton";
import SnapshotBanner from "@/components/SnapshotBanner";

interface LambdaSummary {
  arn: string; name: string; runtime: string; memoryMb: number;
  lastModified: string | null;
  invocations24h: number;
  errors24h: number;
  errorRate: number;
}
interface Resp { ok: boolean; fetchedAt: string | null; region: string; functions: LambdaSummary[]; cached?: boolean; neverRefreshed?: boolean }

interface LogEvent { at: string | null; stream: string | null; message: string }
interface LogsResp { ok: boolean; function: string; count: number; events: LogEvent[] }
type DetailState = LogsResp | { loading: true } | { error: string };

const NUM = new Intl.NumberFormat("en-US");

function ErrorRatePill({ rate, errors }: { rate: number; errors: number }) {
  if (errors === 0) return <span className="muted">—</span>;
  const pct = rate * 100;
  const color = pct >= 10 ? "#ef4444" : pct >= 2 ? "#f97316" : pct >= 0.5 ? "#f59e0b" : "#fbbf24";
  const label = pct < 0.01 ? "<0.01%" : pct.toFixed(2) + "%";
  return <span className="sev-pill" style={{ color, borderColor: color, background: `${color}15` }}>{label}</span>;
}

export default function LambdaOhioPanel() {
  const { data, error, loading, reload } = useJson<Resp>("/api/perf/lambda");
  const [q, setQ] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const fns = data?.functions ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fns.filter((f) => {
      if (errorsOnly && f.errors24h === 0) return false;
      if (needle && !f.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [fns, q, errorsOnly]);

  const totalInv = fns.reduce((a, f) => a + f.invocations24h, 0);
  const totalErr = fns.reduce((a, f) => a + f.errors24h, 0);
  const fnsWithErr = fns.filter((f) => f.errors24h > 0).length;

  async function toggleExpand(name: string) {
    if (expanded === name) { setExpanded(null); return; }
    setExpanded(name);
    const cached = details[name];
    if (cached && !("error" in cached)) return;
    setDetails((p) => ({ ...p, [name]: { loading: true } }));
    try {
      const res = await fetch(`/api/perf/lambda/logs?function=${encodeURIComponent(name)}&hours=1&limit=50`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setDetails((p) => ({ ...p, [name]: body }));
    } catch (e) {
      setDetails((p) => ({ ...p, [name]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 28, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>🪄 AWS Lambda — Ohio (us-east-2)</h2>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            CloudWatch invocation + error counts for the last 24h. Click a function to view recent CloudWatch Logs events.
          </p>
        </div>
        <RefreshButton sources={["lambda-ohio"]} onDone={reload} label="Refresh Lambdas" />
      </div>

      <SnapshotBanner capturedAt={data?.fetchedAt ?? null} label="Lambda snapshot" />

      <div className="card-row" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-label">Functions</div><div className="card-value">{fns.length}</div></div>
        <div className="card"><div className="card-label">Invocations (24h)</div><div className="card-value">{NUM.format(totalInv)}</div></div>
        <div className="card"><div className="card-label">Errors (24h)</div><div className="card-value" style={{ color: totalErr ? "#ef4444" : "#34d399" }}>{NUM.format(totalErr)}</div></div>
        <div className="card"><div className="card-label">Functions with errors</div><div className="card-value" style={{ color: fnsWithErr ? "#ef4444" : "#34d399" }}>{fnsWithErr}</div></div>
      </div>

      <div className="panel">
        <div className="filterbar">
          <input className="input" placeholder="Search function name" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            With errors only
          </label>
        </div>

        {error ? <ErrorBox message={error} />
          : loading && !data ? <Loading />
            : fns.length === 0 ? <Empty text={data?.neverRefreshed ? "No snapshot yet — hit Refresh Lambdas." : "No Lambda functions in us-east-2."} />
              : filtered.length === 0 ? <Empty text="No functions match." />
                : (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: 18 }}></th>
                          <th>Function</th>
                          <th>Runtime</th>
                          <th>Memory</th>
                          <th>Invocations (24h)</th>
                          <th>Errors (24h)</th>
                          <th>Error rate</th>
                          <th>Last modified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((f) => {
                          const isOpen = expanded === f.name;
                          return (
                            <>
                              <tr
                                key={f.arn}
                                className="incident-row"
                                style={{ cursor: "pointer" }}
                                onClick={() => toggleExpand(f.name)}
                                title="Click to view recent CloudWatch Logs"
                              >
                                <td style={{ color: "#94a3b8", transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "rotate(0)" }}>▶</td>
                                <td><strong>{f.name}</strong></td>
                                <td className="mono" style={{ fontSize: 12 }}>{f.runtime}</td>
                                <td>{f.memoryMb} MB</td>
                                <td>{NUM.format(f.invocations24h)}</td>
                                <td style={{ color: f.errors24h ? "#ef4444" : "#94a3b8", fontWeight: f.errors24h ? 600 : 400 }}>
                                  {NUM.format(f.errors24h)}
                                </td>
                                <td><ErrorRatePill rate={f.errorRate} errors={f.errors24h} /></td>
                                <td className="muted" style={{ fontSize: 12 }}>{f.lastModified ? new Date(f.lastModified).toLocaleString() : "—"}</td>
                              </tr>
                              {isOpen && (
                                <tr key={`${f.arn}-detail`}>
                                  <td colSpan={8} style={{ background: "#0a1020", borderTop: "1px solid #1a2342", padding: 14 }}>
                                    {(() => {
                                      const d = details[f.name];
                                      if (!d) return <span className="muted">Loading…</span>;
                                      if ("loading" in d) return <span className="muted">Loading CloudWatch Logs events…</span>;
                                      if ("error" in d) return <ErrorBox message={d.error} />;
                                      if (d.events.length === 0) {
                                        return <span className="muted">No log events in the last hour for /aws/lambda/{f.name}.</span>;
                                      }
                                      return (
                                        <div>
                                          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
                                            Showing {d.events.length} events from /aws/lambda/{f.name} · last 1h
                                          </div>
                                          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 480, overflowY: "auto", paddingRight: 6 }}>
                                            {d.events.map((e, i) => {
                                              const isErr = /ERROR|Task timed out|exception/i.test(e.message);
                                              const border = isErr ? "#ef4444" : "#475569";
                                              const color = isErr ? "#fca5a5" : "#cbd5e1";
                                              return (
                                                <div key={i} style={{ background: "#0d1326", border: "1px solid #1a2342", borderLeft: `3px solid ${border}`, borderRadius: 6, padding: "8px 12px", fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.5 }}>
                                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "#94a3b8", fontSize: 11, marginBottom: 3 }}>
                                                    <span>{e.at ? new Date(e.at).toLocaleString() : "—"}</span>
                                                    <span className="mono">{e.stream ?? "—"}</span>
                                                  </div>
                                                  <div style={{ color, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} title={e.message}>
                                                    {e.message.split("\n")[0].slice(0, 320)}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
      </div>
    </>
  );
}
