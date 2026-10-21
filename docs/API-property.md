# Property API (System A)

All endpoints take and return JSON unless noted. The web app reaches the API at `/api/*` on its own domain, so the
session cookie (`pp_session`, HTTP-only, SameSite=Lax) is first-party.

Conventions:

- **Errors** are `{ code, message, requestId }`. Validation errors are `400 VALIDATION_FAILED` with `issues: [{ path, message }]`.
  Business-rule conflicts are `409` with a code such as `ILLEGAL_MOVE`, `MANAGER_ONLY`, `OVERLAP`.
- **Money** is an integer number of santim (`priceMinor`, `rentMinor`, `amountMinor`; 100 santim = 1 birr). Currency is ETB.
- **Dates** are `YYYY-MM-DD` Addis Ababa calendar days; **times** are ISO instants. The web app shows Ethiopian and Gregorian dates.
- **Lists** take `page` (from 1) and `pageSize` (up to 200) and return `{ items, page, pageSize, total }`.
- **Who may call what** is in [PERMISSIONS-property.md](PERMISSIONS-property.md), generated from the code and checked by a test.
  Brokers see only their own leads and the customers on them.

## Sign-in and users

| Method | Path | Body or query | Response |
| --- | --- | --- | --- |
| POST | /auth/login | `{ email, password }` | `{ user }` and cookie. `401 INVALID_CREDENTIALS`; `429` after 5 failures a minute |
| POST | /auth/logout | | `{ ok }` |
| GET | /auth/me | | `{ user: { id, name, email, role, locale, linkedEntityId } }` |
| PATCH | /auth/me | `{ locale?, telegramChatId? }` | `{ user }` |
| POST | /auth/change-password | `{ currentPassword, newPassword }` (10+ characters) | `{ ok }` |
| POST | /auth/accept-invitation | `{ token, password, name? }` | `{ user }` and cookie (landlord and tenant accounts) |
| GET, POST, PATCH | /users, /users/:id | `{ name, email, role, locale, password }`; patch `{ name?, role?, locale?, isActive? }` | staff accounts (owner) |
| POST | /users/:id/password | `{ password }` | `{ ok }`; owner sets a temporary password and the user is signed out everywhere |
| GET | /staff | | `{ items: [{ id, name, role }] }` active staff for pickers |

## Customers and leads

| Method | Path | Body or query | Response |
| --- | --- | --- | --- |
| GET | /customers | `?q&page&pageSize` | paged customers |
| POST | /customers | `{ name, phone?, email?, telegramChatId?, locale, source }` (phone or email) | `{ customer, warnings }` (`POSSIBLE_DUPLICATE`) |
| GET, PATCH | /customers/:id | | `{ customer, consent }` / `{ customer, warnings }` |
| POST | /customers/:id/consent | `{ channel, granted, note? }` | `{ consent, history }` |
| GET | /customers/:id/export | | everything stored about the customer (owner) |
| POST | /customers/:id/anonymise | | `{ customer }` (owner) |
| GET | /leads | `?status&source&assignedToId&customerId&overdue=true&q&page&pageSize` | paged leads with `customer`, `assignee`, `interestedUnit` |
| GET | /leads/overdue | | `{ items }` open leads past their next step |
| POST | /leads | `{ customerId \| customer, source, interestedUnitId?, interestedUnitNote?, assignedToId?, nextStepAt?, nextStepNote? }` | `{ lead }` |
| GET, PATCH | /leads/:id | | `{ lead, activities, consent }` / `{ lead }` |
| POST | /leads/:id/assign | `{ assignedToId }` (managers) | `{ lead }` |
| POST | /leads/:id/status | `{ status, lostReason? }` | `{ lead }`; forward moves for everyone, backward moves for managers |
| POST | /leads/:id/activities | `{ type, notes?, result?, occurredAt?, nextStepAt?, nextStepNote? }` | `{ activity }` |
| GET, POST | /leads/:id/viewings | `{ scheduledAt, unitId? }` | `{ items }` / `{ viewing }` |
| PATCH | /viewings/:id | `{ scheduledAt?, status? }` | `{ viewing }` |
| GET, POST, PATCH | /saved-searches | `?customerId` / `{ customerId, purpose?, type?, area?, minPriceMinor?, maxPriceMinor?, bedrooms? }` / `{ isActive }` | saved searches that trigger offer messages |

## Listings inventory

| Method | Path | Body or query | Response |
| --- | --- | --- | --- |
| GET, POST | /projects | `{ name, area, description?, isPublished }` | `{ items }` with `unitCount` / `{ project }` |
| GET, PATCH | /projects/:id | | `{ project, buildings }` / `{ project }` |
| POST | /projects/:id/photos | multipart `file` | `{ photo }` |
| POST, PATCH | /buildings, /buildings/:id | `{ projectId, name }` / `{ name }` | `{ building }` |
| GET | /units | `?status&type&purpose&area&projectId&minPriceMinor&maxPriceMinor&bedrooms&q&sort&page&pageSize` | paged units with `project`, `building`, `photoCount` |
| POST | /units | `{ projectId, buildingId?, code, type, purpose, bedrooms?, areaSqm?, floor?, priceMinor, description?, internalNotes?, landlordId? }` | `{ unit }` |
| GET, PATCH | /units/:id | | `{ unit, project, building, landlord, photos, documents }` / `{ unit }` |
| POST | /units/:id/status | `{ status }` | `{ unit }`; leaving AVAILABLE unpublishes the unit |
| POST | /units/:id/publish | `{ isPublished }` | `{ unit }` (only AVAILABLE units can be published) |
| POST | /units/:id/photos | multipart `file` (JPEG, PNG, WebP; 10 MB) | `{ photo }` |
| PATCH | /units/:id/photos/order | `{ ids }` | `{ photos }` |
| DELETE | /photos/:id | | `{ ok }` |
| POST | /units/:id/documents | multipart `file` (PDF, JPEG, PNG), `name`, `isPublic` | `{ document }` |
| PATCH, DELETE | /documents/:id | `{ isPublic }` | `{ document }` / `{ ok }` |
| GET | /files/photos/:id, /files/documents/:id | `?size=thumb` | the file (staff) |
| POST | /imports/:kind/preview | multipart `file`; kind = units, customers, leads | `{ columns, sample, rowCount, fields, suggestedMapping }` |
| POST | /imports/:kind/dry-run, /imports/:kind/commit | multipart `file`, `mapping` (JSON); `?format=csv` | `{ commit, summary, results }` or CSV |

## Public website (no sign-in)

| Method | Path | Notes |
| --- | --- | --- |
| GET | /public/units, /public/units/:id, /public/featured | published, available units only; no internal fields |
| GET | /public/photos/:id, /public/documents/:id | published units' photos and public documents |
| POST | /public/inquiries | `{ name, phone, email?, message?, locale, unitId?, consentChannels, notifySimilar, website (honeypot) }`; rate limited |
| GET | /public/settings, /public/sitemap | company details; sitemap data |
| GET, POST | /optout/:token | `{ valid }` / `{ ok }`; signed link from every marketing message |
| POST | /public/saved-searches/remove/:token | stops offer messages for one saved search |

## Rentals

| Method | Path | Body or query | Response |
| --- | --- | --- | --- |
| GET, POST | /landlords | `{ name, phone?, email?, notes? }` | `{ items }` with `unitCount` / `{ landlord }` |
| GET, PATCH | /landlords/:id | | `{ landlord, units }` |
| POST | /landlords/:id/invite | | `{ link, expiresAt }` portal invitation |
| GET | /leases | `?status&unitId&tenantId&landlordId&expiringDays` | `{ items }` with `unit`, `tenant`, `landlord` |
| GET | /leases/expiring | `?days=60` | active leases ending soon |
| POST | /leases | `{ unitId, tenantId, landlordId?, startDate, endDate, rentMinor, billingFrequency, depositMinor, notes? }` | `{ lease }` (draft) |
| GET, PATCH | /leases/:id | dates and rent change only while a draft | `{ lease, unit, tenant, landlord }` |
| POST | /leases/:id/activate | | marks the unit leased and creates the rent schedule; `409 OVERLAP` |
| POST | /leases/:id/end, /leases/:id/terminate | terminate needs `{ reason }` | unit becomes available again |
| POST | /leases/:id/renew | `{ endDate, rentMinor? }` | new draft starting the day after the old end |
| POST | /leases/:id/invite-tenant | | `{ link, expiresAt, sent }` |
| GET | /leases/:id/ledger | | `{ charges, payments, entries (running balance), upcomingCharges, balanceMinor, creditMinor }` |
| POST | /leases/:id/payments | multipart: `amountMinor, method, paidAt, reference?`, optional `slip` | `{ payment }` with a gapless receipt number |
| POST | /payments/:id/void | `{ reason }` | `{ payment }`; payments are never deleted |
| GET | /payments/:id/receipt.pdf, /payments/:id/slip | | PDF receipt (Amharic and English) / slip image |
| GET | /arrears | | `{ items: [{ leaseId, tenantName, unitCode, dueMinor, oldestDue, daysOverdue }] }` |
| GET, POST | /maintenance | `?unitId&status&priority&from&to` / `{ unitId, leaseId?, title, description?, priority }` | `{ items }` / `{ request }` |
| GET | /maintenance/:id | | `{ request, unit, comments, photos }` |
| POST | /maintenance/:id/assign | `{ assignedToName, assignedToPhone? }` | `{ request }` |
| PATCH | /maintenance/:id/status | `{ status, costMinor?, paidByLandlord? }` (cost required for DONE) | `{ request }` |
| POST | /maintenance/:id/comments, /maintenance/:id/photos | `{ text }` / multipart `file` | |
| GET | /units/:id/maintenance-cost | `?from&to` | `{ costMinor, requests }` |
| GET | /landlords/:id/statements, /landlords/:id/statements/:month | month = `YYYY-MM` | saved statements; a finished month is saved on first view |
| GET | /landlords/:id/statements/:month/pdf | | PDF |
| POST | /landlords/:id/statements/:month/reissue | | recalculates and raises the version |

## Portals

| Method | Path | Who | Response |
| --- | --- | --- | --- |
| GET | /portal/landlord/overview | LANDLORD | `{ units, leases }` |
| GET | /portal/landlord/maintenance | LANDLORD | repairs on their units |
| GET | /portal/landlord/statements, /statements/:month, /statements/:month/pdf | LANDLORD | own statements |
| GET | /portal/tenant/overview | TENANT | `{ leases, upcomingCharges, payments }` |
| GET | /portal/tenant/payments/:id/receipt.pdf | TENANT | own receipts |
| GET, POST | /portal/tenant/maintenance | TENANT | own repair requests; report one for the active lease |
| POST | /portal/tenant/maintenance/:id/photos | TENANT | multipart `file` |

## Reports and settings

| Method | Path | Notes |
| --- | --- | --- |
| GET | /reports/leads, /reports/brokers, /reports/listings | `?from&to&format=csv`; owner and sales managers |
| GET | /reports/occupancy | owner, sales and property managers |
| GET | /reports/rent, /reports/arrears-aging, /reports/leases-expiring, /reports/maintenance | owner and property managers |
| GET, PUT | /settings/site | company details shown on the website and PDFs (owner) |
| GET, PUT | /settings/reminders | which automatic reminders are on and their timing (owner) |
| POST | /automation/run | runs the reminder job now (owner) |
| GET | /messages, /messages/failed-events | message log and failed automation events (owner) |

## Internal (n8n, shared secret in `x-internal-secret`)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | /internal/messages/send | `{ recipient: { kind: "subject" \| "user", id }, channel?, templateKey, data, reminderKey? }` | MessageService result |
| POST | /internal/events/messages | `{ id }` of an outbox event | sends that event's standard messages once |
| GET | /health, /health/ready | public | `{ status }`; ready also checks the database and counts failed events |
