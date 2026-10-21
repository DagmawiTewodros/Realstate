-- One unit can never have two ACTIVE leases with overlapping dates.
-- Enforced by the database, so it also holds under concurrent requests.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_no_active_overlap"
  EXCLUDE USING gist ("unit_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
  WHERE ("status" = 'ACTIVE');
