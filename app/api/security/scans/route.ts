import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");
  const latestOnly = url.searchParams.get("latest") !== "0";

  let jobs;
  if (repo) {
    jobs = await prisma.scanJob.findMany({
      where: { repoFullName: repo },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { _count: { select: { findings: true } } },
    });
  } else if (latestOnly) {
    // Return the latest job PER repo. Previously we took the last 100 globally, which
    // silently hid repos whose most-recent scan wasn't in the freshest 100 rows.
    const distinctRepos = await prisma.scanJob.groupBy({
      by: ["repoFullName"],
      _max: { startedAt: true },
      orderBy: { _max: { startedAt: "desc" } },
      take: 2000,
    });
    const latestJobs = await Promise.all(
      distinctRepos.map((row: { repoFullName: string; _max: { startedAt: Date | null } }) =>
        row._max.startedAt
          ? prisma.scanJob.findFirst({
              where: { repoFullName: row.repoFullName, startedAt: row._max.startedAt },
              include: { _count: { select: { findings: true } } },
            })
          : Promise.resolve(null)
      )
    );
    jobs = latestJobs.filter((j): j is NonNullable<typeof j> => j != null);
  } else {
    jobs = await prisma.scanJob.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { _count: { select: { findings: true } } },
    });
  }

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    jobs: jobs.map((j) => ({
      id: j.id,
      repoFullName: j.repoFullName,
      branch: j.branch,
      status: j.status,
      triggeredBy: j.triggeredBy,
      trigger: j.trigger,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      durationMs: j.durationMs,
      commitSha: j.commitSha,
      errorMessage: j.errorMessage,
      findingsCount: j._count.findings,
    })),
  });
}
