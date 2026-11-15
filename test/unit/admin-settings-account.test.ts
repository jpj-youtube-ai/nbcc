// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { roleToPermissions } from "../../src/admin/permissions";
import { mountAdmin, el, q, text, press, type, settle, adminHtml, type Call, type Reply } from "./helpers/admin-settings-harness";

// My account, in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-settings.md). Every
// address here is invented.

vi.setConfig({ testTimeout: 20_000 });

let passwordAnswer: Reply = { body: { ok: true } };
const route = (c: Call): Reply | undefined => (c.path === "/api/admin/me/password" ? passwordAnswer : undefined);

async function openAccount(role = "editor") {
  const admin = mountAdmin({ email: "isla@example.com", role, fullName: "Isla Example" }, route);
  await admin.signIn();
  press(el("accountBtn"));
  await settle();
  return admin;
}
async function changePassword(current: string, next: string, confirm: string) {
  type(el("accountCurrentPassword"), current);
  type(el("accountNewPassword"), next);
  type(el("accountConfirmPassword"), confirm);
  el("accountPasswordForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

describe("My account says how to change your email truthfully", () => {
  // Team cannot change an email address (src/admin/user-schema.ts takes only role and status).
  it("says to ask an Admin to remove you and invite your new address, not to change it in Team", () => {
    expect(adminHtml).toContain("ask an Admin to remove you and invite your new address");
    expect(adminHtml).not.toContain("ask an Admin to update it in Team");
  });
});

describe("changing your password", () => {
  it("shows the rule before anything is typed", async () => {
    await openAccount();
    expect(text(el("accountRule"))).toContain("At least 10 characters");
  });

  it("says when the two new passwords match, and when they do not", async () => {
    await openAccount();
    type(el("accountNewPassword"), "a-long-pretend-phrase");
    type(el("accountConfirmPassword"), "a-long-pretend");
    expect(text(el("accountMatch"))).toBe("These do not match yet.");
    type(el("accountConfirmPassword"), "a-long-pretend-phrase");
    expect(text(el("accountMatch"))).toBe("✓ These match.");
    expect(el("accountMatch").classList.contains("is-ok")).toBe(true);
  });

  it("shows what was typed when asked, and hides it again", async () => {
    await openAccount();
    const box = el("accountShow") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    ["accountCurrentPassword", "accountNewPassword", "accountConfirmPassword"].forEach((id) =>
      expect((el(id) as HTMLInputElement).type).toBe("text"),
    );
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect((el("accountNewPassword") as HTMLInputElement).type).toBe("password");
  });

  // The server says "Too many attempts. Please try again shortly." on a 429, and the screen used to
  // show "Could not change your password." instead.
  it("gives the server's own words when it says to wait", async () => {
    passwordAnswer = { status: 429, body: { error: "Too many attempts. Please try again shortly." } };
    await openAccount();
    await changePassword("old-pretend-pass", "a-long-pretend-phrase", "a-long-pretend-phrase");
    expect(text(el("accountPasswordStatus"))).toBe("Too many attempts. Please try again shortly.");
    expect(el("accountPasswordStatus").classList.contains("is-error")).toBe(true);
    passwordAnswer = { body: { ok: true } };
  });

  it("still says a wrong current password plainly", async () => {
    passwordAnswer = { status: 400, body: { error: "wrong_password" } };
    await openAccount();
    await changePassword("old-pretend-pass", "a-long-pretend-phrase", "a-long-pretend-phrase");
    expect(text(el("accountPasswordStatus"))).toBe("That current password is not right.");
    passwordAnswer = { body: { ok: true } };
  });
});

describe("what you can open", () => {
  it("names your role and says can look or can change for each area you have", async () => {
    await openAccount("editor");
    const box = el("accountAccess");
    expect(text(box)).toContain("Your role is Editor");
    expect(text(box)).toContain("Donations: can change");
    expect(text(box)).toContain("Audit: can look");
    // What is not in your access is named, so "why can I not see it?" has an answer.
    expect(text(box)).toContain("Team");
    expect(text(el("accountTiles"))).toContain(String(Object.values(roleToPermissions("editor")).filter((l) => l === "edit").length));
  });

  it("goes to Notifications, and signs out, from its cards", async () => {
    await openAccount();
    press(el("accountGoNotifications"));
    await settle();
    expect(el("view-notifications").hidden).toBe(false);
    press(el("accountBtn"));
    await settle();
    press(el("accountSignOut"));
    await settle();
    expect(el("loginView").hidden).toBe(false);
  });

  it("comes back to My account after a refresh", async () => {
    await openAccount();
    expect(window.sessionStorage.getItem("nbccAdminView")).toBe("account");
    expect(q("#view-account")?.hidden).toBe(false);
  });
});
