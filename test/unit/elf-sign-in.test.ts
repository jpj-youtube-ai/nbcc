import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School: signing in with an emailed code, and the page Stripe sends people back
// to. Every family here is invented.

const db = vi.hoisted(() => ({
  getElfSettings: vi.fn(),
  activeFamilyByEmail: vi.fn(),
  saveElfSignInCode: vi.fn(),
  countElfCodeTry: vi.fn(),
  deleteElfSignInCode: vi.fn(),
  createElfSession: vi.fn(),
  findElfSession: vi.fn(),
  deleteElfSession: vi.fn(),
  orderForWelcome: vi.fn(),
  attachStripeSession: vi.fn(),
  createPendingJoin: vi.fn(),
  familyWithDetectives: vi.fn(),
  endOtherElfSessions: vi.fn(),
}));
const mail = vi.hoisted(() => ({ sendElfSignInCode: vi.fn(), sendElfWelcome: vi.fn() }));
vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "production", ADMIN_SESSION_SECRET: "test-secret", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" },
}));
// What every page of the site gains as it goes out (src/routes/site.ts): here the page goes out as drawn.
vi.mock("../../src/routes/site", () => ({ decorateSitePage: async (html: string) => html }));
// A sign in page that will not draw, when a test asks for one.
const drawing = vi.hoisted(() => ({ fail: false }));
vi.mock("../../src/elf/pages/sign-in", async (orig) => {
  const real = await orig<typeof import("../../src/elf/pages/sign-in")>();
  return {
    ...real,
    renderSignInPage: (...a: Parameters<typeof real.renderSignInPage>) => {
      if (drawing.fail) throw new Error("a page that will not draw");
      return real.renderSignInPage(...a);
    },
  };
});

import { elfSessionCookieOptions, ELF_PENDING_COOKIE, ELF_SESSION_COOKIE, hashElfToken } from "../../src/elf/session";
import { ELF_REQUEST_MESSAGE, getWelcome, postSignIn, postSignInRequest, signedInFamily } from "../../src/routes/elf";
import { hashSignInCode } from "../../src/fundraising/sign-in";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 };

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    html: "",
    cookies: [] as { name: string; value: string; opts: unknown }[],
    cleared: [] as string[],
    redirected: null as null | { status: number; url: string },
    locals: {} as Record<string, unknown>,
    headers: {} as Record<string, string>,
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
    type() {
      return res;
    },
    send(b: string) {
      res.html = b;
      res.headersSent = true;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
    cookie(name: string, value: string, opts: unknown) {
      res.cookies.push({ name, value, opts });
      return res;
    },
    clearCookie(name: string) {
      res.cleared.push(name);
      return res;
    },
    redirect(status: number, url: string) {
      res.redirected = { status, url };
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

const req = (o: { body?: unknown; cookie?: string; json?: boolean; query?: Record<string, string> } = {}) =>
  ({
    body: o.body ?? {},
    query: o.query ?? {},
    ip: "203.0.113.7",
    headers: {
      host: "nbcc.scot",
      "sec-fetch-site": "same-origin",
      ...(o.json ? { "content-type": "application/json" } : {}),
      ...(o.cookie ? { cookie: o.cookie } : {}),
    },
  }) as never;

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  for (const f of Object.values(mail)) f.mockReset();
  db.getElfSettings.mockResolvedValue(ON);
});

describe("the session cookie", () => {
  it("is httpOnly, lax, for the whole site, for 30 days, and Secure only in production", () => {
    expect(elfSessionCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60_000 });
    expect(elfSessionCookieOptions(false).secure).toBe(false);
    expect(ELF_SESSION_COOKIE).toBe("nbcc_elf_session");
  });
});

describe("asking for a sign in code", () => {
  it("gives the same answer whoever asks, and only emails a family that has detectives", async () => {
    const answers: unknown[] = [];
    for (const family of [null, { id: 3, grownUpName: "Sam Example" }]) {
      db.activeFamilyByEmail.mockResolvedValueOnce(family);
      const res = fakeRes();
      await postSignInRequest(req({ json: true, body: { email: `sam${answers.length}@example.com` } }), res as never);
      answers.push({ status: res.statusCode, body: res.body });
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(mail.sendElfSignInCode).toHaveBeenCalledTimes(1);
    const [, message] = mail.sendElfSignInCode.mock.calls[0];
    expect(message.email).toBe("sam1@example.com");
    expect(message.text).toMatch(/\d{6}/);
  });

  it("refuses a request sent from another website's page", async () => {
    const res = fakeRes();
    const r = req({ json: true, body: { email: "sam@example.com" } }) as unknown as { headers: Record<string, string> };
    r.headers["sec-fetch-site"] = "cross-site";
    r.headers.origin = "https://evil.example";
    await postSignInRequest(r as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(db.activeFamilyByEmail).not.toHaveBeenCalled();
  });
});

describe("signing in with the code", () => {
  it("starts a new session for the right code, and says the same thing for any wrong one", async () => {
    const email = "sam@example.com";
    db.countElfCodeTry.mockResolvedValue({ codeHash: hashSignInCode(email, "123456", "test-secret"), expiresAt: new Date(Date.now() + 60_000), attempts: 1 });
    db.activeFamilyByEmail.mockResolvedValue({ id: 3, grownUpName: "Sam Example" });
    const wrong = fakeRes();
    await postSignIn(req({ json: true, body: { email, code: "654321" } }), wrong as never);
    expect(wrong.statusCode).toBe(401);
    expect(db.createElfSession).not.toHaveBeenCalled();
    const right = fakeRes();
    await postSignIn(req({ json: true, body: { email, code: "123 456" } }), right as never);
    expect(right.statusCode).toBe(200);
    expect(db.createElfSession).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), 3, expect.any(Date));
    expect(right.cookies[0].name).toBe(ELF_SESSION_COOKIE);
    expect(db.deleteElfSignInCode).toHaveBeenCalledWith(email);
  });

  it("knows who is signed in from the cookie, and nobody without one", async () => {
    db.findElfSession.mockResolvedValue({ familyId: 3 });
    expect(await signedInFamily(req({ cookie: `${ELF_SESSION_COOKIE}=abcDEF123_-xyz` }))).toEqual({ familyId: 3, sessionHash: expect.any(String) });
    expect(await signedInFamily(req())).toBeNull();
    expect(await signedInFamily(req({ cookie: `${ELF_SESSION_COOKIE}=<script>` }))).toBeNull();
  });
});

describe("coming back from paying", () => {
  const token = "a".repeat(64);
  const cookie = `${ELF_PENDING_COOKIE}=${token}`;
  const order = (o: Record<string, unknown> = {}) => ({ familyId: 3, status: "paid", openedFamily: true, browserTokenHash: hashElfToken(token), ...o });

  it("signs the paying browser straight in when this payment opened the account", async () => {
    db.orderForWelcome.mockResolvedValue(order());
    const res = fakeRes();
    await getWelcome(req({ cookie, query: { elf_session: "cs_test_1" } }), res as never);
    expect(res.redirected).toEqual({ status: 303, url: "/elf/hq" });
    expect(db.createElfSession).toHaveBeenCalledWith(expect.any(String), 3, expect.any(Date));
    expect(res.cookies.map((c) => c.name)).toContain(ELF_SESSION_COOKIE);
    expect(res.cleared).toContain(ELF_PENDING_COOKIE);
  });

  it("never signs anyone in when the browser was closed and reopened, or for a family that already had an account", async () => {
    for (const [cookieHeader, o] of [
      [undefined, order()],
      [cookie, order({ openedFamily: false })],
      [`${ELF_PENDING_COOKIE}=${"b".repeat(64)}`, order()],
    ] as const) {
      db.orderForWelcome.mockResolvedValue(o);
      const res = fakeRes();
      await getWelcome(req({ cookie: cookieHeader, query: { elf_session: "cs_test_1" } }), res as never);
      expect(res.redirected).toBeNull();
      expect(res.html).toContain("/elf/sign-in");
      expect(res.html).toContain("Check your email");
    }
    expect(db.createElfSession).not.toHaveBeenCalled();
  });

  it("waits, and looks again by itself, while the payment is still being checked", async () => {
    db.orderForWelcome.mockResolvedValue(order({ status: "pending" }));
    const res = fakeRes();
    await getWelcome(req({ cookie, query: { elf_session: "cs_test_1" } }), res as never);
    expect(res.html).toContain("We are just checking your payment");
    expect(res.html).toMatch(/<meta http-equiv="refresh" content="3"/);
    expect(db.createElfSession).not.toHaveBeenCalled();
  });
});

describe("adding a detective, signed in", () => {
  it("joins the signed in family whatever email is sent, and never asks it to sign in first", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.findElfSession.mockResolvedValue({ familyId: 3 });
    const family = { id: 3, grownUpName: "Sam Example", email: "sam@example.com", detectives: [] };
    db.familyWithDetectives.mockResolvedValue(family);
    db.createPendingJoin.mockResolvedValue({ familyId: 3, orderId: 9, reference: "EDS-K4F9Q2", detectiveIds: [102] });
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(
      req({
        json: true,
        cookie: `${ELF_SESSION_COOKIE}=abcDEF123_-xyz`,
        body: { email: "someone@else.example", grownUpName: "Someone Else", mobile: "07700 900 123", detectives: [{ firstName: "Ivy", surname: "Snowsleuth" }], entryPence: 500, agreed: true },
      }),
      res as never,
    );
    const call = db.createPendingJoin.mock.calls[0][0];
    expect(call.familyId).toBe(3);
    expect(call.body.email).toBe("sam@example.com");
    expect(call.body.grownUpName).toBe("Sam Example");
    // TASK-613: the mobile it gives is the family's, kept as +447 and nine digits.
    expect(call.body.mobile).toBe("+447700900123");
  });
});

// TASK-613: a mobile number on every way of enrolling: the plain form, the page's script (JSON), signed
// in or not. Refused in the form's own words, before anything is saved.
describe("the grown up's mobile, on every way of enrolling", () => {
  const MOBILE_WORDS = "Please type a UK mobile number, like 07700 900 123.";
  const json = { grownUpName: "Sam Example", email: "sam@example.com", detectives: [{ firstName: "Ivy", surname: "Snowsleuth" }], entryPence: 500, agreed: true };
  const form = { grownUpName: "Sam Example", email: "sam@example.com", "detective-1-first": "Ivy", "detective-1-surname": "Snowsleuth", entry: "5", agreed: "on" };

  it("refuses the page's script without one, or with one that is not a UK mobile", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    for (const body of [json, { ...json, mobile: "" }, { ...json, mobile: "01632 960 123" }]) {
      const res = fakeRes();
      res.locals = { elfSettings: ON };
      await postJoin(req({ json: true, body }), res as never);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ errors: [MOBILE_WORDS] });
    }
    expect(db.createPendingJoin).not.toHaveBeenCalled();
  });

  it("refuses the plain form without one, on the form, keeping what was typed", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(req({ body: { ...form, mobile: "07700 900" } }), res as never);
    expect(res.statusCode).toBe(400);
    expect(res.html).toContain(`<li>${MOBILE_WORDS}</li>`);
    expect(res.html).toContain('value="07700 900"');
    expect(db.createPendingJoin).not.toHaveBeenCalled();
  });

  it("refuses a signed in family adding a detective without one", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.findElfSession.mockResolvedValue({ familyId: 3 });
    db.familyWithDetectives.mockResolvedValue({ id: 3, grownUpName: "Sam Example", email: "sam@example.com", detectives: [] });
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(req({ json: true, cookie: `${ELF_SESSION_COOKIE}=abcDEF123_-xyz`, body: json }), res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ errors: [MOBILE_WORDS] });
    expect(db.createPendingJoin).not.toHaveBeenCalled();
  });

  it("takes the plain form's mobile, and hands it on as +447 and nine digits", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.createPendingJoin.mockResolvedValue("sign-in-first");
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(req({ body: { ...form, mobile: "07700 900 045" } }), res as never);
    expect(db.createPendingJoin.mock.calls[0][0].body.mobile).toBe("+447700900045");
  });
});

describe("the review's findings: signing in", () => {
  it("ends every other session of the family when someone signs in with the emailed code", async () => {
    const email = "sam@example.com";
    db.countElfCodeTry.mockResolvedValue({ codeHash: hashSignInCode(email, "123456", "test-secret"), expiresAt: new Date(Date.now() + 60_000), attempts: 1 });
    db.activeFamilyByEmail.mockResolvedValue({ id: 3, grownUpName: "Sam Example" });
    const res = fakeRes();
    await postSignIn(req({ json: true, body: { email, code: "123456" } }), res as never);
    expect(db.endOtherElfSessions).toHaveBeenCalledWith(3, db.createElfSession.mock.calls[0][0]);
  });

  it("does not say whether an email has detectives enrolled: it emails a code and asks them to check their email", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.createPendingJoin.mockResolvedValue("sign-in-first");
    db.activeFamilyByEmail.mockResolvedValue({ id: 3, grownUpName: "Sam Example" });
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(req({ json: true, body: { grownUpName: "Sam Example", email: "sam@example.com", mobile: "07700 900 123", detectives: [{ firstName: "Ivy", surname: "Snowsleuth" }], entryPence: 500, agreed: true } }), res as never);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Check your email");
    expect(JSON.stringify(res.body)).not.toMatch(/already has detectives/);
    expect(mail.sendElfSignInCode).toHaveBeenCalledTimes(1);
  });
});

// Elf Detective School's sign ups went live on 12 November 2026. A database hiccup while someone signs up
// or signs in is said plainly (a 500, never cached), never a rejected promise, which would stop the whole
// server: src has no unhandledRejection handler. Every answer they give today is as it was (above). From
// an address and with emails of their own, so the limits the tests above have used do not count here.
describe("a database hiccup while signing up or signing in", () => {
  const WORDS = "Something went wrong just now. Please try again in a few minutes.";
  const SIGN_UP = { grownUpName: "Sam Example", email: "sam@example.com", mobile: "07700 900 123", detectives: [{ firstName: "Ivy", surname: "Snowsleuth" }], entryPence: 500, agreed: true };
  const SIGN_UP_FORM = { grownUpName: "Sam Example", email: "sam@example.com", mobile: "07700 900 123", "detective-1-first": "Ivy", "detective-1-surname": "Snowsleuth", entry: "5", agreed: "on" };
  const fromElsewhere = (o: Parameters<typeof req>[0]) => ({ ...(req(o) as object), ip: "198.51.100.23" }) as never;
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    drawing.fail = false;
    logged.mockRestore();
  });

  it("answers a sign up 500 when the signed in family cannot be read, from the page's script and from the plain form", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.findElfSession.mockRejectedValue(new Error("database down"));
    for (const json of [true, false]) {
      const res = fakeRes();
      res.locals = { elfSettings: ON };
      await postJoin(fromElsewhere({ json, cookie: `${ELF_SESSION_COOKIE}=abcDEF123_-xyz`, body: json ? SIGN_UP : SIGN_UP_FORM }), res as never);
      expect(res.statusCode).toBe(500);
      expect(res.headers["Cache-Control"]).toBe("no-store");
      if (json) expect(res.body).toEqual({ error: WORDS });
      else expect(res.html).toBe(WORDS);
    }
    expect(db.createPendingJoin).not.toHaveBeenCalled();
    expect(logged.mock.calls.map((c) => c[0])).toEqual(["elf join failed:", "elf join failed:"]);
  });

  it("answers a sign up 500 when it cannot be saved", async () => {
    const { postJoin } = await import("../../src/routes/elf");
    db.createPendingJoin.mockRejectedValue(new Error("database down"));
    const res = fakeRes();
    res.locals = { elfSettings: ON };
    await postJoin(fromElsewhere({ json: true, body: { ...SIGN_UP, email: "lee@example.com" } }), res as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: WORDS });
    expect(res.cookies).toEqual([]);
  });

  it("keeps the answer already given when the database fails after a sign in code is asked for", async () => {
    db.getElfSettings.mockRejectedValue(new Error("database down"));
    const res = fakeRes();
    await postSignInRequest(fromElsewhere({ json: true, body: { email: "pat@example.com" } }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: ELF_REQUEST_MESSAGE });
    expect(mail.sendElfSignInCode).not.toHaveBeenCalled();
    expect(logged.mock.calls.map((c) => c[0])).toEqual(["elf sign in code request failed:"]);
  });

  it("answers a sign in code request 500 when its page will not draw", async () => {
    drawing.fail = true;
    const res = fakeRes();
    await postSignInRequest(fromElsewhere({ body: { email: "kit@example.com" } }), res as never);
    expect(res.statusCode).toBe(500);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.html).toBe(WORDS);
  });

  it("answers a sign in 500 when the code cannot be looked up: in its own words to the page's script, and plainly when the page to say so will not draw", async () => {
    db.countElfCodeTry.mockRejectedValue(new Error("database down"));
    const viaScript = fakeRes();
    await postSignIn(fromElsewhere({ json: true, body: { email: "robin@example.com", code: "123456" } }), viaScript as never);
    expect(viaScript.statusCode).toBe(500);
    expect(viaScript.body).toEqual({ error: "We could not sign you in just now. Please try again in a few minutes." });

    drawing.fail = true;
    const viaForm = fakeRes();
    await postSignIn(fromElsewhere({ body: { email: "robin@example.com", code: "123456" } }), viaForm as never);
    expect(viaForm.statusCode).toBe(500);
    expect(viaForm.headers["Cache-Control"]).toBe("no-store");
    expect(viaForm.html).toBe(WORDS);
    expect(db.createElfSession).not.toHaveBeenCalled();
  });
});
