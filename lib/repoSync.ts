/**
 * Keep the `repo` table honest when a repository disappears from GitHub.
 *
 * The sync only ever upserts what GitHub lists, so a repository that is deleted
 * or moved out of reach kept its row for good and every later scan failed on it
 * with "Repository not found" (97 such rows on 2026-11-19). After a complete
 * listing, rows that were not returned are marked `archived`, which takes them
 * out of scan scope. Nothing is deleted: findings and scan history stay, and
 * the row is un-archived by the normal upsert if GitHub lists the repo again.
 */
import { prisma } from "./db";

export interface ListedRepo {
  fullName: string;
  owner: string;
}

/** Listing size the sync asks GitHub for. A listing that reaches it may be cut short. */
export const REPO_LIST_LIMIT = 500;

/** Above this share of an owner's rows going missing at once, assume lost access and archive nothing. */
const MAX_VANISHED_SHARE = 0.3;

/**
 * Mark rows as archived when their owner was listed but the repository was not.
 *
 * Only owners that appear in the listing are touched, so an owner the token can
 * no longer see at all (zero repos returned) is left alone. The caller must pass
 * `complete: false` when the listing errored or may have been truncated; nothing
 * is changed then.
 */
export async function archiveVanishedRepos(
  listed: ListedRepo[],
  opts: { complete: boolean },
): Promise<{ archived: number; names: string[] }> {
  if (!opts.complete || listed.length === 0) return { archived: 0, names: [] };

  const byOwner = new Map<string, Set<string>>();
  for (const r of listed) {
    const set = byOwner.get(r.owner) ?? new Set<string>();
    set.add(r.fullName.toLowerCase());
    byOwner.set(r.owner, set);
  }

  const names: string[] = [];
  for (const [owner, present] of byOwner) {
    const rows = await prisma.repo.findMany({
      where: { owner, archived: false },
      select: { id: true, fullName: true },
    });
    const gone = rows.filter((row) => !present.has(row.fullName.toLowerCase()));
    if (gone.length === 0) continue;
    // A token that lost access to private repos still lists the public ones, which
    // would look like a mass disappearance. Leave such an owner for a human to check.
    if (gone.length > rows.length * MAX_VANISHED_SHARE) {
      console.warn(`[repoSync] ${owner}: ${gone.length} of ${rows.length} repos missing from the listing; not archiving`);
      continue;
    }
    await prisma.repo.updateMany({
      where: { id: { in: gone.map((row) => row.id) } },
      data: { archived: true },
    });
    names.push(...gone.map((row) => row.fullName));
  }
  return { archived: names.length, names };
}
