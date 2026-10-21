import { z } from "zod";
import { GYM_ROLES, PAYMENT_METHODS, PLAN_KINDS } from "../enums";
import {
  dateStringSchema,
  emailSchema,
  idSchema,
  instantSchema,
  localeSchema,
  minorSchema,
  nameSchema,
  optionalText,
  phoneSchema,
  positiveMinorSchema,
} from "./common";
import { makeUserSchemas } from "./auth";

export const gymUserSchemas = makeUserSchemas(GYM_ROLES);

export const memberCreateSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema.optional().nullable(),
    email: emailSchema.optional().nullable(),
    telegramChatId: z.string().trim().max(64).optional().nullable(),
    locale: localeSchema.default("am"),
    birthDate: dateStringSchema.optional().nullable(),
    emergencyContactName: optionalText(200),
    emergencyContactPhone: phoneSchema.optional().nullable(),
  })
  .refine((v) => Boolean(v.phone || v.email), { message: "Give a phone number or an email", path: ["phone"] });

export const memberUpdateSchema = z.object({
  name: nameSchema.optional(),
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  telegramChatId: z.string().trim().max(64).optional().nullable(),
  locale: localeSchema.optional(),
  birthDate: dateStringSchema.optional().nullable(),
  emergencyContactName: optionalText(200),
  emergencyContactPhone: phoneSchema.optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const planCreateSchema = z.object({
  name: nameSchema,
  kind: z.enum(PLAN_KINDS).default("INDIVIDUAL"),
  durationMonths: z.number().int().min(1).max(36),
  priceMinor: minorSchema,
  isActive: z.boolean().default(true),
});
export const planUpdateSchema = planCreateSchema.partial();

const gymPaymentSchema = z.object({
  amountMinor: positiveMinorSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(200),
});

export const sellMembershipSchema = z
  .object({
    planId: idSchema,
    startDate: dateStringSchema.optional(),
    payment: gymPaymentSchema.optional(),
    complimentaryReason: optionalText(500),
  })
  .refine((v) => Boolean(v.payment) !== Boolean(v.complimentaryReason && v.complimentaryReason.trim()), {
    message: "Record a payment, or a reason for a complimentary membership (not both)",
    path: ["payment"],
  });

export const freezeSchema = z
  .object({ startDate: dateStringSchema, endDate: dateStringSchema, reason: z.string().trim().min(3).max(500) })
  .refine((v) => v.startDate <= v.endDate, { message: "End must be on or after start", path: ["endDate"] });

export const checkinSchema = z
  .object({
    token: z.string().min(10).max(500).optional(),
    memberId: idSchema.optional(),
    overrideReason: optionalText(500),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.memberId), { message: "Give a QR token or a member id", path: ["token"] });

export const trainerCreateSchema = z.object({
  userId: idSchema,
  bio: optionalText(2000),
  phone: phoneSchema.optional().nullable(),
});

export const classTemplateSchema = z.object({
  name: nameSchema,
  trainerId: idSchema,
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  durationMinutes: z.number().int().min(15).max(300),
  capacity: z.number().int().min(1).max(500),
  isActive: z.boolean().default(true),
});
export const classTemplateUpdateSchema = classTemplateSchema.partial();

export const bookingCreateSchema = z.object({ sessionId: idSchema, memberId: idSchema.optional() });

export const personalSessionSchema = z.object({
  trainerId: idSchema,
  memberId: idSchema,
  startsAt: instantSchema,
  durationMinutes: z.number().int().min(15).max(300),
  notes: optionalText(2000),
});

export const attendanceSchema = z.object({
  bookingIds: z.array(idSchema).max(500),
});

export const assignmentSchema = z.object({ trainerId: idSchema, memberId: idSchema });

export const campaignSchema = z.object({
  title: z.string().trim().min(3).max(200),
  messageAm: z.string().trim().min(1).max(1000),
  messageEn: z.string().trim().min(1).max(1000),
  filter: z
    .object({
      membershipStatus: z.enum(["ACTIVE", "EXPIRED", "ANY"]).default("ACTIVE"),
      planId: idSchema.optional(),
    })
    .default({ membershipStatus: "ACTIVE" }),
});

export const GYM_REMINDER_TYPES = ["membership.expiring", "membership.expired", "member.inactive", "member.birthday"] as const;
export type GymReminderType = (typeof GYM_REMINDER_TYPES)[number];

export const gymSettingsSchema = z.object({
  enabled: z.record(z.enum(GYM_REMINDER_TYPES), z.boolean()).default({}),
  inactiveDays: z.number().int().min(3).max(120).default(14),
  expiringDays: z.number().int().min(1).max(30).default(3),
});
export type GymSettings = z.infer<typeof gymSettingsSchema>;
