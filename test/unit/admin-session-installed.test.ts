import { describe, it, expect } from "vitest";
import {
  ADMIN_SESSION_TTL_MS,
  INSTALLED_APP_TTL_MS,
  sessionTtlMs,
  signAdminSession,
  verifyAdminSession,
} from "../../src/admin/session";

// How long a signed-in admin stays signed in (TASK-619).
//
// A browser tab keeps the 8 hours it always had. The admin pinned to a phone's home screen gets
// 30 days, because iOS shuts a backgrounded web app whenever it likes: without this, a
// notification at 2am buzzes the phone, the tap opens the app, and the app asks for a password
// instead of showing the donation — which is the whole feature failing at the last step.
//
// Jaimie chose 30 days on 12 Nov, knowing the trade: anybody holding her unlocked phone is inside
// the admin.

describe("how long a session lasts", () => {
  it("is eight hours in an ordinary browser tab", () => {
    expect(sessionTtlMs({ installed: false })).toBe(ADMIN_SESSION_TTL_MS);
    expect(sessionTtlMs({ installed: false })).toBe(8 * 60 * 60 * 1000);
  });

  it("is thirty days in the app pinned to a home screen", () => {
    expect(sessionTtlMs({ installed: true })).toBe(INSTALLED_APP_TTL_MS);
    expect(sessionTtlMs({ installed: true })).toBe(30 * 24 * 60 * 60 * 1000);
  });

  // Every existing caller omits it, and an older admin page will not send it at all. Treating
  // that as a tab keeps the shorter session as the default everywhere it is not asked for.
  it("is eight hours when nothing says otherwise", () => {
    expect(sessionTtlMs({})).toBe(ADMIN_SESSION_TTL_MS);
    expect(sessionTtlMs({ installed: undefined })).toBe(ADMIN_SESSION_TTL_MS);
  });

  // Only a real boolean lengthens it, so a stray string from a hand-made request cannot.
  it.each([["yes"], [1], [{}], [null]])("is eight hours when handed %o rather than a boolean", (installed) => {
    expect(sessionTtlMs({ installed } as never)).toBe(ADMIN_SESSION_TTL_MS);
  });
});

describe("a token issued for the pinned app", () => {
  const secret = "test-secret";
  const now = new Date("2026-11-12T00:00:00Z");

  it("is still good a fortnight later, where a tab's token is not", () => {
    const app = signAdminSession({ sub: 1, email: "a@nbcc.scot", role: "admin", now, secret, ttlMs: sessionTtlMs({ installed: true }) });
    const tab = signAdminSession({ sub: 1, email: "a@nbcc.scot", role: "admin", now, secret, ttlMs: sessionTtlMs({ installed: false }) });
    const fortnight = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    expect(verifyAdminSession(app.token, secret, fortnight).sub).toBe(1);
    expect(() => verifyAdminSession(tab.token, secret, fortnight)).toThrow(/expired/);
  });

  it("does eventually expire, so it is a long session and not a permanent one", () => {
    const app = signAdminSession({ sub: 1, email: "a@nbcc.scot", role: "admin", now, secret, ttlMs: sessionTtlMs({ installed: true }) });
    const later = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(() => verifyAdminSession(app.token, secret, later)).toThrow(/expired/);
  });
});
