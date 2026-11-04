import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const REDIRECT_URI = "https://natasha.rwdomain.com/api/gdrive/callback";
const ENV_FILE = path.resolve(process.cwd(), ".env");

// Upsert one KEY=VALUE line in the project's .env file so the token
// survives reboots (was previously in /tmp which was volatile).
async function persistToEnv(key: string, value: string) {
  let content = "";
  try { content = await fs.readFile(ENV_FILE, "utf8"); } catch { /* new file */ }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(content)
    ? content.replace(re, line)
    : (content.trimEnd() + `\n${line}\n`);
  await fs.writeFile(ENV_FILE, next, { mode: 0o600 });
}

function stripQuotes(s: string | undefined) {
  if (!s) return "";
  return s.replace(/^["']|["']$/g, "").trim();
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const err = req.nextUrl.searchParams.get("error");
  if (err) {
    return new NextResponse(`<h2>OAuth error</h2><pre>${err}</pre>`, {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }
  if (!code) {
    return new NextResponse(`<h2>Missing code</h2>`, {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const clientId = stripQuotes(process.env.GOOGLE_INFRA_CLIENT_ID);
  const clientSecret = stripQuotes(
    process.env.GOOGLE_INFRA_CLIENT_SECRET_ID ||
      process.env.GOOGLE_INFRA_CLIENT_SECRET
  );
  if (!clientId || !clientSecret) {
    return new NextResponse(
      `<h2>Server missing GOOGLE_INFRA_CLIENT_ID / GOOGLE_INFRA_CLIENT_SECRET_ID</h2>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!r.ok || !j.refresh_token) {
    return new NextResponse(
      `<h2>Token exchange failed</h2><pre>${JSON.stringify(j, null, 2)}</pre>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  await persistToEnv("GDRIVE_REFRESH_TOKEN", j.refresh_token);
  return new NextResponse(
    `<h2>✅ Drive access granted.</h2>
     <p>Refresh token saved to <code>.env</code> (GDRIVE_REFRESH_TOKEN). Restart Natasha for it to load into process.env.</p>
     <p>Scopes: <code>${j.scope || ""}</code></p>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
