# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Natasha Infra Manager": a single-host Next.js 14 (App Router) dashboard for AWS cost, infrastructure health, repo security scans, SonarQube reports and AS2 certificate expiry. It uses MySQL via Prisma.

`README.md` and `ENV_SETUP.md` predate most of this and are partly stale. They describe a billing-only app, password login and a 09:00/15:00 IST cron. Trust the code over them.

## Commands

```bash
npx tsc --noEmit                 # Type check. This is the main verification step.
npm run build                    # Production build (see the warning below)
npm run prisma:migrate           # Create and apply a migration (dev)
npm run prisma:deploy            # Apply existing migrations
npx prisma generate              # Also runs on postinstall
npx tsx scripts/<name>.ts        # One-off scripts (scan, seed, import)

# E2E (Playwright). Expects a server already running; E2E_BASE_URL overrides localhost:3000.
E2E_USER=... E2E_PASS=... npx playwright test
npx playwright test tests/e2e/dashboard.spec.ts -g "login redirect"   # Single test
```

- `npm run lint` is not usable: ESLint isn't installed and there is no config.
- There are no unit tests. `tests/e2e/dashboard.spec.ts` still drives an email/password form, but `/login` is now Google-only, so its login-dependent checks no longer match the app.

## The live service runs from this directory

The production instance is the systemd user unit `natasha-dashboard.service`. It runs `scripts/run-natasha-fg.sh`, which does `next start` on port 3000 from this checkout, and it is reachable through a Cloudflare tunnel.

- `next build` and `next dev` both write to the `.next/` directory the live server uses, so running either here can disrupt production. A build only takes full effect after `systemctl --user restart natasha-dashboard.service`. Confirm with the user before building or restarting.
- The host crontab calls `scripts/cron-refresh.sh` at 00:30 and 12:30 host time, which is IST (the `0030-utc-06ist` / `1230-utc-18ist` labels it passes are misnomers). It hits `localhost:3000`, and `scripts/refresh-sonar-report.sh` has its own schedule. Those scripts hardcode this repo's absolute path.

## Architecture

### Secrets load in two stages

- **Bootstrap values** (`BOOTSTRAP_KEYS` in `lib/secrets.ts`: DB credentials, `INFRA_KMS_KEY`, `NEXTAUTH_*`) live in `.env`.
- **Managed values** (`MANAGED_KEYS`: Google/GitHub OAuth, `SONAR_TOKEN`, `CRON_SECRET`, etc.) are AES-256-GCM encrypted in the `secret_store` table, using a key derived from `INFRA_KMS_KEY`.

`lib/db.ts` hydrates `process.env` asynchronously on import, and routes that need a secret should `await ensureSecretsHydrated()`. That is too late for code reading env at module init, such as the NextAuth Google provider in `lib/auth.ts`. So startup and cron scripts `eval "$(node scripts/hydrate-secrets-cli.mjs)"` before launching. A plain `npm run dev` therefore has no Google sign-in. `instrumentation.ts.disabled` is an earlier approach and is not active.

`lib/db.ts` can build the connection string from `MYSQL_*`, but the Prisma CLI only reads `DATABASE_URL`.

### Three data paths, so check which one a screen uses

1. **Live with TTL:** route handlers wrap AWS calls in `cached()` (`lib/cache.ts`), an in-memory, per-process cache with a 5-minute default. Cost Explorer calls are slow and billable, so keep them cached.
2. **Billing tables:** `POST /api/refresh` runs `lib/snapshot.ts`, which writes `monthly_cost`, `resource_cost_snapshot`, `tag_cost_snapshot`, `resource_daily_cost` and `ec2_itemized_snapshot`. AWS keeps resource-level cost data for only 14 days, hence the rolling windows and stored history.
3. **JSON snapshots:** `data_snapshot` rows are keyed by source (`lib/dataSnapshot.ts`), and pages read the latest successful row. Fetchers are in `lib/snapshotFetchers.ts`, triggered by `/api/cron/refresh-all` or the UI's `/api/refresh/snapshot`.

To add a snapshot source, update the `LiveSource` type and `ALL_SOURCES`, add a fetcher, and add it to the separate `FETCHERS` map in **both** of those routes.

### Auth

- `middleware.ts` requires a NextAuth JWT session for everything except the paths excluded in its matcher. Sign-in is Google OAuth, gated by active rows in `allowed_user`.
- Excluded machine endpoints must authenticate themselves: `Authorization: Bearer $CRON_SECRET` for cron routes, an HMAC signature for `/api/webhooks/github`. A new machine endpoint needs both a matcher exclusion and its own check.
- The matcher also skips any path containing a `.`, so **files in `public/` are served without a session** unless the matcher lists them. `/vulnerability-report*` and `/sonar-reports/*` are listed; a new generated report needs its own entry.

### Conventions

- **AWS is read-only:** only Get/Describe/List-style calls, per the policy in `lib/aws.ts`. Get clients from there; regional clients are created per region.
- **Frontend:** client components fetch `/api/*` through `components/useJson.ts`, which also turns auth redirects into a "session expired" error. Redesigned screens are in `components/screens/`, built from `components/ui/` (shadcn-style Radix wrappers) and `components/natasha/` (charts, KPI and layout primitives, formatters); the sidebar, header and command palette are in `components/shell/`. Pages without a redesign still use `components/tabs/` and `components/perf/`, and many files there are no longer imported.
- **Styling:** Tailwind for redesigned screens, with colours mapped to the CSS tokens in `app/design.css` (dark by default, light under `html[data-theme="light"]`). `app/globals.css` is the legacy stylesheet for the older pages; its variables alias to the new tokens. `app/layout.tsx` imports `tailwind-base.css`, then `globals.css`, then `design.css`, and that order matters.
- **Imports:** use the `@/*` alias for the repo root.
- **Security scans:** `lib/scanRepo.ts` and `lib/scanners.ts` spawn trivy and gitleaks binaries from `~/tools/` (override with `NATASHA_TRIVY_BIN` / `NATASHA_GITLEAKS_BIN`). Results go to `Finding`/`ScanJob`.
- **Slow queries (`/slow-queries`):** two sources on one page. Statement statistics come from MySQL `performance_schema` via `lib/rdsQueryInsights.ts` (needs a read-only `RDS_QUERY_USER`/`RDS_QUERY_PASSWORD` login, otherwise it shows the "unavailable" remedy). Database trouble in the Spring logs comes from ELK via `lib/slowQueryLogs.ts`: exact counts per kind run one query at a time, while failed-statement groups and timed operations come from bounded samples and are labelled as such. `lib/slowQueryParse.ts` redacts every log line (emails, IPs, quoted values, tokens, DTO dumps) before it reaches the browser.
- **AI brief:** `/api/brief` uses the Anthropic API when `ANTHROPIC_API_KEY` is set and falls back to a non-AI brief otherwise.

### Leftovers

The SEO / web-perf feature is fully removed from the code. Its `SeoTarget`/`SeoReport` models stay in `prisma/schema.prisma` as archived, with their data, so no migration drops the tables; nothing reads them. Password login was removed too, while `passwordHash`, `/api/account/password` and `scripts/set-password.ts` remain.
