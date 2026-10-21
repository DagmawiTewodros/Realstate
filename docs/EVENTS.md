# Events

Each system writes events to its own `outbox_events` table **in the same database transaction** as the change that
caused them, so an event exists only if the change was saved. A dispatcher in each API delivers pending events every
5 seconds:

- `AUTOMATION_MODE=direct` (default): the API runs its own automation rules (messages, offer matching).
- `AUTOMATION_MODE=n8n`: local rules run, then the event is posted to `N8N_WEBHOOK_URL` as
  `{ id, name, payload, createdAt }` with headers `x-event-id`, `x-event-name`, `x-timestamp` and
  `x-signature: sha256=HMAC_SHA256(WEBHOOK_SIGNING_SECRET, "<x-timestamp>.<body>")`. Receivers reject timestamps older
  than 5 minutes. The workflows in `ops/n8n/` verify the signature and call `POST /internal/events/messages` to send
  the standard messages; add your own steps (a group chat post, a spreadsheet row) in between.
- `AUTOMATION_MODE=off`: events are marked delivered and nothing is sent.

Delivery is at least once: failures retry with exponential backoff and become `FAILED` after 8 attempts, which raises
an alert (`ERROR_WEBHOOK_URL`, `ALERT_TELEGRAM_CHAT_ID`) and shows on the owner's Messages page and in
`/health/ready`. Two dispatchers can run at once safely (`FOR UPDATE SKIP LOCKED`). Every message is claimed per event
and recipient, so a retried event never sends the same message twice.

Payloads carry ids and the few fields a message needs. Phone numbers and email addresses are never included; names
appear only where the notification text uses them.

## System A: property

| Event | Payload | Emitted when |
| --- | --- | --- |
| `lead.created.v1` | leadId, customerId, source, assignedToId | a lead is created by staff, the website or an import |
| `lead.assigned.v1` | leadId, assignedToId, customerId | a lead is assigned (or created already assigned) |
| `lead.status_changed.v1` | leadId, from, to | a lead moves in the pipeline |
| `lead.followup_overdue.v1` | leadId, brokerId, customerName, reason, level (`broker` or `manager`) | reminder job: next step overdue, or a new lead not contacted in time |
| `viewing.booked.v1` | viewingId, leadId, customerId, brokerId, unitLabel, scheduledAt | a viewing is booked |
| `viewing.reminder.v1` | same as above | reminder job, the day before the viewing |
| `unit.created.v1` | unitId, projectId | a unit is added |
| `unit.status_changed.v1` | unitId, from, to | a unit's status changes |
| `unit.published.v1` | unitId | a unit is put on the website (triggers offer matching) |
| `unit.released.v1` | unitId | a unit returns to AVAILABLE and is republished |
| `unit.price_dropped.v1` | unitId, oldPriceMinor, newPriceMinor | a unit's price goes down (offers go out only for published units) |
| `lease.activated.v1` | leaseId, unitId, tenantId | a draft lease is activated |
| `lease.ended.v1`, `lease.terminated.v1` | leaseId, unitId | a lease ends or is terminated |
| `lease.expiring.v1` | leaseId, landlordId, unitCode, tenantName, endDate | reminder job, `leaseExpiringDays` before the end |
| `rent.due_soon.v1` | chargeId, leaseId, tenantId, unitCode, amountMinor, dueDate | reminder job, `rentDueSoonDays` before a due date |
| `rent.overdue.v1` | the same plus daysOverdue | reminder job, on each of `rentOverdueDays` after the due date |
| `payment.recorded.v1` | paymentId, leaseId, amountMinor | rent payment recorded |
| `maintenance.created.v1` | requestId, unitId, priority, title | repair reported by staff or a tenant |
| `maintenance.done.v1` | requestId, unitId, costMinor | repair marked done |

## System B: gym

| Event | Payload | Emitted when |
| --- | --- | --- |
| `membership.sold.v1` | membershipId, memberId, planId, startDate, endDate | a membership is sold or renewed |
| `membership.expiring.v1` | membershipId, memberId, endDate, planName | daily job, `expiringDays` before the end |
| `membership.expired.v1` | membershipId, memberId, endDate, planName | daily job, the day after the end (only within 7 days) |
| `member.inactive.v1` | memberId, days, lastVisit | daily job, no visit for `inactiveDays` |
| `member.birthday.v1` | memberId | daily job, on the birthday |
| `session.cancelled.v1` | sessionId, memberIds | a class is cancelled |
| `booking.created.v1`, `booking.cancelled.v1` | bookingId, sessionId, memberId | class bookings |
