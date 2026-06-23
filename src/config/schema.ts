import { z } from "zod";

// Pure schema - NO side effects. Safe to import in tests.
export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().url(),

  EXTERNAL_API_ONE_BASE_URL: z.string().url(),
  EXTERNAL_API_ONE_KEY: z.string().min(1),
  EXTERNAL_API_TWO_KEY: z.string().min(1),
});

export type Config = z.infer<typeof configSchema>;
