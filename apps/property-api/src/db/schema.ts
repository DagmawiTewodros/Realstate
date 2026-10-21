/**
 * System A database schema. Money is bigint santim (mode "number": exact up to 9e15).
 * Date-only values (lease dates, due dates) use the SQL date type and are read as "YYYY-MM-DD" strings.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@platform/nest-common";

export {
  users,
  sessions,
  auditLog,
  outboxEvents,
  consentRecords,
  messageLog,
  reminderLog,
  appSettings,
  invitations,
  counters,
} from "@platform/nest-common";

const money = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------- CRM ----------
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    telegramChatId: text("telegram_chat_id"),
    locale: text("locale").notNull().default("am"),
    source: text("source").notNull().default("OTHER"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_phone_idx").on(t.phone), index("customers_email_idx").on(sql`lower(${t.email})`), index("customers_name_idx").on(t.name)],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  area: text("area").notNull(),
  description: text("description"),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const buildings = pgTable(
  "buildings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("buildings_project_name_unique").on(t.projectId, t.name)],
);

export const landlords = pgTable("landlords", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    buildingId: uuid("building_id").references(() => buildings.id, { onDelete: "set null" }),
    landlordId: uuid("landlord_id").references(() => landlords.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    type: text("type").notNull(),
    purpose: text("purpose").notNull(),
    bedrooms: integer("bedrooms"),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2, mode: "number" }),
    floor: integer("floor"),
    priceMinor: money("price_minor").notNull(),
    currency: text("currency").notNull().default("ETB"),
    status: text("status").notNull().default("AVAILABLE"),
    description: text("description"),
    internalNotes: text("internal_notes"),
    isPublished: boolean("is_published").notNull().default(false),
    /** Remembers that the unit was published before it left AVAILABLE, so it can be republished when it returns. */
    republishOnAvailable: boolean("republish_on_available").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("units_project_code_unique").on(t.projectId, t.code),
    index("units_status_idx").on(t.status),
    index("units_public_idx").on(t.isPublished, t.status),
    index("units_landlord_idx").on(t.landlordId),
  ],
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    sortOrder: integer("sort_order").notNull().default(0),
    altText: text("alt_text"),
    createdAt: createdAt(),
  },
  (t) => [index("photos_unit_idx").on(t.unitId, t.sortOrder), index("photos_project_idx").on(t.projectId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("documents_unit_idx").on(t.unitId)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    status: text("status").notNull().default("INQUIRY"),
    assignedToId: uuid("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
    interestedUnitNote: text("interested_unit_note"),
    interestedUnitId: uuid("interested_unit_id").references(() => units.id, { onDelete: "set null" }),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    nextStepNote: text("next_step_note"),
    lostReason: text("lost_reason"),
    /** Time of the first call, viewing, email or Telegram contact (for response-time reports). */
    firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_assignee_idx").on(t.assignedToId, t.status),
    index("leads_next_step_idx").on(t.nextStepAt),
    index("leads_customer_idx").on(t.customerId),
    index("leads_created_idx").on(t.createdAt),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    notes: text("notes"),
    result: text("result"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** System entries (status changes, assignments) are not contacts and are ignored by response-time reports. */
    isSystem: boolean("is_system").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("activities_lead_idx").on(t.leadId, t.occurredAt)],
);

export const viewings = pgTable(
  "viewings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("BOOKED"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("viewings_scheduled_idx").on(t.status, t.scheduledAt)],
);

// ---------- Rentals ----------
export const leases = pgTable(
  "leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    landlordId: uuid("landlord_id").references(() => landlords.id, { onDelete: "set null" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    rentMinor: money("rent_minor").notNull(),
    currency: text("currency").notNull().default("ETB"),
    billingFrequency: text("billing_frequency").notNull().default("MONTHLY"),
    depositMinor: money("deposit_minor").notNull().default(0),
    depositStatus: text("deposit_status").notNull().default("HELD"),
    status: text("status").notNull().default("DRAFT"),
    terminationReason: text("termination_reason"),
    notes: text("notes"),
    /** Overpayments waiting to be applied to future charges. */
    creditMinor: money("credit_minor").notNull().default(0),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    previousLeaseId: uuid("previous_lease_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leases_unit_idx").on(t.unitId, t.status),
    index("leases_tenant_idx").on(t.tenantId),
    index("leases_landlord_idx").on(t.landlordId),
    index("leases_end_idx").on(t.status, t.endDate),
  ],
);

export const rentCharges = pgTable(
  "rent_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    amountMinor: money("amount_minor").notNull(),
    paidMinor: money("paid_minor").notNull().default(0),
    status: text("status").notNull().default("DUE"),
    createdAt: createdAt(),
  },
  (t) => [index("charges_lease_idx").on(t.leaseId, t.dueDate), index("charges_due_idx").on(t.status, t.dueDate)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id, { onDelete: "restrict" }),
    amountMinor: money("amount_minor").notNull(),
    paidAt: date("paid_at", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    receiptNumber: text("receipt_number").notNull().unique(),
    status: text("status").notNull().default("VALID"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: uuid("voided_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Credit from this payment that is still waiting to be applied. */
    unappliedMinor: money("unapplied_minor").notNull().default(0),
    slipKey: text("slip_key"),
    recordedById: uuid("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("payments_lease_idx").on(t.leaseId, t.paidAt), index("payments_paid_idx").on(t.status, t.paidAt)],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => rentCharges.id, { onDelete: "cascade" }),
    amountMinor: money("amount_minor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("allocations_payment_idx").on(t.paymentId), index("allocations_charge_idx").on(t.chargeId)],
);

export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    leaseId: uuid("lease_id").references(() => leases.id, { onDelete: "set null" }),
    reportedByCustomerId: uuid("reported_by_customer_id").references(() => customers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("NORMAL"),
    status: text("status").notNull().default("NEW"),
    assignedToName: text("assigned_to_name"),
    assignedToPhone: text("assigned_to_phone"),
    costMinor: money("cost_minor"),
    paidByLandlord: boolean("paid_by_landlord").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("maintenance_unit_idx").on(t.unitId, t.createdAt), index("maintenance_status_idx").on(t.status, t.priority)],
);

export const maintenanceComments = pgTable("maintenance_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => maintenanceRequests.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  createdAt: createdAt(),
});

export const maintenancePhotos = pgTable("maintenance_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => maintenanceRequests.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: createdAt(),
});

export interface StatementFigures {
  month: string;
  currency: "ETB";
  rentChargedMinor: number;
  rentReceivedMinor: number;
  arrearsMinor: number;
  maintenanceCostMinor: number;
  netMinor: number;
  leases: Array<{ leaseId: string; unitCode: string; tenantName: string; chargedMinor: number; receivedMinor: number; arrearsMinor: number }>;
  maintenance: Array<{ requestId: string; unitCode: string; title: string; costMinor: number; closedAt: string }>;
}

export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    landlordId: uuid("landlord_id")
      .notNull()
      .references(() => landlords.id, { onDelete: "restrict" }),
    month: text("month").notNull(),
    figures: jsonb("figures").$type<StatementFigures>().notNull(),
    version: integer("version").notNull().default(1),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedById: uuid("issued_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("statements_landlord_month_unique").on(t.landlordId, t.month)],
);

// ---------- Offers ----------
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    purpose: text("purpose"),
    type: text("type"),
    area: text("area"),
    minPriceMinor: money("min_price_minor"),
    maxPriceMinor: money("max_price_minor"),
    bedrooms: integer("bedrooms"),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("saved_searches_active_idx").on(t.isActive)],
);

export const offerNotifications = pgTable(
  "offer_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savedSearchId: uuid("saved_search_id")
      .notNull()
      .references(() => savedSearches.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    /** SENT, BLOCKED, or QUEUED (waiting for the weekly cap; sent later in a digest), DIGESTED */
    status: text("status").notNull(),
    messageId: uuid("message_id"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("offer_once_unique").on(t.savedSearchId, t.unitId, t.eventType),
    index("offer_customer_idx").on(t.customerId, t.status, t.sentAt),
  ],
);
