import { describe, it, expect, vi, beforeEach } from "vitest";

// Task B1: POST /api/my-story. DB-free unit coverage for the JSON path, validation,
// honeypot handling, and per-IP rate limiting — mirrors test/unit/contact-endpoint.test.ts
// (mock the DB write + config so no real pool/env is touched). The form-encoded (no-JS)
// HTML thank-you response and the real DB insert are covered by BDD in CI (per Task B1
// scope: "BDD (CI only - NO Docker locally, do NOT run)").

const { insertStory } = vi.hoisted(() => ({ insertStory: vi.fn() }));
vi.mock("../../src/db/stories", () => ({ insertStory }));

// api.ts also imports the Stripe client + config at module load; mock both so the
// real config (which would validate process.env and exit) is never loaded.
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
  stripePriceByPlan: {},
}));
vi.mock("../../src/config", () => ({
  config: { STRIPE_SUCCESS_URL: "https://nbcc.test/s", STRIPE_CANCEL_URL: "https://nbcc.test/c" },
}));

import { postMyStory, rejectOversizedMyStoryJson } from "../../src/routes/api";

type MockRes = {
  statusCode: number;
  body: unknown;
  contentType: string | undefined;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  type: (t: string) => MockRes;
  send: (b: unknown) => MockRes;
};

function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined, contentType: undefined } as MockRes;
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  res.type = (t: string) => {
    res.contentType = t;
    return res;
  };
  res.send = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

function jsonReq(body: unknown, ip = "1.2.3.4") {
  return {
    body,
    ip,
    is: (type: string) => (type === "application/json" ? "application/json" : false),
  };
}

const VALID = {
  submitterRole: "supported",
  storyText: "The Red Bag made such a difference.",
  useScope: "internal_only",
  confirmOver16: true,
};

beforeEach(() => {
  insertStory.mockReset();
  insertStory.mockResolvedValue({ id: 1 });
});

describe("POST /api/my-story — valid JSON submission", () => {
  it("inserts the story and returns 200 { ok: true }", async () => {
    const res = mockRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postMyStory(jsonReq(VALID) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(insertStory).toHaveBeenCalledOnce();
    expect(insertStory).toHaveBeenCalledWith(
      expect.objectContaining({ story_text: VALID.storyText, use_scope: "internal_only" }),
    );
  });
});

describe("POST /api/my-story — invalid bodies", () => {
  it.each([
    ["missing storyText", { ...VALID, storyText: "" }],
    ["confirmOver16 false", { ...VALID, confirmOver16: false }],
    ["missing confirmOver16", { submitterRole: "supported", storyText: "hi", useScope: "public" }],
    ["bad useScope enum", { ...VALID, useScope: "everywhere" }],
  ])("rejects %s with 400 and never inserts", async (_label, body) => {
    const res = mockRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postMyStory(jsonReq(body) as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(insertStory).not.toHaveBeenCalled();
  });
});

describe("POST /api/my-story — honeypot", () => {
  it("returns 200 without inserting when the honeypot field is filled", async () => {
    const res = mockRes();
    const body = { ...VALID, website: "http://spam.example" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postMyStory(jsonReq(body) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(insertStory).not.toHaveBeenCalled();
  });
});

describe("rejectOversizedMyStoryJson — body-size guard (G1 item 2)", () => {
  // The global express.json() (src/app.ts) already parses every route's JSON body at
  // its own 100kb default BEFORE apiRouter ever sees the request, and body-parser skips
  // re-parsing an already-parsed body — so a per-route express.json({ limit }) would be
  // a silent no-op. This middleware instead rejects an oversized JSON POST by its
  // Content-Length header, mounted ahead of the (already-run) global parser's effects.
  function req(opts: { contentType?: string | false; contentLength?: string }) {
    return {
      is: (type: string) =>
        opts.contentType === undefined
          ? false
          : opts.contentType === type
            ? type
            : false,
      headers: opts.contentLength !== undefined ? { "content-length": opts.contentLength } : {},
    };
  }
  function res() {
    const r = { statusCode: 200, body: undefined as unknown } as {
      statusCode: number;
      body: unknown;
      status: (c: number) => typeof r;
      json: (b: unknown) => typeof r;
    };
    r.status = (c) => {
      r.statusCode = c;
      return r;
    };
    r.json = (b) => {
      r.body = b;
      return r;
    };
    return r;
  }

  it("calls next() for a JSON body at or under the 32kb limit", () => {
    const next = vi.fn();
    const r = res();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rejectOversizedMyStoryJson(req({ contentType: "application/json", contentLength: String(32 * 1024) }) as any, r as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(r.statusCode).toBe(200);
  });

  it("rejects a JSON body over the 32kb limit with 413 and does not call next()", () => {
    const next = vi.fn();
    const r = res();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rejectOversizedMyStoryJson(req({ contentType: "application/json", contentLength: String(32 * 1024 + 1) }) as any, r as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(413);
  });

  it("calls next() for a non-JSON (form-encoded) request regardless of Content-Length", () => {
    const next = vi.fn();
    const r = res();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rejectOversizedMyStoryJson(req({ contentType: false, contentLength: String(1024 * 1024) }) as any, r as any, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when Content-Length is absent (streamed/chunked)", () => {
    const next = vi.fn();
    const r = res();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rejectOversizedMyStoryJson(req({ contentType: "application/json" }) as any, r as any, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("POST /api/my-story — per-IP rate limiting", () => {
  it("eventually rejects repeated submissions from the same IP", async () => {
    let lastRes: MockRes | undefined;
    for (let i = 0; i < 10; i++) {
      lastRes = mockRes();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await postMyStory(jsonReq(VALID, "9.9.9.9") as any, lastRes as any);
    }
    // Some call within these 10 must have been rate-limited (a non-200/400 status,
    // or insertStory called fewer than 10 times).
    expect(insertStory.mock.calls.length).toBeLessThan(10);
  });
});
