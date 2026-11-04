"use client";
import { Eye } from "lucide-react";
import type { InspectPayload } from "./InspectorDrawer";

/** One-line dispatch button that opens the global Inspector drawer for a resource. */
export default function InspectButton({ payload, label = "Inspect" }: { payload: InspectPayload; label?: string }) {
  function open() {
    window.dispatchEvent(new CustomEvent<InspectPayload>("natasha:inspect", { detail: payload }));
  }
  return (
    <button
      className="btn-ghost btn-inspect"
      onClick={open}
      title={`Inspect ${payload.id}`}
      aria-label={`Inspect ${payload.id}`}
    >
      <Eye size={13} /> {label}
    </button>
  );
}
