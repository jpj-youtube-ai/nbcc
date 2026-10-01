import { configSchema } from "./schema";

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a missing SSM parameter (or a typo'd key) stops the container
  // from booting, so you find it at deploy time via the health check -
  // not on the first user request in production.
  console.error(
    "Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const config = parsed.data;
