"use client";
import Link from "next/link";
import { useJson } from "./useJson";

const TABS: Array<{ key: string; label: string; color: string }> = [
  { key: "2.0", label: "2.0", color: "#38bdf8" },
  { key: "3.0", label: "3.0", color: "#a78bfa" },
  { key: "Infra", label: "Infra", color: "#f59e0b" },
  { key: "Dev", label: "Dev", color: "#f472b6" },
  { key: "Shared", label: "Shared", color: "#34d399" },
  { key: "Not using", label: "Not using", color: "#64748b" },
  { key: "Other", label: "Other", color: "#94a3b8" },
];

interface AllocResp {
  categoryCounts?: Record<string, number>;
}

export default function CategoryTabs({ active }: { active: string }) {
  const { data } = useJson<AllocResp>("/api/cost/allocation");
  const counts = data?.categoryCounts ?? {};
  return (
    <div className="cat-tabs" role="tablist" aria-label="Categories">
      {TABS.map((t) => {
        const isActive = t.key === active;
        const n = counts[t.key];
        return (
          <Link
            key={t.key}
            href={`/tag/${encodeURIComponent(t.key)}`}
            role="tab"
            aria-selected={isActive}
            className={`cat-tab ${isActive ? "active" : ""}`}
          >
            <span className="cat-swatch-dot" style={{ background: t.color }} aria-hidden />
            {t.label}
            {typeof n === "number" ? <span className="cat-tab-count">({n})</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
