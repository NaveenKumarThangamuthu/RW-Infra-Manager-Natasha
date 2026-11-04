"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useJson } from "./useJson";
import { Command, FileDown, Loader2, ChevronDown, Settings, Plug, LogOut, Users, Sun, Moon, Monitor } from "lucide-react";

interface RefreshInfo {
  lastRefreshAt: string | null;
  lastRunLabel: string | null;
}

function lastRefreshText(info?: RefreshInfo | null): string {
  if (!info?.lastRefreshAt) {
    return "No refresh yet";
  }
  const d = new Date(info.lastRefreshAt);
  const stamp = d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
  return `Last refreshed ${stamp} IST${info.lastRunLabel ? ` (${info.lastRunLabel})` : ""}`;
}

export default function TopBar() {
  const { data: session } = useSession();
  const { data: refresh } = useJson<RefreshInfo>("/api/refresh/status");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? "";
  const image = session?.user?.image ?? "";
  const initial = (name || email).charAt(0).toUpperCase();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function onPdfClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const resp = await fetch("/api/export/pdf");
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `natasha-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    } catch (err) {
      alert(`PDF export failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-meta">
        {lastRefreshText(refresh)}
      </div>
      <div className="topbar-user">
        <button
          type="button"
          className="btn-signout topbar-cmdk"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          title="Open command palette (Ctrl/Cmd+K)"
        >
          <Command size={13} /> <kbd>K</kbd>
        </button>
        <a
          className={`btn-signout topbar-pdf ${pdfBusy ? "pdf-busy" : ""}`}
          href="/api/export/pdf"
          onClick={onPdfClick}
          title={pdfBusy ? "Rendering PDF — this can take ~10s" : "Download dashboard as PDF"}
          aria-busy={pdfBusy}
        >
          {pdfBusy ? <Loader2 size={13} className="spin" /> : <FileDown size={13} />}
          {pdfBusy ? "Rendering…" : "PDF"}
        </a>
        {email ? (
          <div className="topbar-user-menu" ref={menuRef}>
            <button
              type="button"
              className={`topbar-userchip ${menuOpen ? "open" : ""}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={name ? `${name} · ${email}` : email}
            >
              {image ? (
                // Google's photo — plain <img> avoids Next-Image domain config.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="avatar-img" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar">{initial}</span>
              )}
              <span className="topbar-email">{email}</span>
              <ChevronDown size={13} className={`topbar-userchip-caret ${menuOpen ? "flip" : ""}`} />
            </button>
            {menuOpen && (
              <div className="topbar-userdropdown" role="menu">
                <div className="topbar-userdropdown-head">
                  {name && <div className="topbar-userdropdown-name">{name}</div>}
                  <div className="topbar-userdropdown-email mono small">{email}</div>
                </div>
                <div className="topbar-userdropdown-divider" />
                <Link href="/settings" role="menuitem" className="topbar-userdropdown-item" onClick={() => setMenuOpen(false)}>
                  <Settings size={14} /> Settings
                </Link>
                <Link href="/settings#allowed-users" role="menuitem" className="topbar-userdropdown-item" onClick={() => setMenuOpen(false)}>
                  <Users size={14} /> Allowed users
                </Link>
                <Link href="/integrations" role="menuitem" className="topbar-userdropdown-item" onClick={() => setMenuOpen(false)}>
                  <Plug size={14} /> Integrations
                </Link>
                <div className="topbar-userdropdown-divider" />
                <ThemeToggle />
                <div className="topbar-userdropdown-divider" />
                <button
                  role="menuitem"
                  type="button"
                  className="topbar-userdropdown-item topbar-userdropdown-danger"
                  onClick={() => { setMenuOpen(false); signOut({ callbackUrl: "/login" }); }}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="topbar-email">—</span>
        )}
      </div>
    </header>
  );
}

type ThemePref = "dark" | "light" | "system";

function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const effective = pref === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : pref;
  html.setAttribute("data-theme", effective);
  html.style.colorScheme = effective;
}

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("dark");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 1) Local cache first — instant paint without waiting for a round-trip.
    const cached = (typeof localStorage !== "undefined" && (localStorage.getItem("natasha-theme") as ThemePref | null)) || "dark";
    setPref(cached);
    applyTheme(cached);
    // 2) Then reconcile with server — if the DB value differs, adopt it.
    fetch("/api/settings/theme").then((r) => r.ok ? r.json() : null).then((j: { theme?: ThemePref | null } | null) => {
      if (j?.theme && j.theme !== cached) {
        setPref(j.theme);
        applyTheme(j.theme);
        localStorage.setItem("natasha-theme", j.theme);
      }
    }).catch(() => { /* offline / unauth — cached value stays */ });

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => { if ((localStorage.getItem("natasha-theme") as ThemePref | null) === "system") applyTheme("system"); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const set = (p: ThemePref) => {
    setPref(p);
    localStorage.setItem("natasha-theme", p);
    applyTheme(p);
    setSaving(true);
    fetch("/api/settings/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: p }),
    }).catch(() => { /* best-effort */ }).finally(() => setSaving(false));
  };

  return (
    <div className="topbar-userdropdown-theme">
      <div className="topbar-userdropdown-theme-label">
        Theme
        {saving && <span className="chip-me" style={{ background: "rgba(148,163,184,0.14)", color: "#94a3b8" }}>saving…</span>}
      </div>
      <div className="topbar-userdropdown-theme-row">
        <button className={`theme-btn ${pref === "light" ? "active" : ""}`} onClick={() => set("light")} title="Light"><Sun size={13} /></button>
        <button className={`theme-btn ${pref === "dark" ? "active" : ""}`} onClick={() => set("dark")} title="Dark"><Moon size={13} /></button>
        <button className={`theme-btn ${pref === "system" ? "active" : ""}`} onClick={() => set("system")} title="Follow OS"><Monitor size={13} /></button>
      </div>
    </div>
  );
}
