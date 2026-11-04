"use client";
import { useEffect, useState } from "react";
import { Palette, Layers, Sun, Moon, Monitor } from "lucide-react";

type Theme = "dark" | "light" | "system";
type Accent = "indigo" | "violet" | "pink" | "mint" | "cyan" | "amber";
type BgVariant = "default" | "pure-black" | "navy" | "warm-white";
type Density = "comfortable" | "compact";

const ACCENTS: Array<{ id: Accent; hex: string; label: string }> = [
  { id: "indigo", hex: "#6366f1", label: "Indigo" },
  { id: "violet", hex: "#8b5cf6", label: "Violet" },
  { id: "pink",   hex: "#ec4899", label: "Pink"   },
  { id: "mint",   hex: "#10b981", label: "Mint"   },
  { id: "cyan",   hex: "#06b6d4", label: "Cyan"   },
  { id: "amber",  hex: "#f59e0b", label: "Amber"  },
];

const BG_VARIANTS: Array<{ id: BgVariant; label: string; hint: string; forTheme: "dark" | "light" | "any" }> = [
  { id: "default",     label: "Default",     hint: "Deep midnight / soft white", forTheme: "any" },
  { id: "pure-black",  label: "Pure black",  hint: "True #000 background (OLED-friendly)", forTheme: "dark" },
  { id: "navy",        label: "Navy",        hint: "Cool blue-slate midnight", forTheme: "dark" },
  { id: "warm-white",  label: "Warm white",  hint: "Cream, easier on the eyes", forTheme: "light" },
];

function applyAppearance(theme: Theme | null, accent: Accent | null, bg: BgVariant | null, density: Density | null) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const effTheme: "dark" | "light" =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : (theme ?? "dark");
  html.setAttribute("data-theme", effTheme);
  html.style.colorScheme = effTheme;
  if (accent && accent !== "indigo") html.setAttribute("data-accent", accent);
  else html.removeAttribute("data-accent");
  if (bg && bg !== "default") html.setAttribute("data-bg", bg);
  else html.removeAttribute("data-bg");
  if (density && density !== "comfortable") html.setAttribute("data-density", density);
  else html.removeAttribute("data-density");
}

export default function AppearancePanel() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [accent, setAccent] = useState<Accent>("indigo");
  const [bg, setBg] = useState<BgVariant>("default");
  const [density, setDensity] = useState<Density>("comfortable");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Instant paint from local cache
    const t = (localStorage.getItem("natasha-theme") as Theme) || "dark";
    const a = (localStorage.getItem("natasha-accent") as Accent) || "indigo";
    const b = (localStorage.getItem("natasha-bg") as BgVariant) || "default";
    const d = (localStorage.getItem("natasha-density") as Density) || "comfortable";
    setTheme(t); setAccent(a); setBg(b); setDensity(d);
    applyAppearance(t, a, b, d);
    // Reconcile with server
    fetch("/api/settings/appearance").then((r) => r.ok ? r.json() : null).then((j) => {
      if (!j) return;
      const nt = (j.theme as Theme) ?? t;
      const na = (j.accent as Accent) ?? a;
      const nb = (j.bgVariant as BgVariant) ?? b;
      const nd = (j.density as Density) ?? d;
      if (nt !== t) { setTheme(nt); localStorage.setItem("natasha-theme", nt); }
      if (na !== a) { setAccent(na); localStorage.setItem("natasha-accent", na); }
      if (nb !== b) { setBg(nb); localStorage.setItem("natasha-bg", nb); }
      if (nd !== d) { setDensity(nd); localStorage.setItem("natasha-density", nd); }
      applyAppearance(nt, na, nb, nd);
    }).catch(() => {});
  }, []);

  function save(patch: Partial<{ theme: Theme; accent: Accent; bgVariant: BgVariant; density: Density }>) {
    setSaving(true);
    fetch("/api/settings/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {}).finally(() => setSaving(false));
  }

  function pickTheme(t: Theme)    { setTheme(t);   localStorage.setItem("natasha-theme", t);    applyAppearance(t, accent, bg, density); save({ theme: t }); }
  function pickAccent(a: Accent)  { setAccent(a);  localStorage.setItem("natasha-accent", a);   applyAppearance(theme, a, bg, density); save({ accent: a }); }
  function pickBg(b: BgVariant)   { setBg(b);      localStorage.setItem("natasha-bg", b);       applyAppearance(theme, accent, b, density); save({ bgVariant: b }); }
  function pickDensity(d: Density){ setDensity(d); localStorage.setItem("natasha-density", d);  applyAppearance(theme, accent, bg, d); save({ density: d }); }

  const currentTheme: "dark" | "light" =
    theme === "system"
      ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : theme;
  const relevantBgs = BG_VARIANTS.filter((v) => v.forTheme === "any" || v.forTheme === currentTheme);

  return (
    <div className="panel settings-panel">
      <div className="settings-head"><Palette size={14} /> Appearance {saving && <span className="chip-me" style={{ background: "rgba(148,163,184,0.14)", color: "#94a3b8" }}>saving…</span>}</div>
      <div className="settings-note">These preferences follow your Google account across devices.</div>

      <div className="appearance-section">
        <div className="appearance-label">Theme</div>
        <div className="appearance-row">
          <button className={`appearance-btn ${theme === "light" ? "active" : ""}`} onClick={() => pickTheme("light")}><Sun size={13} /> Light</button>
          <button className={`appearance-btn ${theme === "dark" ? "active" : ""}`} onClick={() => pickTheme("dark")}><Moon size={13} /> Dark</button>
          <button className={`appearance-btn ${theme === "system" ? "active" : ""}`} onClick={() => pickTheme("system")}><Monitor size={13} /> System</button>
        </div>
      </div>

      <div className="appearance-section">
        <div className="appearance-label">Accent</div>
        <div className="appearance-row appearance-row-swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              className={`accent-swatch ${accent === a.id ? "active" : ""}`}
              onClick={() => pickAccent(a.id)}
              title={a.label}
              style={{ background: a.hex }}
              aria-label={`Accent ${a.label}`}
            />
          ))}
        </div>
      </div>

      <div className="appearance-section">
        <div className="appearance-label">Background</div>
        <div className="appearance-row appearance-row-bgs">
          {relevantBgs.map((v) => (
            <button
              key={v.id}
              className={`appearance-bg-card ${bg === v.id ? "active" : ""} bg-preview-${v.id}`}
              onClick={() => pickBg(v.id)}
              title={v.hint}
            >
              <div className="appearance-bg-preview" />
              <div className="appearance-bg-name">{v.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-section">
        <div className="appearance-label"><Layers size={12} /> Density</div>
        <div className="appearance-row">
          <button className={`appearance-btn ${density === "comfortable" ? "active" : ""}`} onClick={() => pickDensity("comfortable")}>Comfortable</button>
          <button className={`appearance-btn ${density === "compact" ? "active" : ""}`} onClick={() => pickDensity("compact")}>Compact</button>
        </div>
      </div>
    </div>
  );
}
