export function money(amount: number | null | undefined, unit = "USD"): string {
  const symbol = unit === "USD" ? "$" : "";
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `${symbol}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${unit && unit !== "USD" ? " " + unit : ""}`;
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}
