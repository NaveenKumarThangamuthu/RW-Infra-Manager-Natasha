"use client";
import Link from "next/link";
import { useJson } from "./useJson";
import { money } from "./format";

interface AllocResp {
  categoryCounts?: Record<string, number>;
  byCategory?: Record<string, number>;
  total?: number;
}

const TILES: Array<{ key: string; label: string; color: string; blurb: string }> = [
  { key: "2.0",        label: "2.0",        color: "#38bdf8", blurb: "Legacy V2 workloads" },
  { key: "3.0",        label: "3.0",        color: "#a78bfa", blurb: "Current V3 platform" },
  { key: "Infra",      label: "Infra",      color: "#f59e0b", blurb: "Shared platform services" },
  { key: "Dev",        label: "Dev",        color: "#f472b6", blurb: "Development + staging" },
  { key: "Shared",     label: "Shared",     color: "#34d399", blurb: "Cross-team services" },
  { key: "Not using",  label: "Not using",  color: "#64748b", blurb: "Candidates to shut off" },
  { key: "Other",      label: "Other",      color: "#94a3b8", blurb: "Uncategorised" },
];

export default function CategoryTiles() {
  const { data } = useJson<AllocResp>("/api/cost/allocation");

  return (
    <div className="cat-tiles">
      {TILES.map((t) => {
        const count = data?.categoryCounts?.[t.key];
        const spend = data?.byCategory?.[t.key];
        return (
          <Link key={t.key} href={`/tag/${encodeURIComponent(t.key)}`} className="cat-tile" style={{ borderColor: `${t.color}30` }}>
            <div className="cat-tile-head">
              <span className="cat-swatch-dot" style={{ background: t.color }} aria-hidden />
              <span className="cat-tile-label">{t.label}</span>
              {typeof count === "number" && <span className="cat-tile-count">({count})</span>}
            </div>
            {typeof spend === "number" && spend > 0 && (
              <div className="cat-tile-spend" style={{ color: t.color }}>{money(spend)}</div>
            )}
            <div className="cat-tile-blurb">{t.blurb}</div>
          </Link>
        );
      })}
    </div>
  );
}
