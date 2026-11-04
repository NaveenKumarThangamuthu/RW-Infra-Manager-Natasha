"use client";
import Link from "next/link";

type Sev = "CRIT" | "HIGH" | "WARN" | "INFO";

export interface IssueBucket {
  sev: Sev;
  incidents: number;
  recommendations: number;
  href: string | null;
}

interface Props {
  bucket: IssueBucket | null | undefined;
}

const META: Record<Sev, { glyph: string; cls: string; label: string }> = {
  CRIT: { glyph: "⛔", cls: "crit", label: "Critical" },
  HIGH: { glyph: "▲",  cls: "high", label: "High" },
  WARN: { glyph: "⚠",  cls: "warn", label: "Warning" },
  INFO: { glyph: "ⓘ",  cls: "info", label: "Info" },
};

export default function IssueIcon({ bucket }: Props) {
  if (!bucket || (bucket.incidents === 0 && bucket.recommendations === 0)) return null;
  const m = META[bucket.sev];
  const parts: string[] = [];
  if (bucket.incidents) parts.push(`${bucket.incidents} incident${bucket.incidents === 1 ? "" : "s"}`);
  if (bucket.recommendations) parts.push(`${bucket.recommendations} recommendation${bucket.recommendations === 1 ? "" : "s"}`);
  const tooltip = `${m.label}: ${parts.join(" · ")}`;
  const Inner = (
    <span className={`issue-icon ${m.cls}`} title={tooltip} aria-label={tooltip}>
      <span className="glyph">{m.glyph}</span>
      <span className="count">{bucket.incidents + bucket.recommendations}</span>
    </span>
  );
  return bucket.href ? <Link href={bucket.href} style={{ textDecoration: "none" }}>{Inner}</Link> : Inner;
}
