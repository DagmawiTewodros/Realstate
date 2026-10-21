# Decisions

Choices made where the plan left room, and the reasons. Change them here when the client decides otherwise.
Gym-specific details are also in [apps/gym-api/DECISIONS.md](../apps/gym-api/DECISIONS.md).

## Both systems

- **Two systems, one code base.** Property (System A) and gym (System B) share code in `packages/*` but have separate
  databases, users, secrets, storage and domains. A lint rule stops either app from importing the other's code.
- **Stack.** Node.js 22 and TypeScript; NestJS 11 APIs; Drizzle ORM on PostgreSQL 16; Next.js 15 web apps.
  The browser only talks to its web app, which proxies `/api/*` to the API, so session cookies stay first-party.
- **Sessions.** A random token in an HTTP-only, SameSite=Lax cookie; only its SHA-256 is stored. Sessions last 7 days.
  Deactivating a user ends all of their sessions. Passwords use bcrypt (cost 12) and need at least 10 characters.
- **Deny by default.** Every API route must declare who may call it (`@Roles`, `@AnyRole`, `@Public`, `@Internal`);
  a test fails if one does not, and the property route table in `docs/PERMISSIONS-property.md` is generated and checked.
- **Rate limits** (sign-in failures, website inquiries) are kept in memory per API process. That is enough for one
  instance; running several API instances would need a shared store.
- **Money** is stored as integer santim (`bigint`), never floating point. Dates without a time are stored as SQL
  `date` in Addis Ababa days; instants are `timestamptz`. Screens show the Ethiopian date with the Gregorian date beside it.
- **Language.** Amharic is the default for the public website and new customers; every screen and message exists in
  Amharic and English, and a check fails the build if a key is missing in either language or used but not defined.
- **Messages.** Telegram and email are enabled; SMS and WhatsApp exist in the data model but are switched off until
  a provider is chosen. Customers and members get marketing or reminder messages only on channels they agreed to;
  every attempt (sent or blocked) is logged. Nothing is sent between 20:00 and 07:00 Addis time: those messages wait
  until 07:00. Every marketing message carries a signed opt-out link.
- **Receipts** are numbered per year without gaps (`R-2026-000001` property, `G-2026-000001` gym), using a locked
  counter row in the same transaction as the payment. Payments are never deleted; voiding keeps them on record.
- **Automation.** By default the APIs send messages themselves (`AUTOMATION_MODE=direct`), so the system works without
  n8n. With n8n, events are signed webhooks and the workflow hands them back for the standard messages (see EVENTS.md).
- **Uploads** are checked by their content (not the file name) and limited in size; listing photos get a resized WebP thumbnail.
  Files are private unless a unit document is marked public. Storage is a local folder or S3-compatible.
- **CSV exports** start with a UTF-8 byte order mark so Excel shows Amharic correctly, and any cell that starts with
  `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet cannot run it as a formula.
- **Personal data.** Owners can export everything stored about a customer or member, or anonymise them (name and
  contact details removed; payments and counts stay for reports).

## Property (System A)

- **Lead pipeline.** INQUIRY → VIEWING → OFFER → SIGNED, or LOST (a reason is required). Anyone working the lead can move
  it forward; moving back or reopening is for sales managers and the owner. Brokers see only leads assigned to them
  and customers on those leads.
- **Unit status.** AVAILABLE → RESERVED → SOLD or LEASED. Only managers can mark an available unit sold or leased
  directly. A unit that leaves AVAILABLE is taken off the website and put back automatically when it returns.
- **Website leads** are created unassigned and the sales managers are told at once; a broker who has not made first
  contact within `leadResponseHours` (default 1) is reminded, and the manager is told a day later.
- **Offers.** When a unit is published, released, or drops in price, customers with a matching saved search are told,
  at most 3 offer messages per customer in 7 days; further matches wait for a single digest.
- **Leases.** A lease starts as a draft; activating it checks for overlapping active leases on the unit (also enforced
  by a database exclusion constraint), marks the unit leased and generates the whole rent schedule. Rent is due on the
  first day of each billing period (`DUE_DAYS_AFTER_PERIOD_START = 0` in `packages/shared/src/rent.ts`). Dates and rent
  can only change while a lease is a draft; a renewal is a new draft starting the day after the old lease ends.
- **Payments** pay the oldest unpaid charges first; any extra is kept as credit on the lease and used on the next
  charge. The balance shown counts only charges already due; future charges are listed separately.
- **Maintenance.** NEW → ASSIGNED → IN_PROGRESS → DONE (cost required, zero allowed) or CANCELLED. The cost is charged
  to the landlord's statement unless staff untick it.
- **Owner statements** cover rent charged (charges due in the month), rent received (valid payments dated in the
  month), unpaid rent and maintenance charged to the owner; net = received − maintenance. Management fees are not
  included yet: the fee rule (percentage or fixed, deducted or invoiced) is an open question for the client.
  A finished month is saved the first time it is viewed and only changes when a manager issues it again.
- **Portal invitations.** Landlords have no consent record, so their invitation link is shown to staff to share.
  Tenant invitations are sent by message when the tenant agreed to messages; the link is always shown as well.
  Links work once and expire after 7 days. Inviting the same person again is how they recover a forgotten password:
  accepting the new link sets the new password and signs them out everywhere else. Staff passwords are reset by the owner.

## Operations

- **Hosting.** One server with Docker Compose: two PostgreSQL databases, two APIs, two web apps, Caddy for HTTPS
  (automatic certificates) and optional n8n. Migrations run when each API starts and are safe to repeat.
- **Proxies.** The APIs read the visitor's address `TRUST_PROXY_HOPS` hops back in `X-Forwarded-For`
  (1 in development, 2 behind Caddy), which the rate limits rely on.
- **Backups.** Nightly `pg_dump` (custom format) of each database plus an archive of each system's uploaded files,
  kept 14 days locally and optionally copied off-site with rclone. Restores are per system and ask for confirmation.
