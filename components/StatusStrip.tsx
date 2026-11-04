"use client";
import { useJson } from "./useJson";
import { Activity, RefreshCw, Database } from "lucide-react";
import DensityToggle from "./DensityToggle";

interface SnapMeta { capturedAt: string | null; via: string | null; status: string | null }
interface Resp {
  ok: boolean;
  ops?: {
    cronLastAt: string | null;
    backfillLastAt: string | null;
    snapshots: Record<string, SnapMeta>;
  };
}

const SOURCE_LABEL: Record<string, string> = {
  "spring-health": "spring",
  "spring-logs": "logs",
  "ec2-health": "ec2",
  "ec2-volumes": "vol",
  "cloudwatch-alarms": "cw",
  "prom-alerts": "prom",
  "recommendations": "recs",
  "lambda-ohio": "λ",
};

function ageMin(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function ageLabel(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

function freshness(min: number | null): "ok" | "stale" | "old" {
  if (min == null) return "old";
  if (min < 12 * 60) return "ok";
  if (min < 36 * 60) return "stale";
  return "old";
}

export default function StatusStrip() {
  const { data } = useJson<Resp>("/api/dashboard/summary");
  const ops = data?.ops;
  if (!ops) return null;

  const cronMin = ageMin(ops.cronLastAt);
  const entries = Object.entries(ops.snapshots);

  return (
    <div className="status-strip" role="status" aria-label="Operational status">
      <div className="ss-group">
        <Activity size={13} className="ss-ico" />
        <span className="ss-label">Cron</span>
        <span className={`ss-val ss-${freshness(cronMin)}`}>{ageLabel(cronMin)} ago</span>
      </div>
      <div className="ss-group ss-snapshots" title="Snapshot ages (per source)">
        <Database size={13} className="ss-ico" />
        <span className="ss-label">Snapshots</span>
        {entries.map(([src, meta]) => {
          const m = ageMin(meta.capturedAt);
          return (
            <span key={src} className={`ss-snap ss-${freshness(m)}`} title={`${src} → ${meta.capturedAt ?? "never"}`}>
              <span className="ss-snap-src">{SOURCE_LABEL[src] ?? src}</span>
              <span className="ss-snap-age">{ageLabel(m)}</span>
            </span>
          );
        })}
      </div>
      {ops.backfillLastAt && (
        <div className="ss-group">
          <RefreshCw size={13} className="ss-ico" />
          <span className="ss-label">Backfill</span>
          <span className="ss-val muted">{ageLabel(ageMin(ops.backfillLastAt))} ago</span>
        </div>
      )}
      <div className="ss-spacer" />
      <DensityToggle />
    </div>
  );
}
