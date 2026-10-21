# Gym API (System B)

All endpoints are JSON unless noted. Sign-in sets an HTTP-only cookie named `gym_session`.
Errors are `{ code, message, requestId }`; validation errors are `400 VALIDATION_FAILED` with `issues`.
Money is in santim (`amountMinor`, `priceMinor`; 100 santim = 1 birr). Dates are `YYYY-MM-DD` (Addis Ababa calendar days); times are ISO instants.
Role groups: DESK = OWNER, GYM_MANAGER, FRONT_DESK. MANAGERS = OWNER, GYM_MANAGER. STAFF = DESK + TRAINER.

| Method | Path | Roles | Request | Response |
| --- | --- | --- | --- | --- |
| POST | /auth/login | public | `{ email, password }` | `{ user }` + cookie; 401 INVALID_CREDENTIALS, 429 after 5 failures/min |
| POST | /auth/logout | public | none | `{ ok }` |
| GET | /auth/me | any signed-in | none | `{ user }` |
| PATCH | /auth/me | any signed-in | `{ locale?, telegramChatId? }` | `{ user }` |
| POST | /auth/change-password | any signed-in | `{ currentPassword, newPassword }` | `{ ok }` |
| POST | /auth/accept-invitation | public | `{ token, password, name? }` | `{ user }` + cookie (creates the MEMBER login) |
| GET | /users | OWNER | none | `{ items }` staff users |
| POST | /users | OWNER | `{ name, email, role, locale, password }` (not MEMBER) | `{ user }` |
| PATCH | /users/:id | OWNER | `{ name?, role?, locale?, isActive? }` | `{ user }`; deactivating ends sessions |
| POST | /users/:id/password | OWNER | `{ password }` | `{ ok }`; temporary password for a staff member, ends their sessions |
| GET | /members/:id (trainers field) | STAFF | none | the member record now also lists `trainers: [{ trainerId, name }]` |
| GET | /staff | STAFF | none | `{ items: [{ id, name, role }] }` |
| GET | /members | DESK | `?q&page&pageSize` | `{ items, page, pageSize, total }` |
| POST | /members | DESK | memberCreateSchema | `{ member, warnings }` (POSSIBLE_DUPLICATE warnings) |
| GET | /members/:id | STAFF (TRAINER: assigned only) | none | `{ member, membership, consent? }` |
| PATCH | /members/:id | DESK | memberUpdateSchema (incl. `status`) | `{ member, warnings }` |
| POST | /members/:id/consent | DESK | `{ channel, granted, note? }` | `{ consent, history }` |
| POST | /members/:id/photo | DESK | multipart `file` (jpeg/png/webp, 5 MB) | `{ member }` |
| GET | /members/:id/photo | STAFF (TRAINER: assigned) | none | image |
| POST | /members/:id/qr/regenerate | DESK | none | `{ qrVersion }`; old codes stop working |
| POST | /members/:id/invite | DESK | none | `{ link, expiresAt, delivery }` (member needs an email) |
| GET | /members/:id/export | OWNER | none | everything stored about the member |
| POST | /members/:id/anonymise | OWNER | none | `{ member }` |
| GET | /members/:id/checkins | STAFF (TRAINER: assigned) | none | `{ items }` |
| GET | /members/:id/memberships | DESK | none | `{ memberships (with freezes), payments, current }` |
| POST | /members/:id/memberships | DESK | `{ planId, startDate?, payment? \| complimentaryReason? }` | `{ membership, payment }`; complimentary: MANAGERS only |
| GET | /plans | DESK | `?all=true` to include inactive | `{ items }` |
| POST | /plans | MANAGERS | planCreateSchema | `{ plan }` |
| PATCH | /plans/:id | MANAGERS | planUpdateSchema | `{ plan }` |
| POST | /memberships/:id/freeze | MANAGERS | `{ startDate, endDate, reason }` | `{ membership, freeze }`; end date moves by the frozen days |
| POST | /freezes/:id/end | MANAGERS | none | `{ membership }`; unused days are returned |
| POST | /memberships/:id/cancel | MANAGERS | `{ reason }` | `{ membership }` |
| GET | /memberships/expiring | DESK | `?days=7` | `{ items: [{ membership, member, planName }] }` |
| GET | /memberships/expired | DESK | `?sinceDays=30` | `{ items }` (not renewed) |
| POST | /payments/:id/void | MANAGERS | `{ reason }` | `{ payment }` |
| GET | /payments/:id/receipt.pdf | DESK | none | PDF in the member's language |
| POST | /checkins | DESK | `{ token }` or `{ memberId }`, `overrideReason?` (MANAGERS) | `{ result, deniedReason, override, member, membership, checkinId }` |
| GET | /checkins/today | DESK | none | `{ items }` allowed visits today |
| GET | /me | MEMBER | none | `{ member, membership: { status, planName, endDate, daysLeft, freeze, next } }` |
| GET | /me/qr | MEMBER | none | `{ token }` |
| GET | /me/qr.svg | MEMBER | none | SVG QR code |
| GET | /me/checkins | MEMBER | none | own visits |
| GET | /me/payments | MEMBER | none | own payments |
| GET | /me/payments/:id/receipt.pdf | MEMBER | none | own receipt PDF |
| GET | /me/bookings | MEMBER | none | own bookings with session |
| GET | /trainers | STAFF | none | `{ items: [{ trainer, user }] }` |
| POST | /trainers | MANAGERS | `{ userId, bio?, phone? }` (user must have TRAINER role) | `{ trainer }` |
| POST | /trainer-assignments | MANAGERS | `{ trainerId, memberId }` | `{ assignment }` |
| DELETE | /trainer-assignments | MANAGERS | `{ trainerId, memberId }` | `{ ok }` |
| GET | /trainers/me/members | TRAINER | none | assigned members |
| GET | /trainers/me/schedule | TRAINER | `?from&days` | `{ classes, personal }` |
| GET | /class-templates | STAFF | none | `{ items }` |
| POST | /class-templates | MANAGERS | classTemplateSchema (weekday 0=Sunday, "HH:MM" Addis) | `{ template }`; sessions generated 28 days ahead |
| PATCH | /class-templates/:id | MANAGERS | partial | `{ template }` |
| GET | /sessions | everyone | `?from=YYYY-MM-DD&days=7` | `{ items }` with `booked`, `spotsLeft`, `trainerName` |
| POST | /sessions/:id/cancel | MANAGERS | `{ reason }` | `{ session }`; bookings cancelled, members notified |
| GET | /sessions/:id/roster | STAFF (TRAINER: own classes) | none | `{ session, bookings }` |
| POST | /sessions/:id/attendance | TRAINER (own), MANAGERS | `{ bookingIds }` | `{ updated }` |
| POST | /bookings | DESK, MEMBER | `{ sessionId, memberId? }` (members book for themselves) | `{ booking }`; 409 SESSION_FULL / NO_ACTIVE_MEMBERSHIP / ALREADY_BOOKED |
| POST | /bookings/:id/cancel | DESK, MEMBER (own) | `{ reason? }` | `{ booking }`; within 2 h of start only MANAGERS with a reason |
| GET | /personal-sessions | TRAINER (own), MANAGERS | `?from&days` | `{ items }` |
| POST | /personal-sessions | TRAINER (own), MANAGERS | personalSessionSchema | `{ session }` |
| PATCH | /personal-sessions/:id | TRAINER (own), MANAGERS | `{ status }` | `{ session }` |
| GET | /campaigns | MANAGERS | none | `{ items }` |
| GET | /campaigns/:id | MANAGERS | none | `{ campaign }` |
| POST | /campaigns | MANAGERS | `{ title, messageAm, messageEn, filter: { membershipStatus, planId? } }` | `{ campaign }` with sent/blocked/failed/deferred/capped counts |
| GET | /settings/reminders | OWNER | none | `{ settings }` |
| PUT | /settings/reminders | OWNER | gymSettingsSchema | `{ settings }` |
| POST | /jobs/run | OWNER | none | daily job result (also runs every 15 minutes) |
| GET | /dashboard/summary | MANAGERS | none | `{ activeMembers, expiringIn7Days, newMembersThisMonth }` |
| GET | /dashboard/revenue | MANAGERS | `?month=YYYY-MM` | `{ month, currency, totalMinor, byPlan }` |
| GET | /dashboard/attendance | MANAGERS | none | last 30 days: `days`, `hours`, `weekdays`, `busiestHour`, `busiestWeekday` |
| GET | /dashboard/at-risk | MANAGERS | none | `{ inactiveDays, items: [{ memberId, name, phone, lastVisit, daysSince, membershipEnd }] }` |
| POST | /dashboard/at-risk/:memberId/message | MANAGERS | none | MessageService result (consent checked) |
| GET | /dashboard/revenue.csv, /attendance.csv, /at-risk.csv | MANAGERS | as above | CSV (UTF-8 with BOM) |
| GET | /messages | OWNER | `?status&page` | message log |
| GET | /messages/failed-events | OWNER | none | outbox events that failed |
| POST | /internal/messages/send | internal secret header | `{ recipient, channel?, templateKey, data, reminderKey? }` | for n8n |
| POST | /internal/events/messages | internal secret header | `{ id }` of an outbox event | sends that event's standard messages once (n8n mode) |
| GET, POST | /optout/:token | public | none | `{ valid }` / `{ ok }` |
| GET | /health, /health/ready | public | none | status |

## Events (outbox)

| Event | Payload | Emitted by |
| --- | --- | --- |
| membership.sold.v1 | membershipId, memberId, planId, startDate, endDate | selling a membership |
| membership.expiring.v1 | membershipId, memberId, endDate, planName | daily job, `expiringDays` before the end |
| membership.expired.v1 | membershipId, memberId, endDate, planName | daily job, the day after the end (up to 7 days later) |
| member.inactive.v1 | memberId, days, lastVisit | daily job, no visit for `inactiveDays` |
| member.birthday.v1 | memberId | daily job |
| session.cancelled.v1 | sessionId, memberIds | cancelling a class |
| booking.created.v1, booking.cancelled.v1 | bookingId, sessionId, memberId | bookings |
