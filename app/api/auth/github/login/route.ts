/**
 * Start the GitHub OAuth flow.
 *
 *   GET /api/auth/github/login
 *
 * Redirects the user to GitHub's authorization endpoint with a CSRF-protected
 * state value. Requires GITHUB_CLIENT_ID env var. The callback at
 * /api/auth/github/callback finishes the exchange.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const SCOPES = ["repo", "read:user", "read:org"];

/** Resolve the public-facing origin: prefer NEXTAUTH_URL, fall back to forwarded headers. */
function publicOrigin(req: Request): string {
  const env = process.env.NEXTAUTH_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    // Relative path → browser resolves against the public host it's actually using
    return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent("/security/connect")}`, publicOrigin(req)));
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET." },
      { status: 503 },
    );
  }

  const origin = publicOrigin(req);
  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${origin}/api/auth/github/callback`;

  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("scope", SCOPES.join(" "));
  auth.searchParams.set("state", state);
  auth.searchParams.set("allow_signup", "false");

  const res = NextResponse.redirect(auth.toString());
  // 10-min state cookie, scoped to the callback path. Httponly, sameSite=lax.
  res.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: "/api/auth/github",
    maxAge: 600,
  });
  return res;
}
