import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCurrentToken, getMe } from "@/lib/github";
import { getRepoAllowlist, isRepoAllowed } from "@/lib/sheetAllowlist";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creds = await getCurrentToken();
  if (!creds) {
    return NextResponse.json({ ok: true, connected: false, repos: [], me: null });
  }

  // Allow ?all=1 to bypass the Google-Sheet allowlist (rare — e.g. for debug or admin views).
  const showAll = req.nextUrl.searchParams.get("all") === "1";

  const [me, all, allowlist] = await Promise.all([
    getMe(creds.token).catch(() => null),
    prisma.repo.findMany({ orderBy: { pushedAt: "desc" } }),
    showAll ? Promise.resolve(null) : getRepoAllowlist(),
  ]);

  const nonArchived = all.filter((r) => !r.archived);
  const archivedHidden = all.length - nonArchived.length;

  // Filter to allowlist unless caller asked for all.
  const repos = allowlist && allowlist.repos
    ? nonArchived.filter((r) => isRepoAllowed(allowlist.repos, r.fullName))
    : nonArchived;
  const excludedByAllowlist = nonArchived.length - repos.length;

  const lastSyncedAt = all.length
    ? all.reduce((max, r) => (r.lastSyncedAt > max ? r.lastSyncedAt : max), all[0].lastSyncedAt)
    : null;

  return NextResponse.json({
    ok: true,
    connected: true,
    fetchedAt: lastSyncedAt?.toISOString() ?? null,
    syncedAt: lastSyncedAt?.toISOString() ?? null,
    repoCount: all.length,
    archivedHidden,
    excludedByAllowlist,
    allowlist: allowlist
      ? {
          source: allowlist.source,
          count: allowlist.count,
          fetchedAt: allowlist.fetchedAt,
          cached: allowlist.cached,
          error: allowlist.error,
        }
      : null,
    me: me
      ? {
          login: me.login,
          name: me.name,
          avatar_url: me.avatar_url,
          public_repos: me.public_repos,
          total_private_repos: me.total_private_repos ?? null,
          html_url: me.html_url,
        }
      : null,
    repos: repos.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.fullName,
      owner: r.owner,
      private: r.private,
      fork: r.fork,
      archived: r.archived,
      description: r.description,
      language: r.language,
      pushed_at: r.pushedAt?.toISOString() ?? null,
      default_branch: r.defaultBranch,
      scan_branch: r.scanBranch,
      html_url: r.htmlUrl,
      stars: r.stars,
    })),
  });
}
