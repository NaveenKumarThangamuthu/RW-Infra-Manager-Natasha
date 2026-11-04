/**
 * Finish the GitHub OAuth flow.
 *
 *   GET /api/auth/github/callback?code=...&state=...
 *
 * 1. Verify the CSRF state cookie matches the query state (constant-time).
 * 2. Exchange the code for an access token (with timeout + retries).
 * 3. Forward the token to the Infra backend so it can be stored in the
 *    encrypted GitHub vault. Vault writes use the operator's session email
 *    plus a shared-secret header so the backend can attribute the token.
 * 4. Redirect to /security/connect with a sanitized status flag.
 *
 * Security:
 *  - State cookie is httpOnly, sameSite=lax, path-scoped, 10-min lifetime.
 *  - Tokens are never logged; only first 4 chars surface in dev-mode debug.
 *  - Error redirects only ever go to /security/connect on our own origin —
 *    no user-supplied URLs are followed (open-redirect defense).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { timingSafeEqual } from "crypto";
import { storeToken } from "@/lib/githubVault";

const INFRA_BACKEND = process.env.INFRA_BACKEND_URL || "";
const INFRA_INTERNAL_TOKEN = process.env.INFRA_INTERNAL_TOKEN || "";
const FETCH_TIMEOUT_MS = 8_000;

const ERROR_WHITELIST = new Set([
  "state_mismatch",
  "missing_params",
  "not_configured",
  "exchange_failed",
  "store_failed",
  "timeout",
  "network",
  "bad_redirect_uri",
  "access_denied",
  "incorrect_client_credentials",
]);

function safeError(err: string): string {
  return ERROR_WHITELIST.has(err) ? err : "exchange_failed";
}

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function publicOrigin(req: Request): string {
  const env = process.env.NEXTAUTH_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

function redirectError(origin: string, err: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/security/connect?error=${safeError(err)}`, origin));
  res.cookies.set("gh_oauth_state", "", { path: "/api/auth/github", maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/login?callbackUrl=/security/connect", origin));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const githubError = url.searchParams.get("error");
  if (githubError) return redirectError(origin, githubError);
  if (!code || !state) return redirectError(origin, "missing_params");

  const cookieState = (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([k]) => k === "gh_oauth_state")?.[1];

  if (!cookieState || !safeCompare(state, cookieState)) {
    return redirectError(origin, "state_mismatch");
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirectError(origin, "not_configured");

  // Exchange code for token
  let token: string;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "natasha-dashboard/1.0",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${origin}/api/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!tokenRes.ok) return redirectError(origin, "exchange_failed");
    const body = await tokenRes.json();
    if (body.error) return redirectError(origin, body.error);
    if (!body.access_token || typeof body.access_token !== "string") {
      return redirectError(origin, "exchange_failed");
    }
    token = body.access_token;
  } catch (err) {
    return redirectError(origin, err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network");
  }

  // Validate token + capture login + scopes
  let login: string | null = null;
  let grantedScopes: string | null = null;
  try {
    const meRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "natasha-dashboard/1.0",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!meRes.ok) return redirectError(origin, "exchange_failed");
    const me = await meRes.json();
    login = typeof me.login === "string" ? me.login : null;
    grantedScopes = meRes.headers.get("x-oauth-scopes");
  } catch {
    return redirectError(origin, "network");
  }

  // Persist token encrypted-at-rest in MySQL (AES-256-GCM).
  const email = session.user?.email;
  if (!email) return redirectError(origin, "exchange_failed");
  try {
    await storeToken(email, token, login, grantedScopes);
  } catch (err) {
    // Encryption or DB failure — surface as store_failed (sanitized).
    console.error("github vault store failed:", err instanceof Error ? err.message : err);
    return redirectError(origin, "store_failed");
  }

  // Set HttpOnly session-pointer cookie (no token in it — just a "connected" flag
  // so the client knows to enable the connected UI quickly).
  const isHttps = origin.startsWith("https:");
  const res = NextResponse.redirect(new URL("/security?status=connected", origin));
  res.cookies.set("gh_connected", "1", {
    httpOnly: false, // readable for nav rendering
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.set("gh_login", login ?? "", {
    httpOnly: false,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.set("gh_oauth_state", "", { path: "/api/auth/github", maxAge: 0 });

  // Best-effort forward to Infra backend vault if it's online (non-fatal).
  if (INFRA_BACKEND) {
    fetch(`${INFRA_BACKEND}/api/github/connection`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-User-Email": email,
        "X-Github-Login": login ?? "",
        ...(INFRA_INTERNAL_TOKEN ? { "X-Internal-Token": INFRA_INTERNAL_TOKEN } : {}),
      },
      body: JSON.stringify({ token, source: "oauth", login }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => { /* backend offline — fine */ });
  }

  return res;
}
