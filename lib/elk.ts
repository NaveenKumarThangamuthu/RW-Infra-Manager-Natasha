/**
 * Elasticsearch client for the RW DEV cluster.
 *
 * Two URLs:
 *   - LAN:    http://192.168.16.181:9200  (fast, only reachable from RW support wifi)
 *   - Public: http://3.221.76.159:9200    (full public IP, slow)
 *
 * Auth: HTTP Basic. Configure via env:
 *   ELK_URL              — full base URL (overrides LAN/public selection)
 *   ELK_URL_LAN          — LAN URL  (default: http://192.168.16.181:9200)
 *   ELK_URL_PUBLIC       — public URL (default: http://3.221.76.159:9200)
 *   ELK_USER, ELK_PASS   — basic auth credentials
 *
 * The LAN URL is preferred. If a request fails or times out we fall back to
 * the public URL. The active URL is reported so the UI can show a banner when
 * we're on the slower public path.
 */
const LAN = process.env.ELK_URL_LAN ?? "http://192.168.16.181:9200";
const PUBLIC = process.env.ELK_URL_PUBLIC ?? "http://3.221.76.159:9200";
const OVERRIDE = process.env.ELK_URL;
const USER = process.env.ELK_USER ?? "RW-DEV";
const PASS = process.env.ELK_PASS ?? "RW@elk123";
const TIMEOUT_LAN_MS = 4_000;
const TIMEOUT_PUBLIC_MS = 15_000;

export const SPRING_LOG_INDEX = "logs-tcp-default";

function authHeader(): string {
  return "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
}

async function tryFetch(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ES ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export interface EsResult<T = unknown> {
  data: T;
  via: "override" | "lan" | "public";
}

export async function esSearch<T = unknown>(
  index: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<EsResult<T>> {
  const path = `/${encodeURIComponent(index)}/_search`;
  if (OVERRIDE) {
    return { data: (await tryFetch(OVERRIDE, path, body, TIMEOUT_PUBLIC_MS)) as T, via: "override" };
  }
  try {
    return { data: (await tryFetch(LAN, path, body, opts?.timeoutMs ?? TIMEOUT_LAN_MS)) as T, via: "lan" };
  } catch (lanErr) {
    try {
      return { data: (await tryFetch(PUBLIC, path, body, TIMEOUT_PUBLIC_MS)) as T, via: "public" };
    } catch (pubErr) {
      throw new Error(
        `ES unreachable. LAN: ${lanErr instanceof Error ? lanErr.message : String(lanErr)} | Public: ${pubErr instanceof Error ? pubErr.message : String(pubErr)}`,
      );
    }
  }
}

// Elasticsearch sheds load with 429s, circuit-breaker errors and timeouts when its
// heap is full. These usually clear within seconds, so retry before recording a failure.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 3_000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
