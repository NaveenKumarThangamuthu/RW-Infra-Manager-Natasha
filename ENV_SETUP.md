# Environment Setup

Create a file named `.env.local` in the project root (git-ignored). Prisma also
reads `DATABASE_URL` from `.env`, so put at least `DATABASE_URL` in a `.env`
file too. Set each variable to the value shown in the right column.

| Variable | Value to set |
|---|---|
| `DATABASE_URL` | optional — auto-built from `MYSQL_USER`/`MYSQL_PASSWORD` in `/etc/environment`. Set explicitly only to override. |
| `NEXTAUTH_URL` | your public base URL — `http://localhost:3000` for local, or the Cloudflare tunnel hostname in production |
| `NEXTAUTH_SECRET` | output of `openssl rand -base64 32` |
| `CRON_SECRET` | output of `openssl rand -hex 24` (crontab sends this as a Bearer token) |
| `AWS_PROFILE` / `AWS_REGION` | optional — pin the AWS SDK profile/region (unchanged behaviour) |

> Each line in `.env.local` is `KEY=value` (no spaces around `=`). Wrap values in
> double quotes if they contain special characters.

## Authentication (email + password)
Sign-in is email + password; passwords are stored as bcrypt hashes in
`allowed_user` (never plaintext). There is no third-party OAuth.

- **Create / reset a user's password (admin / recovery):**
  ```bash
  USER_EMAIL=you@company.com USER_PASSWORD=your-password npm run set:password
  ```
- **In-app reset:** a signed-in user can change their password at **/account**
  (Top bar → "Reset password"). It requires the current password.
- There is **no email-based "forgot password"** flow (no mail service); if a
  user is locked out, an admin re-runs `npm run set:password` for that email.

## MySQL database + app user
Run these as a MySQL admin (`sudo mysql` or `mysql -u root -p`):

```sql
CREATE DATABASE IF NOT EXISTS billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'billing_app'@'localhost' IDENTIFIED BY 'YOUR_DB_PASSWORD';
GRANT ALL PRIVILEGES ON billing.* TO 'billing_app'@'localhost';
FLUSH PRIVILEGES;
```

Then:
```bash
npm run prisma:migrate      # creates tables
npm run db:seed             # seeds the login allowlist (default: naveen@rw.team)
```

Tags (2.0 / 3.0 / Infra) are assigned inline on the **EC2 — per server** screen
(click **Edit** on a row); they are stored in the `server_tag` table.

## Cron (twice daily)

The host crontab runs `scripts/cron-refresh.sh` at 00:30 and 12:30 host time (IST). The script loads the
cron secret from the secret store and calls the refresh endpoint on `localhost:3000` with it as a bearer
token, so no secret is written in the crontab or in this file. See `CLAUDE.md` for the current schedule.
