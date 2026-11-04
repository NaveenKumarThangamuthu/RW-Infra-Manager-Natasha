"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard, AlertOctagon, ShieldCheck, Server, Receipt, Sparkle, Newspaper,
  Mail, Shuffle, Globe, Sprout, Lightbulb,
  Settings as SettingsIcon, Plug, Layers, KeyRound, LogOut, MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

interface Item { href: string; label: string; Icon: LucideIcon }

const PRIMARY: Item[] = [
  { href: "/", label: "Home", Icon: LayoutDashboard },
  { href: "/ec2", label: "Servers", Icon: Server },
  { href: "/perf/spring", label: "Spring", Icon: Sprout },
  { href: "/security", label: "Repos", Icon: ShieldCheck },
];

const SECTIONS: Array<{ title: string; items: Item[] }> = [
  {
    title: "Overview",
    items: [
      { href: "/brief", label: "Daily Brief", Icon: Newspaper },
      { href: "/tag", label: "Categories", Icon: Layers },
    ],
  },
  {
    title: "AWS Ops",
    items: [
      { href: "/bill", label: "Billing", Icon: Receipt },
      { href: "/lambda", label: "Lambda", Icon: Sparkle },
      { href: "/sns", label: "SNS", Icon: Mail },
      { href: "/data-transfer", label: "Data Transfer", Icon: Shuffle },
      { href: "/regions", label: "Regions", Icon: Globe },
    ],
  },
  {
    title: "Performance",
    items: [
      { href: "/incidents", label: "Incidents", Icon: AlertOctagon },
      { href: "/perf/recommendations", label: "Recommendations", Icon: Lightbulb },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/settings", label: "Settings", Icon: SettingsIcon },
      { href: "/integrations", label: "Integrations", Icon: Plug },
      { href: "/account", label: "Reset password", Icon: KeyRound },
    ],
  },
];

const SHEET_ITEMS = SECTIONS.flatMap((s) => s.items);

export default function MobileNav() {
  const path = usePathname();
  const { data } = useSession();
  const [open, setOpen] = useState(false);

  const isActive = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  const moreActive = SHEET_ITEMS.some((m) => isActive(m.href));
  const email = data?.user?.email ?? "";

  return (
    <>
      {open && <div className="m-sheet-backdrop" onClick={() => setOpen(false)} />}

      <div className={`m-sheet ${open ? "open" : ""}`} role="dialog" aria-hidden={!open}>
        <div className="m-sheet-handle" />
        <div className="m-sheet-user">{email}</div>
        {SECTIONS.map((section) => (
          <div key={section.title} className="m-sheet-section">
            <div className="m-sheet-section-title">{section.title}</div>
            {section.items.map((m) => {
              const Icon = m.Icon;
              return (
                <Link key={m.href} href={m.href} className={`m-sheet-link ${isActive(m.href) ? "active" : ""}`} onClick={() => setOpen(false)}>
                  <span className="ico"><Icon size={16} strokeWidth={1.75} /></span>
                  {m.label}
                </Link>
              );
            })}
          </div>
        ))}
        <button className="m-sheet-link signout" onClick={() => signOut({ callbackUrl: "/login" })}>
          <span className="ico"><LogOut size={16} strokeWidth={1.75} /></span>
          Sign out
        </button>
      </div>

      <nav className="m-bottomnav">
        {PRIMARY.map((it) => {
          const Icon = it.Icon;
          return (
            <Link key={it.href} href={it.href} className={`m-tab ${isActive(it.href) ? "active" : ""}`}>
              <span className="m-tab-ico"><Icon size={18} strokeWidth={1.75} /></span>
              <span className="m-tab-label">{it.label}</span>
            </Link>
          );
        })}
        <button className={`m-tab ${open || moreActive ? "active" : ""}`} onClick={() => setOpen((o) => !o)}>
          <span className="m-tab-ico"><MoreHorizontal size={18} strokeWidth={1.75} /></span>
          <span className="m-tab-label">More</span>
        </button>
      </nav>
    </>
  );
}
