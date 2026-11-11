"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command as Cmdk } from "cmdk";
import { Download, Moon, PanelLeft, RefreshCw, Search, Sprout, Sun, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { num } from "@/components/natasha/format";
import { NAV } from "./nav";
import { useShell } from "./ShellContext";

interface SpringLogStat { service: string; errors: number }

const ITEM = "flex h-[38px] cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] text-foreground data-[selected=true]:bg-active";
const GROUP = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

function Row({ icon: Icon, label, hint, onSelect }: { icon: LucideIcon; label: string; hint?: string; onSelect: () => void }) {
  return (
    <Cmdk.Item value={label} onSelect={onSelect} className={ITEM}>
      <span className="text-muted-foreground"><Icon size={14} className="block" /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="text-[12px] text-muted-foreground tnum">{hint}</span>}
    </Cmdk.Item>
  );
}

export function CommandMenu({ collapsed, onToggleSidebar, onExportPdf }: { collapsed: boolean; onToggleSidebar: () => void; onExportPdf?: () => void }) {
  const router = useRouter();
  const { cmdOpen, setCmdOpen, resolvedTheme, setTheme, refresh } = useShell();
  const [q, setQ] = useState("");
  const [services, setServices] = useState<SpringLogStat[]>([]);

  useEffect(() => {
    if (!cmdOpen) { setQ(""); return; }
    if (services.length) return;
    fetch("/api/perf/spring/logs?window=1h").then((r) => (r.ok ? r.json() : null)).then((j: { services?: SpringLogStat[] } | null) => {
      setServices((j?.services ?? []).filter((s) => s.errors > 0).sort((a, b) => b.errors - a.errors));
    }).catch(() => { /* the palette still works without service shortcuts */ });
  }, [cmdOpen, services.length]);

  const run = (fn: () => void) => { setCmdOpen(false); fn(); };
  const go = (href: string) => run(() => router.push(href));

  return (
    <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
      <DialogContent>
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Cmdk label="Command menu" loop>
          <div className="flex h-[52px] items-center gap-2.5 border-0 border-b border-solid border-border px-4 text-muted-foreground">
            <Search size={16} className="block shrink-0" />
            <Cmdk.Input value={q} onValueChange={setQ} placeholder="Type a command or search…" className="h-full flex-1 border-none bg-transparent text-[14.5px] text-foreground outline-none" />
            <kbd className="rounded-[5px] border border-solid border-border bg-card-2 px-1.5 py-px font-mono text-[11px] text-muted-foreground">esc</kbd>
          </div>
          <Cmdk.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            <Cmdk.Empty className="p-7 text-center text-[13px] text-muted-foreground">No results for “{q}”.</Cmdk.Empty>
            <Cmdk.Group heading="Go to" className={GROUP}>
              {NAV.flatMap((g) => g.items).map((it) => <Row key={it.href} icon={it.icon} label={it.title ?? it.label} onSelect={() => go(it.href)} />)}
            </Cmdk.Group>
            <Cmdk.Group heading="Actions" className={GROUP}>
              <Row icon={resolvedTheme === "dark" ? Sun : Moon} label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))} />
              <Row icon={RefreshCw} label="Refresh all sources" onSelect={() => run(() => void refresh())} />
              {onExportPdf && <Row icon={Download} label="Export dashboard as PDF" onSelect={() => run(onExportPdf)} />}
              <Row icon={PanelLeft} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} hint="Ctrl B" onSelect={() => run(onToggleSidebar)} />
            </Cmdk.Group>
            {services.length > 0 && (
              <Cmdk.Group heading="Spring services" className={GROUP}>
                {(q ? services : services.slice(0, 3)).map((s) => (
                  <Row key={s.service} icon={Sprout} label={s.service} hint={`${num(s.errors)} errors`} onSelect={() => go(`/perf/spring?q=${encodeURIComponent(s.service)}`)} />
                ))}
              </Cmdk.Group>
            )}
          </Cmdk.List>
          <div className="flex items-center gap-3.5 border-0 border-t border-solid border-border px-4 py-2.5 text-[12px] text-muted-foreground">
            <span>↑ ↓ to navigate</span><span>↵ to select</span><span className="ml-auto">Natasha</span>
          </div>
        </Cmdk>
      </DialogContent>
    </Dialog>
  );
}
