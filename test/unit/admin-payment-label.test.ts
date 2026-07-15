import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TASK-241 (admin donations list: payment status + refunds). paymentLabel is a pure helper that turns a
// donation's payment_status + refund into one display label/state for the donations table: Pending / Paid
// / Failed and — layered on a settled gift — Refunded (fully) or Partly refunded (partial). DOM-free, so
// it is required straight into the unit suite (helpers.js CommonJS-guard export), like the other helpers.

const require = createRequire(import.meta.url);
const H = require(resolve(__dirname, "../../assets/js/admin/helpers.js"));

const row = (over: Record<string, unknown> = {}) => ({
  payment_status: "paid",
  amount_pence: 5000,
  refunded_amount_pence: 0,
  ...over,
});

describe("admin paymentLabel (TASK-241)", () => {
  it("labels a settled, un-refunded gift Paid", () => {
    expect(H.paymentLabel(row())).toEqual({ label: "Paid", state: "paid" });
  });

  it("labels a pending gift Pending and a failed gift Failed", () => {
    expect(H.paymentLabel(row({ payment_status: "pending" }))).toEqual({ label: "Pending", state: "pending" });
    expect(H.paymentLabel(row({ payment_status: "failed" }))).toEqual({ label: "Failed", state: "failed" });
  });

  it("labels a fully refunded gift Refunded (refund >= amount)", () => {
    expect(H.paymentLabel(row({ refunded_amount_pence: 5000 }))).toEqual({ label: "Refunded", state: "refunded" });
    expect(H.paymentLabel(row({ refunded_amount_pence: 6000 }))).toEqual({ label: "Refunded", state: "refunded" });
  });

  it("labels a partially refunded gift Partly refunded", () => {
    expect(H.paymentLabel(row({ refunded_amount_pence: 1500 }))).toEqual({ label: "Partly refunded", state: "partial" });
  });

  it("keeps a non-settled gift as its status even if a stray refund figure is present", () => {
    expect(H.paymentLabel(row({ payment_status: "pending", refunded_amount_pence: 100 })).state).toBe("pending");
  });

  it("defaults missing fields safely (no crash) to Paid", () => {
    expect(H.paymentLabel({}).state).toBe("paid");
  });
});
