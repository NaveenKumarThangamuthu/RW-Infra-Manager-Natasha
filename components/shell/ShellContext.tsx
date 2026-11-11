"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

export type ThemePref = "dark" | "light" | "system";
type RefreshSource = "spring-health" | "spring-logs" | "ec2-health" | "ec2-volumes" | "cloudwatch-alarms" | "prom-alerts" | "recommendations" | "lambda-ohio" | "all";

const REFRESHED_EVENT = "natasha:refreshed";

interface ShellValue {
  toast: (message: string) => void;
  refreshing: boolean;
  refresh: (sources?: RefreshSource[]) => Promise<void>;
  theme: ThemePref;
  resolvedTheme: "dark" | "light";
  setTheme: (t: ThemePref) => void;
  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;
}

const Ctx = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell must be used inside ShellProvider");
  return v;
}

/** Re-run a loader whenever any refresh (header, palette or page button) completes. */
export function useOnRefreshed(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener(REFRESHED_EVENT, h);
    return () => window.removeEventListener(REFRESHED_EVENT, h);
  }, []);
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

interface RefreshResult { source: string; ok: boolean; error?: string }

export function ShellProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>("dark");
  const [resolvedTheme, setResolved] = useState<"dark" | "light">("dark");
  const [cmdOpen, setCmdOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((m: string) => {
    clearTimeout(toastTimer.current);
    setToastMsg(m);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const applyTheme = useCallback((p: ThemePref) => {
    const t = resolve(p);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    setResolved(t);
  }, []);

  useEffect(() => {
    let cached: ThemePref = "dark";
    try { cached = (localStorage.getItem("natasha-theme") as ThemePref | null) ?? "dark"; } catch { /* storage blocked */ }
    setThemeState(cached);
    applyTheme(cached);
    // The DB value wins over the local cache so the choice follows the user across browsers.
    fetch("/api/settings/theme").then((r) => (r.ok ? r.json() : null)).then((j: { theme?: ThemePref | null } | null) => {
      if (j?.theme && j.theme !== cached) {
        setThemeState(j.theme);
        applyTheme(j.theme);
        try { localStorage.setItem("natasha-theme", j.theme); } catch { /* storage blocked */ }
      }
    }).catch(() => { /* offline or signed out: the cached value stays */ });
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => { try { if (localStorage.getItem("natasha-theme") === "system") applyTheme("system"); } catch { /* storage blocked */ } };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [applyTheme]);

  const setTheme = useCallback((p: ThemePref) => {
    setThemeState(p);
    applyTheme(p);
    try { localStorage.setItem("natasha-theme", p); } catch { /* storage blocked */ }
    fetch("/api/settings/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: p }),
    }).catch(() => { /* best-effort */ });
  }, [applyTheme]);

  const refresh = useCallback(async (sources: RefreshSource[] = ["all"]) => {
    setRefreshing(true);
    try {
      const results: RefreshResult[] = [];
      for (const source of sources) {
        const res = await fetch("/api/refresh/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        });
        const body = await res.json().catch(() => ({}));
        if (body.results) results.push(...body.results);
        else results.push({ source, ok: false, error: body.error ?? `HTTP ${res.status}` });
      }
      const failed = results.filter((r) => !r.ok);
      const ok = results.length - failed.length;
      toast(failed.length === 0
        ? (sources[0] === "all" ? `All sources refreshed · ${ok} snapshots updated` : `${ok} source${ok === 1 ? "" : "s"} refreshed`)
        : `${ok} refreshed, ${failed.length} failed: ${failed.map((f) => f.source).join(", ")}`);
      window.dispatchEvent(new Event(REFRESHED_EVENT));
    } catch (e) {
      toast(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  const value = useMemo<ShellValue>(() => ({ toast, refreshing, refresh, theme, resolvedTheme, setTheme, cmdOpen, setCmdOpen }),
    [toast, refreshing, refresh, theme, resolvedTheme, setTheme, cmdOpen]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div role="status" className="fixed bottom-5 right-5 z-[90] flex max-w-[min(380px,calc(100vw-40px))] items-center gap-2.5 rounded-[10px] border border-solid border-border bg-popover px-3.5 py-3 text-[13px] text-foreground shadow-[0_12px_32px_rgba(0,0,0,.3)] animate-nt-in">
          <span className="text-success"><Check size={14} className="block" /></span>
          <span>{toastMsg}</span>
        </div>
      )}
    </Ctx.Provider>
  );
}
