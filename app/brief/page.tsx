"use client";
import { useJson } from "@/components/useJson";
import { Sparkles, Newspaper } from "lucide-react";
import AIBrief from "@/components/AIBrief";

interface BriefResp {
  ok: boolean;
  brief?: {
    headline?: string;
    paragraphs?: string[];
    chips?: Array<{ label: string; value: string; tone?: string }>;
    generatedAt?: string;
    model?: string;
    kind?: string;
  };
  history?: Array<{
    generatedAt: string;
    headline: string;
    paragraphs?: string[];
    chips?: Array<{ label: string; value: string; tone?: string }>;
  }>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

export default function BriefArchivePage() {
  const { data } = useJson<BriefResp>("/api/brief");

  const history = data?.history ?? [];
  const current = data?.brief;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Newspaper size={22} className="ico-inline" /> Daily Brief</h1>
          <p className="page-sub">Fable's exec summary of the last 24 hours. Regenerated after every twice-daily cron.</p>
        </div>
      </div>

      <AIBrief />

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Archive</h2>
          <span className="chip">{history.length} previous brief{history.length === 1 ? "" : "s"}</span>
        </div>

        {history.length === 0 && !current && (
          <div className="anomaly-banner-clean muted">
            No previous briefs yet — the archive fills up as the twice-daily cron runs. The current brief renders above.
          </div>
        )}

        {history.length === 0 && current && (
          <div className="anomaly-banner-clean muted">
            The current brief is the only one in the system. Tomorrow's cron will start populating the archive.
          </div>
        )}

        {history.length > 0 && (
          <div className="brief-archive">
            {history.map((b, i) => (
              <article key={`${b.generatedAt}-${i}`} className="brief-card">
                <header className="brief-card-head">
                  <div className="brief-card-date">{fmtDate(b.generatedAt)}</div>
                  <div className="brief-card-time muted small">{fmtTime(b.generatedAt)} IST</div>
                </header>
                <h3 className="brief-card-headline">{b.headline}</h3>
                {(b.paragraphs ?? []).map((p, j) => (
                  <p key={j} className="brief-card-p">{p}</p>
                ))}
                {(b.chips ?? []).length > 0 && (
                  <div className="brief-card-chips">
                    {(b.chips ?? []).map((c, k) => (
                      <span key={k} className={`brief-chip brief-chip-${c.tone ?? "info"}`}>
                        <span className="brief-chip-label">{c.label}</span>
                        <span className="brief-chip-value">{c.value}</span>
                      </span>
                    ))}
                  </div>
                )}
                <footer className="brief-card-foot muted small">
                  <Sparkles size={11} /> Powered by Fable · claude-fable-5
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
