// TASK-178 (REQ-003): pure, DB-free model for the supporter ticker. The Zod input schemas are
// unit-tested; the transactional write layer lives in src/db/ticker.ts and is exercised via BDD.
import { z } from "zod";

// A supporter shown in the site's scrolling ticker. Name is required; active toggles visibility;
// sortOrder positions it (lower first). active/sortOrder are optional on create (sensible defaults).
export const supporterCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type SupporterCreate = z.infer<typeof supporterCreateSchema>;

// A partial update: any subset of the editable fields, but at least one.
export const supporterUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.active !== undefined || v.sortOrder !== undefined, {
    message: "no fields to update",
  });
export type SupporterUpdate = z.infer<typeof supporterUpdateSchema>;
