import { existsSync } from "node:fs";
import { z } from "zod";

/**
 * Development convenience: reads ./.env when it exists and NODE_ENV is not production.
 * Variables already set in the environment win. Production sets real environment variables instead.
 */
export function loadDotEnv(path = ".env"): void {
  if (process.env.NODE_ENV === "production" || !existsSync(path)) return;
  process.loadEnvFile(path);
}

/**
 * Environment variables both APIs need. Each app extends this with its own variables.
 * The app refuses to start when a required variable is missing or invalid (see loadConfig).
 */
export const baseConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().url().refine((v) => v.startsWith("postgres"), "DATABASE_URL must be a postgres URL"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** Base URL of the web app, used in links inside messages (opt-out, invitations, listings). */
  PUBLIC_WEB_URL: z.string().url(),
  /** Origins allowed to call the API from a browser (comma-separated). */
  CORS_ORIGINS: z.string().default(""),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** "direct" runs the automation rules inside the API; "n8n" posts signed webhooks to n8n. */
  AUTOMATION_MODE: z.enum(["direct", "n8n", "off"]).default("direct"),
  N8N_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  INTERNAL_API_SECRET: z.string().min(16),
  DISPATCHER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  TELEGRAM_BOT_TOKEN: z.string().optional().or(z.literal("")),
  SMTP_HOST: z.string().optional().or(z.literal("")),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional().or(z.literal("")),
  SMTP_PASSWORD: z.string().optional().or(z.literal("")),
  SMTP_FROM: z.string().default("no-reply@example.com"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional().or(z.literal("")),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional().or(z.literal("")),
  S3_ACCESS_KEY: z.string().optional().or(z.literal("")),
  S3_SECRET_KEY: z.string().optional().or(z.literal("")),
  ERROR_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  ALERT_TELEGRAM_CHAT_ID: z.string().optional().or(z.literal("")),
  COMPANY_NAME: z.string().default("Company"),
  /** Proxies in front of the API: 1 = web app only (development), 2 = HTTPS proxy + web app (docker-compose). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});
export type BaseConfig = z.infer<typeof baseConfigSchema>;

export class ConfigError extends Error {}

/** Validates environment variables. Throws one clear error listing every problem. */
export function loadConfig<S extends z.ZodTypeAny>(schema: S, env: Record<string, string | undefined> = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const config = result.data as BaseConfig;
  if (config.AUTOMATION_MODE === "n8n" && !config.N8N_WEBHOOK_URL) {
    throw new ConfigError("Invalid environment configuration:\n  - N8N_WEBHOOK_URL: required when AUTOMATION_MODE=n8n");
  }
  if (config.STORAGE_DRIVER === "s3" && (!config.S3_BUCKET || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY)) {
    throw new ConfigError("Invalid environment configuration:\n  - S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY: required when STORAGE_DRIVER=s3");
  }
  return result.data;
}
