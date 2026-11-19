/**
 * The repositories whose findings and scans count on Home and Alerts: non-archived
 * rows limited to the running-services list, exactly as the Repositories page does.
 * When the list cannot be read the scope is every non-archived repository.
 */
import { prisma } from "./db";
import { getRepoAllowlist, isRepoAllowed } from "./sheetAllowlist";

export interface RepoScope {
  names: string[];
  /** True when the running-services list was applied. */
  limited: boolean;
}

export async function inScopeRepos(): Promise<RepoScope> {
  const [rows, allowlist] = await Promise.all([
    prisma.repo.findMany({ where: { archived: false }, select: { fullName: true } }),
    getRepoAllowlist(),
  ]);
  const names = rows.map((r) => r.fullName).filter((n) => isRepoAllowed(allowlist.repos, n));
  return { names, limited: allowlist.repos !== null };
}
