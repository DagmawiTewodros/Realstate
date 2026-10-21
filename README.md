# Real Estate and Gym Platform

Two separate systems in one pnpm monorepo, built with Node.js and TypeScript:

- **System A (property):** leads and sales pipeline, listings inventory, public website, rentals (leases, rent, receipts, maintenance), landlord and tenant portals, reports, and automated customer messaging.
- **System B (gym):** members, memberships and payments, check-ins, classes, trainer schedules, and reminders.

The two systems share code (`packages/*`) but never share a database or users.

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Business rules shared by server and web: enums, status transitions, Ethiopian calendar, phone numbers, money, rent schedules, payment allocation, zod schemas |
| `packages/nest-common` | Server building blocks: config, database, session auth and roles, audit log, outbox and webhook dispatcher, consent and messaging, PDFs, uploads, rate limiting |
| `packages/ui` | Shared React components and mobile-first styles |
| `apps/property-api` | System A API (NestJS 11, Drizzle ORM, PostgreSQL 16) |
| `apps/gym-api` | System B API (NestJS 11, Drizzle ORM, PostgreSQL 16) |
| `apps/property-web` | System A web app (Next.js 15, Amharic and English) |

## Getting started

Requirements: Node.js 20 or newer, pnpm 10, PostgreSQL 16.

```bash
pnpm install
pnpm build
pnpm test        # needs PostgreSQL on localhost:5432 (see apps/*/test/env.ts)
```

Run System A locally:

```bash
cd apps/property-api
DATABASE_URL=postgres://postgres@localhost:5432/property_dev pnpm db:migrate
DATABASE_URL=postgres://postgres@localhost:5432/property_dev SEED_PASSWORD=change-me pnpm db:seed
pnpm dev                      # API on :4000
cd ../property-web && pnpm dev # web on :3000
```

## Status

Done:

- Shared packages with unit tests
- Property API (tasks 02–20) and gym API (tasks 21–25) with integration tests against PostgreSQL
- Property web: public website, listings, inquiry form, login, staff home, language switch

In progress:

- Remaining property staff screens, landlord and tenant portals
- Gym web app
- End-to-end tests at phone width (Playwright)
- Docker Compose, CI, backups, n8n workflow exports, operations docs
