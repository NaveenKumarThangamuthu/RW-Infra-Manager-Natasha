"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ChevronsUpDown, LogOut, Monitor, Moon, Plug, Settings2, Sun, Users, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { cn, tint } from "@/lib/utils";
import { ago, ageMinutes } from "@/components/natasha/format";
import { isActive, NAV } from "./nav";
import { useShell, type ThemePref } from "./ShellContext";
import { useSummary } from "./useOps";
import { useJson } from "@/components/useJson";
import { useState } from "react";

export function NatashaMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="8 7 18 18" className="block" aria-hidden="true">
      <path d="M11 22L11 10L13.6 10L20.4 19L20.4 10L23 10L23 22L20.4 22L13.6 13L13.6 22Z" fill="currentColor" />
    </svg>
  );
}

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={12} className="block" /> },
  { value: "dark", label: "Dark", icon: <Moon size={12} className="block" /> },
  { value: "system", label: "System", icon: <Monitor size={12} className="block" /> },
];

function MenuLink({ href, icon, children, onNavigate }: { href: string; icon: React.ReactNode; children: React.ReactNode; onNavigate: () => void }) {
  return (
    <Link href={href} onClick={onNavigate} className="flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-foreground no-underline hover:bg-hover hover:text-foreground">
      <span className="text-muted-foreground">{icon}</span>{children}
    </Link>
  );
}

function UserMenu({ expanded }: { expanded: boolean }) {
  const { data: session } = useSession();
  const { theme, setTheme } = useShell();
  const [open, setOpen] = useState(false);
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? email.split("@")[0] ?? "";
  const image = session?.user?.image ?? "";
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border-none bg-transparent p-1.5 text-left text-foreground hover:bg-hover">
          {image ? (
            // Google's avatar: plain <img> avoids Next image-domain config.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-[8px] object-cover" />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-brand text-[13px] font-semibold text-white">{(name || "?").charAt(0).toUpperCase()}</span>
          )}
          {expanded && (
            <>
              <span className="min-w-0 flex-1 leading-[1.25]">
                <span className="block truncate text-[13px] font-medium">{name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{email}</span>
              </span>
              <span className="text-muted-foreground"><ChevronsUpDown size={14} className="block" /></span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-1.5">
        <div className="px-2.5 pb-2.5 pt-2">
          <div className="text-[13.5px] font-semibold">{name}</div>
          <div className="mt-0.5 font-mono text-[12px] text-muted-foreground">{email}</div>
        </div>
        <div className="-mx-1.5 mb-1 mt-0.5 h-px bg-border" />
        <MenuLink href="/settings" onNavigate={close} icon={<Settings2 size={14} className="block" />}>Settings</MenuLink>
        <MenuLink href="/settings#allowed-users" onNavigate={close} icon={<Users size={14} className="block" />}>Allowed users</MenuLink>
        <MenuLink href="/integrations" onNavigate={close} icon={<Plug size={14} className="block" />}>Integrations</MenuLink>
        <div className="-mx-1.5 my-1 h-px bg-border" />
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="mb-1.5 text-[12px] text-muted-foreground">Theme</div>
          <Segmented size="sm" value={theme} onChange={setTheme} options={THEME_OPTIONS} aria-label="Theme"
            className="flex w-full [&>button]:flex-1 [&>button]:gap-[5px] [&>button]:text-[12px]" />
        </div>
        <div className="-mx-1.5 my-1 h-px bg-border" />
        <button type="button" onClick={() => { close(); void signOut({ callbackUrl: "/login" }); }}
          className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[7px] border-none bg-transparent px-2.5 text-left text-[13px] text-danger hover:bg-hover">
          <LogOut size={14} className="block" />Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function AppSidebar({ collapsed, mobile, drawer, onCloseDrawer }: { collapsed: boolean; mobile: boolean; drawer: boolean; onCloseDrawer: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const expanded = !collapsed;
  const { data: summary } = useSummary();
  const cronMin = ageMinutes(summary?.ops.cronLastAt);
  const cronStale = cronMin == null || cronMin > 36 * 60;

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col gap-2.5 overflow-hidden px-2.5 py-3 transition-[width,transform] duration-200 ease-in-out",
        mobile ? "fixed left-0 top-0 z-[70] w-[272px] border-0 border-r border-solid border-border bg-shell" : "relative",
        mobile && (drawer ? "shadow-[0_24px_64px_rgba(0,0,0,.4)]" : "-translate-x-[105%]"),
        !mobile && (collapsed ? "w-[60px]" : "w-[252px]"),
      )}
    >
      <div className="flex min-h-[44px] items-center gap-2.5 px-1 pb-2 pt-1">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-solid border-border bg-card text-brand"><NatashaMark /></div>
        {expanded && (
          <div className="min-w-0 flex-1 leading-[1.25]">
            <div className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">Natasha</div>
            <div className="whitespace-nowrap text-[12px] text-muted-foreground">Infra Command Center</div>
          </div>
        )}
        {mobile && (
          <button type="button" onClick={onCloseDrawer} title="Close menu" className="inline-grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[8px] border-none bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground">
            <X size={16} className="block" />
          </button>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden scrollbar-none">
        {NAV.map((g) => (
          <div key={g.group} className="flex flex-col gap-px">
            {expanded && <div className="px-2.5 pb-1.5 text-[11.5px] font-medium text-subtle">{g.group}</div>}
            {g.items.map((it) => {
              const on = isActive(path, it.href);
              const Icon = it.icon;
              return (
                <Link key={it.href} href={it.href} title={it.label} onClick={onCloseDrawer}
                  className={cn(
                    "flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13.5px] no-underline hover:bg-hover hover:text-foreground",
                    on ? "bg-active font-medium text-foreground" : "font-normal text-fg-2",
                  )}>
                  <Icon size={16} className="block shrink-0" />
                  {expanded && <span className="min-w-0 flex-1 truncate">{it.label}</span>}
                  {expanded && it.danger && <AlertsBadge />}
                  {expanded && it.badge && (
                    <span className="rounded-full bg-card-2 px-[7px] py-px text-[11px] font-semibold text-muted-foreground tnum">{it.badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {expanded && (
        <button type="button" onClick={() => { onCloseDrawer(); router.push("/cron"); }}
          className="flex cursor-pointer flex-col gap-[3px] rounded-[10px] border border-solid border-border bg-card px-3 py-2.5 text-left text-foreground hover:border-border-strong">
          <span className="flex items-center gap-[7px] text-[12.5px] font-medium">
            <span className={cn("h-1.5 w-1.5 rounded-[6px]", cronStale ? "bg-warning" : "bg-success")} />
            {summary ? `Cron ran ${ago(summary.ops.cronLastAt)}` : "Cron status…"}
          </span>
          <span className="text-[12px] text-muted-foreground">AWS · Prometheus · CloudWatch · ELK</span>
        </button>
      )}
      <UserMenu expanded={expanded} />
    </aside>
  );
}

function AlertsBadge() {
  const count = useCritCount();
  if (!count) return null;
  return (
    <span className="rounded-full px-[7px] py-px text-[11px] font-semibold text-danger tnum" style={{ background: tint("var(--danger)") }}>{count}</span>
  );
}

function useCritCount(): number {
  const { data } = useJson<{ bySeverity?: { CRIT?: number } }>("/api/incidents");
  return data?.bySeverity?.CRIT ?? 0;
}
