import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_THEME  = new Set(["dark", "light", "system"]);
const VALID_ACCENT = new Set(["indigo", "violet", "pink", "mint", "cyan", "amber"]);
const VALID_BG     = new Set(["default", "pure-black", "navy", "warm-white"]);
const VALID_DEN    = new Set(["comfortable", "compact"]);

async function currentEmail(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  return s?.user?.email?.trim().toLowerCase() ?? null;
}

export async function GET() {
  const email = await currentEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = await prisma.allowedUser.findFirst({
    where: { email },
    select: { theme: true, accent: true, bgVariant: true, density: true },
  });
  return NextResponse.json({
    ok: true,
    theme: u?.theme ?? null,
    accent: u?.accent ?? null,
    bgVariant: u?.bgVariant ?? null,
    density: u?.density ?? null,
  });
}

export async function POST(req: NextRequest) {
  const email = await currentEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    theme?: string; accent?: string; bgVariant?: string; density?: string;
  };
  const patch: Record<string, string | null> = {};
  if (body.theme !== undefined) {
    const v = String(body.theme).trim().toLowerCase();
    if (v === "" || v === "null") patch.theme = null;
    else if (VALID_THEME.has(v)) patch.theme = v;
    else return NextResponse.json({ error: "theme invalid" }, { status: 400 });
  }
  if (body.accent !== undefined) {
    const v = String(body.accent).trim().toLowerCase();
    if (v === "" || v === "null") patch.accent = null;
    else if (VALID_ACCENT.has(v)) patch.accent = v;
    else return NextResponse.json({ error: "accent invalid" }, { status: 400 });
  }
  if (body.bgVariant !== undefined) {
    const v = String(body.bgVariant).trim().toLowerCase();
    if (v === "" || v === "null") patch.bgVariant = null;
    else if (VALID_BG.has(v)) patch.bgVariant = v;
    else return NextResponse.json({ error: "bgVariant invalid" }, { status: 400 });
  }
  if (body.density !== undefined) {
    const v = String(body.density).trim().toLowerCase();
    if (v === "" || v === "null") patch.density = null;
    else if (VALID_DEN.has(v)) patch.density = v;
    else return NextResponse.json({ error: "density invalid" }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  await prisma.allowedUser.updateMany({ where: { email }, data: patch });
  return NextResponse.json({ ok: true, ...patch });
}
