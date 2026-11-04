/**
 * CRUD for manual server tags (2.0 / 3.0 / Infra / ...). Used by the /tags UI.
 * Protected by the auth middleware (signed-in users only).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALLOC_CATEGORIES } from "@/lib/allocationDb";

export const dynamic = "force-dynamic";

const VALID = new Set<string>(ALLOC_CATEGORIES);

export async function GET() {
  const tags = await prisma.serverTag.findMany({ orderBy: [{ category: "asc" }, { matchKey: "asc" }] });
  return NextResponse.json({ tags, categories: ALLOC_CATEGORIES });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const matchKey = String(body.matchKey ?? "").trim();
    if (!matchKey) {
      return NextResponse.json({ error: "matchKey (IP or resource id) is required" }, { status: 400 });
    }
    const category = String(body.category ?? "Other");
    if (!VALID.has(category)) {
      return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
    }
    const data = {
      label: body.label ? String(body.label) : null,
      region: body.region ? String(body.region) : null,
      instanceType: body.instanceType ? String(body.instanceType) : null,
      category,
      services: body.services ? String(body.services) : null,
    };
    const saved = await prisma.serverTag.upsert({
      where: { matchKey },
      update: data,
      create: { matchKey, ...data },
    });
    return NextResponse.json({ ok: true, tag: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Valid id required" }, { status: 400 });
  }
  await prisma.serverTag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
