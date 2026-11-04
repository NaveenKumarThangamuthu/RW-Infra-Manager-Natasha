/**
 * Per-tag monthly budgets — env-driven, no schema change.
 *
 * Set TAG_BUDGETS_JSON in /tmp/srv.env, e.g.
 *   TAG_BUDGETS_JSON='{"2.0": 800, "3.0": 600, "Infra": 300, "Dev": 150}'
 *
 * Anything not in the map gets `null` (no budget set). The dashboard renders
 * a "Budget" KPI + projected-vs-budget Δ when set.
 */

let cache: Record<string, number> | null = null;
let parsedAt = 0;

function parse(): Record<string, number> {
  // Re-read once per process start; cheap.
  if (cache && Date.now() - parsedAt < 60_000) return cache;
  const raw = process.env.TAG_BUDGETS_JSON;
  if (!raw) { cache = {}; parsedAt = Date.now(); return cache; }
  try {
    const obj = JSON.parse(raw);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    cache = out;
    parsedAt = Date.now();
    return cache;
  } catch {
    cache = {};
    parsedAt = Date.now();
    return cache;
  }
}

export function budgetFor(category: string): number | null {
  const map = parse();
  return Object.prototype.hasOwnProperty.call(map, category) ? map[category] : null;
}

export function budgetStatus(
  currentMtd: number,
  budget: number | null,
  dayOfMonth: number,
  daysInMonth: number,
): { projection: number; budget: number | null; pctConsumed: number | null; status: "ok" | "warn" | "over" | "unset"; deltaPctVsBudget: number | null } {
  const projection = dayOfMonth > 0 ? +(currentMtd * (daysInMonth / dayOfMonth)).toFixed(2) : currentMtd;
  if (budget == null) {
    return { projection, budget: null, pctConsumed: null, status: "unset", deltaPctVsBudget: null };
  }
  const pctConsumed = budget > 0 ? +((currentMtd / budget) * 100).toFixed(1) : 0;
  const monthFraction = daysInMonth > 0 ? dayOfMonth / daysInMonth : 1;
  let status: "ok" | "warn" | "over" = "ok";
  if (projection > budget) status = "over";
  else if (pctConsumed > monthFraction * 100 + 15) status = "warn";
  const deltaPctVsBudget = budget > 0 ? +(((projection - budget) / budget) * 100).toFixed(1) : null;
  return { projection, budget, pctConsumed, status, deltaPctVsBudget };
}
