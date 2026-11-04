"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import NatashaLogo from "./NatashaLogo";
import {
  LayoutDashboard, Receipt, Server, Sparkle, Mail, Shuffle, Globe, Layers,
  Sprout, AlertOctagon, Lightbulb, ShieldCheck, FileKey, ShieldAlert,
  Settings, Plug, Newspaper, Gauge, PanelLeftClose, PanelLeftOpen, Radio, Bug,
  Database,
  type LucideIcon,
} from "lucide-react";

interface NavItem { href: string; label: string; Icon: LucideIcon; badge?: string }

const ITEMS: NavItem[] = [
  { href: "/", label: "Home", Icon: LayoutDashboard },
  { href: "/bill", label: "Billing", Icon: Receipt },
  { href: "/ec2", label: "Servers", Icon: Server },
  { href: "/lambda", label: "Lambda", Icon: Sparkle },
  { href: "/rds", label: "Databases", Icon: Database },
  { href: "/sns", label: "SNS", Icon: Mail },
  { href: "/data-transfer", label: "Data Transfer", Icon: Shuffle },
  { href: "/regions", label: "Regions", Icon: Globe },
  { href: "/tag", label: "Categories", Icon: Layers, badge: "60" },
  { href: "/perf/spring", label: "Spring", Icon: Sprout },
  { href: "/openas2", label: "OpenAS2 · EDI", Icon: Radio },
  { href: "/incidents", label: "Alerts & Actions", Icon: AlertOctagon },
  { href: "/security", label: "Repositories", Icon: ShieldCheck },
  { href: "/sonar", label: "Sonar Quality", Icon: Bug },
  { href: "/certificates", label: "Certificates", Icon: FileKey },
  { href: "/security-groups", label: "Security Groups", Icon: ShieldAlert },
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/integrations", label: "Integrations", Icon: Plug },
];

const STORAGE_KEY = "natasha-sidebar-collapsed";

export default function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage on mount so state persists across reloads.
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  // Toggle a body class so the app-shell grid can respond to the collapsed width.
  useEffect(() => {
    if (!mounted) return;
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed, mounted]);

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`} data-collapsed={collapsed ? "1" : "0"}>
      <div className="brand" title={collapsed ? "Natasha · Infra Command Center" : undefined}>
        <NatashaLogo size={28} />
        <div className="brand-text">
          <span className="brand-name">Natasha</span>
          <span className="brand-sub">Infra Command Center</span>
        </div>
      </div>

      <nav>
        <div className="nav-section">
          {ITEMS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            const Icon = l.Icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-link ${active ? "active" : ""}`}
                title={collapsed ? (l.badge ? `${l.label} (${l.badge})` : l.label) : undefined}
                aria-label={l.label}
              >
                <span className="ico">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="nav-label">{l.label}</span>
                {l.badge ? <span className="nav-badge">{l.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      </nav>

      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
      >
        {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
        <span className="sidebar-collapse-label">Collapse</span>
      </button>

      <div className="foot">
        <div className="foot-line">⚡ AWS · Prometheus · CloudWatch · ELK</div>
        <div className="foot-line muted-soft">Powered by Fable · claude-fable-5</div>
      </div>
    </aside>
  );
}
