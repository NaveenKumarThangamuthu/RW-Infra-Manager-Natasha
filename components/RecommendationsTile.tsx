"use client";
import Link from "next/link";
import { Lightbulb, PiggyBank } from "lucide-react";
import { money } from "./format";

interface RecItem { instanceId: string; name?: string; message: string; monthlyDeltaUsd: number }
interface Props {
  total: number;
  monthlySavingsUsd: number;
  top: RecItem[];
  lastSnap: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export default function RecommendationsTile({ total, monthlySavingsUsd, top, lastSnap }: Props) {
  const hasSavings = monthlySavingsUsd > 0;
  return (
    <Link href="/perf/recommendations" className={`infra-tile rec ${hasSavings ? "warn" : ""}`} aria-label="Recommendations">
      <div className="tile-head">
        <span className="tile-ico" aria-hidden><Lightbulb size={17} /></span>
        <span className="tile-title">Recommendations</span>
        <span className="tile-go" aria-hidden>↗</span>
      </div>
      <div className="tile-primary">
        <span className="big tab-num">{hasSavings ? money(monthlySavingsUsd) : total}</span>
        <span className="muted small">{hasSavings ? "potential savings /mo" : "open recommendations"}</span>
      </div>

      {top.length > 0 && (
        <ul className="rec-top">
          {top.map((r) => (
            <li key={r.instanceId} className="rec-top-row">
              <span className="rec-top-name mono">{r.name ?? r.instanceId}</span>
              <span className="rec-top-savings">
                <PiggyBank size={12} />
                {money(-r.monthlyDeltaUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {top.length === 0 && (
        <div className="rec-top-empty muted small">No actionable wins detected — all instances right-sized.</div>
      )}

      <div className="tile-foot">
        <span>Prometheus + CloudWatch</span>
        <span className="muted">Snap {relTime(lastSnap)}</span>
      </div>
    </Link>
  );
}
