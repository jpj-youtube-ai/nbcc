import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: the one sender of a family's sign in code (src/elf/sign-in-code.ts). The
// public sign in page never says whether a code went (it must not tell anyone who is enrolled); a head
// elf sending one from Head Elf HQ is told when it did not. Every family here is invented.

const m = vi.hoisted(() => ({ activeFamilyByEmail: vi.fn(), saveElfSignInCode: vi.fn(), sendElfSignInCode: vi.fn() }));
vi.mock("../../src/db/elf", () => ({ activeFamilyByEmail: m.activeFamilyByEmail, saveElfSignInCode: m.saveElfSignInCode }));
vi.mock("../../src/clients/email", () => ({ sendElfSignInCode: m.sendElfSignInCode }));
vi.mock("../../src/config", () => ({ config: { ADMIN_SESSION_SECRET: "test-secret", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { sendSignInCodeTo } from "../../src/elf/sign-in-code";

beforeEach(() => {
  vi.clearAllMocks();
  m.activeFamilyByEmail.mockResolvedValue({ id: 3, grownUpName: "Sam Example" });
  m.saveElfSignInCode.mockResolvedValue(undefined);
  m.sendElfSignInCode.mockResolvedValue(undefined);
});

describe("sending a family a sign in code", () => {
  it("answers true once the code is saved and the email handed to the sender", async () => {
    expect(await sendSignInCodeTo("sam@example.org")).toBe(true);
    expect(m.saveElfSignInCode).toHaveBeenCalledTimes(1);
    expect(m.sendElfSignInCode).toHaveBeenCalledTimes(1);
    expect(m.sendElfSignInCode.mock.calls[0][0]).toBe("Sam Example");
  });

  it("answers false, and sends nothing, when no family that may sign in has that email", async () => {
    m.activeFamilyByEmail.mockResolvedValue(null);
    expect(await sendSignInCodeTo("nobody@example.org")).toBe(false);
    expect(m.sendElfSignInCode).not.toHaveBeenCalled();
  });

  it("answers false, and never throws, when the email cannot be sent", async () => {
    m.sendElfSignInCode.mockRejectedValue(new Error("the address is suppressed"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendSignInCodeTo("sam@example.org")).toBe(false);
    quiet.mockRestore();
  });
});
