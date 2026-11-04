"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";

function monthOptions(n = 12): { key: string; label: string }[] {
  const now = new Date();
  const opts: { key: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label =
      d.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) +
      (i === 0 ? " (current)" : i === 1 ? " (last month)" : "");
    opts.push({ key, label });
  }
  return opts;
}

export default function MonthPicker() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const opts = monthOptions(12);
  const current = sp.get("month") ?? opts[0].key;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set("month", e.target.value);
    router.push(`${path}?${params.toString()}`);
  }

  return (
    <div className="monthpicker">
      <label htmlFor="month"><Calendar size={12} className="ico-inline" />Billing month</label>
      <select id="month" value={current} onChange={onChange}>
        {opts.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
