"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import MobileTopBar from "./MobileTopBar";
import MobileNav from "./MobileNav";
import StatusStrip from "./StatusStrip";
import CommandPalette from "./CommandPalette";
import InspectorDrawer from "./InspectorDrawer";

/**
 * App chrome. The /login screen renders bare. Every other route gets:
 *  - desktop: sidebar + top bar + always-visible operational status strip footer
 *  - mobile:  a compact app bar + a bottom tab nav (toggled purely by CSS)
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  if (path === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="content">
        <MobileTopBar />
        <TopBar />
        {children}
        <StatusStrip />
      </main>
      <MobileNav />
      <CommandPalette />
      <InspectorDrawer />
    </div>
  );
}
