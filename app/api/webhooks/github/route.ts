import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { scanRepo } from "@/lib/scanRepo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const body = await req.text();
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? "";
  const signature = req.headers.get("x-hub-signature-256");

  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  let payload: { repository?: { full_name?: string; owner?: { login?: string }; name?: string }; ref?: string };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = payload.repository?.full_name;
  if (!fullName) return NextResponse.json({ error: "Missing repository.full_name" }, { status: 400 });

  const repo = await prisma.repo.findUnique({ where: { fullName } });
  if (!repo) return NextResponse.json({ error: "Repo not registered" }, { status: 404 });
  if (!repo.webhookSecret) return NextResponse.json({ error: "Webhook not provisioned for this repo" }, { status: 400 });

  if (!verifySignature(body, signature, repo.webhookSecret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const pushedRef = payload.ref ?? "";
  const pushedBranch = pushedRef.startsWith("refs/heads/") ? pushedRef.slice(11) : pushedRef;
  if (pushedBranch && pushedBranch !== repo.scanBranch) {
    return NextResponse.json({ ok: true, ignored: `ref ${pushedBranch} != scanBranch ${repo.scanBranch}`, delivery });
  }

  // Queue (fire-and-forget) so GitHub gets a fast 202.
  scanRepo({
    triggeredBy: "webhook",
    owner: repo.owner,
    name: repo.name,
    branch: repo.scanBranch,
    trigger: "webhook",
  }).catch((err) => {
    console.error("[webhook] scanRepo failed", fullName, err);
  });

  return NextResponse.json({ ok: true, queued: true, repo: fullName, delivery }, { status: 202 });
}
