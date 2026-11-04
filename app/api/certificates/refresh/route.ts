import { NextRequest, NextResponse } from "next/server";
import { scanCertificates } from "@/lib/certificates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function stripQuotes(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/^["']|["']$/g, "").trim();
}

export async function POST(req: NextRequest) {
  // Machine trigger (cron): requires CRON_SECRET bearer.
  // Browser trigger (Refresh button): allowed because Natasha's session middleware
  // guards the parent /api/certificates namespace via NextAuth JWT already.
  const auth = req.headers.get("authorization") || "";
  const cronSecret = stripQuotes(process.env.CRON_SECRET);
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const machineTrigger = cronSecret && bearer === cronSecret;

  const silent = req.nextUrl.searchParams.get("silent") === "1" || !machineTrigger;

  try {
    const summary = await scanCertificates({ silent });
    return NextResponse.json({ ok: true, summary });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
