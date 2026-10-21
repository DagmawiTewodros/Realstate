# Environment variables

Each API validates its settings when it starts and refuses to run with a clear list of what is missing or wrong
(`packages/nest-common/src/config.ts`). In development an API also reads `.env` in its own folder; copy the
`.env.example` next to it. With Docker Compose all values come from the root `.env` (copy `.env.example`).

Generate secrets with `openssl rand -base64 48`. Use different secrets for the two systems.

## APIs (`apps/property-api`, `apps/gym-api`)

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | | `development` | `production` on the server |
| `PORT` | yes | | 4000 (property), 4001 (gym) |
| `DATABASE_URL` | yes | | `postgres://user:password@host:5432/db` (each system its own database) |
| `SESSION_SECRET` | yes | | 32+ characters; also signs the gym QR codes, so changing it signs everyone out and invalidates member QR codes |
| `PUBLIC_WEB_URL` | yes | | the web app's address, used in links inside messages |
| `CORS_ORIGINS` | | empty | comma-separated origins allowed to call the API from a browser (normally not needed: the web app proxies) |
| `COOKIE_SECURE` | | `false` | `true` behind HTTPS |
| `TRUST_PROXY_HOPS` | | `1` | proxies in front of the API: 1 = web app only, 2 = Caddy + web app |
| `MIGRATE_ON_START` | | unset | `true` applies pending migrations before the API starts (set in Docker Compose) |
| `AUTOMATION_MODE` | | `direct` | `direct`, `n8n` or `off` (see EVENTS.md) |
| `N8N_WEBHOOK_URL` | with n8n | | where events are posted |
| `WEBHOOK_SIGNING_SECRET` | yes | | 16+ characters; signs webhooks to n8n |
| `INTERNAL_API_SECRET` | yes | | 16+ characters; n8n sends it in `x-internal-secret` |
| `DISPATCHER_ENABLED` | | `true` | deliver outbox events every 5 seconds |
| `SCHEDULER_ENABLED` | | `true` | run reminder jobs (property every 10 minutes, gym every 15) |
| `TELEGRAM_BOT_TOKEN` | | empty | Telegram bot used for messages; empty = messages are only logged |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | | | email delivery; empty host = email is only logged |
| `STORAGE_DRIVER` | | `local` | `local` or `s3` |
| `STORAGE_DIR` | | `./storage` | folder for uploads with `local` (`/data/storage` in Docker) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | with `s3` | | S3-compatible storage |
| `ERROR_WEBHOOK_URL` | | empty | receives a JSON post for server errors and failed events |
| `ALERT_TELEGRAM_CHAT_ID` | | empty | Telegram chat that receives the same alerts |
| `COMPANY_NAME` | | `Company` | fallback name in messages before the owner fills in Settings |
| `SEED_PASSWORD` | for the seed | | password given to the demo users by `node dist/seed.js` |

## Web apps

| App | Variable | Default | Meaning |
| --- | --- | --- | --- |
| property-web | `PROPERTY_API_URL` | `http://localhost:4000` | where `/api/*` is forwarded; fixed when the app is built |
| property-web | `PUBLIC_WEB_URL` | `http://localhost:3000` | used for the sitemap and canonical links |
| gym-web | `GYM_API_URL` | `http://localhost:4001` | where `/api/*` is forwarded; fixed when the app is built |

## Docker Compose (`.env` at the repository root)

`PROPERTY_DOMAIN`, `GYM_DOMAIN`, `N8N_DOMAIN`, `ACME_EMAIL` set the public addresses and the certificate contact.
`PROPERTY_DB_PASSWORD`, `PROPERTY_SESSION_SECRET`, `PROPERTY_WEBHOOK_SIGNING_SECRET`, `PROPERTY_INTERNAL_API_SECRET`
and the `GYM_*` equivalents are required. Messaging, alert and storage settings are shared by both APIs.
`N8N_ENCRYPTION_KEY` protects credentials stored in n8n.
