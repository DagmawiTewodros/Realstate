# Real Estate and Gym Platform

Two separate systems in one pnpm monorepo, built with Node.js and TypeScript:

- **System A (property):** public website with listings and inquiries, leads and sales pipeline, customers and
  consent, listings inventory with photos and documents, spreadsheet import, rentals (leases, rent schedule, payments
  with receipts, arrears, maintenance), landlord statements, landlord and tenant portals, dashboards, and automatic
  reminders and offers by Telegram and email.
- **System B (gym):** front-desk check-in by QR code, members and memberships (sell, renew, freeze, cancel),
  payments with receipts, class timetable and bookings, trainer schedules and attendance, manager dashboard,
  announcements, reminders, and a member app with the QR code and class booking.

Everything works in Amharic and English, on a phone first. Dates show the Ethiopian calendar with the Gregorian date.
The two systems share code (`packages/*`) but never share a database, users, secrets or files.

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Business rules used by servers and web apps: enums, status moves, Ethiopian calendar, phone numbers, money, rent schedules, payment allocation, membership dates, request schemas |
| `packages/nest-common` | Server building blocks: config, database, sessions and roles, audit log, outbox and signed webhooks, consent and messaging, PDFs, uploads, rate limits, invitations |
| `packages/ui` | Shared React components and mobile-first styles |
| `apps/property-api` | System A API (NestJS 11, Drizzle ORM, PostgreSQL 16) |
| `apps/property-web` | System A web app (Next.js 15): public website, staff app, landlord and tenant portals |
| `apps/gym-api` | System B API |
| `apps/gym-web` | System B web app: front desk, managers, trainers, member app |
| `ops/` | Dockerfiles, Caddy, backup and restore scripts, n8n workflows |
| `docs/` | Decisions, environment, operations, API, events, permissions |

## Quick start (development)

Requirements: Node.js 22, pnpm 10 (`corepack enable`), PostgreSQL 16.

```bash
pnpm install
cp apps/property-api/.env.example apps/property-api/.env   # edit DATABASE_URL, secrets, SEED_PASSWORD
cp apps/gym-api/.env.example apps/gym-api/.env
createdb property_dev && createdb gym_dev
pnpm db:migrate && pnpm db:seed
pnpm dev
```

| App | Address | Demo sign-in |
| --- | --- | --- |
| Property website and staff app | http://localhost:3000 (staff: /login) | owner@example.com, sales.manager@example.com, broker@example.com, property.manager@example.com, landlord@example.com, tenant@example.com |
| Gym app | http://localhost:3001 | owner@gym.example, manager@gym.example, desk@gym.example, trainer@gym.example, member@gym.example |

The demo password is the `SEED_PASSWORD` you set.

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @platform/property-web e2e    # Playwright at 360 px, needs the apps running with seed data
pnpm --filter @platform/gym-web e2e
```

API tests run against a real PostgreSQL (each suite creates its own database). CI runs everything, including the
end-to-end tests, on every push (`.github/workflows/ci.yml`).

## Production

One server with Docker Compose: `cp .env.example .env`, fill in the domains and secrets, `docker compose up -d --build`.
Caddy provides HTTPS. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for installation, updates, backups, restores,
monitoring and the optional n8n automation.

## Documentation

- [docs/DECISIONS.md](docs/DECISIONS.md): choices made and open questions for the client
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md): every setting
- [docs/OPERATIONS.md](docs/OPERATIONS.md): running the platform
- [docs/API-property.md](docs/API-property.md) and [apps/gym-api/API.md](apps/gym-api/API.md): API reference
- [docs/PERMISSIONS-property.md](docs/PERMISSIONS-property.md): who may call each property endpoint (generated)
- [docs/EVENTS.md](docs/EVENTS.md): events and automation

## Open questions for the client

- Management fees on owner statements (percentage or fixed; deducted or invoiced).
- SMS or WhatsApp provider, if wanted (Telegram and email work now).
- Online payments (Telebirr, bank) are recorded by staff today; direct integration needs a provider agreement.
