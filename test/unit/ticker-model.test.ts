import { describe, it, expect } from "vitest";
import { supporterCreateSchema, supporterUpdateSchema } from "../../src/ticker/model";

// TASK-178 (REQ-003): the supporter-ticker input schemas. Pure/DB-free, so unit-tested directly;
// the DB write layer is exercised via BDD.

describe("supporter ticker model (REQ-003)", () => {
  describe("supporterCreateSchema", () => {
    it("accepts a name, trimming whitespace", () => {
      const r = supporterCreateSchema.safeParse({ name: "  Ayrshire Bakery  " });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.name).toBe("Ayrshire Bakery");
    });
    it("accepts optional active + sortOrder", () => {
      expect(supporterCreateSchema.safeParse({ name: "X", active: false, sortOrder: 3 }).success).toBe(true);
    });
    it("rejects a blank name", () => {
      expect(supporterCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    });
    it("rejects an over-long name (>120)", () => {
      expect(supporterCreateSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
    });
  });

  describe("supporterUpdateSchema", () => {
    it("accepts a partial update", () => {
      expect(supporterUpdateSchema.safeParse({ active: false }).success).toBe(true);
      expect(supporterUpdateSchema.safeParse({ name: "New name" }).success).toBe(true);
    });
    it("rejects an empty update (no fields)", () => {
      expect(supporterUpdateSchema.safeParse({}).success).toBe(false);
    });
  });
});
