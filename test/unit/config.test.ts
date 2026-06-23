import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema";

describe("config schema", () => {
  it("rejects an env that is missing DATABASE_URL", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a fully populated env", () => {
    const result = configSchema.safeParse({
      DATABASE_URL: "postgres://app:app@localhost:5432/charity",
      EXTERNAL_API_ONE_BASE_URL: "https://sandbox.api-one.example",
      EXTERNAL_API_ONE_KEY: "k",
      EXTERNAL_API_TWO_KEY: "k",
    });
    expect(result.success).toBe(true);
  });
});
