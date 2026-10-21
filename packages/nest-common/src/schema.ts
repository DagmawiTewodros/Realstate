/**
 * Tables that exist in BOTH databases (each system has its own copy in its own database).
 * Each app re-exports these from its own schema file so its migrations include them.
 */
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    locale: text("locale").notNull().default("en"),
    isActive: boolean("is_active").notNull().default(true),
    telegramChatId: text("telegram_chat_id"),
    /** For portal users: the landlord, customer (tenant) or member record this login belongs to. */
    linkedEntityId: uuid("linked_entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`), index("users_role_idx").on(t.role)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the session token; the token itself only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.nextAttemptAt)],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A customer (System A) or member (System B). */
    subjectId: uuid("subject_id").notNull(),
    channel: text("channel").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    note: text("note"),
    createdById: uuid("created_by_id"),
  },
  (t) => [index("consent_subject_idx").on(t.subjectId, t.channel)],
);

export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id"),
    userId: uuid("user_id"),
    channel: text("channel"),
    templateKey: text("template_key").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    campaignId: uuid("campaign_id"),
    sendAfter: timestamp("send_after", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("message_subject_idx").on(t.subjectId, t.createdAt), index("message_status_idx").on(t.status, t.sendAfter)],
);

/** One row per reminder that has fired, so each reminder fires once. */
export const reminderLog = pgTable("reminder_log", {
  key: text("key").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedById: uuid("updated_by_id"),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  role: text("role").notNull(),
  linkedEntityId: uuid("linked_entity_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdById: uuid("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Sequential numbers per scope and year (receipts). Locked per row, so numbers have no gaps. */
export const counters = pgTable(
  "counters",
  {
    scope: text("scope").notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.scope, t.year] })],
);

export const commonTables = {
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
};
