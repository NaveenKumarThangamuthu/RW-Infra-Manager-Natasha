---
model: opus  # Complex tier — multi-feature full-stack build
---

# Execution Plan: AWS Billing Dashboard → Professional, Auth'd, DB-backed

## Problem Statement
Convert the existing read-only Next.js AWS Billing Dashboard into a professional,
access-controlled product:
1. Google Sign-In, restricted to emails present in a DB allowlist.
2. Local **MySQL 8.4** (already installed & running on this host) as the data store, via Prisma.
3. Cloudflare tunnel hostname as the app's default/base URL (OAuth redirect target).
4. One-time history backfill (3 years of monthly cost aggregates) into the DB.
5. Twice-daily refresh (09:00 & 15:00 IST) via system crontab → protected API endpoint,
   loading the latest data into the DB.
6. 2.0 / 3.0 / Infra tags assigned **manually in an in-app UI**, stored in DB (replacing the Excel file),
   driving the cost-by-version views.
7. Polished, professional UI.

## Hard AWS Constraint (already flagged to user)
- Monthly cost by SERVICE/REGION: AWS Cost Explorer serves up to **38 months** → 3-year backfill OK.
- Resource-level data (per-EC2/Lambda/SNS, the basis for IP→tag allocation): AWS retains only the
  **last 14 days**. 3-year per-resource history is impossible from AWS. The DB therefore stores:
  (a) 3 yrs monthly aggregates (one-time), plus (b) a growing series of twice-daily resource/tag snapshots.

## Decisions (confirmed by user)
- DB: **MySQL** (local, installed). ORM: **Prisma**.
- Tags: **in-app UI, stored in DB**.
- History: **3 years** monthly (subject to AWS retention).
- Cron: **system crontab → protected API endpoint**.
- Auth: **NextAuth.js v4** (App Router handler) + Google provider, JWT sessions, DB allowlist check.

## Inputs required from user before end-to-end test (NOT needed to write code)
1. Google OAuth **Client ID** + **Client Secret** (Google Cloud Console → OAuth consent + credentials).
2. Cloudflare **tunnel hostname** (e.g. `billing.example.com`) — becomes `NEXTAUTH_URL`/base URL,
   and the Google "Authorized redirect URI" must be `https://<host>/api/auth/callback/google`.
3. MySQL **username/password** for the app (or permission to create a `billing` DB + user).
4. The list of **allowed emails** (or confirm seeding just `naveen@rw.team` initially).

## Scope

### New files
- `prisma/schema.prisma` — models below.
- `lib/db.ts` — Prisma client singleton.
- `lib/snapshot.ts` — shared snapshot routine (AWS CE → DB), used by backfill + cron.
- `lib/repo.ts` — DB read/write helpers for the screens.
- `lib/auth.ts` — NextAuth options (Google provider, allowlist signIn callback).
- `app/api/auth/[...nextauth]/route.ts` — NextAuth handler.
- `app/login/page.tsx` — professional sign-in screen.
- `app/api/refresh/route.ts` — POST, `CRON_SECRET`-protected; runs snapshot for `?label=09:00|15:00`.
- `app/api/backfill/route.ts` — POST, `CRON_SECRET`-protected; one-time 3-yr monthly backfill (idempotent, `?force=1`).
- `app/tags/page.tsx` + `app/api/tags/manage/route.ts` — in-app tag management UI (CRUD on ServerTag).
- `middleware.ts` — protect all pages/APIs except `/login`, `/api/auth/*`, `/api/refresh`, `/api/backfill`.
- `scripts/seed-allowed-users.ts` and `scripts/import-tags-from-xlsx.ts` — optional bootstrap helpers.
- `.env.local.example` — extended with new vars (NEXTAUTH_*, GOOGLE_*, DATABASE_URL, CRON_SECRET).

### Files to modify
- `package.json` — add deps: `next-auth`, `prisma`, `@prisma/client`. Add scripts: `prisma:*`, `backfill`.
- `app/layout.tsx` — wrap with SessionProvider; add top bar (user + sign out + "last refreshed").
- `components/Sidebar.tsx` — add "Tags" nav item; keep "2.0 / 3.0 / Infra".
- `lib/allocation.ts` — add `loadAllocationFromDb()`; keep Excel parser only for the one-time import script.
- `app/api/cost/*` routes — repoint reads to DB (latest snapshot / monthly history) instead of live AWS;
  keep a live path only inside the snapshot routine.
- `components/tabs/*` + `globals.css` — professional polish, tag-cost cards, 3-yr monthly trend.

### Prisma models (summary)
- `AllowedUser(email unique, name, createdAt)` — login allowlist.
- `ServerTag(resourceId/ip unique, label, region, instanceType, category, services json, updatedAt)`.
- `MonthlyCost(month, dimension, key, amount, unit, snapshotAt)` — unique(month,dimension,key).
- `ResourceCostSnapshot(snapshotAt, label, service, resourceId, region, usageType, amount, unit, rangeStart, rangeEnd)`.
- `TagCostSnapshot(snapshotAt, label, category, amount, unit)`.
- `RefreshRun(startedAt, finishedAt, status, kind, message)` — cron/backfill audit.
- JWT sessions → **no** NextAuth DB adapter tables needed.

## Execution Steps (phased; approval gate after each phase)
**Phase A — DB + Prisma foundation:** create `billing` schema/user in MySQL, add Prisma, write schema,
`prisma migrate`, `lib/db.ts`. Seed `AllowedUser` (naveen@rw.team + any provided).
**Phase B — Auth + Cloudflare base URL:** NextAuth options, route handler, login page, middleware,
SessionProvider, top bar. Wire `NEXTAUTH_URL` to tunnel host.
**Phase C — Snapshot engine + backfill + cron endpoints:** `lib/snapshot.ts`, `/api/refresh`,
`/api/backfill`; provide crontab lines (09:00 IST=03:30 UTC, 15:00 IST=09:30 UTC; IST-server variant too).
**Phase D — Tag management UI** + `loadAllocationFromDb()` + optional Excel import.
**Phase E — Repoint read APIs to DB + professional UI polish.**

## Expected Outcomes
- Visiting the tunnel URL forces Google sign-in; only allowlisted emails get in.
- DB holds 3 yrs monthly history + twice-daily resource/tag snapshots.
- Cron refreshes at 09:00 & 15:00 IST.
- Tags managed in-app; 2.0/3.0/Infra cost views read from DB.
- `npm run build` passes.

## Risks & Constraints
- Resource-level history limited to 14 days (above) — communicated in UI.
- Crontab time math depends on server timezone — provide both UTC and IST lines.
- READ-ONLY AWS policy preserved — snapshot routine uses only Get/Describe/List.
- No secrets committed; `.env.local` git-ignored. No auto-commit; branch on request.

## Verification
- `npx prisma migrate dev` succeeds; tables exist.
- `npm run build` + `npm run dev`: unauth → redirect to /login; non-allowlisted email → denied.
- `POST /api/backfill` populates MonthlyCost; `POST /api/refresh?label=09:00` creates a RefreshRun + snapshots.
- Tag UI writes ServerTag; allocation view reflects new tags.
