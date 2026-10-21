import { z } from "zod";
import { CHANNELS, LOCALES } from "../enums";
import { isValidDateString } from "../dates";
import { normalizePhone } from "../phone";

export const idSchema = z.string().uuid();
export const localeSchema = z.enum(LOCALES);
export const channelSchema = z.enum(CHANNELS);

export const dateStringSchema = z.string().refine(isValidDateString, { message: "Expected a valid date as YYYY-MM-DD" });
export const instantSchema = z.coerce.date();

/** Money in santim. */
export const minorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positiveMinorSchema = minorSchema.refine((v) => v > 0, { message: "Must be more than zero" });

export const nameSchema = z.string().trim().min(1).max(200);
export const optionalText = (max = 2000) => z.string().trim().max(max).optional().nullable();

/** Accepts any common phone format and returns the normalized "+251..." value. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid phone number" });
      return z.NEVER;
    }
    return normalized;
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export const dateRangeSchema = z
  .object({ from: dateStringSchema, to: dateStringSchema })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" });

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(200);

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
