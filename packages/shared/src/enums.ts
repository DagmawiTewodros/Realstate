// Fixed names used by both systems. See AGENTS.md "Fixed enums and names".

export const LOCALES = ["am", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const CURRENCY = "ETB" as const;

export const PROPERTY_ROLES = ["OWNER", "SALES_MANAGER", "BROKER", "PROPERTY_MANAGER", "LANDLORD", "TENANT"] as const;
export type PropertyRole = (typeof PROPERTY_ROLES)[number];

export const GYM_ROLES = ["OWNER", "GYM_MANAGER", "TRAINER", "FRONT_DESK", "MEMBER"] as const;
export type GymRole = (typeof GYM_ROLES)[number];

export const CHANNELS = ["TELEGRAM", "EMAIL", "SMS", "WHATSAPP"] as const;
export type Channel = (typeof CHANNELS)[number];
/** SMS and WhatsApp stay disabled until a provider is approved. */
export const ENABLED_CHANNELS: readonly Channel[] = ["TELEGRAM", "EMAIL"];

export const LEAD_STATUSES = ["INQUIRY", "VIEWING", "OFFER", "SIGNED", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ["SIGNED", "LOST"];

export const LEAD_SOURCES = ["WEBSITE", "PHONE", "WALK_IN", "TELEGRAM", "REFERRAL", "SOCIAL", "IMPORT", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const ACTIVITY_TYPES = ["CALL", "VIEWING", "NOTE", "OFFER", "EMAIL", "TELEGRAM"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const UNIT_STATUSES = ["AVAILABLE", "RESERVED", "SOLD", "LEASED"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const UNIT_TYPES = ["APARTMENT", "HOUSE", "VILLA", "OFFICE", "SHOP", "LAND"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_PURPOSES = ["SALE", "RENT"] as const;
export type UnitPurpose = (typeof UNIT_PURPOSES)[number];

export const LEASE_STATUSES = ["DRAFT", "ACTIVE", "ENDED", "TERMINATED"] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const BILLING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const DEPOSIT_STATUSES = ["HELD", "RETURNED", "PARTIAL"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const CHARGE_STATUSES = ["DUE", "PARTIAL", "PAID", "OVERDUE", "WAIVED"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "TELEBIRR", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["VALID", "VOIDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MAINTENANCE_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const VIEWING_STATUSES = ["BOOKED", "DONE", "CANCELLED", "NO_SHOW"] as const;
export type ViewingStatus = (typeof VIEWING_STATUSES)[number];

export const MESSAGE_STATUSES = ["SENT", "FAILED", "BLOCKED_NO_CONSENT", "BLOCKED_NO_CONTACT", "BLOCKED_CHANNEL_DISABLED", "DEFERRED_QUIET_HOURS"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

// ---- Gym ----
export const MEMBER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const PLAN_KINDS = ["INDIVIDUAL", "FAMILY", "CORPORATE"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "FROZEN", "EXPIRED", "CANCELLED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const CHECKIN_METHODS = ["QR", "MANUAL"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export const CHECKIN_RESULTS = ["ALLOWED", "DENIED", "DUPLICATE"] as const;
export type CheckinResult = (typeof CHECKIN_RESULTS)[number];

export const DENIED_REASONS = ["EXPIRED", "FROZEN", "CANCELLED", "NO_MEMBERSHIP", "UNKNOWN_CODE", "INACTIVE_MEMBER"] as const;
export type DeniedReason = (typeof DENIED_REASONS)[number];

export const BOOKING_STATUSES = ["BOOKED", "CANCELLED", "ATTENDED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const SESSION_STATUSES = ["SCHEDULED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PERSONAL_SESSION_STATUSES = ["BOOKED", "DONE", "CANCELLED", "NO_SHOW"] as const;
export type PersonalSessionStatus = (typeof PERSONAL_SESSION_STATUSES)[number];
