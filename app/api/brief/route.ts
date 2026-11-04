/**
 * AI-generated daily brief — narrates the latest state of the dashboard as a
 * 2-3 sentence executive summary. Stored in `data_snapshot[source="ai-brief"]`
 * by the nightly cron, read by the home dashboard tile.
 *
 * GET  /api/brief                   — return the latest saved brief
 * POST /api/brief?label=<run>       — Bearer CRON_SECRET; computes a fresh
 *                                     brief from current API state and saves it.
 *
 * If ANTHROPIC_API_KEY is set, the writer is Claude (claude-fable-5).
 * Otherwise the route falls back to a deterministic template summary so the
 * tile never goes empty — same shape, just less elegant prose.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLatest, saveSnapshot } from "@/lib/dataSnapshot";
import { money } from "@/components/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Brief {
  generatedAt: string;
  headline: string;
  paragraphs: string[];
  highlights: Array<{ kind: "anomaly" | "savings" | "incident" | "ok"; label: string; value?: string }>;
  model: string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const snap = await readLatest<Brief>("ai-brief");
  if (!snap) return NextResponse.json({ ok: true, brief: null });
  return NextResponse.json({ ok: true, brief: snap.payload, capturedAt: snap.meta.capturedAt });
}

async function buildBriefContext() {
  // Recompute the inputs locally instead of HTTP-roundtripping into other routes.
  const [anomalyCount, lastCron, recsSnap, repoFindings] = await Promise.all([
    prisma.resourceDailyCost.count({ where: { date: { gte: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) } } }),
    prisma.refreshRun.findFirst({ where: { kind: "cron", status: "success" }, orderBy: { startedAt: "desc" } }),
    readLatest<{ instances: Array<{ recommendations?: Array<{ monthlyDeltaUsd?: number }> }> }>("recommendations"),
    prisma.finding.groupBy({ by: ["severity"], where: { suppressedAt: null }, _count: { _all: true } }),
  ]);

  let savings = 0;
  for (const inst of recsSnap?.payload?.instances ?? []) {
    for (const r of inst.recommendations ?? []) {
      if (typeof r.monthlyDeltaUsd === "number" && r.monthlyDeltaUsd < 0) savings += -r.monthlyDeltaUsd;
    }
  }

  const findings: Record<string, number> = {};
  for (const f of repoFindings) findings[f.severity] = f._count._all;

  return { anomalyCount, savings, findings, lastCron: lastCron?.startedAt ?? null };
}

function fallbackBrief(ctx: Awaited<ReturnType<typeof buildBriefContext>>): Brief {
  const headline =
    ctx.findings.CRIT && ctx.findings.CRIT > 0
      ? `${ctx.findings.CRIT} critical security findings open`
      : ctx.savings > 0
      ? `~${money(ctx.savings)} / month in right-sizing wins available`
      : "All systems nominal";
  const paragraphs = [
    `Last successful cron run: ${ctx.lastCron ? new Date(ctx.lastCron).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "never"}. ${ctx.anomalyCount.toLocaleString()} per-resource cost rows in the last 24h baseline.`,
    `Recommendations engine sees ${ctx.savings > 0 ? money(ctx.savings) + " / month in right-sizing savings" : "no actionable wins"}. Security: ${ctx.findings.CRIT ?? 0} CRIT · ${ctx.findings.HIGH ?? 0} HIGH · ${ctx.findings.MED ?? 0} MED · ${ctx.findings.LOW ?? 0} LOW · ${ctx.findings.INFO ?? 0} INFO open across all repos.`,
  ];
  return {
    generatedAt: new Date().toISOString(),
    headline,
    paragraphs,
    model: null,
    highlights: [
      { kind: "savings", label: "Right-sizing wins", value: money(ctx.savings) },
      { kind: "incident", label: "CRIT findings", value: String(ctx.findings.CRIT ?? 0) },
      { kind: "anomaly", label: "Cost rows scanned (24h)", value: ctx.anomalyCount.toLocaleString() },
    ],
  };
}

async function claudeBrief(ctx: Awaited<ReturnType<typeof buildBriefContext>>): Promise<Brief | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const prompt = `You are the morning brief writer for an internal AWS ops dashboard called Natasha.\n\nSnapshot:\n- Cost rows scanned in last 24h: ${ctx.anomalyCount}\n- Right-sizing savings opportunity: $${ctx.savings.toFixed(2)}/mo\n- Security findings open: ${JSON.stringify(ctx.findings)}\n- Last cron success: ${ctx.lastCron ?? "unknown"}\n\nWrite a 2-paragraph executive brief (110 words MAX), plain prose, no headings. Lead with the most important thing. End with one concrete recommendation. Reply ONLY with valid JSON: {"headline": "<one-line headline, <=70 chars>", "paragraphs": ["<para1>", "<para2>"]}`;
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
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const rawText: string = data.content?.[0]?.text ?? "";
    // Claude sometimes wraps the JSON in ```json … ``` fences; strip them.
    const text = rawText
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(text);
    return {
      generatedAt: new Date().toISOString(),
      headline: String(parsed.headline ?? "").slice(0, 140),
      paragraphs: Array.isArray(parsed.paragraphs) ? parsed.paragraphs.map(String) : [],
      model: "claude-fable-5",
      highlights: fallbackBrief(ctx).highlights,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Bearer CRON_SECRET — same pattern as /api/cron/refresh-all
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await buildBriefContext();
  const brief = (await claudeBrief(ctx)) ?? fallbackBrief(ctx);
  await saveSnapshot("ai-brief", brief, { via: "cron", fetchMs: 0, refreshedBy: "cron@brief" });
  return NextResponse.json({ ok: true, brief });
}
