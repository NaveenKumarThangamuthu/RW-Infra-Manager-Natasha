/**
 * Dashboard PDF export. Uses Playwright (already a devDep) to drive a
 * headless Chromium against the current `next start` server, renders the
 * dashboard with the calling user's session cookie, and pipes a PDF back.
 *
 * Usage: GET /api/export/pdf  (auth required) — downloads dashboard.pdf
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reqUrl = new URL(req.url);
  // Hit the local server (same process) — avoids the tunnel hop.
  const base = `${reqUrl.protocol}//127.0.0.1:${reqUrl.port || 3000}`;

  // Forward the NextAuth session cookie so the rendered page is authenticated.
  const cookieStore = await cookies();
  const sessionCookieName = process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  const sessionCookie = cookieStore.get(sessionCookieName);
  if (!sessionCookie) {
    return NextResponse.json({ error: "Session cookie not found." }, { status: 401 });
  }

  let browser;
  try {
    // Dynamic import keeps playwright-core out of the webpack bundle.
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1800 },
    });
    await ctx.addCookies([
      {
        name: sessionCookieName,
        value: sessionCookie.value,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        expires: -1,
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 30_000 });
    // Wait briefly for client-side fetches to populate.
    await page.waitForTimeout(1500);
    const pdf = await page.pdf({
      format: "A3",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    await browser.close();

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="natasha-dashboard-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  } catch (err) {
    if (browser) await browser.close();
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "PDF export failed" },
      { status: 500 },
    );
  }
}
