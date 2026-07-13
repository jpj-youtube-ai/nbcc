import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-212: the business thank-you page API. GET /api/business/fulfilment/:token returns the state the
// page renders (band + eligible perks + already-captured + saved prefs); POST captures the choices
// ONCE. The token IS the auth, so an unknown token returns the SAME generic 404 as a known one (no
// enumeration), and both routes are rate limited. The DB layer (getFulfilmentPageContextByToken,
// updateFulfilmentPreferences) is mocked so the route logic runs DB-free; the real FulfilmentCaptureError
// class is supplied by the mock so the route's `instanceof` maps a submit-once collision to 409.

const { getCtxMock, updateMock, CaptureError } = vi.hoisted(() => {
  class CaptureError extends Error {
    public readonly reason: "not_found" | "already_captured";
    constructor(reason: "not_found" | "already_captured") {
      super(reason);
      this.name = "FulfilmentCaptureError";
      this.reason = reason;
    }
  }
  return { getCtxMock: vi.fn(), updateMock: vi.fn(), CaptureError };
});

vi.mock("../../src/db/fulfilment", () => ({
  getFulfilmentPageContextByToken: getCtxMock,
  updateFulfilmentPreferences: updateMock,
  FulfilmentCaptureError: CaptureError,
}));

import { getFulfilment, postFulfilment } from "../../src/routes/business";

// A platinum record, not yet captured. perksForBand(platinum) exposes all four recognition sections.
const platinumCtx = {
  band: "platinum" as const,
  businessName: "Gorilla Jetwash",
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

beforeEach(() => {
  getCtxMock.mockReset();
  updateMock.mockReset();
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
