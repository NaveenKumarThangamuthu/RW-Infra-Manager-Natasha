"use client";
import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";

const KEY = "natasha-density";
type Density = "comfortable" | "compact";

/**
 * Persists "comfortable" or "compact" to localStorage and toggles a body class
 * (`density-compact`). CSS hooks into that class to tighten paddings/heights.
 */
export default function DensityToggle() {
  const [d, setD] = useState<Density>("comfortable");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && (localStorage.getItem(KEY) as Density)) || "comfortable";
    setD(stored);
    document.body.classList.toggle("density-compact", stored === "compact");
  }, []);

  function toggle() {
    const next: Density = d === "compact" ? "comfortable" : "compact";
    setD(next);
    if (typeof window !== "undefined") localStorage.setItem(KEY, next);
    document.body.classList.toggle("density-compact", next === "compact");
  }

  return (
    <button
      className="density-toggle"
      onClick={toggle}
      aria-label={`Switch to ${d === "compact" ? "comfortable" : "compact"} density`}
      title={`Density: ${d} — click to toggle`}
    >
      {d === "compact" ? <Rows3 size={14} /> : <LayoutGrid size={14} />}
      <span className="dt-label-text">{d === "compact" ? "Compact" : "Comfortable"}</span>
    </button>
  );
}
