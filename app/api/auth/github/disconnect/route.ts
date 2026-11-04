import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revokeCurrentConnection } from "@/lib/github";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let outcome: { revokedAtGithub: boolean; githubError?: string } = { revokedAtGithub: false };
  try {
    outcome = await revokeCurrentConnection();
  } catch {
    /* non-fatal — still clear cookies and redirect */
  }

  const envOrigin = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const origin = envOrigin || (host ? `${proto}://${host}` : new URL(req.url).origin);
  const status = outcome.revokedAtGithub ? "disconnected" : "disconnected_local_only";
  const res = NextResponse.redirect(new URL(`/security/connect?status=${status}`, origin), { status: 303 });
  res.cookies.set("gh_connected", "", { path: "/", maxAge: 0 });
  res.cookies.set("gh_login", "", { path: "/", maxAge: 0 });
  return res;
}
