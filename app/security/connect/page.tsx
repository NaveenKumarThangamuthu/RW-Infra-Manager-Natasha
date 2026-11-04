"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function ConnectCard() {
  const params = useSearchParams();
  const status = params.get("status");
  const error = params.get("error");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect GitHub</h1>
          <p className="page-sub">
            Authorize Natasha against your GitHub account. We exchange the code for an
            access token, store it encrypted in the platform vault, and use it to enumerate
            repos and run security scans. No tokens are ever pasted by hand.
          </p>
        </div>
      </div>

      {status === "connected" && (
        <div className="panel" style={{ borderColor: "#34d399", background: "rgba(52,211,153,0.06)" }}>
          <strong style={{ color: "#34d399" }}>✓ Connected.</strong> Your GitHub repositories will appear under{" "}
          <a href="/security">Security → Repositories</a> shortly.
        </div>
      )}

      {status === "disconnected" && (
        <div className="panel" style={{ borderColor: "#34d399", background: "rgba(52,211,153,0.06)" }}>
          <strong style={{ color: "#34d399" }}>✓ Disconnected.</strong> The OAuth grant has been revoked at GitHub
          and the encrypted token wiped from the database. Re-connecting will prompt the GitHub consent screen again.
        </div>
      )}

      {status === "disconnected_local_only" && (
        <div className="panel" style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.06)" }}>
          <strong style={{ color: "#f59e0b" }}>⚠ Local copy wiped, GitHub grant still active.</strong>
          <p className="note" style={{ marginTop: 6 }}>
            Couldn't reach GitHub to revoke the grant — your access token is gone from this dashboard, but the
            OAuth app authorization may still appear under{" "}
            <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">
              github.com → Settings → Applications
            </a>. Revoke it there for a full clean.
          </p>
        </div>
      )}

      {error && (
        <div className="panel" style={{ borderColor: "#f87171", background: "rgba(248,113,113,0.06)" }}>
          <strong style={{ color: "#f87171" }}>Connection failed:</strong> {error}
          {error === "not_configured" && (
            <p className="note" style={{ marginTop: 8 }}>
              The dashboard operator hasn't set <span className="mono">GITHUB_CLIENT_ID</span> /{" "}
              <span className="mono">GITHUB_CLIENT_SECRET</span> yet.
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>One-click OAuth</h2>
        <p className="note" style={{ marginTop: 0 }}>
          Scopes requested: <span className="mono">repo</span>, <span className="mono">read:user</span>,{" "}
          <span className="mono">read:org</span>.
        </p>
        <a className="btn-primary" href="/api/auth/github/login" style={{ display: "inline-block", marginTop: 8, textDecoration: "none" }}>
          Connect with GitHub
        </a>
        <p className="note" style={{ marginTop: 18 }}>
          After authorizing, GitHub redirects back here. The token is forwarded to the security
          backend, encrypted with AES-GCM, and never persisted in clear text. You can revoke access
          any time at github.com → Settings → Applications.
        </p>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <ConnectCard />
    </Suspense>
  );
}
