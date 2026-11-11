/**
 * Route guard. Every page and cost API requires a valid NextAuth JWT session.
 * Excluded (handled separately or public):
 *   - /login                  (the sign-in screen)
 *   - /api/auth/*             (NextAuth endpoints)
 *   - /api/refresh, /api/backfill  (machine endpoints — protected by CRON_SECRET)
 *   - /api/webhooks/*         (signed by external systems — verified per-handler)
 *   - Next.js static assets
 * Files in public/ are skipped too (any path with a dot), except the generated
 * reports listed in the matcher below, which need a session.
 */
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/((?!login|api/auth|api/refresh|api/backfill|api/webhooks|api/cron|api/gdrive/callback|api/certificates/refresh|_next/static|_next/image|favicon.ico|.*\\..*).*)",
    "/vulnerability-report(.*)",
    "/sonar-reports/:path*",
  ],
};
