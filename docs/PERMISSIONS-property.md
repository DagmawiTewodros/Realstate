# Property API permissions

Generated from the code by `apps/property-api/test/permissions.test.ts`. Do not edit by hand.

Legend: ✓ allowed, blank denied (403). Public = no sign-in. Internal = n8n shared secret. Any = any signed-in user.

| Method | Path | Access | OWNER | SALES_MANAGER | BROKER | PROPERTY_MANAGER | LANDLORD | TENANT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/arrears` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/auth/accept-invitation` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/auth/change-password` | Any | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/auth/login` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/auth/logout` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/auth/me` | Any | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PATCH | `/auth/me` | Any | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/automation/run` | Roles | ✓ |  |  |  |  |  |
| POST | `/buildings` | Roles | ✓ | ✓ |  |  |  |  |
| PATCH | `/buildings/:id` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/customers` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/customers` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/customers/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| PATCH | `/customers/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/customers/:id/anonymise` | Roles | ✓ |  |  |  |  |  |
| POST | `/customers/:id/consent` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/customers/:id/export` | Roles | ✓ |  |  |  |  |  |
| DELETE | `/documents/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| PATCH | `/documents/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/files/documents/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/files/maintenance-photos/:id` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/files/photos/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/health` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/health/ready` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/imports/:kind/commit` | Roles | ✓ | ✓ |  | ✓ |  |  |
| POST | `/imports/:kind/dry-run` | Roles | ✓ | ✓ |  | ✓ |  |  |
| POST | `/imports/:kind/preview` | Roles | ✓ | ✓ |  | ✓ |  |  |
| POST | `/internal/events/messages` | Internal |  |  |  |  |  |  |
| POST | `/internal/messages/send` | Internal |  |  |  |  |  |  |
| GET | `/landlords` | Roles | ✓ | ✓ |  | ✓ |  |  |
| POST | `/landlords` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/landlords/:id` | Roles | ✓ | ✓ |  | ✓ |  |  |
| PATCH | `/landlords/:id` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/landlords/:id/invite` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/landlords/:landlordId/statements` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/landlords/:landlordId/statements/:month` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/landlords/:landlordId/statements/:month/pdf` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/landlords/:landlordId/statements/:month/reissue` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/leads` | Roles | ✓ | ✓ | ✓ |  |  |  |
| POST | `/leads` | Roles | ✓ | ✓ | ✓ |  |  |  |
| GET | `/leads/:id` | Roles | ✓ | ✓ | ✓ |  |  |  |
| PATCH | `/leads/:id` | Roles | ✓ | ✓ | ✓ |  |  |  |
| POST | `/leads/:id/activities` | Roles | ✓ | ✓ | ✓ |  |  |  |
| POST | `/leads/:id/assign` | Roles | ✓ | ✓ |  |  |  |  |
| POST | `/leads/:id/status` | Roles | ✓ | ✓ | ✓ |  |  |  |
| GET | `/leads/:id/viewings` | Roles | ✓ | ✓ | ✓ |  |  |  |
| POST | `/leads/:id/viewings` | Roles | ✓ | ✓ | ✓ |  |  |  |
| GET | `/leads/overdue` | Roles | ✓ | ✓ | ✓ |  |  |  |
| GET | `/leases` | Roles | ✓ | ✓ |  | ✓ |  |  |
| POST | `/leases` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/leases/:id` | Roles | ✓ | ✓ |  | ✓ |  |  |
| PATCH | `/leases/:id` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/activate` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/end` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/invite-tenant` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/leases/:id/ledger` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/payments` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/renew` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/leases/:id/terminate` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/leases/expiring` | Roles | ✓ | ✓ |  | ✓ |  |  |
| GET | `/maintenance` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/maintenance` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/maintenance/:id` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/maintenance/:id/assign` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/maintenance/:id/comments` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/maintenance/:id/photos` | Roles | ✓ |  |  | ✓ |  |  |
| PATCH | `/maintenance/:id/status` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/messages` | Roles | ✓ |  |  |  |  |  |
| GET | `/messages/failed-events` | Roles | ✓ |  |  |  |  |  |
| GET | `/optout/:token` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/optout/:token` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/payments/:id/receipt.pdf` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/payments/:id/slip` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/payments/:id/void` | Roles | ✓ |  |  | ✓ |  |  |
| DELETE | `/photos/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/portal/landlord/maintenance` | Roles |  |  |  |  | ✓ |  |
| GET | `/portal/landlord/overview` | Roles |  |  |  |  | ✓ |  |
| GET | `/portal/landlord/statements` | Roles |  |  |  |  | ✓ |  |
| GET | `/portal/landlord/statements/:month` | Roles |  |  |  |  | ✓ |  |
| GET | `/portal/landlord/statements/:month/pdf` | Roles |  |  |  |  | ✓ |  |
| GET | `/portal/tenant/maintenance` | Roles |  |  |  |  |  | ✓ |
| POST | `/portal/tenant/maintenance` | Roles |  |  |  |  |  | ✓ |
| POST | `/portal/tenant/maintenance/:id/photos` | Roles |  |  |  |  |  | ✓ |
| GET | `/portal/tenant/overview` | Roles |  |  |  |  |  | ✓ |
| GET | `/portal/tenant/payments/:id/receipt.pdf` | Roles |  |  |  |  |  | ✓ |
| GET | `/projects` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/projects` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/projects/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| PATCH | `/projects/:id` | Roles | ✓ | ✓ |  |  |  |  |
| POST | `/projects/:id/photos` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/public/documents/:id` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/featured` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/public/inquiries` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/photos/:id` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST | `/public/saved-searches/remove/:token` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/settings` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/sitemap` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/units` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/public/units/:id` | Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET | `/reports/arrears-aging` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/reports/brokers` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/reports/leads` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/reports/leases-expiring` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/reports/listings` | Roles | ✓ | ✓ |  |  |  |  |
| GET | `/reports/maintenance` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/reports/occupancy` | Roles | ✓ | ✓ |  | ✓ |  |  |
| GET | `/reports/rent` | Roles | ✓ |  |  | ✓ |  |  |
| GET | `/saved-searches` | Roles | ✓ | ✓ | ✓ |  |  |  |
| POST | `/saved-searches` | Roles | ✓ | ✓ | ✓ |  |  |  |
| PATCH | `/saved-searches/:id` | Roles | ✓ | ✓ | ✓ |  |  |  |
| GET | `/settings/reminders` | Roles | ✓ |  |  |  |  |  |
| PUT | `/settings/reminders` | Roles | ✓ |  |  |  |  |  |
| GET | `/settings/site` | Roles | ✓ |  |  |  |  |  |
| PUT | `/settings/site` | Roles | ✓ |  |  |  |  |  |
| GET | `/staff` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/units` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/units` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/units/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| PATCH | `/units/:id` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/units/:id/documents` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/units/:id/maintenance-cost` | Roles | ✓ |  |  | ✓ |  |  |
| POST | `/units/:id/photos` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| PATCH | `/units/:id/photos/order` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/units/:id/publish` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| POST | `/units/:id/status` | Roles | ✓ | ✓ | ✓ | ✓ |  |  |
| GET | `/users` | Roles | ✓ |  |  |  |  |  |
| POST | `/users` | Roles | ✓ |  |  |  |  |  |
| PATCH | `/users/:id` | Roles | ✓ |  |  |  |  |  |
| PATCH | `/viewings/:id` | Roles | ✓ | ✓ | ✓ |  |  |  |
