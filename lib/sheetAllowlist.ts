/**
 * Google Sheet-driven repo allowlist.
 *
 * Fetches the first tab (gid=0) of the "Running Services List - Production" sheet
 * via the gviz CSV endpoint (works with our drive.readonly OAuth token), extracts
 * every `github.com/OWNER/REPO(.git)` URL, and returns the unique set. If the first
 * tab has none, the "Summary" tab is tried as a fallback. Cached in
 * memory for 10 min per process to avoid hitting Google on every /security request.
 *
 * Any failure (no refresh token, Google 5xx, malformed sheet) returns null so the
 * caller can degrade to "show everything" — the allowlist is a filter, not a gate.
 */
import { promises as fs } from "fs";
import { ensureSecretsHydrated } from "./db";

const SHEET_ID = "1C-e0rNlL-PRx6gMGyu62RA-oOpOjDBJnnpzhqMQBGAg";
const TAB_NAME = "Summary";
const REFRESH_TOKEN_FILE = "/tmp/gdrive-refresh-token.txt";
const TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  repos: Set<string>;
  sourceCount: number;
  source: string;
  error: string | null;
}
let cache: CacheEntry | null = null;

function stripQuotes(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/^["']|["']$/g, "").trim();
}

async function readRefreshToken(): Promise<string | null> {
  // Prefer the env var (persistent across reboots).
  const envTok = process.env.GDRIVE_REFRESH_TOKEN?.trim();
  if (envTok) return envTok;
  // Fallback to the legacy /tmp file for one migration cycle.
  try {
    const s = (await fs.readFile(REFRESH_TOKEN_FILE, "utf8")).trim();
    return s || null;
  } catch {
    return null;
  }
}

async function mintAccessToken(refreshToken: string): Promise<string> {
  const clientId = stripQuotes(process.env.GOOGLE_INFRA_CLIENT_ID);
  const clientSecret = stripQuotes(
    process.env.GOOGLE_INFRA_CLIENT_SECRET_ID || process.env.GOOGLE_INFRA_CLIENT_SECRET
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`token refresh failed: ${j.error || r.status}`);
  return j.access_token;
}

/**
 * Pull every `github.com/OWNER/REPO` out of the CSV, wherever it sits. The sheet's
 * columns move around and some cells hold more than one line, so a column parser
 * misses rows; a whole-document scan does not. Repo names may contain dots
 * ("RW-Domain-2.0-Thym"), so only a trailing ".git" or stray full stop is dropped.
 */
export function extractRepos(csv: string): string[] {
  const out: string[] = [];
  const re = /github\.com[/:]([A-Za-z0-9_-][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.-]+)/gi;
  for (const m of csv.matchAll(re)) {
    const name = m[2].replace(/\.git$/i, "").replace(/\.+$/, "");
    if (name) out.push(`${m[1]}/${name}`.toLowerCase());
  }
  return out;
}

/** Tabs to read, in order. The first one that yields any GitHub URL wins. */
const TAB_SOURCES: Array<{ label: string; query: string }> = [
  { label: "Sheet:first tab", query: "gid=0&headers=1" },
  { label: `Sheet:${TAB_NAME}`, query: `sheet=${encodeURIComponent(TAB_NAME)}` },
];

async function fetchTabCsv(accessToken: string, query: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&${query}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`gviz http ${r.status}`);
  return r.text();
}

export interface AllowlistResult {
  repos: Set<string> | null;       // lowercased "owner/name" — null if unavailable
  count: number;
  source: string;
  fetchedAt: string | null;
  error: string | null;
  cached: boolean;
}

export async function getRepoAllowlist(): Promise<AllowlistResult> {
  const now = Date.now();
  // A failure is retried after a minute; a good list is kept for the full TTL.
  if (cache && now - cache.fetchedAt < (cache.error ? ERROR_TTL_MS : TTL_MS)) {
    return {
      // A cached failure must degrade open too, not filter everything out.
      repos: cache.error ? null : cache.repos,
      count: cache.sourceCount,
      source: `${cache.source} (cached · ${Math.round((now - cache.fetchedAt) / 1000)}s old)`,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      error: cache.error,
      cached: true,
    };
  }

  try {
    // The Google credentials live in the secret store, which loads asynchronously after start.
    await ensureSecretsHydrated();
    const refreshToken = await readRefreshToken();
    if (!refreshToken) throw new Error("no gdrive refresh token — visit /api/gdrive/callback once");
    const accessToken = await mintAccessToken(refreshToken);
    let uniq = new Set<string>();
    let source = TAB_SOURCES[0].label;
    const problems: string[] = [];
    for (const tab of TAB_SOURCES) {
      try {
        const found = new Set(extractRepos(await fetchTabCsv(accessToken, tab.query)));
        if (found.size > 0) { uniq = found; source = tab.label; break; }
        problems.push(`${tab.label}: no GitHub URLs`);
      } catch (e) {
        problems.push(`${tab.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // An empty result means the sheet changed shape, not that every repo is excluded.
    if (uniq.size === 0) throw new Error(`no GitHub URLs found in the sheet (${problems.join("; ")})`);
    cache = { fetchedAt: now, repos: uniq, sourceCount: uniq.size, source, error: null };
    return {
      repos: uniq,
      count: uniq.size,
      source,
      fetchedAt: new Date(now).toISOString(),
      error: null,
      cached: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Cache the error briefly so we don't hammer Google on every failing call.
    cache = { fetchedAt: now, repos: new Set(), sourceCount: 0, source: "Sheet", error: msg };
    return { repos: null, count: 0, source: "Sheet", fetchedAt: null, error: msg, cached: false };
  }
}

/** Case-insensitive match for a repo full_name against the allowlist. */
export function isRepoAllowed(allowlist: Set<string> | null, fullName: string): boolean {
  if (!allowlist) return true; // degrade open if allowlist unavailable
  return allowlist.has(fullName.toLowerCase());
}
