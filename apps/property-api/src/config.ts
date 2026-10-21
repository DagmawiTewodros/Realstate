import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@platform/nest-common";

export const propertyConfigSchema = baseConfigSchema.extend({
  /** Password given to the seed users. Required to run the seed; never stored in the repository. */
  SEED_PASSWORD: z.string().min(10).optional(),
});
export type PropertyConfig = z.infer<typeof propertyConfigSchema>;

export function loadPropertyConfig(env: Record<string, string | undefined> = process.env): PropertyConfig {
  return loadConfig(propertyConfigSchema, env);
}
