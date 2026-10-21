import { z } from "zod";
import {
  ACTIVITY_TYPES,
  BILLING_FREQUENCIES,
  DEPOSIT_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MAINTENANCE_STATUSES,
  PAYMENT_METHODS,
  PRIORITIES,
  PROPERTY_ROLES,
  UNIT_PURPOSES,
  UNIT_STATUSES,
  UNIT_TYPES,
} from "../enums";
import {
  channelSchema,
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

export const propertyUserSchemas = makeUserSchemas(PROPERTY_ROLES);

// ---------- Customers and consent ----------
export const customerCreateSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema.optional().nullable(),
    email: emailSchema.optional().nullable(),
    telegramChatId: z.string().trim().max(64).optional().nullable(),
    locale: localeSchema.default("am"),
    source: z.enum(LEAD_SOURCES).default("OTHER"),
  })
  .refine((v) => Boolean(v.phone || v.email), { message: "Give a phone number or an email", path: ["phone"] });
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = z.object({
  name: nameSchema.optional(),
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  telegramChatId: z.string().trim().max(64).optional().nullable(),
  locale: localeSchema.optional(),
});

export const consentSchema = z.object({
  channel: channelSchema,
  granted: z.boolean(),
  note: optionalText(500),
});

// ---------- Leads ----------
const inlineCustomer = z.object({
  name: nameSchema,
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  locale: localeSchema.default("am"),
});

export const leadCreateSchema = z
  .object({
    customerId: idSchema.optional(),
    customer: inlineCustomer.optional(),
    source: z.enum(LEAD_SOURCES),
    interestedUnitNote: optionalText(500),
    interestedUnitId: idSchema.optional().nullable(),
    assignedToId: idSchema.optional().nullable(),
    nextStepAt: instantSchema.optional().nullable(),
    nextStepNote: optionalText(500),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.customer), {
    message: "Give either an existing customerId or a new customer",
    path: ["customerId"],
  });
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z.object({
  source: z.enum(LEAD_SOURCES).optional(),
  interestedUnitNote: optionalText(500),
  interestedUnitId: idSchema.optional().nullable(),
  nextStepAt: instantSchema.optional().nullable(),
  nextStepNote: optionalText(500),
});

export const leadStatusSchema = z
  .object({ status: z.enum(LEAD_STATUSES), lostReason: optionalText(500) })
  .refine((v) => v.status !== "LOST" || Boolean(v.lostReason && v.lostReason.trim().length > 0), {
    message: "A reason is required to mark a lead lost",
    path: ["lostReason"],
  });

export const leadAssignSchema = z.object({ assignedToId: idSchema });

export const leadListQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  assignedToId: idSchema.optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  overdue: z.coerce.boolean().optional(),
  q: z.string().trim().max(100).optional(),
});

export const activityCreateSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  notes: optionalText(2000),
  result: optionalText(500),
  occurredAt: instantSchema.optional(),
  nextStepAt: instantSchema.optional().nullable(),
  nextStepNote: optionalText(500),
});

// ---------- Inventory ----------
export const projectCreateSchema = z.object({
  name: nameSchema,
  area: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  isPublished: z.boolean().default(false),
});
export const projectUpdateSchema = projectCreateSchema.partial();

export const buildingCreateSchema = z.object({ projectId: idSchema, name: nameSchema });
export const buildingUpdateSchema = z.object({ name: nameSchema });

export const unitCreateSchema = z.object({
  projectId: idSchema,
  buildingId: idSchema.optional().nullable(),
  code: z.string().trim().min(1).max(50),
  type: z.enum(UNIT_TYPES),
  purpose: z.enum(UNIT_PURPOSES),
  bedrooms: z.number().int().min(0).max(50).optional().nullable(),
  areaSqm: z.number().positive().max(1_000_000).optional().nullable(),
  floor: z.number().int().min(-10).max(200).optional().nullable(),
  priceMinor: minorSchema,
  description: optionalText(5000),
  internalNotes: optionalText(5000),
  landlordId: idSchema.optional().nullable(),
});
export const unitUpdateSchema = unitCreateSchema.omit({ projectId: true }).partial();
export const unitStatusSchema = z.object({ status: z.enum(UNIT_STATUSES) });
export const unitPublishSchema = z.object({ isPublished: z.boolean() });

export const unitListQuerySchema = z.object({
  status: z.enum(UNIT_STATUSES).optional(),
  type: z.enum(UNIT_TYPES).optional(),
  purpose: z.enum(UNIT_PURPOSES).optional(),
  area: z.string().trim().max(200).optional(),
  projectId: idSchema.optional(),
  minPriceMinor: z.coerce.number().int().nonnegative().optional(),
  maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
});

// ---------- Public website ----------
export const publicInquirySchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional().nullable().or(z.literal("").transform(() => null)),
  message: optionalText(2000),
  locale: localeSchema.default("am"),
  unitId: idSchema.optional().nullable(),
  consentChannels: z.array(channelSchema).max(4).default([]),
  notifySimilar: z.boolean().default(false),
  /** Honeypot: real visitors never fill this hidden field. */
  website: z.string().max(0).optional().or(z.literal("")),
});
export type PublicInquiryInput = z.infer<typeof publicInquirySchema>;

const localizedText = z.object({ am: z.string().trim().max(2000).default(""), en: z.string().trim().max(2000).default("") });

export const siteSettingsSchema = z.object({
  companyName: localizedText.default({}),
  phone: z.string().trim().max(50).default(""),
  email: z.string().trim().max(320).default(""),
  address: localizedText.default({}),
  openingHours: localizedText.default({}),
  about: localizedText.default({}),
  socialLinks: z.array(z.object({ label: z.string().trim().max(50), url: z.string().url() })).max(10).default([]),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

// ---------- Leases, rent, maintenance ----------
export const landlordCreateSchema = z.object({
  name: nameSchema,
  phone: phoneSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  notes: optionalText(2000),
});
export const landlordUpdateSchema = landlordCreateSchema.partial();

export const leaseCreateSchema = z
  .object({
    unitId: idSchema,
    tenantId: idSchema,
    landlordId: idSchema.optional().nullable(),
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    rentMinor: positiveMinorSchema,
    billingFrequency: z.enum(BILLING_FREQUENCIES).default("MONTHLY"),
    depositMinor: minorSchema.default(0),
    notes: optionalText(2000),
  })
  .refine((v) => v.startDate <= v.endDate, { message: "End date must be on or after start date", path: ["endDate"] });

export const leaseUpdateSchema = z.object({
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  rentMinor: positiveMinorSchema.optional(),
  billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
  depositMinor: minorSchema.optional(),
  depositStatus: z.enum(DEPOSIT_STATUSES).optional(),
  landlordId: idSchema.optional().nullable(),
  notes: optionalText(2000),
});

export const leaseRenewSchema = z.object({
  endDate: dateStringSchema,
  rentMinor: positiveMinorSchema.optional(),
});

export const paymentCreateSchema = z.object({
  amountMinor: positiveMinorSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(200),
  paidAt: dateStringSchema,
});

export const maintenanceCreateSchema = z.object({
  unitId: idSchema,
  leaseId: idSchema.optional().nullable(),
  title: z.string().trim().min(3).max(200),
  description: optionalText(5000),
  priority: z.enum(PRIORITIES).default("NORMAL"),
});
export const maintenanceAssignSchema = z.object({
  assignedToName: z.string().trim().min(1).max(200),
  assignedToPhone: phoneSchema.optional().nullable(),
});
export const maintenanceStatusSchema = z
  .object({
    status: z.enum(MAINTENANCE_STATUSES),
    costMinor: minorSchema.optional().nullable(),
    paidByLandlord: z.boolean().optional(),
  })
  .refine((v) => v.status !== "DONE" || (v.costMinor !== undefined && v.costMinor !== null), {
    message: "Cost is required to mark a request done (zero is allowed)",
    path: ["costMinor"],
  });
export const commentSchema = z.object({ text: z.string().trim().min(1).max(5000) });

export const tenantMaintenanceSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: optionalText(5000),
  priority: z.enum(PRIORITIES).default("NORMAL"),
});

// ---------- Viewings, saved searches, reminders ----------
export const viewingCreateSchema = z.object({
  unitId: idSchema.optional().nullable(),
  scheduledAt: instantSchema,
});
export const viewingUpdateSchema = z.object({
  scheduledAt: instantSchema.optional(),
  status: z.enum(["BOOKED", "DONE", "CANCELLED", "NO_SHOW"]).optional(),
});

export const savedSearchSchema = z.object({
  customerId: idSchema,
  purpose: z.enum(UNIT_PURPOSES).optional().nullable(),
  type: z.enum(UNIT_TYPES).optional().nullable(),
  area: z.string().trim().max(200).optional().nullable(),
  minPriceMinor: minorSchema.optional().nullable(),
  maxPriceMinor: minorSchema.optional().nullable(),
  bedrooms: z.number().int().min(0).max(50).optional().nullable(),
});

export const REMINDER_TYPES = [
  "viewing.reminder",
  "rent.due_soon",
  "rent.overdue",
  "lease.expiring",
  "lead.followup_overdue",
  "offers",
] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const reminderSettingsSchema = z.object({
  enabled: z.record(z.enum(REMINDER_TYPES), z.boolean()).default({}),
  leadResponseHours: z.number().int().min(1).max(72).default(1),
  rentDueSoonDays: z.number().int().min(1).max(30).default(3),
  rentOverdueDays: z.array(z.number().int().min(1).max(90)).max(5).default([1, 7]),
  leaseExpiringDays: z.number().int().min(7).max(180).default(60),
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;
