"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { money } from "./format";

/**
 * Right-side detail drawer — opens when a row's "Inspect" button dispatches
 * a custom event with the resource info.
 */
export interface InspectPayload {
  kind: "ec2" | "lambda" | "sns" | "repo" | "service";
  id: string;
  label?: string;
  region?: string;
  tag?: string;
  cost14d?: number;
  href?: string;
  meta?: Record<string, string | number | null | undefined>;
}

export default function InspectorDrawer() {
  const [payload, setPayload] = useState<InspectPayload | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  // Open/close listeners
  useEffect(() => {
    function onOpen(e: Event) {
      const ce = e as CustomEvent<InspectPayload>;
      lastActiveRef.current = document.activeElement as HTMLElement | null;
      setPayload(ce.detail);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPayload(null);
    }
    window.addEventListener("natasha:inspect", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("natasha:inspect", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Reset scroll + focus when payload changes
  useEffect(() => {
    if (payload && drawerRef.current) {
      drawerRef.current.scrollTop = 0;
      const focusable = drawerRef.current.querySelector<HTMLElement>("button, [href], input, select, textarea");
      focusable?.focus();
    }
    if (!payload && lastActiveRef.current) {
      // Restore focus when drawer closes
      lastActiveRef.current.focus();
    }
  }, [payload]);

  // Focus trap while drawer is open
  useEffect(() => {
    if (!payload) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hidden && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payload]);

  if (!payload) return null;

  const metaRows = Object.entries(payload.meta ?? {}).filter(([, v]) => v != null && v !== "");

  return (
    <>
      <div className="drawer-scrim" onClick={() => setPayload(null)} aria-hidden />
      <aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-label="Inspector">
        <header className="drawer-head">
          <div className="drawer-head-text">
            <div className="drawer-kind">{payload.kind.toUpperCase()}</div>
            <div className="drawer-id mono">{payload.id}</div>
            {payload.label && <div className="drawer-label">{payload.label}</div>}
          </div>
          <button className="drawer-close" onClick={() => setPayload(null)} aria-label="Close inspector">
            <X size={18} />
          </button>
        </header>

        <section className="drawer-section">
          <div className="drawer-grid">
            {payload.region && (
              <div className="drawer-cell">
                <span className="drawer-cell-label">Region</span>
                <span className="drawer-cell-val mono">{payload.region}</span>
              </div>
            )}
            {payload.tag && (
              <div className="drawer-cell">
                <span className="drawer-cell-label">Category</span>
                <span className="drawer-cell-val">{payload.tag}</span>
              </div>
            )}
            {typeof payload.cost14d === "number" && (
              <div className="drawer-cell">
                <span className="drawer-cell-label">14-day cost</span>
                <span className="drawer-cell-val tab-num">{money(payload.cost14d)}</span>
              </div>
            )}
          </div>
        </section>

        {metaRows.length > 0 && (
          <section className="drawer-section">
            <h3 className="drawer-section-title">Details</h3>
            <ul className="drawer-meta">
              {metaRows.map(([k, v]) => (
                <li key={k}>
                  <span className="drawer-meta-k">{k}</span>
                  <span className="drawer-meta-v">{String(v)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {payload.href && (
          <Link className="btn-ghost drawer-open" href={payload.href} onClick={() => setPayload(null)}>
            Open full page <ExternalLink size={13} />
          </Link>
        )}
      </aside>
    </>
  );
}
