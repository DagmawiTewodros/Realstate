import { z } from "zod";
import { emailSchema, localeSchema, nameSchema, passwordSchema } from "./common";

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
  name: nameSchema.optional(),
});

/** User schemas are built per system because the two systems have different roles. */
export function makeUserSchemas<R extends readonly [string, ...string[]]>(roles: R) {
  const create = z.object({
    name: nameSchema,
    email: emailSchema,
    role: z.enum(roles),
    locale: localeSchema.default("en"),
    password: passwordSchema,
    telegramChatId: z.string().trim().max(64).optional().nullable(),
  });
  const update = z.object({
    name: nameSchema.optional(),
    role: z.enum(roles).optional(),
    locale: localeSchema.optional(),
    telegramChatId: z.string().trim().max(64).optional().nullable(),
    isActive: z.boolean().optional(),
  });
  return { create, update };
}
