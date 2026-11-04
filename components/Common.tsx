"use client";
import { pct } from "./format";

export function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="bar-wrap" title={`${pct(value, max).toFixed(1)}%`}>
      <div className="bar-fill" style={{ width: `${pct(value, max)}%` }} />
    </div>
  );
}

interface LoadingProps {
  /** "rows" = stacked shimmer bars (default); "card" = 4-card grid; "chart" = donut placeholder; "table" = table-like placeholder */
  variant?: "rows" | "card" | "chart" | "table";
  rows?: number;
}

export function Loading({ variant = "rows", rows = 5 }: LoadingProps = {}) {
  if (variant === "card") {
    return (
      <div className="skel-grid">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-card" />)}
      </div>
    );
  }
  if (variant === "chart") {
    return <div className="skel skel-donut" />;
  }
  if (variant === "table") {
    return (
      <div className="skel-table">
        <div className="skel skel-row" style={{ height: 20, marginBottom: 14 }} />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skel skel-row" />
        ))}
      </div>
    );
  }
  return (
    <div className="skel-rows" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel skel-row" />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const isSessionExpired = /session expired/i.test(message);
  const isAwsCost = /cost explorer|ce:get|ec2:describe|resource-level|aws_profile|cost\sapi|allocation/i.test(message);
  return (
    <div className="error">
      <strong>Error:</strong> {message}
      {isSessionExpired ? (
        <div className="note" style={{ color: "#fecaca" }}>
          Your sign-in cookie is no longer valid. <a href="/login" style={{ color: "#fca5a5", textDecoration: "underline" }}>Sign in again</a> and reload this page.
        </div>
      ) : isAwsCost ? (
        <div className="note" style={{ color: "#fecaca" }}>
          Common causes: Cost Explorer not enabled, resource-level data not turned on, or the
          credential/profile lacks <span className="mono">ce:Get*</span> /{" "}
          <span className="mono">ec2:Describe*</span> permissions.
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
