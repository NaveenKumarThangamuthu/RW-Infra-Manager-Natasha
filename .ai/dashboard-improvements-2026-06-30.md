# Natasha Infra Manager — Dashboard analysis & improvement plan

Date: 2026-06-30
Author: Natasha (analysis from current codebase)
Scope: UI/UX, information architecture, analytical depth, polish for a "professional" feel

---

## 1. What's working today

| Strength | Where | Why it matters |
|---|---|---|
| Premium dark palette (midnight + indigo-violet, radial glows) | `app/globals.css:1-20` | Already on-brand; no full re-skin needed |
| Health Pulse banner (good / warn / crit cascading from real signals) | `components/InfraOverviewTiles.tsx:40-67` | Best component in the app — extend the pattern |
| Snapshot-cached pages (DB-backed, no live AWS calls on render) | `lib/dataSnapshot.ts`, `prisma.DataSnapshot` | Pages are fast; refresh is explicit |
| Tag-driven cost split (2.0 / 3.0 / Infra / Dev / Shared) | `components/Dashboard.tsx:54-70`, `server_tag` table | Business categorization — competitive differentiator |
| Read-only badge + clear "no writes to AWS" posture | `components/Sidebar.tsx:55` | Builds trust with execs/auditors |
| KPI row (MTD / Forecast / Last 7d / Avg/day) | `components/Dashboard.tsx:123-140` | FinOps-correct framing |
| `Ec2ItemizedSnapshot` DB fallback + `RefreshRun` audit trail | `prisma/schema.prisma` | Production-grade resilience |

## 2. What's holding the dashboard back

### A. Visualizations are primitive — they cap how much analysis is possible

- **Daily-spend chart is CSS `<div>` bars** (`Dashboard.tsx:159-167`, `globals.css:92-97`). No axes, no values on hover, no anomaly markers, no period overlay. You can see "tall vs short" — nothing else.
- **DonutChart (88 LOC)** and **LineChart (136 LOC)** are hand-rolled SVG. No interactive legend, no zoom, no comparison mode, no export. Polish ceiling is low.
- **Top-services / Top-regions tables** use a CSS `<Bar>` (`OverviewTab.tsx:55-61`). No sort, no drill-down, no Δ-vs-last-month column.

### B. Single-period views — no comparisons, no anomalies

- MTD is shown, never **vs last month**.
- Forecast is shown, never **vs forecast accuracy last month**.
- Tag split is "now" only — no trend ribbon by category.
- No anomaly surfacing — `ResourceDailyCost` has all the data to flag "EC2 i-0abc jumped 3.4× vs 14d median" and nothing exposes it.

### C. Information architecture leaks

- Sidebar has 13 items but **no global search**, no breadcrumbs, no recent-views.
- 8 snapshot sources but their freshness is buried in `SnapshotBanner`/tile foot — should live in a global status strip.
- Incidents page is linked from the top of the sidebar but doesn't thread back to **which service / which tag / which cost line item** caused it.
- `/perf/recommendations` exists but isn't surfaced on the home dashboard — the most actionable page is invisible.

### D. Tags are powerful but underused

`server_tag` drives one donut. It should drive:
- A **per-tag landing page** (`/tag/3.0`): spend, projection, top instances, MoM trend, incidents touching that tag, security findings on repos owned by that team.
- Sidebar "Categories" section: clickable 2.0 / 3.0 / Infra / Dev / Shared.
- KPI cards repeated per tag on hover.
- Cost anomaly feed scoped by tag.

This is the single highest-leverage change because the data already exists.

### E. Polish gaps that cost the "professional" feeling

| Issue | Fix |
|---|---|
| Emoji icons in sidebar (🚨 🖥 λ ✉ 🔀) | Replace with Lucide-react (~5KB, uniform stroke, accessible) |
| 1180px content max-width caps the dashboard on 27" monitors | Lift to 1440 + comfortable gutters; add density toggle |
| No keyboard shortcuts (`g d` → dashboard, `/` → search) | 1-day add via `kbar` or a small `useHotkeys` |
| Tables: no sticky header, no column resize, no CSV export | Use TanStack Table; CSV via a 30-line helper |
| Active nav state = blue background pill | Lift idea from Linear/Vercel: 2px left border + accent text, less heavy |
| No tabular figures on numbers in some places | `font-variant-numeric: tabular-nums` site-wide on `.num` |
| `RefreshButton` has spinner but no progress for 8-source cron | Show per-source ticks ("spring-health ✓ 240ms, ec2-health …") |
| Mobile sidebar reflows oddly at 760px | `MobileNav.tsx` already exists; switch fully at md, not let sidebar wrap |

### F. Operational ergonomics

- Filters don't survive navigation — there's `MonthPicker` but no URL-state for region, tag, service.
- No "share this view" URL.
- No saved views ("My weekly review", "EC2 only").
- No exports — neither table CSV nor dashboard PDF.

---

## 3. Concrete recommendations, ranked by ROI

> ROI = analytical lift × polish lift ÷ engineering days

### Tier 1 — biggest analytical lift per day

1. **Swap custom charts for Recharts (or ECharts)** — donuts, lines, bars get hover tooltips, axis labels, comparison overlays, anomaly markers for free. **Est. 2 days.** Single biggest visual upgrade.
2. **Add Δ-vs-prev-period everywhere** — KPI cards (`"$1,243 ⬆ +12% vs last month"`), top-services column, donut secondary ring. **Est. 1 day.** Trivial code, huge analytical lift.
3. **Cost-anomaly feed on the home dashboard** — z-score per `(service, resource)` over 14-day baseline using existing `ResourceDailyCost`; surface top 5 outliers with a 1-click "investigate". **Est. 2 days.** Turns the dashboard from passive to actionable. The killer FinOps feature.
4. **Promote `/perf/recommendations` to the home** — top-3 tile: "Right-size 4 EC2 instances → save $182/mo". Already wired, just surface it. **Est. 0.5 day.**

### Tier 2 — biggest "feels like a tool" lift

5. **Tag as a first-class navigation primitive** — per-tag landing pages, sidebar Categories section, tag filter that flows through every view via URL state. **Est. 3 days.** Unlocks executive-friendly views ("show me 3.0 spend").
6. **Inspector drawer** — clicking any resource opens a right-side drawer: cost timeline, CloudWatch metrics, alarms, scan findings, tags, owner — without losing dashboard context. **Est. 3 days.** Linear/Asana pattern.
7. **URL-state for all filters** (period, region, tag, service) — shareable deep links, persistent across navigation. **Est. 1 day.** `useSearchParams` + a tiny `useFilter` hook.
8. **Operational status strip** (always-visible footer) — cron last/next run, 8 snapshot ages, AWS session state. **Est. 0.5 day.**

### Tier 3 — polish that compounds into "professional"

9. **Lucide-react icon set** replacing all emoji in sidebar/tiles. **Est. 0.5 day.**
10. **Lift max-width to 1440** + density toggle (comfortable/compact) saved to user pref. **Est. 0.5 day.**
11. **Sticky table headers + CSV export button** (one helper, reused). **Est. 1 day.**
12. **Tabular nums site-wide** on all numeric columns; Inter Display for h1/h2. **Est. 0.5 day.**
13. **Keyboard nav** — `kbar`-style command palette, `g d` shortcuts, `/` focus search. **Est. 1 day.**
14. **Forecast accuracy widget** — "Last month forecast vs actual: +3%". Builds trust. **Est. 0.5 day.**
15. **Micro-animations on tile hover** (translateY -1px + shadow lift). **Est. 0.5 day.**
16. **Dashboard → PDF export** for monthly reviews (Playwright already in devDeps). **Est. 1 day.**

---

## 4. Suggested 3-week phased plan

| Phase | Days | What ships | Why this order |
|---|---|---|---|
| **Phase 1 — Analytical lift** | 5 | Recharts swap, Δ-vs-prev, anomaly feed, recommendations on home | Maximum analysis-per-screen jump first |
| **Phase 2 — Tag as first-class** | 5 | Per-tag pages, sidebar Categories, URL-state filters, Inspector drawer | Turns it into a "tool", not a "report" |
| **Phase 3 — Polish** | 4 | Icons, density, status strip, sticky tables/CSV, command palette, PDF export | Removes the remaining "looks personal" signals |

---

## 5. Quick wins shippable today (under 3 hours total)

- Replace emoji in sidebar with Lucide icons → +polish, no risk
- `font-variant-numeric: tabular-nums` on `.num`, `.tab-num`, `.value`, `.metric-val` → numbers line up
- Lift `.container`/`.content` max-width 1180 → 1440 → reclaims 25% screen on big monitors
- Add `aria-label` + `title` on the CSS bars in the daily-spend chart → users can hover to read values until charts are swapped
- Add a `snapshot age` chip next to each section title (e.g. EC2 → "snap 2h ago") sourced from `data_snapshot.capturedAt`

---

## 6. Stretch ideas

- **AI summary at top of dashboard** ("This month: EC2 up 12% led by RW-PROD-7. Data transfer dropped 8%. 2 anomalies flagged. Open the brief →"). Two-paragraph summary generated nightly by a cron job calling Claude. Highest perceived intelligence per dollar.
- **Per-tag budgets + alerts**: set `$X/mo` budget on 3.0, show burn rate vs budget, page if projected > budget.
- **Cost-per-deploy proxy**: pair `RefreshRun` with `Repo.pushedAt` and AWS daily cost to spot deploys that changed the bill.
- **Live "what's open right now" strip** — drives heads-up adoption: open incidents + CRIT findings + Spring down + Lambda errors in one ticker.

---

## 7. What NOT to do

- Don't add Tailwind on top of the existing `globals.css` — the palette is fine; consolidating around CSS variables + a few utility classes is enough.
- Don't switch to Naive UI / Mantine wholesale — the design language is yours, not a generic admin theme; only adopt component primitives (TanStack Table, Recharts, Lucide).
- Don't add real-time websockets yet — refresh-on-interval is sufficient for the snapshot model and avoids server complexity.
- Don't over-tabify the home — too many tabs hides the anomaly feed; flat scroll with sticky section headers reads better.
