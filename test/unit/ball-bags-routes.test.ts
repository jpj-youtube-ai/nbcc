import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Red bags at the Festive Ball: GET /bag and GET /bag/thank-you through the real Ball router, with
// Stripe and the database mocked and the clock set. /bag is public (no Ball gate: a guest at a table
// never sees a password), and both forward to /fill once Sunday 8 November 2026 is over in the UK.
// The thank you reads the bag count from the Stripe session; when it cannot, it is a plain thank
// you, never an error. Every id here is invented.

const state = vi.hoisted(() => ({
  retrieve: vi.fn(),
  gateOpen: false,
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "test",
    BALL_BASE_URL: "https://example.com",
    BALL_FROM_EMAIL: "ball@example.com",
    BALL_PREVIEW_PASSWORD: "an-invented-password",
    STRIPE_PUBLISHABLE_KEY: "",
  },
}));
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: (...args: unknown[]) => state.retrieve(...args) } } },
  stripeConfigured: false,
}));
vi.mock("../../src/clients/email", () => ({ sendBallRunUp: async () => undefined }));
vi.mock("../../src/db/ball-transfer", () => ({
  cancelReplacedCheckout: async () => undefined,
  getTransferSettings: async () => ({}),
  pendingCardSession: async () => null,
}));
vi.mock("../../src/db/ball", async (original) => {
  const real = await original<Record<string, unknown>>();
  const guarded: Record<string, unknown> = {};
  for (const name of Object.keys(real)) {
    guarded[name] = typeof real[name] === "function" ? () => { throw new Error(`${name} must not be called`); } : real[name];
  }
  return { ...guarded, getSettings: async () => ({ gateOpen: state.gateOpen, gateOpensAt: null }), getPreviewPasswordHash: async () => null };
});
vi.mock("../../src/db/events", () => ({ eventsPageIsOn: async () => false }));
vi.mock("../../src/db/fundraisers", () => ({ fundraisingIsOn: async () => false }));
vi.mock("../../src/ball/preview-access", () => ({ holdsPreviewCookie: async () => false, previewSecret: () => "an-invented-secret" }));

import { ballRouter } from "../../src/routes/ball";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(ballRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T21:00:00Z"));
  state.retrieve.mockReset();
  state.gateOpen = false;
});
afterEach(() => vi.useRealTimers());

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("GET /bag", () => {
  it("is served to anyone, with the Ball's gate shut and no cookie", async () => {
    const res = await get("/bag");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0");
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain("Thank you for being here tonight");
  });

  it("is still there in the last second of Sunday 8 November", async () => {
    vi.setSystemTime(new Date("2026-11-08T23:59:59Z"));
    expect((await get("/bag")).status).toBe(200);
  });

  it("forwards to Fill a Red Bag once the Sunday is over", async () => {
    vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
    const res = await get("/bag");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/fill");
  });
});

describe("GET /bag/thank-you", () => {
  it("says how many bags the session paid for, and is never cached", async () => {
    state.retrieve.mockResolvedValue({ payment_status: "paid", metadata: { ballBags: "3" }, amount_total: 15000 });
    const res = await get("/bag/thank-you?session_id=cs_test_invented123");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(state.retrieve).toHaveBeenCalledWith("cs_test_invented123");
    const html = await res.text();
    expect(html).toContain("You've filled 3 red bags");
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });

  it("is a plain thank you, with no count, for a session that is not paid", async () => {
    state.retrieve.mockResolvedValue({ payment_status: "unpaid", metadata: { ballBags: "3" }, amount_total: 15000 });
    const res = await get("/bag/thank-you?session_id=cs_test_invented123");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("You've filled");
    expect(html).toContain("Enjoy the rest of your night.");
  });

  it("is a plain thank you when Stripe cannot be read", async () => {
    state.retrieve.mockRejectedValue(new Error("Stripe is out of reach"));
    const res = await get("/bag/thank-you?session_id=cs_test_invented123");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("You've filled");
    expect(html).toContain("Enjoy the rest of your night.");
  });

  it("asks Stripe nothing without a session id, or with one that is not a session's shape", async () => {
    expect((await get("/bag/thank-you")).status).toBe(200);
    expect((await get("/bag/thank-you?session_id=not-a-session")).status).toBe(200);
    expect((await get("/bag/thank-you?session_id=cs_x&session_id=cs_y")).status).toBe(200);
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it("forwards to Fill a Red Bag once the Sunday is over", async () => {
    vi.setSystemTime(new Date("2026-11-09T00:00:01Z"));
    const res = await get("/bag/thank-you?session_id=cs_test_invented123");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/fill");
    expect(state.retrieve).not.toHaveBeenCalled();
  });
});
