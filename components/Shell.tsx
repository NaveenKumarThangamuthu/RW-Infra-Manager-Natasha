"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "./shell/AppSidebar";
import { AppHeader } from "./shell/AppHeader";
import { CommandMenu } from "./shell/CommandMenu";
import { pageTitle } from "./shell/nav";
import { ShellProvider, useShell } from "./shell/ShellContext";
import InspectorDrawer from "./InspectorDrawer";

const COLLAPSE_KEY = "natasha-sidebar-collapsed";
const NARROW_PX = 1100;
const MOBILE_PX = 768;

/** Grid breakpoints follow the content column, not the viewport, so they stay right when the sidebar toggles. */
function applyLayoutVars(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const W = Math.round(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const vars: Record<string, number> = {
    "--k4": W >= 860 ? 4 : W >= 520 ? 2 : 1,
    "--k3": W >= 600 ? 3 : 1,
    "--k2": W >= 640 ? 2 : 1,
    "--s5c": W >= 960 ? 5 : W >= 480 ? 6 : 2,
    "--s5a": W >= 960 ? 1 : W >= 480 ? 2 : 1,
    "--s5b": W >= 960 ? 1 : W >= 480 ? 3 : 1,
    "--s5e": W >= 960 ? 1 : W >= 480 ? 3 : 2,
    "--k6": W >= 1040 ? 6 : W >= 480 ? 3 : 2,
    "--k10": W >= 980 ? 5 : W >= 560 ? 2 : 1,
    "--h5c": W >= 1280 ? 5 : W >= 600 ? 6 : 1,
    "--h5a": W >= 1280 ? 1 : W >= 600 ? 2 : 1,
    "--h5b": W >= 1280 ? 1 : W >= 600 ? 3 : 1,
  };
  const root = document.documentElement.style;
  for (const k of Object.keys(vars)) root.setProperty(k, String(vars[k]));
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { cmdOpen, setCmdOpen } = useShell();
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const collapsed = !mobile && (collapsedPref ?? narrow);

  const toggleSidebar = useCallback(() => {
    if (mobile) { setDrawer((d) => !d); return; }
    const next = !(collapsedPref ?? narrow);
    setCollapsedPref(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* storage blocked */ }
  }, [mobile, collapsedPref, narrow]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      if (saved != null) setCollapsedPref(saved === "1");
    } catch { /* storage blocked */ }
    const onResize = () => {
      setNarrow(window.innerWidth < NARROW_PX);
      setMobile(window.innerWidth < MOBILE_PX);
      setDrawer(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") { e.preventDefault(); setCmdOpen(!cmdOpen); }
      else if ((e.metaKey || e.ctrlKey) && k === "b") { e.preventDefault(); toggleSidebar(); }
      else if (k === "escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen, setCmdOpen, toggleSidebar]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => applyLayoutVars(el)); });
    ro.observe(el);
    applyLayoutVars(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Each route starts at the top, because the frame (not the window) is the scroller.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [path]);

  return (
    <div className="flex h-screen overflow-hidden bg-shell text-foreground">
      {mobile && drawer && <div onClick={() => setDrawer(false)} className="fixed inset-0 z-[65] bg-overlay animate-nt-fade" />}
      <AppSidebar collapsed={collapsed} mobile={mobile} drawer={drawer} onCloseDrawer={() => setDrawer(false)} />
      <main className={mobile ? "flex min-w-0 flex-1" : "flex min-w-0 flex-1 py-2 pr-2"}>
        <div ref={scrollRef} className={mobile
          ? "min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-background shadow-card"
          : "min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[14px] border border-solid border-border bg-background shadow-card"}>
          <AppHeader title={pageTitle(path)} mobile={mobile} onToggleSidebar={toggleSidebar} />
          <div ref={contentRef} className="mx-auto max-w-[1480px] px-[clamp(16px,3vw,36px)] pb-14 pt-7">
            {children}
          </div>
        </div>
      </main>
      <CommandMenu collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      <InspectorDrawer />
    </div>
  );
}

/** App chrome. /login renders bare; every other route gets the sidebar + framed content column. */
export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;
  return (
    <ShellProvider>
      <Frame>{children}</Frame>
    </ShellProvider>
  );
}
