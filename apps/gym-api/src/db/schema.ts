/**
 * System B (gym) database schema. Separate database from System A.
 * Money is bigint santim (mode "number"). Date-only values use the SQL date type ("YYYY-MM-DD" strings).
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    telegramChatId: text("telegram_chat_id"),
    locale: text("locale").notNull().default("am"),
    birthDate: date("birth_date", { mode: "string" }),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    photoKey: text("photo_key"),
    status: text("status").notNull().default("ACTIVE"),
    /** Increases when a QR code is regenerated; older codes stop working. */
    qrVersion: integer("qr_version").notNull().default(1),
    joinedAt: date("joined_at", { mode: "string" }).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("members_phone_idx").on(t.phone), index("members_name_idx").on(t.name), index("members_joined_idx").on(t.joinedAt)],
);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("INDIVIDUAL"),
  durationMonths: integer("duration_months").notNull(),
  priceMinor: money("price_minor").notNull(),
  currency: text("currency").notNull().default("ETB"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("ACTIVE"),
    /** Price of the plan when it was sold. */
    priceMinor: money("price_minor").notNull(),
    complimentaryReason: text("complimentary_reason"),
    cancelReason: text("cancel_reason"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memberships_member_idx").on(t.memberId, t.endDate), index("memberships_status_end_idx").on(t.status, t.endDate)],
);

export const membershipFreezes = pgTable(
  "membership_freezes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    /** True once the membership end date has been moved later by the frozen days. */
    applied: boolean("applied").notNull().default(false),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("freezes_membership_idx").on(t.membershipId)],
);

export const gymPayments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "set null" }),
    amountMinor: money("amount_minor").notNull(),
    paidAt: date("paid_at", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    receiptNumber: text("receipt_number").notNull().unique(),
    status: text("status").notNull().default("VALID"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: uuid("voided_by_id").references(() => users.id, { onDelete: "set null" }),
    recordedById: uuid("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("gym_payments_paid_idx").on(t.status, t.paidAt), index("gym_payments_member_idx").on(t.memberId)],
);

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    method: text("method").notNull(),
    /** ALLOWED, DENIED or DUPLICATE. Only ALLOWED rows count as visits. */
    result: text("result").notNull(),
    deniedReason: text("denied_reason"),
    override: boolean("override").notNull().default(false),
    overrideReason: text("override_reason"),
    recordedById: uuid("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("checkins_member_idx").on(t.memberId, t.at), index("checkins_at_idx").on(t.result, t.at)],
);

export const trainers = pgTable("trainers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "restrict" }),
  bio: text("bio"),
  phone: text("phone"),
  createdAt: createdAt(),
});

export const trainerAssignments = pgTable(
  "trainer_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainers.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("trainer_member_unique").on(t.trainerId, t.memberId)],
);

export const classTemplates = pgTable("class_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  trainerId: uuid("trainer_id")
    .notNull()
    .references(() => trainers.id, { onDelete: "restrict" }),
  /** 0 = Sunday ... 6 = Saturday */
  weekday: integer("weekday").notNull(),
  /** "HH:MM", Addis Ababa time */
  startTime: text("start_time").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  capacity: integer("capacity").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const classSessions = pgTable(
  "class_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => classTemplates.id, { onDelete: "cascade" }),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    capacity: integer("capacity").notNull(),
    status: text("status").notNull().default("SCHEDULED"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_template_start_unique").on(t.templateId, t.startsAt), index("sessions_starts_idx").on(t.startsAt)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("BOOKED"),
    bookedAt: timestamp("booked_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [uniqueIndex("booking_member_session_unique").on(t.sessionId, t.memberId), index("bookings_member_idx").on(t.memberId)],
);

export const personalSessions = pgTable(
  "personal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => trainers.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status").notNull().default("BOOKED"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("personal_trainer_idx").on(t.trainerId, t.startsAt)],
);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  messageAm: text("message_am").notNull(),
  messageEn: text("message_en").notNull(),
  filter: jsonb("filter").$type<Record<string, unknown>>().notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  deferredCount: integer("deferred_count").notNull().default(0),
  cappedCount: integer("capped_count").notNull().default(0),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
