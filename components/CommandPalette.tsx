"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Receipt, Server, HardDrive, Sparkle, Mail, Globe,
  Sprout, Lightbulb, ShieldCheck, AlertOctagon, Tag, RefreshCw,
} from "lucide-react";

/**
 * Cmd/Ctrl-K command palette. Pure-React, no kbar dep.
 */

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  Icon: typeof LayoutDashboard;
  run: (router: ReturnType<typeof useRouter>) => void;
}

const CMDS: Cmd[] = [
  { id: "go-home", label: "Go to Dashboard", Icon: LayoutDashboard, run: (r) => r.push("/") },
  { id: "go-bill", label: "Open Billing Summary", Icon: Receipt, run: (r) => r.push("/bill") },
  { id: "go-ec2", label: "Open EC2", Icon: Server, run: (r) => r.push("/ec2") },
  { id: "go-vol", label: "Open Volumes", Icon: HardDrive, run: (r) => r.push("/perf/volumes") },
  { id: "go-lambda", label: "Open Lambda Functions", Icon: Sparkle, run: (r) => r.push("/lambda") },
  { id: "go-sns", label: "Open SNS Topics", Icon: Mail, run: (r) => r.push("/sns") },
  { id: "go-regions", label: "Open Regions", Icon: Globe, run: (r) => r.push("/regions") },
  { id: "go-spring", label: "Open Spring Services", Icon: Sprout, run: (r) => r.push("/perf/spring") },
  { id: "go-recs", label: "Open Recommendations", Icon: Lightbulb, run: (r) => r.push("/perf/recommendations") },
  { id: "go-sec", label: "Open Repositories (Security)", Icon: ShieldCheck, run: (r) => r.push("/security") },
  { id: "go-incidents", label: "Open Incidents", Icon: AlertOctagon, run: (r) => r.push("/incidents") },
  { id: "go-tag-20", label: "View 2.0 servers", keywords: ["tag", "category"], Icon: Tag, run: (r) => r.push("/tag/2.0") },
  { id: "go-tag-30", label: "View 3.0 servers", keywords: ["tag", "category"], Icon: Tag, run: (r) => r.push("/tag/3.0") },
  { id: "go-tag-infra", label: "View Infra category", keywords: ["tag"], Icon: Tag, run: (r) => r.push("/tag/Infra") },
  { id: "go-tag-dev", label: "View Dev category", keywords: ["tag"], Icon: Tag, run: (r) => r.push("/tag/Dev") },
  { id: "go-tag-shared", label: "View Shared category", keywords: ["tag"], Icon: Tag, run: (r) => r.push("/tag/Shared") },
  {
    id: "refresh-snapshots",
    label: "Refresh all snapshots now",
    hint: "Triggers /api/refresh/snapshot",
    keywords: ["snapshot", "refresh"],
    Icon: RefreshCw,
    run: () => {
      fetch("/api/refresh/snapshot", { method: "POST", body: JSON.stringify({ source: "all" }), headers: { "content-type": "application/json" } })
        .then(() => alert("Snapshot refresh queued."));
    },
  },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      if (metaOrCtrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) lastActiveRef.current = document.activeElement as HTMLElement | null;
          return !v;
        });
        return;
      }
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else if (lastActiveRef.current) {
      lastActiveRef.current.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return CMDS;
    return CMDS.filter((c) =>
      c.label.toLowerCase().includes(needle) ||
      (c.keywords ?? []).some((k) => k.toLowerCase().includes(needle))
    );
  }, [q]);

  function onSelect(c: Cmd) {
    setOpen(false);
    c.run(router);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[active];
      if (c) onSelect(c);
    } else if (e.key === "Tab") {
      // Focus stays trapped inside the input — palette has nowhere else to tab.
      e.preventDefault();
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="cmdk-scrim" onClick={() => setOpen(false)} aria-hidden />
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" aria-describedby="cmdk-help">
        <div className="cmdk-input-wrap">
          <Search size={16} className="cmdk-search-ico" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or page name…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            aria-label="Search commands"
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        <ul className="cmdk-list" role="listbox">
          {filtered.map((c, i) => {
            const Icon = c.Icon;
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                className={`cmdk-item ${i === active ? "cmdk-active" : ""}`}
                onClick={() => onSelect(c)}
              >
                <Icon size={15} className="cmdk-item-ico" />
                <span className="cmdk-item-label">{c.label}</span>
                {c.hint && <span className="cmdk-item-hint muted">{c.hint}</span>}
              </li>
            );
          })}
          {filtered.length === 0 && <li className="cmdk-empty">No match.</li>}
        </ul>
        <div id="cmdk-help" className="cmdk-foot muted small">
          <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
        </div>
      </div>
    </>
  );
}
