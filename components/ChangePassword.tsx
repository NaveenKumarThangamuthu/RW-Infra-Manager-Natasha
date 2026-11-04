"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: "err", text: "New password and confirmation do not match." });
      return;
    }
    if (next.length < 8) {
      setMsg({ kind: "err", text: "New password must be at least 8 characters." });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Failed");
      setMsg({ kind: "ok", text: "Password updated. You'll be signed out — sign in with the new password." });
      setCurrent("");
      setNext("");
      setConfirm("");
      setTimeout(() => signOut({ callbackUrl: "/login" }), 1800);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 460 }}>
      <h2>Reset password</h2>
      {msg && <div className={msg.kind === "ok" ? "login-ok" : "login-error"}>{msg.text}</div>}
      <form className="login-form" onSubmit={onSubmit}>
        <label>
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          <span>New password (min 8 chars)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label>
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <button className="btn-primary login-submit" type="submit" disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
