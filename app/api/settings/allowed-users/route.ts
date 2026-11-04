import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const users = await prisma.allowedUser.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, active: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({
    ok: true,
    users,
    currentEmail: session.user?.email ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { email?: string; name?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim() || null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const existing = await prisma.allowedUser.findUnique({ where: { email } });
  if (existing) {
    if (existing.active) return NextResponse.json({ error: "That email is already on the allowlist.", user: existing }, { status: 409 });
    // Reactivate a soft-disabled row.
    const updated = await prisma.allowedUser.update({ where: { id: existing.id }, data: { active: true, name: name ?? existing.name } });
    return NextResponse.json({ ok: true, reactivated: true, user: updated });
  }
  const user = await prisma.allowedUser.create({ data: { email, name, active: true } });
  return NextResponse.json({ ok: true, user }, { status: 201 });
}
