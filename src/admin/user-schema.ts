import { z } from "zod";

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
