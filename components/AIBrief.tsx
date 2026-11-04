"use client";
import { useJson } from "./useJson";
import { Brain, Sparkles } from "lucide-react";

interface Highlight { kind: "anomaly" | "savings" | "incident" | "ok"; label: string; value?: string }
interface Brief {
  generatedAt: string;
  headline: string;
  paragraphs: string[];
  highlights: Highlight[];
  model: string | null;
}

interface Resp { ok: boolean; brief: Brief | null; capturedAt?: string }

function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

/**
 * Light markdown for backtick spans and bold — keeps the Claude prose readable
 * without pulling a full markdown lib.
 */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    const bold = text.indexOf("**", i);
    const next = [tick, bold].filter((n) => n >= 0).sort((a, b) => a - b)[0];
    if (next == null) {
      parts.push(text.slice(i));
      break;
    }
    if (next > i) parts.push(text.slice(i, next));
    if (next === tick) {
      const end = text.indexOf("`", tick + 1);
      if (end < 0) { parts.push(text.slice(i)); break; }
      parts.push(<code key={key++} className="ai-brief-code">{text.slice(tick + 1, end)}</code>);
      i = end + 1;
    } else {
      const end = text.indexOf("**", bold + 2);
      if (end < 0) { parts.push(text.slice(i)); break; }
      parts.push(<strong key={key++}>{text.slice(bold + 2, end)}</strong>);
      i = end + 2;
    }
  }
  return parts;
}

export default function AIBrief() {
  const { data, loading } = useJson<Resp>("/api/brief");

  if (loading) return null;

  // No brief yet — show a thin placeholder rather than vanishing the section.
  if (!data || !data.brief) {
    return (
      <section className="ai-brief ai-brief-placeholder">
        <div className="ai-brief-head">
          <span className="ai-brief-ico"><Brain size={16} /></span>
          <span className="ai-brief-title">Daily brief</span>
          <span className="ai-brief-model muted small">· not generated yet</span>
        </div>
        <p className="ai-brief-p muted">
          The daily brief is computed after each cron refresh (twice daily). Set <code className="ai-brief-code">ANTHROPIC_API_KEY</code> in <code className="ai-brief-code">/tmp/srv.env</code> to upgrade from template prose to Claude Haiku 4.5.
        </p>
      </section>
    );
  }

  const b = data.brief;

  return (
    <section className="ai-brief">
      <div className="ai-brief-head">
        <span className="ai-brief-ico"><Brain size={16} /></span>
        <span className="ai-brief-title">Daily brief</span>
        <span className="ai-brief-model muted small">
          {b.model ? `· ${b.model}` : "· template"} · generated {relTime(b.generatedAt)}
        </span>
      </div>
      <h2 className="ai-brief-headline">
        <Sparkles size={15} className="ai-brief-spark" />
        {renderInline(b.headline)}
      </h2>
      {b.paragraphs.map((p, i) => (
        <p key={i} className="ai-brief-p">{renderInline(p)}</p>
      ))}
      {b.highlights.length > 0 && (
        <ul className="ai-brief-highlights">
          {b.highlights.map((h, i) => (
            <li key={i} className={`ai-brief-hl ai-brief-hl-${h.kind}`}>
              <span className="ai-brief-hl-label">{h.label}</span>
              {h.value && <span className="ai-brief-hl-val tab-num">{h.value}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
