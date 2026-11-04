/**
 * Tiny server-side TTL cache. Cost Explorer responses change slowly and each
 * call is slow + billable, so we memoize results for a few minutes. This makes
 * re-visiting a screen instant and keeps CE request costs down.
 *
 * In-memory only (per server process) — fine for a personal dashboard.
 */
interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Default TTL for cost data — 5 minutes. */
export const DEFAULT_TTL = 5 * 60 * 1000;
