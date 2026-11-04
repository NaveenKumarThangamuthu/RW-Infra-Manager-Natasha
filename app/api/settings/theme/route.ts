import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID = new Set(["dark", "light", "system"]);

async function currentUserEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email?.trim().toLowerCase() ?? null;
}

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.allowedUser.findFirst({ where: { email }, select: { theme: true } });
  return NextResponse.json({ ok: true, theme: user?.theme ?? null });
}

export async function POST(req: NextRequest) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { theme?: string };
  const theme = (body.theme ?? "").trim().toLowerCase();
  if (!VALID.has(theme)) {
    return NextResponse.json({ error: "theme must be dark|light|system" }, { status: 400 });
  }
  await prisma.allowedUser.updateMany({ where: { email }, data: { theme } });
  return NextResponse.json({ ok: true, theme });
}
