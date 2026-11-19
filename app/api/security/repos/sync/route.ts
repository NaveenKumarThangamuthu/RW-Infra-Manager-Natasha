import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCurrentToken, listRepos, resolveScanBranches } from "@/lib/github";
import { archiveVanishedRepos, REPO_LIST_LIMIT } from "@/lib/repoSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creds = await getCurrentToken();
  if (!creds) return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });

  try {
    const all = await listRepos(creds.token, REPO_LIST_LIMIT);
    const branches = await resolveScanBranches(
      creds.token,
      all.map((r) => ({ owner: r.owner.login, name: r.name, default_branch: r.default_branch })),
    );

    const now = new Date();
    let inserted = 0, updated = 0;
    for (const r of all) {
      const data = {
        fullName: r.full_name,
        owner: r.owner.login,
        name: r.name,
        githubId: BigInt(r.id),
        private: r.private,
        fork: r.fork,
        archived: r.archived,
        description: r.description,
        language: r.language,
        defaultBranch: r.default_branch,
        scanBranch: branches.get(`${r.owner.login}/${r.name}`) ?? r.default_branch,
        htmlUrl: r.html_url,
        stars: r.stargazers_count,
        pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
        lastSyncedAt: now,
      };
      // `githubId` and `fullName` are both unique. A repo that was recreated or
      // transferred keeps its name but gets a new id, so an upsert keyed only on
      // githubId collides with the old row. Rebind that row rather than fail.
      const existing = await prisma.repo.findUnique({ where: { githubId: data.githubId } });
      const byName = existing ? null : await prisma.repo.findUnique({ where: { fullName: data.fullName } });
      if (existing) {
        await prisma.repo.update({ where: { githubId: data.githubId }, data });
        updated++;
      } else if (byName) {
        await prisma.repo.update({ where: { fullName: data.fullName }, data });
        updated++;
      } else {
        await prisma.repo.create({ data });
        inserted++;
      }
    }

    // Repos that GitHub no longer lists are taken out of scan scope (never deleted).
    // With more than one GitHub connection, one person's listing is not the whole
    // picture, so that case is left to the scheduled sync, which combines them all.
    const connections = await prisma.githubConnection.count({ where: { revokedAt: null } });
    const vanished = await archiveVanishedRepos(
      all.map((r) => ({ fullName: r.full_name, owner: r.owner.login })),
      { complete: connections === 1 && all.length < REPO_LIST_LIMIT },
    );

    const total = await prisma.repo.count();
    const active = await prisma.repo.count({ where: { archived: false } });

    return NextResponse.json({
      ok: true,
      syncedAt: now.toISOString(),
      fetched: all.length,
      inserted,
      updated,
      archivedMissing: vanished.archived,
      total,
      active,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
