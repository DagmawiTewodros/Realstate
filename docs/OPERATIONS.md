# Operations

How to run, update, back up and restore the platform. Settings are listed in [ENVIRONMENT.md](ENVIRONMENT.md).

## Development

Requirements: Node.js 22, pnpm 10 (`corepack enable`), PostgreSQL 16.

```bash
pnpm install
cp apps/property-api/.env.example apps/property-api/.env   # then edit DATABASE_URL and the secrets
cp apps/gym-api/.env.example apps/gym-api/.env
createdb property_dev && createdb gym_dev
pnpm db:migrate
pnpm db:seed          # needs SEED_PASSWORD in each .env
pnpm dev              # APIs on :4000 and :4001, web apps on :3000 and :3001
```

Demo accounts after seeding (password = `SEED_PASSWORD`):

| System | Accounts |
| --- | --- |
| Property | owner@example.com, sales.manager@example.com, broker@example.com, property.manager@example.com, landlord@example.com, tenant@example.com |
| Gym | owner@gym.example, manager@gym.example, trainer@gym.example, desk@gym.example, member@gym.example |

Without `TELEGRAM_BOT_TOKEN` and `SMTP_HOST`, messages are written to the API log instead of being sent.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test             # API tests use a real PostgreSQL on localhost:5432 (databases property_test and gym_test)
pnpm build
```

End-to-end tests run at phone width (360 px) against running apps with seed data:

```bash
pnpm --filter @platform/property-web e2e   # expects the property web app on :3000
pnpm --filter @platform/gym-web e2e        # expects the gym web app on :3001
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on every push to `main` and `test` and on pull requests.

## First installation on a server

1. A Linux server with Docker and the Compose plugin, ports 80 and 443 open, and DNS records for
   `PROPERTY_DOMAIN`, `GYM_DOMAIN` (and `N8N_DOMAIN` if used) pointing at it.
2. `git clone` the repository, then `cp .env.example .env` and fill in every value (generate secrets with
   `openssl rand -base64 48`).
3. `docker compose up -d --build`. Caddy obtains HTTPS certificates; each API applies its migrations on start.
4. Create the first owner account for each system:
   `docker compose exec -e SEED_PASSWORD='a-strong-password' property-api node dist/seed.js` (and the same for
   `gym-api`). The seed also adds demo projects, plans and members; remove those, or change the owner's email and
   password at once (Staff accounts, My account).
5. As the owner, fill in Settings (company name, phone, address in both languages) before sharing the website.
6. Install the backup cron job (below) and do a test restore.

## Updates

```bash
git pull
docker compose up -d --build      # migrations run automatically when the APIs restart
docker compose ps                 # every service should be "healthy" or "running"
```

Roll back by checking out the previous version and running the same command. Migrations only add to the schema;
if a release ever needs a destructive migration, its notes will say so and a backup must be taken first.

## Backups

`ops/backup/backup.sh` dumps both databases and archives both upload folders into `./backups`, checks that each dump
can be read, deletes local backups older than `KEEP_DAYS` (14), and copies new files off-site when `RCLONE_REMOTE` is set.

```cron
15 2 * * * cd /srv/platform && RCLONE_REMOTE=b2:company-backups/platform ops/backup/backup.sh >> /var/log/platform-backup.log 2>&1
```

Keep at least one copy off the server. Test a restore every month on a spare machine.

## Restore

```bash
ops/backup/restore.sh property backups/property-db-20261021-021500.dump backups/property-files-20261021-021500.tgz
ops/backup/restore.sh gym      backups/gym-db-20261021-021500.dump      backups/gym-files-20261021-021500.tgz
```

The script asks you to type the system name, checks the dump first, stops that system's API, replaces its database
(and files, when given), and starts the API again. The other system keeps running.

## Monitoring

- `GET /api/health` on each web domain: the API is up. `GET /api/health/ready`: database reachable, and the number
  of automation events that failed after all retries (should be 0).
- Server errors and failed events are posted to `ERROR_WEBHOOK_URL` and sent to `ALERT_TELEGRAM_CHAT_ID` when set.
- The owner's **Messages** page lists every message attempt and any failed automation events.
- Logs: `docker compose logs -f property-api` (one JSON line per request with a request id; the same id is returned in
  error responses so a user can quote it).

## Automation with n8n (optional)

The APIs send all standard messages themselves. Use n8n when the company wants extra steps (posting new leads to a
sales group chat, copying payments to a spreadsheet):

1. `docker compose --profile automation up -d`, open `https://N8N_DOMAIN`, create the n8n owner account.
2. Import `ops/n8n/property-events.json` and `ops/n8n/gym-events.json`, activate both. They verify each event's
   signature and hand it back to the API for the standard messages; add your own steps between those two nodes.
3. In `.env` set `AUTOMATION_MODE=n8n`, `PROPERTY_N8N_WEBHOOK_URL=http://n8n:5678/webhook/property-events` and
   `GYM_N8N_WEBHOOK_URL=http://n8n:5678/webhook/gym-events`, then `docker compose up -d`.
4. If n8n is down, events wait and retry for about an hour, then show as failed on the Messages page and raise an alert. Switching back to
   `AUTOMATION_MODE=direct` makes the APIs send messages themselves again.

## Common tasks

| Task | How |
| --- | --- |
| A staff member forgot their password | Staff accounts → New password (owner). Give the temporary password in person; they change it under My account. Landlords, tenants and members get a new invitation link instead. |
| A staff member leaves | Staff accounts → Deactivate. They are signed out everywhere at once. |
| A customer asks for their data | Customer page → Download data (owner). To be forgotten: Anonymise. |
| Load the company's existing spreadsheets | Staff → Import: choose the file, match columns, Check, then Import. |
| Wrong payment recorded | Lease page → Void (with a reason), then record the right one. The receipt number is not reused. |
| A member lost their phone | Member page → New QR code; the old code stops working at once. |
