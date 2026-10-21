import { z } from "zod";
import { baseConfigSchema, loadConfig } from "@platform/nest-common";

export const gymConfigSchema = baseConfigSchema.extend({
  /** Password given to the seed users. Required to run the seed; never stored in the repository. */
  SEED_PASSWORD: z.string().min(10).optional(),
});
export type GymConfig = z.infer<typeof gymConfigSchema>;

export function loadGymConfig(env: Record<string, string | undefined> = process.env): GymConfig {
  return loadConfig(gymConfigSchema, env);
}
