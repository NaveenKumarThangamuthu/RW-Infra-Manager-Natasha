import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { ok: true as const, email: (session.user?.email ?? "").toLowerCase() };
}

/** PATCH — toggle active flag or update name. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await requireSession();
  if (!s.ok) return s.resp;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { active?: boolean; name?: string };

  const target = await prisma.allowedUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Guard: can't deactivate yourself.
  if (body.active === false && target.email.toLowerCase() === s.email) {
    return NextResponse.json({ error: "You can't deactivate your own login." }, { status: 400 });
  }
  // Guard: can't deactivate the last active user.
  if (body.active === false && target.active) {
    const remaining = await prisma.allowedUser.count({ where: { active: true, NOT: { id } } });
    if (remaining === 0) return NextResponse.json({ error: "At least one user must stay active." }, { status: 400 });
  }

  const updated = await prisma.allowedUser.update({
    where: { id },
    data: {
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(typeof body.name === "string" ? { name: body.name.trim() || null } : {}),
    },
  });
  return NextResponse.json({ ok: true, user: updated });
}

/** DELETE — hard delete a user. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await requireSession();
  if (!s.ok) return s.resp;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const target = await prisma.allowedUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (target.email.toLowerCase() === s.email) {
    return NextResponse.json({ error: "You can't delete your own login." }, { status: 400 });
  }
  if (target.active) {
    const remaining = await prisma.allowedUser.count({ where: { active: true, NOT: { id } } });
    if (remaining === 0) return NextResponse.json({ error: "At least one active user must remain." }, { status: 400 });
  }
  await prisma.allowedUser.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
