import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-212: the business thank-you page API. GET /api/business/fulfilment/:token returns the state the
// page renders (band + eligible perks + already-captured + saved prefs); POST captures the choices
// ONCE. The token IS the auth, so an unknown token returns the SAME generic 404 as a known one (no
// enumeration), and both routes are rate limited. The DB layer (getFulfilmentPageContextByToken,
// updateFulfilmentPreferences) is mocked so the route logic runs DB-free; the real FulfilmentCaptureError
// class is supplied by the mock so the route's `instanceof` maps a submit-once collision to 409.

const { getCtxMock, getBySessionMock, updateMock, CaptureError } = vi.hoisted(() => {
  class CaptureError extends Error {
    public readonly reason: "not_found" | "already_captured";
    constructor(reason: "not_found" | "already_captured") {
      super(reason);
      this.name = "FulfilmentCaptureError";
      this.reason = reason;
    }
  }
  return { getCtxMock: vi.fn(), getBySessionMock: vi.fn(), updateMock: vi.fn(), CaptureError };
});

vi.mock("../../src/db/fulfilment", () => ({
  getFulfilmentPageContextByToken: getCtxMock,
  getFulfilmentPageContextBySession: getBySessionMock,
  updateFulfilmentPreferences: updateMock,
  FulfilmentCaptureError: CaptureError,
}));

// TASK-221: business.ts now imports the Stripe client (by-session retrieve), the email client
// (capture-confirmation send) and config — mock all three so the route logic runs DB-free and
// network-free (config would otherwise process.exit on missing env). The Stripe stub exposes ONLY
// checkout.sessions.retrieve (what the READ-ONLY by-session endpoint calls). The real pure
// capture-confirmation-email builder is NOT mocked, so the send tests also prove it is wired.
const { retrieveMock, sendCaptureMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  sendCaptureMock: vi.fn(),
}));
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: retrieveMock } } },
}));
vi.mock("../../src/clients/email", () => ({ sendBusinessCaptureConfirmation: sendCaptureMock }));
vi.mock("../../src/config", () => ({
  config: { PORTAL_BASE_URL: "https://nbcc.test", GIVING_FROM_EMAIL: "giving@nbcc.scot" },
}));

import { getFulfilment, getFulfilmentBySession, postFulfilment } from "../../src/routes/business";

// A platinum record, not yet captured. perksForBand(platinum) exposes all four recognition sections.
const platinumCtx = {
  band: "platinum" as const,
  businessName: "Gorilla Jetwash",
  email: "biz@acme.test",
  captured: false,
  creditName: null,
  website: null,
  socials: null,
  listOnSupporters: false,
  wantSocial: false,
  wantBadge: false,
  wantCertificate: false,
  certificateDelivery: null,
  certificateAddress: null,
  consentFeatured: false,
};
// A bronze record: only the Supporters-page question is asked (plus the newsletter statement).
const bronzeCtx = { ...platinumCtx, band: "bronze" as const, businessName: "Small Bakery Ltd" };

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runGet = async (token: string, ip = "t1") => { const res = mockRes(); await getFulfilment({ params: { token }, ip } as any, res as any); return res; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runPost = async (token: string, body: unknown, ip = "t1") => { const res = mockRes(); await postFulfilment({ params: { token }, body, ip } as any, res as any); return res; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runBySession = async (sessionId: string, ip = "s1") => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await getFulfilmentBySession({ params: { sessionId }, ip } as any, res as any);
  return res;
};

// A completed monthly (subscription) session that BANDS as a business supporter (company, £100/mo).
const completedBizSession = {
  id: "cs_biz",
  status: "complete",
  mode: "subscription",
  amount_total: 10000,
  metadata: { mode: "monthly", donorType: "company", businessName: "Acme Ltd" },
};
// A completed monthly session for an INDIVIDUAL (no business name) — bands to nothing.
const completedIndivSession = {
  id: "cs_ind",
  status: "complete",
  mode: "subscription",
  amount_total: 5000,
  metadata: { mode: "monthly", donorType: "individual", businessName: "" },
};
// The by-session DB context shape (FulfilmentSessionContext): the page state PLUS the token.
const sessionCtxReady = {
  token: "tok_sess",
  band: "platinum" as const,
  businessName: "Gorilla Jetwash",
  email: "biz@acme.test",
  captured: false,
  creditName: null,
  website: null,
  socials: null,
  listOnSupporters: false,
  wantSocial: false,
  wantBadge: false,
  wantCertificate: false,
  certificateDelivery: null,
  certificateAddress: null,
  consentFeatured: false,
};

beforeEach(() => {
  getCtxMock.mockReset();
  getBySessionMock.mockReset();
  updateMock.mockReset();
  retrieveMock.mockReset();
  sendCaptureMock.mockReset();
  sendCaptureMock.mockResolvedValue(undefined);
});

describe("GET /api/business/fulfilment/:token (TASK-212)", () => {
  it("returns the band, eligible perks and business name for a valid, not-yet-captured token", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    const res = await runGet("tok_plat", "ip_get_1");
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.businessName).toBe("Gorilla Jetwash");
    expect(body.band).toBe("platinum");
    expect(body.captured).toBe(false);
    expect(body.preferences).toBeNull(); // not captured → no saved prefs echoed
    // Platinum exposes every recognition section.
    expect(body.perks).toMatchObject({
      supportersListing: true,
      newsletter: true,
      socialThankYou: true,
      digitalBadge: true,
      certificate: true,
    });
  });

  it("returns the saved preferences for an already-captured token (submit-once read-only)", async () => {
    getCtxMock.mockResolvedValue({
      ...platinumCtx,
      captured: true,
      listOnSupporters: true,
      creditName: "Gorilla Jetwash",
      wantSocial: true,
      socials: "@gorilla",
      wantBadge: true,
      wantCertificate: true,
      certificateDelivery: "download",
    });
    const res = await runGet("tok_done", "ip_get_2");
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.captured).toBe(true);
    expect(body.preferences).toMatchObject({
      listOnSupporters: true,
      creditName: "Gorilla Jetwash",
      wantSocial: true,
      wantCertificate: true,
      certificateDelivery: "download",
    });
  });

  it("bronze exposes only the Supporters-page perk (no platinum extras)", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    const res = await runGet("tok_bronze", "ip_get_3");
    const perks = (res.body as Record<string, Record<string, boolean>>).perks;
    expect(perks).toMatchObject({
      supportersListing: true,
      newsletter: true,
      socialThankYou: false,
      digitalBadge: false,
      certificate: false,
    });
  });

  it("returns a generic 404 for an unknown token (no enumeration)", async () => {
    getCtxMock.mockResolvedValue(null);
    const res = await runGet("nope", "ip_get_4");
    expect(res.statusCode).toBe(404);
    // The message is identical to any other not-found, so a valid token is indistinguishable.
    expect((res.body as { error: string }).error).toMatch(/not valid/i);
  });
});

describe("POST /api/business/fulfilment/:token (TASK-212)", () => {
  it("saves once and returns the confirmation for a valid bronze submission", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    updateMock.mockResolvedValue({ id: 7, band: "bronze" });
    const res = await runPost("tok_bronze", { listOnSupporters: true, creditName: "Small Bakery Ltd" }, "ip_post_1");
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [token, prefs, actor] = updateMock.mock.calls[0];
    expect(token).toBe("tok_bronze");
    expect(actor).toBe("business");
    // Bronze can never set the platinum extras true, even if the body tried.
    expect(prefs).toMatchObject({
      listOnSupporters: true,
      creditName: "Small Bakery Ltd",
      wantSocial: false,
      wantBadge: false,
      wantCertificate: false,
      certificateDelivery: null,
      consentFeatured: true, // listed on supporters → consented to be featured
    });
  });

  it("saves a full platinum submission, composing the posted certificate address", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    updateMock.mockResolvedValue({ id: 9, band: "platinum" });
    const res = await runPost(
      "tok_plat",
      {
        listOnSupporters: true,
        creditName: "Gorilla Jetwash",
        website: "gorillajetwash.co.uk",
        wantSocial: true,
        socials: "@gorilla",
        wantBadge: true,
        wantCertificate: true,
        certificateDelivery: "post",
        addressLine1: "1 Suds Lane",
        town: "Ayr",
        postcode: "KA1 1AA",
      },
      "ip_post_2",
    );
    expect(res.statusCode).toBe(200);
    const prefs = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(prefs).toMatchObject({
      wantSocial: true,
      socials: "@gorilla",
      wantBadge: true,
      wantCertificate: true,
      certificateDelivery: "post",
      certificateAddress: "1 Suds Lane\nAyr\nKA1 1AA",
    });
  });

  it("ignores platinum answers on a bronze band (defence in depth)", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    updateMock.mockResolvedValue({ id: 7, band: "bronze" });
    await runPost(
      "tok_bronze",
      { listOnSupporters: false, wantSocial: true, wantBadge: true, wantCertificate: true, certificateDelivery: "download" },
      "ip_post_3",
    );
    const prefs = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(prefs).toMatchObject({ wantSocial: false, wantBadge: false, wantCertificate: false, certificateDelivery: null });
  });

  it("400s when a required question is unanswered (platinum missing the social answer)", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    const res = await runPost(
      "tok_plat",
      { listOnSupporters: true, creditName: "Gorilla Jetwash", wantBadge: false, wantCertificate: false },
      "ip_post_4",
    );
    expect(res.statusCode).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400s when Show my business is chosen without a display name", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    const res = await runPost("tok_bronze", { listOnSupporters: true }, "ip_post_5");
    expect(res.statusCode).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400s and never writes when the credit name trips the bad-word filter (TASK-223)", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    const res = await runPost("tok_bronze", { listOnSupporters: true, creditName: "Fuck Co" }, "ip_post_bad");
    expect(res.statusCode).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("409s on an already-captured record and never calls the write (submit-once)", async () => {
    getCtxMock.mockResolvedValue({ ...bronzeCtx, captured: true });
    const res = await runPost("tok_bronze", { listOnSupporters: false }, "ip_post_6");
    expect(res.statusCode).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("409s when the DB submit-once guard trips a concurrent second submit", async () => {
    getCtxMock.mockResolvedValue(bronzeCtx);
    updateMock.mockRejectedValue(new CaptureError("already_captured"));
    const res = await runPost("tok_bronze", { listOnSupporters: false }, "ip_post_7");
    expect(res.statusCode).toBe(409);
  });

  it("returns the generic 404 for an unknown token before any write", async () => {
    getCtxMock.mockResolvedValue(null);
    const res = await runPost("nope", { listOnSupporters: false }, "ip_post_8");
    expect(res.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/business/fulfilment/by-session/:sessionId (TASK-221, READ-ONLY)", () => {
  it("returns ready + the token + page state when the fulfilment exists and is not captured", async () => {
    retrieveMock.mockResolvedValue(completedBizSession);
    getBySessionMock.mockResolvedValue(sessionCtxReady);
    const res = await runBySession("cs_ready", "ip_bs_1");
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe("ready");
    expect(body.token).toBe("tok_sess");
    expect(body.businessName).toBe("Gorilla Jetwash");
    expect(body.band).toBe("platinum");
    expect(body.captured).toBe(false);
    expect(body.preferences).toBeNull();
    expect(body.perks).toMatchObject({ socialThankYou: true, digitalBadge: true, certificate: true });
    // READ-ONLY: never writes.
    expect(updateMock).not.toHaveBeenCalled();
    // The donor email is NOT leaked to the browser.
    expect(JSON.stringify(body)).not.toContain("biz@acme.test");
  });

  it("returns captured + the saved preferences when already submitted", async () => {
    retrieveMock.mockResolvedValue(completedBizSession);
    getBySessionMock.mockResolvedValue({
      ...sessionCtxReady,
      captured: true,
      listOnSupporters: true,
      creditName: "Gorilla Jetwash",
      wantBadge: true,
      wantCertificate: true,
      certificateDelivery: "download",
    });
    const res = await runBySession("cs_done", "ip_bs_2");
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe("captured");
    expect(body.token).toBe("tok_sess");
    expect(body.preferences).toMatchObject({ listOnSupporters: true, wantCertificate: true, certificateDelivery: "download" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns pending when it IS a qualifying business monthly session but no record exists yet", async () => {
    retrieveMock.mockResolvedValue(completedBizSession); // company, £100/mo, complete subscription → bands
    getBySessionMock.mockResolvedValue(null); // the webhook has not written the record yet
    const res = await runBySession("cs_pending", "ip_bs_3");
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe("pending");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns none for a completed individual monthly session (no recognition applies)", async () => {
    retrieveMock.mockResolvedValue(completedIndivSession); // individual, no business name → bands nothing
    getBySessionMock.mockResolvedValue(null);
    const res = await runBySession("cs_indiv", "ip_bs_4");
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe("none");
  });

  it("returns none for a business monthly session below the £10/mo band", async () => {
    retrieveMock.mockResolvedValue({ ...completedBizSession, amount_total: 500 });
    getBySessionMock.mockResolvedValue(null);
    const res = await runBySession("cs_small", "ip_bs_5");
    expect((res.body as { status: string }).status).toBe("none");
  });

  it("returns none for a session that is not a completed subscription (defensive)", async () => {
    retrieveMock.mockResolvedValue({ ...completedBizSession, status: "open" });
    getBySessionMock.mockResolvedValue(null);
    const res = await runBySession("cs_open", "ip_bs_6");
    expect((res.body as { status: string }).status).toBe("none");
  });

  it("returns a generic 404 for an unknown/foreign session id (retrieve throws, no enumeration)", async () => {
    retrieveMock.mockRejectedValue(new Error("No such checkout session"));
    const res = await runBySession("cs_nope", "ip_bs_7");
    expect(res.statusCode).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not valid/i);
    // Never reads the DB or writes when the session is unknown.
    expect(getBySessionMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("429s once a single IP exceeds the per-session request budget", async () => {
    retrieveMock.mockResolvedValue(completedBizSession);
    getBySessionMock.mockResolvedValue(sessionCtxReady);
    let sawLimited = false;
    for (let i = 0; i < 50; i++) {
      const res = await runBySession("cs_flood", "ip_bs_flood");
      if (res.statusCode === 429) sawLimited = true;
    }
    expect(sawLimited).toBe(true);
  });
});

describe("POST capture confirmation email (TASK-221, best-effort, post-response)", () => {
  const validPlatinumBody = { listOnSupporters: false, wantSocial: false, wantBadge: false, wantCertificate: false };

  it("emails the capture confirmation on a successful submit, From/Reply-To the giving inbox", async () => {
    getCtxMock.mockResolvedValue(platinumCtx); // carries an email
    updateMock.mockResolvedValue({ id: 9, band: "platinum" });
    const res = await runPost("tok_plat", validPlatinumBody, "ip_cc_1");
    expect(res.statusCode).toBe(200);
    expect(sendCaptureMock).toHaveBeenCalledOnce();
    const msg = sendCaptureMock.mock.calls[0][0];
    expect(msg.email).toBe("biz@acme.test");
    expect(msg.from).toBe("giving@nbcc.scot");
    expect(msg.replyTo).toBe("giving@nbcc.scot");
    expect(msg.subject).toContain("Gorilla Jetwash"); // built by the real pure builder → wired
    expect(msg.html).toContain("You are all set");
    expect(msg.text.length).toBeGreaterThan(0);
  });

  it("still returns 200 (capture succeeds) when the confirmation send throws", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    updateMock.mockResolvedValue({ id: 9, band: "platinum" });
    sendCaptureMock.mockRejectedValue(new Error("relay 500"));
    const res = await runPost("tok_plat", validPlatinumBody, "ip_cc_2");
    // The thrown send is swallowed — the capture is unaffected.
    expect(res.statusCode).toBe(200);
    expect((res.body as { captured: boolean }).captured).toBe(true);
    expect(sendCaptureMock).toHaveBeenCalledOnce();
  });

  it("sends NO confirmation when the business gave us no email", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, email: null });
    updateMock.mockResolvedValue({ id: 9, band: "platinum" });
    const res = await runPost("tok_plat", validPlatinumBody, "ip_cc_3");
    expect(res.statusCode).toBe(200);
    expect(sendCaptureMock).not.toHaveBeenCalled();
  });

  it("does NOT send when the capture 409s (already captured — no new choices to confirm)", async () => {
    getCtxMock.mockResolvedValue({ ...platinumCtx, captured: true });
    const res = await runPost("tok_plat", validPlatinumBody, "ip_cc_4");
    expect(res.statusCode).toBe(409);
    expect(sendCaptureMock).not.toHaveBeenCalled();
  });
});

describe("rate limiting (TASK-212, mirrors the portal request limiter)", () => {
  it("429s once a single IP exceeds the per-token request budget", async () => {
    getCtxMock.mockResolvedValue(platinumCtx);
    let sawLimited = false;
    let last = 200;
    // The per-token cap is 40 within the window; drive past it from one fresh token + IP so this test
    // never drains the budget of the others (which each use their own token/IP).
    for (let i = 0; i < 50; i++) {
      const res = await runGet("tok_flood", "ip_flood");
      last = res.statusCode;
      if (res.statusCode === 429) sawLimited = true;
    }
    expect(sawLimited).toBe(true);
    expect(last).toBe(429); // still limited at the end of the burst
  });
});
