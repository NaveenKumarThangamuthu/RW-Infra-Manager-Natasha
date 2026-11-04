import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listSecrets, setSecret, deleteSecret, BOOTSTRAP_KEYS, MANAGED_KEYS } from "@/lib/secrets";

export const dynamic = "force-dynamic";

async function currentUserEmail(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  return s?.user?.email?.trim().toLowerCase() ?? null;
}

export async function GET() {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listSecrets();
  return NextResponse.json({
    ok: true,
    secrets: rows,
    knownManagedKeys: Array.from(MANAGED_KEYS).sort(),
    bootstrapKeys: Array.from(BOOTSTRAP_KEYS).sort(),
  });
}

export async function POST(req: NextRequest) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    key?: string; value?: string; description?: string;
  };
  const key = String(body.key || "").trim().toUpperCase();
  const value = String(body.value || "");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (!value) return NextResponse.json({ error: "value required" }, { status: 400 });
  if (BOOTSTRAP_KEYS.has(key)) {
    return NextResponse.json({ error: `${key} is a bootstrap credential — edit .env directly + restart Natasha` }, { status: 400 });
  }
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(key)) {
    return NextResponse.json({ error: "key must be UPPER_SNAKE, ≤64 chars, letters/digits/_" }, { status: 400 });
  }
  await setSecret(key, value, email, body.description);
  return NextResponse.json({ ok: true, key, updatedBy: email, updatedAt: new Date().toISOString() });
}

export async function DELETE(req: NextRequest) {
  const email = await currentUserEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = new URL(req.url).searchParams.get("key")?.trim().toUpperCase();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  if (BOOTSTRAP_KEYS.has(key)) {
    return NextResponse.json({ error: `${key} is a bootstrap credential — cannot delete` }, { status: 400 });
  }
  await deleteSecret(key);
  return NextResponse.json({ ok: true, deleted: key });
}
