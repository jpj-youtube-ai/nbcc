import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TASK-245 (admin: surface cancelled subscriptions). subscriptionStateLabel is a pure helper that turns
// a subscription_dunning row into one display label/state for the admin subscriptions view: Active /
// At risk (past_due) / Lapsed (retries exhausted) / Cancelled (voluntarily ended). A cancelled row can
// keep status 'active' (the cancel is stamped in cancelled_at, not the status), so cancelled takes
// precedence. DOM-free, so required straight into the unit suite like the other helpers.

const require = createRequire(import.meta.url);
const H = require(resolve(__dirname, "../../assets/js/admin/helpers.js"));

const row = (over: Record<string, unknown> = {}) => ({
  status: "active",
  lapsed_at: null,
  cancelled_at: null,
  ...over,
});

describe("admin subscriptionStateLabel (TASK-245)", () => {
  it("labels a healthy subscription Active", () => {
    expect(H.subscriptionStateLabel(row())).toEqual({ label: "Active", state: "active" });
  });

  it("labels a past_due subscription At risk", () => {
    expect(H.subscriptionStateLabel(row({ status: "past_due" }))).toEqual({ label: "At risk", state: "past_due" });
  });

  it("labels a lapsed subscription Lapsed", () => {
    expect(H.subscriptionStateLabel(row({ status: "lapsed", lapsed_at: "2026-01-01T00:00:00Z" }))).toEqual({
      label: "Lapsed",
      state: "lapsed",
    });
  });

  it("labels a cancelled subscription Cancelled even though its status is still 'active'", () => {
    expect(H.subscriptionStateLabel(row({ status: "active", cancelled_at: "2026-01-01T00:00:00Z" }))).toEqual({
      label: "Cancelled",
      state: "cancelled",
    });
  });

  it("prefers Cancelled over the raw dunning status", () => {
    expect(H.subscriptionStateLabel(row({ status: "past_due", cancelled_at: "2026-01-01T00:00:00Z" })).state).toBe(
      "cancelled",
    );
  });

  it("defaults a missing row safely to Active (no crash)", () => {
    expect(H.subscriptionStateLabel(undefined).state).toBe("active");
  });
});
