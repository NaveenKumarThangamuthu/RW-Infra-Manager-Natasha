"use client";
import { useEffect, useMemo, useState } from "react";
import { KeyRound, RefreshCw, Plus, Save, X, Trash2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

interface SecretRow { key: string; updatedAt: string; updatedBy: string; description: string | null; managed: boolean }
interface Resp {
  ok: boolean;
  secrets: SecretRow[];
  knownManagedKeys: string[];
  bootstrapKeys: string[];
}

function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
}
function rel(iso: string) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

export default function SecretsPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/settings/secrets", { cache: "no-store" });
      const j: Resp = await r.json();
      setData(j);
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const missingManaged = useMemo(() => {
    if (!data) return [] as string[];
    const have = new Set(data.secrets.map((s) => s.key));
    return data.knownManagedKeys.filter((k) => !have.has(k));
  }, [data]);

  async function save(key: string, value: string, description?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, description }),
      });
      const j = await r.json();
      if (r.ok) {
        setMsg({ type: "ok", text: `${key} rotated · in-process env updated` });
        setRotating(null);
        setAdding(false);
        load();
      } else {
        setMsg({ type: "err", text: j.error || "rotate failed" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(key: string) {
    if (!confirm(`Delete secret ${key}? Any subsystem depending on it will fail until you add it back.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/settings/secrets?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const j = await r.json();
      if (r.ok) { setMsg({ type: "ok", text: `${key} deleted` }); load(); }
      else setMsg({ type: "err", text: j.error || "delete failed" });
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/secrets/reload", { method: "POST" });
      const j = await r.json();
      if (r.ok) setMsg({ type: "ok", text: `Reloaded ${j.loaded} secrets into process.env` });
      else setMsg({ type: "err", text: j.error || "reload failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel settings-panel">
      <div className="settings-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span><ShieldCheck size={14} /> Secrets</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button className="input" style={{ padding: "4px 10px", fontSize: 12 }} onClick={reload} disabled={busy} title="Reload all secrets into process.env">
            <RefreshCw size={11} style={{ marginRight: 4, animation: busy ? "spin 1s linear infinite" : "none" }} />
            Reload env
          </button>
          <button className="input" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setAdding(true)} disabled={busy}>
            <Plus size={11} style={{ marginRight: 4 }} />
            Add secret
          </button>
        </span>
      </div>

      <div className="settings-note">
        Encrypted at rest with AES-256-GCM using <span className="mono">INFRA_KMS_KEY</span>. Bootstrap credentials
        (<span className="mono">MYSQL_*</span>, <span className="mono">NEXTAUTH_SECRET</span>, <span className="mono">INFRA_KMS_KEY</span>) stay in <span className="mono">.env</span> — everything else lives in <span className="mono">secret_store</span> and can be rotated from here.
      </div>

      {msg && (
        <div style={{
          marginTop: 10, padding: "6px 12px", borderRadius: 8,
          background: msg.type === "ok" ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
          color: msg.type === "ok" ? "#34d399" : "#f87171",
          border: `1px solid ${msg.type === "ok" ? "#065f46" : "#7f1d1d"}`,
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5,
        }}>
          {msg.type === "ok" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {msg.text}
        </div>
      )}

      {missingManaged.length > 0 && (
        <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid #92400e", fontSize: 12.5, color: "#fcd34d" }}>
          <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />
          {missingManaged.length} managed key(s) not yet in the store: <span className="mono">{missingManaged.join(", ")}</span>
        </div>
      )}

      <table style={{ marginTop: 14, width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Key</th>
            <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Last rotated</th>
            <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>By</th>
            <th style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}></th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={4} style={{ padding: 14, color: "var(--muted)" }}>Loading…</td></tr>}
          {!loading && data?.secrets.length === 0 && <tr><td colSpan={4} style={{ padding: 14, color: "var(--muted)" }}>No secrets in store yet.</td></tr>}
          {data?.secrets.map((s) => (
            <tr key={s.key}>
              <td className="mono" style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                {s.key}
                {!s.managed && <span title="Custom key — not in the built-in managed set" style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(148,163,184,0.15)", color: "var(--muted)" }}>custom</span>}
              </td>
              <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }} title={fmtIST(s.updatedAt)}>{rel(s.updatedAt)}</td>
              <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 12 }}>{s.updatedBy}</td>
              <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                <button className="input" style={{ padding: "3px 10px", fontSize: 11, marginRight: 4 }} onClick={() => setRotating(s.key)} disabled={busy}>Rotate</button>
                {!s.managed && (
                  <button className="input" style={{ padding: "3px 8px", fontSize: 11, color: "#fca5a5" }} onClick={() => remove(s.key)} disabled={busy}>
                    <Trash2 size={10} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rotating && (
        <RotateModal
          initialKey={rotating}
          allowKeyEdit={false}
          busy={busy}
          onCancel={() => setRotating(null)}
          onSubmit={(k, v, d) => save(k, v, d)}
        />
      )}
      {adding && (
        <RotateModal
          initialKey=""
          allowKeyEdit={true}
          busy={busy}
          knownKeys={data?.knownManagedKeys ?? []}
          onCancel={() => setAdding(false)}
          onSubmit={(k, v, d) => save(k, v, d)}
        />
      )}
      <style jsx>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}

function RotateModal({
  initialKey, allowKeyEdit, knownKeys, busy, onSubmit, onCancel,
}: {
  initialKey: string;
  allowKeyEdit: boolean;
  knownKeys?: string[];
  busy: boolean;
  onSubmit: (key: string, value: string, description?: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initialKey);
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [reveal, setReveal] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, minWidth: 420, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
            <KeyRound size={14} />
            {allowKeyEdit ? "Add secret" : `Rotate ${initialKey}`}
          </div>
          <button onClick={onCancel} className="input" style={{ padding: "4px 8px", background: "transparent" }} title="Cancel"><X size={14} /></button>
        </div>

        {allowKeyEdit ? (
          <>
            <label className="settings-label" style={{ display: "block", marginBottom: 4 }}>Key</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="e.g. SONAR_TOKEN"
              className="input"
              style={{ width: "100%", marginBottom: 12, fontFamily: "ui-monospace, monospace" }}
              list="known-secret-keys"
            />
            {knownKeys && knownKeys.length > 0 && (
              <datalist id="known-secret-keys">
                {knownKeys.map((k) => <option key={k} value={k} />)}
              </datalist>
            )}
          </>
        ) : (
          <div style={{ marginBottom: 12, fontSize: 12.5, color: "var(--muted)" }}>Key: <span className="mono">{initialKey}</span></div>
        )}

        <label className="settings-label" style={{ display: "block", marginBottom: 4 }}>Value</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="New secret value"
            className="input"
            style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
            autoFocus
          />
          <button className="input" onClick={() => setReveal(!reveal)} style={{ padding: "0 10px", fontSize: 11 }} type="button">{reveal ? "Hide" : "Show"}</button>
        </div>
        <div style={{ marginBottom: 14, fontSize: 11, color: "var(--muted)" }}>
          Value is encrypted with AES-256-GCM before writing. Never logged.
        </div>

        <label className="settings-label" style={{ display: "block", marginBottom: 4 }}>Description <span style={{ color: "var(--muted)" }}>(optional)</span></label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Sonar API token · rotated after leak"
          className="input"
          style={{ width: "100%", marginBottom: 16, fontSize: 13 }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} className="input" style={{ background: "transparent" }}>Cancel</button>
          <button
            onClick={() => onSubmit(key, value, description || undefined)}
            className="input"
            disabled={busy || !key || !value}
            style={{ background: "var(--accent)", color: "white", border: "none" }}
          >
            <Save size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
