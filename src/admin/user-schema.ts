import { z } from "zod";
import { SECTIONS, type Section } from "./permissions";

// Zod request schemas for admin user-management + reset endpoints (admin-management Phase 1
// plan, Task 4). Pure, DB-free — consumed by the routes in src/routes/admin-users.ts (Task 5).

const roleEnum = z.enum(["viewer", "editor", "admin"]);
const statusEnum = z.enum(["active", "disabled"]);

export const inviteSchema = z.object({
  email: z.string().email().max(254),
  fullName: z.string().min(1).max(120),
  role: roleEnum,
});

export type InviteInput = z.infer<typeof inviteSchema>;

export const userPatchSchema = z
  .object({
    role: roleEnum.optional(),
    status: statusEnum.optional(),
  })
  .strict()
  .refine((data) => data.role !== undefined || data.status !== undefined, {
    message: "at least one of role or status must be present",
  });

export type UserPatchInput = z.infer<typeof userPatchSchema>;

export const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10).max(200),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const forgotSchema = z.object({
  email: z.string().email(),
});

export type ForgotInput = z.infer<typeof forgotSchema>;

// Step 2 of admin login (Phase 3 · TASK-188, mandatory email 2FA): the emailed one-time code plus
// the optional "remember this device" flag. `code` is exactly 6 digits (matches
// src/admin/two-factor.ts's generateLoginCode shape) so a malformed guess 400s before it ever
// reaches the DB-backed attempt counter.
export const twoFactorSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  remember: z.boolean().optional(),
});

export type TwoFactorInput = z.infer<typeof twoFactorSchema>;

// PATCH /api/admin/users/:id/permissions (Admin Phase 2, Task 5). Requires a COMPLETE matrix — one
// level per section, matching the Team editor UI (Task 6), which always renders and submits all 13
// rows — rather than a Partial<PermissionMap> that would let a client silently omit a section. Both
// the outer object and the inner `permissions` object are `.strict()`, so an unknown top-level key
// or an unknown section name is rejected (400) rather than silently ignored.
const levelEnum = z.enum(["none", "view", "edit"]);
const permissionsShape = Object.fromEntries(SECTIONS.map((section) => [section, levelEnum])) as Record<
  Section,
  typeof levelEnum
>;

export const permissionsSchema = z
  .object({
    permissions: z.object(permissionsShape).strict(),
  })
  .strict();

export type PermissionsInput = z.infer<typeof permissionsSchema>;
