import {
  Bug, Clock, Database, FileKey, Globe, Layers, LayoutDashboard, Mail, OctagonAlert, Plug, Radio, Receipt,
  Server, Settings2, ShieldAlert, ShieldCheck, Shuffle, Sparkle, Sprout, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; title?: string; icon: LucideIcon; badge?: string; danger?: boolean }
export interface NavGroup { group: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { group: "Overview", items: [
    { href: "/", label: "Home", title: "Dashboard", icon: LayoutDashboard },
    { href: "/incidents", label: "Alerts & Actions", icon: OctagonAlert, danger: true },
  ] },
  { group: "Cost", items: [
    { href: "/bill", label: "Billing", icon: Receipt },
    { href: "/tag", label: "Categories", icon: Layers, badge: "60" },
    { href: "/data-transfer", label: "Data Transfer", icon: Shuffle },
    { href: "/regions", label: "Regions", icon: Globe },
  ] },
  { group: "Compute", items: [
    { href: "/ec2", label: "Servers", title: "EC2 servers", icon: Server },
    { href: "/perf/spring", label: "Spring", title: "Spring Services", icon: Sprout },
    { href: "/lambda", label: "Lambda", icon: Sparkle },
    { href: "/rds", label: "Databases", icon: Database },
    { href: "/sns", label: "SNS", icon: Mail },
    { href: "/openas2", label: "OpenAS2 · EDI", icon: Radio },
  ] },
  { group: "Security", items: [
    { href: "/security", label: "Repositories", icon: ShieldCheck },
    { href: "/sonar", label: "Sonar Quality", icon: Bug },
    { href: "/certificates", label: "Certificates", icon: FileKey },
    { href: "/security-groups", label: "Security Groups", icon: ShieldAlert },
  ] },
  { group: "Workspace", items: [
    { href: "/cron", label: "Cron jobs", icon: Clock },
    { href: "/integrations", label: "Integrations", icon: Plug },
    { href: "/settings", label: "Settings", icon: Settings2 },
  ] },
];

export function isActive(path: string, href: string): boolean {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function pageTitle(path: string): string {
  for (const g of NAV) for (const it of g.items) if (isActive(path, it.href)) return it.title ?? it.label;
  if (path.startsWith("/perf/")) return "Performance";
  if (path.startsWith("/account")) return "Account";
  if (path.startsWith("/brief")) return "Daily brief";
  return "Natasha";
}
