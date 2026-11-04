"use client";
import { useCallback, useEffect, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Minimal JSON fetch hook with manual reload. */
export function useJson<T>(url: string): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (r) => {
        // Read as text first so a non-JSON error page (e.g. a 502 from the
        // tunnel, or "Internal Server Error") yields a clean message instead
        // of an "Unexpected token" JSON parse error.
        const text = await r.text();
        // Auth middleware redirects to /login when the session expires; the
        // browser follows the 307 and we land on login HTML. Detect that and
        // surface a clear "session expired" message.
        const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(text);
        if (
          r.status === 401 ||
          (looksLikeHtml && (r.url.includes("/login") || r.redirected))
        ) {
          throw new Error("Session expired — please sign in again.");
        }
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          if (looksLikeHtml) {
            throw new Error("Session expired — please sign in again.");
          }
          throw new Error(
            r.ok ? "Unexpected response from server (not JSON)." : `Request failed (${r.status} ${r.statusText}).`,
          );
        }
        if (!r.ok) {
          const msg = (body as { error?: string } | null)?.error;
          if (r.status === 401) throw new Error("Session expired — please sign in again.");
          throw new Error(msg || `Request failed (${r.status}).`);
        }
        return body as T;
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [url, tick]);

  return { data, error, loading, reload };
}
