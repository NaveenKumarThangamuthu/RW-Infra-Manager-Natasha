/**
 * Server-side GitHub API client.
 *
 * Tokens are read from the encrypted MySQL vault (lib/githubVault.ts) keyed by
 * the signed-in dashboard user's email. Tokens never appear in URLs, logs, or
 * client-side state.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { readToken, revokeConnection } from "./githubVault";

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
  email: string | null;
  bio: string | null;
  public_repos: number;
  total_private_repos?: number;
  html_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  language: string | null;
  pushed_at: string;
  default_branch: string;
  html_url: string;
  visibility: string;
  open_issues_count: number;
  stargazers_count: number;
}

const FETCH_TIMEOUT_MS = 10_000;
const API_BASE = "https://api.github.com";

function buildHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "natasha-dashboard/1.0",
  };
}

/** Resolve the current user's stored GitHub token from the vault. */
export async function getCurrentToken(): Promise<{ token: string; login: string | null } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  const stored = await readToken(email);
  if (!stored) return null;
  return { token: stored.token, login: stored.login };
}

/** Revoke the current user's connection at GitHub + hard-delete the local row. */
export async function revokeCurrentConnection(): Promise<{
  revokedAtGithub: boolean;
  githubError?: string;
}> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { revokedAtGithub: false };
  return revokeConnection(email);
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Token rejected by GitHub (revoked or expired).");
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    throw new Error(remaining === "0" ? "GitHub rate limit exhausted." : "Forbidden by GitHub.");
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

export async function getMe(token: string): Promise<GitHubUser> {
  return fetchJson<GitHubUser>(`${API_BASE}/user`, token);
}

const SCAN_BRANCH_PRIORITY = ["production", "feat/env/prod"];

/**
 * Resolve the branch that scans should run against for one repo:
 *   1. "production" if the branch exists
 *   2. "feat/env/prod" if it exists
 *   3. fall back to the repo's default_branch
 *
 * Uses HEAD on /repos/{owner}/{repo}/branches/{branch} which is cheap (no body).
 * Returns null if the resolution call fails — caller falls back to default_branch.
 */
export async function resolveScanBranch(
  token: string,
  owner: string,
  name: string,
  defaultBranch: string,
): Promise<string> {
  for (const branch of SCAN_BRANCH_PRIORITY) {
    try {
      const res = await fetch(
        `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branch)}`,
        {
          method: "HEAD",
          headers: buildHeaders(token),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          cache: "no-store",
        },
      );
      if (res.status === 200) return branch;
      // 404 → branch absent, try next; anything else → bail to default to avoid wasted retries
      if (res.status !== 404) break;
    } catch {
      break;
    }
  }
  return defaultBranch;
}

/** Resolve scan branches for many repos in parallel, with bounded concurrency. */
export async function resolveScanBranches(
  token: string,
  repos: Array<{ owner: string; name: string; default_branch: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CONCURRENCY = 16;
  let i = 0;
  async function worker() {
    while (i < repos.length) {
      const idx = i++;
      const r = repos[idx];
      const key = `${r.owner}/${r.name}`;
      const branch = await resolveScanBranch(token, r.owner, r.name, r.default_branch).catch(() => r.default_branch);
      out.set(key, branch);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

export async function listRepos(token: string, limit = 200): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = [];
  let url = `${API_BASE}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`;
  while (url && out.length < limit) {
    const res = await fetch(url, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 401) throw new Error("Token rejected by GitHub.");
    if (res.status === 403) throw new Error("Forbidden by GitHub.");
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const page: GitHubRepo[] = await res.json();
    out.push(...page);
    const link = res.headers.get("link") ?? "";
    const next = link.split(",").map((s) => s.trim()).find((p) => p.endsWith('rel="next"'));
    url = next ? next.replace(/^<|>; rel="next"$/g, "") : "";
  }
  return out.slice(0, limit);
}
