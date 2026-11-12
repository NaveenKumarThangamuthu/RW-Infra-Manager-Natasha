/**
 * Google Sheet-driven repo allowlist.
 *
 * Fetches the "Summary" tab of the "Running Services List - Production" sheet
 * via the gviz CSV endpoint (works with our drive.readonly OAuth token), extracts
 * every `github.com/OWNER/REPO(.git)` URL, and returns the unique set. Cached in
 * memory for 10 min per process to avoid hitting Google on every /security request.
 *
 * Any failure (no refresh token, Google 5xx, malformed sheet) returns null so the
 * caller can degrade to "show everything" — the allowlist is a filter, not a gate.
 */
import { promises as fs } from "fs";

const SHEET_ID = "1C-e0rNlL-PRx6gMGyu62RA-oOpOjDBJnnpzhqMQBGAg";
const TAB_NAME = "Summary";
const REFRESH_TOKEN_FILE = "/tmp/gdrive-refresh-token.txt";
const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  repos: Set<string>;
  sourceCount: number;
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

function extractRepos(csv: string): string[] {
  // Header line has "Github Url" column somewhere. Find its index dynamically.
  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return [];
  // Simple CSV parse (fields are double-quoted, may contain commas — accept the naive split
  // because the Github URL column doesn't contain commas or quotes in practice).
  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = parseRow(lines[0]);
  const idx = header.findIndex((h) => h.toLowerCase().replace(/\s+/g, "") === "githuburl");
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseRow(lines[i]);
    if (cells.length <= idx) continue;
    const url = cells[idx].trim();
    const m = url.match(/github\.com\/([^/]+)\/([^/.\s]+)/i);
    if (m) out.push(`${m[1]}/${m[2]}`.toLowerCase());
  }
  return out;
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
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return {
      // A cached failure must degrade open too, not filter everything out.
      repos: cache.error ? null : cache.repos,
      count: cache.sourceCount,
      source: `Sheet:Summary (cached · ${Math.round((now - cache.fetchedAt) / 1000)}s old)`,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      error: cache.error,
      cached: true,
    };
  }

  try {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) throw new Error("no gdrive refresh token — visit /api/gdrive/callback once");
    const accessToken = await mintAccessToken(refreshToken);
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB_NAME)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`gviz http ${r.status}`);
    const csv = await r.text();
    const repos = extractRepos(csv);
    const uniq = new Set(repos);
    // An empty result means the tab changed shape, not that every repo is excluded.
    if (uniq.size === 0) throw new Error(`no GitHub URLs found in the "${TAB_NAME}" tab — is the "Github Url" column missing?`);
    cache ={ fetchedAt: now, repos: uniq, sourceCount: uniq.size, error: null };
    return {
      repos: uniq,
      count: uniq.size,
      source: "Sheet:Summary",
      fetchedAt: new Date(now).toISOString(),
      error: null,
      cached: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Cache the error briefly so we don't hammer Google on every failing call.
    cache = { fetchedAt: now, repos: new Set(), sourceCount: 0, error: msg };
    return { repos: null, count: 0, source: "Sheet:Summary", fetchedAt: null, error: msg, cached: false };
  }
}

/** Case-insensitive match for a repo full_name against the allowlist. */
export function isRepoAllowed(allowlist: Set<string> | null, fullName: string): boolean {
  if (!allowlist) return true; // degrade open if allowlist unavailable
  return allowlist.has(fullName.toLowerCase());
}
