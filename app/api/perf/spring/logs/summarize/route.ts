/**
 * AI diagnosis of recent ERROR log entries for a Spring service.
 *
 * POST body:
 *   { service: string, entries: Array<{ at: string|null, host: string|null, message: string }> }
 *
 * Response:
 *   { ok: true, summary: { headline: string, rootCause: string, suggestedFix: string, patterns: Array<{ pattern: string, count: number }> } }
 *
 * Uses Claude Fable 5 when ANTHROPIC_API_KEY is set. Falls back to a
 * deterministic pattern-frequency summary otherwise.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Entry { at: string | null; host: string | null; message: string }

/** Collapse similar messages into pattern buckets by stripping numbers, hex, and UUIDs. */
function normalize(msg: string): string {
  return msg
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?\b/g, "<ts>")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<ip>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function patternGroups(entries: Entry[]): Array<{ pattern: string; count: number; sample: string }> {
  const counts = new Map<string, { count: number; sample: string }>();
  for (const e of entries) {
    const first = (e.message ?? "").split("\n")[0] ?? "";
    const key = normalize(first) || "(empty)";
    const bucket = counts.get(key);
    if (bucket) { bucket.count++; }
    else counts.set(key, { count: 1, sample: first.slice(0, 300) });
  }
  return [...counts.entries()]
    .map(([pattern, v]) => ({ pattern, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function fallbackSummary(service: string, entries: Entry[]) {
  const groups = patternGroups(entries);
  const top = groups[0];
  const headline = top
    ? `${service}: ${top.count}× "${top.pattern.slice(0, 90)}${top.pattern.length > 90 ? "…" : ""}"`
    : `${service}: no ERROR entries in the sample.`;
  const rootCause = top
    ? `${entries.length} ERROR entries in the window; the dominant pattern (${top.count} occurrences) is: ${top.sample.slice(0, 400)}`
    : "No dominant pattern detected.";
  const suggestedFix = top
    ? "Investigate the top pattern in the service logs. Check downstream dependencies mentioned in the message and any recent deploys."
    : "Nothing to act on.";
  return {
    headline,
    rootCause,
    suggestedFix,
    patterns: groups.map((g) => ({ pattern: g.pattern, count: g.count })),
    model: null as string | null,
  };
}

async function claudeSummary(service: string, entries: Entry[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const groups = patternGroups(entries);
  const prompt = `You are diagnosing recent ERROR logs for a Spring Boot service named "${service}".\n\nPattern buckets (top ${groups.length}):\n${groups.map((g, i) => `${i + 1}. count=${g.count} pattern="${g.pattern}" sample="${g.sample.slice(0, 500)}"`).join("\n")}\n\nSample of raw ERROR messages (up to 15):\n${entries.slice(0, 15).map((e, i) => `${i + 1}. [${e.at ?? "?"}] ${e.host ? `<${e.host}> ` : ""}${e.message.slice(0, 400).replace(/\n/g, " ")}`).join("\n")}\n\nRespond ONLY with valid JSON: {"headline": "<one-line summary of the dominant problem, <=90 chars>", "rootCause": "<1-2 sentence root cause>", "suggestedFix": "<one concrete next action>"}`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-fable-5",
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const rawText: string = data.content?.[0]?.text ?? "";
    const text = rawText
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(text);
    return {
      headline: String(parsed.headline ?? "").slice(0, 140),
      rootCause: String(parsed.rootCause ?? "").slice(0, 800),
      suggestedFix: String(parsed.suggestedFix ?? "").slice(0, 500),
      patterns: groups.map((g) => ({ pattern: g.pattern, count: g.count })),
      model: "claude-fable-5" as string | null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { service?: string; entries?: Entry[] } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const service = String(body.service ?? "").trim();
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 60) : [];
  if (!service) return NextResponse.json({ error: "Missing service" }, { status: 400 });
  if (entries.length === 0) return NextResponse.json({ error: "No entries to summarize" }, { status: 400 });

  const summary = (await claudeSummary(service, entries)) ?? fallbackSummary(service, entries);
  return NextResponse.json({ ok: true, service, count: entries.length, summary });
}
