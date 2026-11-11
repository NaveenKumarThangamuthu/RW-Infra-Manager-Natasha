"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowRight, Monitor, Moon, Plus, RefreshCw, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ago, CATEGORY_META, usd } from "@/components/natasha/format";
import { Dot, ErrorNote } from "@/components/natasha/primitives";
import { useShell, type ThemePref } from "@/components/shell/ShellContext";
import { useSummary } from "@/components/shell/useOps";
import { useJson } from "@/components/useJson";
import { cn, tint } from "@/lib/utils";

const ACCENTS = [{ id: "indigo", hex: "#6366f1" }, { id: "violet", hex: "#8b5cf6" }, { id: "pink", hex: "#ec4899" }, { id: "mint", hex: "#10b981" }, { id: "cyan", hex: "#06b6d4" }, { id: "amber", hex: "#f59e0b" }];
const BGS = [{ id: "default", label: "Default", sw: "#09090b" }, { id: "pure-black", label: "Pure black", sw: "#000000" }, { id: "navy", label: "Navy", sw: "#0b1222" }];
const DEFAULT_ACCENT = "violet";
// Mirrors the defaults used by the tag budget view; real values come from TAG_BUDGETS_JSON.
const BUDGETS: Record<string, number> = { "2.0": 800, "3.0": 600, Infra: 300, Dev: 150, Shared: 100 };

function Section({ id, title, description, children, cardClass, last }: { id?: string; title: string; description: ReactNode; children: ReactNode; cardClass?: string; last?: boolean }) {
  return (
    <div id={id} className={cn("flex flex-wrap gap-x-10 gap-y-3.5 border-0 border-t border-solid border-border pt-7", !last && "pb-7")}>
      <div className="max-w-[320px] flex-[1_1_240px]">
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        <p className="mb-0 mt-1 text-[13px] leading-[1.5] text-muted-foreground text-wrap-pretty">{description}</p>
      </div>
      <Card className={cn("min-w-0 flex-[999_1_460px]", cardClass)}>{children}</Card>
    </div>
  );
}

function KV({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-[13px]", !last && "border-0 border-b border-solid border-border")}>
      <span className="text-muted-foreground">{label}</span><span>{children}</span>
    </div>
  );
}
const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[12px] text-fg-2">{children}</span>;

function Appearance() {
  const { theme, setTheme } = useShell();
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [bg, setBg] = useState("default");

  const apply = useCallback((a: string, b: string) => {
    const html = document.documentElement;
    html.setAttribute("data-accent", a);
    if (b === "default") html.removeAttribute("data-bg");
    else html.setAttribute("data-bg", b);
  }, []);

  useEffect(() => {
    let a = DEFAULT_ACCENT, b = "default";
    try { a = localStorage.getItem("natasha-accent") ?? a; b = localStorage.getItem("natasha-bg") ?? b; } catch { /* storage blocked */ }
    setAccent(a); setBg(b);
    fetch("/api/settings/appearance").then((r) => (r.ok ? r.json() : null)).then((j: { accent?: string | null; bgVariant?: string | null } | null) => {
      if (!j) return;
      const na = j.accent ?? a, nb = j.bgVariant ?? b;
      setAccent(na); setBg(nb); apply(na, nb);
      try { localStorage.setItem("natasha-accent", na); localStorage.setItem("natasha-bg", nb); } catch { /* storage blocked */ }
    }).catch(() => { /* offline: the cached values stay */ });
  }, [apply]);

  const save = (patch: { accent?: string; bgVariant?: string }) => {
    fetch("/api/settings/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => { /* best-effort */ });
  };
  const pickAccent = (a: string) => { setAccent(a); apply(a, bg); try { localStorage.setItem("natasha-accent", a); } catch { /* storage blocked */ } save({ accent: a }); };
  const pickBg = (b: string) => { setBg(b); apply(accent, b); try { localStorage.setItem("natasha-bg", b); } catch { /* storage blocked */ } save({ bgVariant: b }); };

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-fg-2">Theme</span>
        <Segmented<ThemePref> size="md" value={theme} onChange={setTheme} aria-label="Theme" className="flex max-w-[360px] [&>button]:flex-1 [&>button]:text-[12.5px]" options={[
          { value: "light", label: "Light", icon: <Sun size={12} className="block" /> },
          { value: "dark", label: "Dark", icon: <Moon size={12} className="block" /> },
          { value: "system", label: "System", icon: <Monitor size={12} className="block" /> },
        ]} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-fg-2">Accent</span>
        <div className="flex flex-wrap gap-3 p-0.5">
          {ACCENTS.map((a) => (
            <button key={a.id} type="button" title={a.id} aria-label={`${a.id} accent`} aria-pressed={accent === a.id} onClick={() => pickAccent(a.id)}
              className="h-[26px] w-[26px] cursor-pointer rounded-[26px] border-none"
              style={{ background: a.hex, boxShadow: accent === a.id ? `0 0 0 2px var(--card), 0 0 0 4px ${a.hex}` : "none" }} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-fg-2">Dark background</span>
        <div className="grid max-w-[420px] grid-cols-3 gap-2">
          {BGS.map((b) => (
            <button key={b.id} type="button" aria-pressed={bg === b.id} onClick={() => pickBg(b.id)} className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-[9px] border border-solid bg-card p-1.5 text-left" style={{ borderColor: bg === b.id ? "var(--brand)" : "var(--border)" }}>
              <span className="h-8 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" style={{ background: b.sw }} />
              <span className="truncate px-0.5 text-[12px] font-medium text-fg-2">{b.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

interface AllowedUser { id: number; email: string; name: string | null; active: boolean; createdAt: string }

function AllowedUsers() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<{ users: AllowedUser[]; currentEmail: string | null }>("/api/settings/allowed-users");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const users = data?.users ?? [];

  const call = async (url: string, init: RequestInit, done: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, init);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast(done);
      reload();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    const ok = await call("/api/settings/allowed-users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, name: name.trim() || undefined }) }, `${em} can sign in now`);
    if (ok) { setEmail(""); setName(""); }
  };

  return (
    <>
      <form onSubmit={add} className="flex flex-wrap gap-2 border-0 border-b border-solid border-border px-5 py-4">
        <Input type="email" required placeholder="teammate@rw.team" value={email} onChange={(e) => setEmail(e.target.value)} className="h-[34px] min-w-0 flex-[2_1_180px]" />
        <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="h-[34px] min-w-0 flex-[1_1_130px]" />
        <Button type="submit" variant="primary" className="px-3.5" disabled={busy || !email.trim()}><Plus size={12} className="block" />Add user</Button>
      </form>
      <div className="flex h-9 items-center justify-between gap-3 bg-card-2 px-5 text-[12px] font-medium text-muted-foreground">
        <span>Members</span><span className="tnum">{users.length} total · {users.filter((u) => u.active).length} active</span>
      </div>
      {error && <div className="p-4"><ErrorNote message={error} onRetry={reload} /></div>}
      {users.map((u) => {
        const you = u.email === data?.currentEmail;
        const color = u.active ? "var(--success)" : "var(--muted-fg)";
        return (
          <div key={u.id} className="group flex min-h-[52px] items-center gap-3 border-0 border-t border-solid border-border px-5 py-2 text-[13px]">
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-card-2 text-[12px] font-semibold text-fg-2">{(u.name || u.email).charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-[12.5px]">{u.email}</span>
                {you && <span className="shrink-0 rounded-[5px] bg-card-2 px-1.5 py-px text-[11px] font-medium text-muted-foreground">you</span>}
              </div>
              <div className="mt-px text-[12px] text-muted-foreground">{u.name ? `${u.name} · ` : ""}Added {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
            {!you && (
              <button type="button" title={`Delete ${u.email}`} aria-label={`Delete ${u.email}`} disabled={busy}
                onClick={() => { if (window.confirm(`Delete ${u.email} from the allowlist? This cannot be undone.`)) void call(`/api/settings/allowed-users/${u.id}`, { method: "DELETE" }, `${u.email} removed`); }}
                className="inline-grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] border-none bg-transparent text-muted-foreground opacity-0 transition-opacity hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
                <Trash2 size={14} className="block" />
              </button>
            )}
            <button type="button" disabled={you || busy} title={you ? "You can't deactivate yourself" : u.active ? "Click to deactivate" : "Click to reactivate"}
              onClick={() => { if (window.confirm(u.active ? `Deactivate ${u.email}?` : `Reactivate ${u.email}?`)) void call(`/api/settings/allowed-users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !u.active }) }, `${u.email} ${u.active ? "deactivated" : "reactivated"}`); }}
              className={cn("inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-[6px] border-none px-[7px] text-[12px] font-medium", !you && "cursor-pointer")} style={{ color, background: u.active ? tint(color) : "var(--card-2)" }}>
              <Dot color={color} />{u.active ? "Active" : "Inactive"}
            </button>
          </div>
        );
      })}
    </>
  );
}

interface SecretRow { key: string; updatedAt: string; updatedBy: string }
interface SecretsResp { secrets: SecretRow[]; knownManagedKeys: string[] }

function Secrets() {
  const { toast } = useShell();
  const { data, error, reload } = useJson<SecretsResp>("/api/settings/secrets");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string | null>(null);

  const close = () => { setEditing(null); setAdding(false); setValue(""); setNewKey(""); };
  const save = async (key: string) => {
    if (!key.trim() || !value) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim(), value }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Rotate failed");
      toast(`${key.trim()} rotated`);
      setRecent(key.trim());
      close();
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Rotate failed");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (key: string) => {
    if (!window.confirm(`Delete secret ${key}? Any subsystem depending on it will fail until you add it back.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/settings/secrets?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed");
      toast(`${key} deleted`);
      close();
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };
  const reloadEnv = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/secrets/reload", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Reload failed");
      toast(`Environment reloaded · ${j.loaded} secrets in secret_store`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reload failed");
    } finally {
      setBusy(false);
    }
  };

  const valueInput = <Input type="password" autoComplete="new-password" placeholder="New value" value={value} onChange={(e) => setValue(e.target.value)} className="h-7 min-w-0 flex-1 rounded-[7px] text-[12px]" autoFocus />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-0 border-b border-solid border-border px-5 py-3.5">
        <div className="min-w-0 flex-[1_1_260px] text-[12.5px] leading-[1.5] text-muted-foreground">
          Bootstrap credentials stay in .env: <span className="font-mono text-fg-2">MYSQL_*</span>, <span className="font-mono text-fg-2">NEXTAUTH_SECRET</span>, <span className="font-mono text-fg-2">INFRA_KMS_KEY</span>.
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" className="h-8 px-2.5 text-[12.5px]" disabled={busy} onClick={() => void reloadEnv()}><RefreshCw size={12} className="block" />Reload env</Button>
          <Button size="sm" className="h-8 px-2.5 text-[12.5px]" onClick={() => { close(); setAdding(true); }}><Plus size={12} className="block" />Add secret</Button>
        </div>
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border bg-hover px-5 py-3">
          <Input placeholder="SECRET_NAME" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase())} className="h-7 flex-[1_1_180px] rounded-[7px] font-mono text-[12px]" />
          {valueInput}
          <Button variant="primary" size="xs" className="rounded-[7px]" disabled={busy || !newKey.trim() || !value} onClick={() => void save(newKey)}>Save</Button>
          <Button variant="ghost" size="xs" className="rounded-[7px]" onClick={close}>Cancel</Button>
        </div>
      )}
      {error && <div className="p-4"><ErrorNote message={error} onRetry={reload} /></div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,380px),1fr))]">
        {(data?.secrets ?? []).map((k) => editing === k.key ? (
          <div key={k.key} className="flex min-h-[52px] flex-wrap items-center gap-2 px-5 py-1.5 shadow-[0_1px_0_var(--border),1px_0_0_var(--border)]">
            <span className="min-w-0 max-w-full truncate font-mono text-[12.5px]">{k.key}</span>
            {valueInput}
            <Button variant="primary" size="xs" className="rounded-[7px]" disabled={busy || !value} onClick={() => void save(k.key)}>Save</Button>
            <Button variant="ghost" size="xs" className="rounded-[7px]" onClick={close}>Cancel</Button>
            <button type="button" title={`Delete ${k.key}`} aria-label={`Delete ${k.key}`} disabled={busy} onClick={() => void remove(k.key)} className="inline-grid h-7 w-7 cursor-pointer place-items-center rounded-[7px] border-none bg-transparent text-muted-foreground hover:bg-hover hover:text-danger"><Trash2 size={14} className="block" /></button>
          </div>
        ) : (
          <div key={k.key} className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3.5 px-5 py-1.5 text-[13px] shadow-[0_1px_0_var(--border),1px_0_0_var(--border)]">
            <span className="min-w-0 truncate font-mono text-[12.5px]">{k.key}</span>
            <span className="text-right text-[12px] leading-[1.4]" style={{ color: recent === k.key ? "var(--success)" : "var(--fg-2)" }}>
              <span className="block">{ago(k.updatedAt)}</span><span className="block text-muted-foreground">{k.updatedBy}</span>
            </span>
            <Button size="xs" className="gap-[5px] rounded-[7px] text-[12px]" onClick={() => { close(); setEditing(k.key); }}><RefreshCw size={12} className="block" />Rotate</Button>
          </div>
        ))}
      </div>
    </>
  );
}

function Budgets() {
  const { data } = useJson<{ buckets?: Array<{ category: string; amount: number }> }>("/api/cost/allocation?mode=month");
  const rows = CATEGORY_META.filter((c) => BUDGETS[c.key]);
  return (
    <>
      {rows.map((c, i) => {
        const spent = data?.buckets?.find((b) => b.category === c.key)?.amount ?? 0;
        const budget = BUDGETS[c.key];
        const pct = (spent / budget) * 100;
        const color = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : c.color;
        return (
          <div key={c.key} className={cn("flex flex-col gap-2 py-3", i < rows.length - 1 && "border-0 border-b border-solid border-border")}>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-2 font-medium"><Dot color={c.color} size={8} />{c.key}</span>
              <span className="text-[12.5px] text-muted-foreground tnum">{usd(spent)} / {usd(budget)} per month · {pct.toFixed(0)}%</span>
            </div>
            <span className="block h-[5px] overflow-hidden rounded-[5px] bg-card-2"><span className="block h-full rounded-[5px]" style={{ width: `${Math.min(100, pct)}%`, background: color }} /></span>
          </div>
        );
      })}
    </>
  );
}

export default function Settings() {
  const { data: session } = useSession();
  const { data: ops } = useSummary();
  const email = session?.user?.email ?? "—";
  const name = session?.user?.name ?? email.split("@")[0];
  const image = session?.user?.image;
  return (
    <div data-screen-label="Settings" className="nt-screen flex flex-col">
      <div className="mb-5 max-w-[760px]">
        <h1 className="m-0 text-[26px] font-semibold leading-[1.2] tracking-[-0.025em]">Settings</h1>
        <p className="mb-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground">Profile, appearance, access, secrets, budgets, cron schedule and anomaly thresholds.</p>
      </div>
      <Section title="Profile" description="Your account and how you sign in." cardClass="px-5 py-1">
        <div className="flex items-center gap-3 border-0 border-b border-solid border-border py-3.5">
          {image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={image} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-[10px] object-cover" />
            : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-brand text-[15px] font-semibold text-white">{(name || "?").charAt(0).toUpperCase()}</span>}
          <div className="min-w-0"><div className="text-[14px] font-semibold">{name}</div><div className="font-mono text-[12px] text-muted-foreground">{email}</div></div>
        </div>
        <KV label="Session">NextAuth · JWT, 30-day rolling</KV>
        <KV label="Provider" last>Google Sign-In only</KV>
      </Section>
      <Section title="Appearance" description="These preferences follow your Google account across devices." cardClass="flex flex-col gap-5 px-5 py-[18px]"><Appearance /></Section>
      <Section id="allowed-users" title="Allowed users" description="Google Sign-In is gated by this list. Teammates with an @rw.team Google account can log in immediately — no restart needed." cardClass="overflow-hidden"><AllowedUsers /></Section>
      <Section id="secrets" title="Secrets" cardClass="overflow-hidden" description={<>Encrypted at rest with AES-256-GCM using <Mono>INFRA_KMS_KEY</Mono>. Everything outside .env lives in <Mono>secret_store</Mono> and can be rotated here.</>}><Secrets /></Section>
      <Section title="Categories & budgets" cardClass="px-5 py-1" description={<>Configured via <Mono>TAG_BUDGETS_JSON</Mono> in <Mono>/tmp/srv.env</Mono>.</>}><Budgets /></Section>
      <Section title="Cron schedule" cardClass="px-5 pb-4 pt-1" description={<>Chains <Mono>/api/cron/refresh-all</Mono> (ops) and <Mono>/api/refresh</Mono> (billing). Each call logs independently, so a failure in one no longer skips the other.</>}>
        <KV label="Last run">{ago(ops?.ops.cronLastAt)}</KV>
        <KV label="Schedule">Twice daily · 00:30 &amp; 12:30 UTC</KV>
        <div className="mb-3.5 flex flex-wrap justify-between gap-x-4 gap-y-1 border-0 border-b border-solid border-border py-3 text-[13px]"><span className="text-muted-foreground">Script</span><span className="font-mono text-[12.5px]">scripts/cron-refresh.sh</span></div>
        <Button asChild size="sm" className="h-8 text-[12.5px]"><Link href="/cron" className="no-underline">Open cron jobs<ArrowRight size={12} className="block" /></Link></Button>
      </Section>
      <Section title="Anomaly thresholds" description="How cost anomalies are detected and when they alert." cardClass="px-5 py-1">
        <KV label="Detection">MAD z-score · 14-day baseline</KV>
        <KV label="Warn threshold"><span className="font-mono text-[12.5px]">z ≥ 2.0</span></KV>
        <KV label="Critical threshold"><span className="font-mono text-[12.5px]">z ≥ 3.0</span></KV>
        <KV label="Minimum impact" last>$25 · <span className="font-mono text-[12px]">TELEGRAM_ALERT_MIN_USD</span></KV>
      </Section>
      <Section title="Alerts" description="Where notifications are delivered." cardClass="px-5 py-1">
        <KV label="Anomaly alerts">Telegram · Infra topic 61</KV>
        <KV label="Cron summary">Silent unless anomalies or CRIT findings</KV>
        <KV label="Suppression" last>Per repository, with audit trail</KV>
      </Section>
      <Section title="About" description="Build and data handling." cardClass="px-5 py-1" last>
        <KV label="App">Natasha Infra Command Center</KV>
        <KV label="Stack">Next.js 14 · React 18 · Prisma 5 · MySQL 8.4</KV>
        <KV label="Data" last>Read-only · every snapshot preserved</KV>
      </Section>
    </div>
  );
}
