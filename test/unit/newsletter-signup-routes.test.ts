import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeSignupHandlers, type SignupRouteDeps } from "../../src/routes/newsletter-signup";
import { hashSignupToken, newSignupToken } from "../../src/mailing-list/model";

// Joining the mailing list from /newsletter: the routes, with everything behind them faked. What is
// checked: the form says the same thing whoever the address belongs to; one email with a link kept
// only as a hash; robots and other websites store nothing; opening the link never adds anyone, only
// pressing the button does; a link works once and not after it expires; and an address we must not
// email is never added. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const TEMPLATE = readFileSync(resolve(ROOT, "newsletter.html"), "utf8");
const NOW = new Date("2026-10-05T12:00:00Z");
const OK = { status: "check_email" };

function deps(over: Partial<SignupRouteDeps> = {}) {
  const d = {
    now: () => NOW,
    production: false,
    baseUrl: "https://nbcc.test",
    template: () => TEMPLATE,
    decorate: vi.fn(async (html: string) => html),
    captchaEnabled: () => false,
    captchaSiteKey: () => null as string | null,
    verifyCaptcha: vi.fn(async () => ({ outcome: "passed" as const })),
    fromOurOwnPage: vi.fn(() => true),
    suppressed: vi.fn(async () => false),
    save: vi.fn(async () => true),
    forget: vi.fn(async () => undefined),
    find: vi.fn(async () => ({ email: "sam@example.com", firstName: "Sam" }) as { email: string; firstName: string } | null),
    sendConfirm: vi.fn(async () => undefined),
    alreadyOnList: vi.fn(async () => false),
    subscribe: vi.fn(async () => "added"),
    record: vi.fn(async () => undefined),
    ...over,
  };
  return d as unknown as SignupRouteDeps & typeof d;
}

type Res = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sent: string | null;
  status(c: number): Res;
  json(b: unknown): Res;
  setHeader(k: string, v: string): void;
  type(t: string): Res;
  send(b: string): Res;
};
function mockRes(): Res {
  const res = { statusCode: 200, body: undefined, headers: {}, sent: null } as Res;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => void (res.headers[k.toLowerCase()] = v);
  res.type = () => res;
  res.send = (b) => ((res.sent = b), res);
  return res;
}
// Each request from its own address, so the per address limits never meet in a test.
let caller = 0;
const req = (over: Record<string, unknown> = {}) =>
  ({ params: {}, query: {}, body: {}, headers: {}, ip: `198.51.100.${(caller += 1)}`, get: () => undefined, ...over }) as never;
const next = vi.fn();
let person = 0;
const good = () => ({ firstName: "Sam", email: `sam${(person += 1)}@example.com`, company: "", captchaToken: "" });

describe("asking to join", () => {
  it("keeps the request, emails one link to confirm, and says to check their email", async () => {
    const d = deps();
    const res = mockRes();
    const body = good();
    await makeSignupHandlers(d).postSignup(req({ body }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK);
    expect(d.save).toHaveBeenCalledTimes(1);
    const [saved, now] = d.save.mock.calls[0] as unknown as [{ email: string; firstName: string; tokenHash: string }, Date];
    expect(saved.email).toBe(body.email);
    expect(saved.firstName).toBe("Sam");
    expect(saved.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(now).toBe(NOW);
    expect(d.sendConfirm).toHaveBeenCalledTimes(1);
    const sent = (d.sendConfirm.mock.calls[0] as unknown as [{ email: string; firstName: string; confirmUrl: string }])[0];
    expect(sent.email).toBe(body.email);
    expect(sent.confirmUrl).toMatch(/^https:\/\/nbcc\.test\/newsletter\/confirm\?t=[A-Za-z0-9_-]{43}$/);
  });

  it("only a hash of the link is kept, never the link", async () => {
    const d = deps();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), mockRes() as never);
    const saved = (d.save.mock.calls[0] as unknown as [{ tokenHash: string }])[0];
    const url = (d.sendConfirm.mock.calls[0] as unknown as [{ confirmUrl: string }])[0].confirmUrl;
    const token = new URL(url).searchParams.get("t") as string;
    expect(saved.tokenHash).toBe(hashSignupToken(token));
    expect(JSON.stringify(d.save.mock.calls)).not.toContain(token);
  });

  it("adds nobody to the mailing list: that needs the button in the email", async () => {
    const d = deps();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), mockRes() as never);
    expect(d.subscribe).not.toHaveBeenCalled();
  });

  it("says exactly the same for an address already on the list", async () => {
    const d = deps({ alreadyOnList: vi.fn(async () => true) });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK);
  });

  it("says exactly the same for an address we must not email, and sends and keeps nothing", async () => {
    const d = deps({ suppressed: vi.fn(async () => true) });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.sendConfirm).not.toHaveBeenCalled();
  });

  it("a second request too soon after the first says the same and sends no second email", async () => {
    const d = deps({ save: vi.fn(async () => false) });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.body).toEqual(OK);
    expect(d.sendConfirm).not.toHaveBeenCalled();
  });

  it("says the same when the email could not be sent, and forgets the request so they can try again", async () => {
    const d = deps({
      sendConfirm: vi.fn(async () => {
        throw new Error("mailbox unavailable");
      }),
    });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK);
    const saved = (d.save.mock.calls[0] as unknown as [{ tokenHash: string }])[0];
    expect(d.forget).toHaveBeenCalledWith(saved.tokenHash);
  });

  it("tells them which box needs another look", async () => {
    const d = deps();
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: { firstName: "", email: "nope" } }), res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Please check the boxes marked below.",
      fields: { firstName: "Please enter your first name.", email: "Please enter a valid email address." },
    });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("a robot that fills the hidden box is told all is well, and nothing is kept or sent", async () => {
    const d = deps();
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: { ...good(), company: "Robots Ltd" } }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.sendConfirm).not.toHaveBeenCalled();
  });

  it("another website's page cannot post the form", async () => {
    const d = deps({
      fromOurOwnPage: vi.fn((_req: unknown, res: { status(c: number): { json(b: unknown): void } }) => {
        res.status(403).json({ error: "no" });
        return false;
      }) as never,
    });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.statusCode).toBe(403);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("says try again, without details, when something breaks", async () => {
    const d = deps({
      save: vi.fn(async () => {
        throw new Error("database is down");
      }),
    });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "We could not take your details just now. Please try again in a few minutes." });
  });
});

describe("the limits on asking", () => {
  it("one caller may ask only so many times in ten minutes", async () => {
    const d = deps();
    const h = makeSignupHandlers(d);
    const ip = "203.0.113.50";
    const codes: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const res = mockRes();
      await h.postSignup(req({ body: good(), ip }), res as never);
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 8)).toEqual(Array(8).fill(200));
    expect(codes[8]).toBe(429);
  });

  it("one address may be asked for only so many times, whoever asks", async () => {
    const d = deps();
    const h = makeSignupHandlers(d);
    const body = good();
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = mockRes();
      await h.postSignup(req({ body }), res as never);
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 200, 429]);
  });

  it("a request made on the server itself (local work and the test suite) is not limited", async () => {
    const d = deps();
    const h = makeSignupHandlers(d);
    for (let i = 0; i < 12; i += 1) {
      const res = mockRes();
      await h.postSignup(req({ body: good(), ip: "127.0.0.1" }), res as never);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("the spam check", () => {
  it("tells the page the site key when the check is on, and nothing when it is off", () => {
    const on = mockRes();
    makeSignupHandlers(deps({ captchaSiteKey: () => "site-key-1" })).getCaptcha(req(), on as never);
    expect(on.body).toEqual({ siteKey: "site-key-1" });
    const off = mockRes();
    makeSignupHandlers(deps()).getCaptcha(req(), off as never);
    expect(off.body).toEqual({ siteKey: null });
  });

  it("a pass Cloudflare refuses keeps nothing and sends nothing", async () => {
    const d = deps({ captchaEnabled: () => true, verifyCaptcha: vi.fn(async () => ({ outcome: "refused" as const, reason: "invalid-input-response" })) });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: { ...good(), captchaToken: "bad" } }), res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "captcha" });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("a good pass goes through, checked with the caller's address", async () => {
    const d = deps({ captchaEnabled: () => true });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: { ...good(), captchaToken: "pass-1" }, ip: "198.51.100.200" }), res as never);
    expect(d.verifyCaptcha).toHaveBeenCalledWith("pass-1", "198.51.100.200");
    expect(res.body).toEqual(OK);
  });

  it("outside production, a check that cannot answer lets the request through", async () => {
    const d = deps({ captchaEnabled: () => true, verifyCaptcha: vi.fn(async () => ({ outcome: "unavailable" as const, reason: "timeout" })) });
    const res = mockRes();
    await makeSignupHandlers(d).postSignup(req({ body: good() }), res as never);
    expect(res.body).toEqual(OK);
  });

  it("in production the form is closed when the check cannot answer or is not set up: it emails whoever is named", async () => {
    const closed = { error: "Joining the mailing list is not available just now. Please try again in a little while." };
    const down = deps({ production: true, captchaEnabled: () => true, verifyCaptcha: vi.fn(async () => ({ outcome: "unavailable" as const, reason: "timeout" })) });
    const r1 = mockRes();
    await makeSignupHandlers(down).postSignup(req({ body: good() }), r1 as never);
    expect(r1.statusCode).toBe(503);
    expect(r1.body).toEqual(closed);
    expect(down.sendConfirm).not.toHaveBeenCalled();

    const unset = deps({ production: true });
    const r2 = mockRes();
    await makeSignupHandlers(unset).postSignup(req({ body: good() }), r2 as never);
    expect(r2.statusCode).toBe(503);
    expect(unset.sendConfirm).not.toHaveBeenCalled();
  });
});

describe("opening the link in the email", () => {
  const token = newSignupToken();

  it("shows a page with one button, and adds nobody: a mail scanner opening the link changes nothing", async () => {
    const d = deps();
    const res = mockRes();
    await makeSignupHandlers(d).getConfirmPage(req({ query: { t: token } }), res as never, next);
    expect(res.statusCode).toBe(200);
    expect(d.find).toHaveBeenCalledWith(hashSignupToken(token), NOW);
    expect(res.sent).toContain("One more step");
    expect(res.sent).toContain('<form class="nl-confirm" method="post" action="/newsletter/confirm">');
    expect(res.sent).toContain(`name="t" value="${token}"`);
    expect(res.sent).toContain(">Yes, add me</button>");
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(d.forget).not.toHaveBeenCalled();
  });

  it("is private: never kept, never indexed, and never handed on as a referrer", async () => {
    const res = mockRes();
    await makeSignupHandlers(deps()).getConfirmPage(req({ query: { t: token } }), res as never, next);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.sent).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("a link that has expired, been used or never existed says it no longer works and offers to start again", async () => {
    const d = deps({ find: vi.fn(async () => null) });
    const res = mockRes();
    await makeSignupHandlers(d).getConfirmPage(req({ query: { t: token } }), res as never, next);
    expect(res.statusCode).toBe(404);
    expect(res.sent).toContain("This link no longer works");
    expect(res.sent).toContain('href="/newsletter"');
    expect(res.sent).toContain(">Start again</a>");
    expect(res.sent).not.toContain("<form");
  });

  it("something that is not one of our links is not looked up at all", async () => {
    const d = deps();
    const res = mockRes();
    await makeSignupHandlers(d).getConfirmPage(req({ query: { t: "'; DROP TABLE" } }), res as never, next);
    expect(res.statusCode).toBe(404);
    expect(d.find).not.toHaveBeenCalled();
  });

  it("never shows the form or the email address on these pages", async () => {
    const res = mockRes();
    await makeSignupHandlers(deps()).getConfirmPage(req({ query: { t: token } }), res as never, next);
    expect(res.sent).not.toContain("sam@example.com");
    expect(res.sent).not.toContain('id="nlForm"');
  });
});

describe("pressing Yes, add me", () => {
  const token = newSignupToken();
  const press = (d: ReturnType<typeof deps>, res: Res, t: unknown = token) => makeSignupHandlers(d).postConfirm(req({ body: { t } }), res as never, next);

  it("adds them to the newsletter's own list the way the website already does, and thanks them", async () => {
    const d = deps();
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(200);
    expect(d.subscribe).toHaveBeenCalledTimes(1);
    expect(d.subscribe).toHaveBeenCalledWith({ name: "Sam", email: "sam@example.com" });
    expect(res.sent).toContain("Thank you for joining us");
    expect(d.record).toHaveBeenCalledWith("sam@example.com", "added");
  });

  it("the link works once: it is forgotten as soon as it is used", async () => {
    const d = deps();
    await press(d, mockRes());
    expect(d.forget).toHaveBeenCalledWith(hashSignupToken(token));
    // The next press finds nothing.
    d.find.mockResolvedValue(null);
    const again = mockRes();
    await press(d, again);
    expect(again.statusCode).toBe(404);
    expect(again.sent).toContain("This link no longer works");
    expect(d.subscribe).toHaveBeenCalledTimes(1);
  });

  it("someone already on the list is thanked, and nothing is changed", async () => {
    const d = deps({ alreadyOnList: vi.fn(async () => true) });
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain("Thank you for joining us");
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(d.forget).toHaveBeenCalled();
  });

  it("an address we must not email (it bounced, or they complained) is not added, and sees the same thank you", async () => {
    const d = deps({ suppressed: vi.fn(async () => true) });
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain("Thank you for joining us");
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(d.alreadyOnList).not.toHaveBeenCalled();
    expect(d.forget).toHaveBeenCalled();
  });

  it("someone who unsubscribed before and now signs up again is added again, as the website's own form does", async () => {
    const d = deps({ subscribe: vi.fn(async () => "resubscribed") });
    const res = mockRes();
    await press(d, res);
    expect(res.sent).toContain("Thank you for joining us");
    expect(d.record).toHaveBeenCalledWith("sam@example.com", "resubscribed");
  });

  it("an expired or unknown link adds nobody", async () => {
    const d = deps({ find: vi.fn(async () => null) });
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(404);
    expect(d.subscribe).not.toHaveBeenCalled();
  });

  it("if they could not be added, the link is kept so they can press again, and the page says so", async () => {
    const d = deps({ subscribe: vi.fn(async () => "no_list") });
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(500);
    expect(res.sent).toContain("Something went wrong");
    expect(d.forget).not.toHaveBeenCalled();
  });

  it("a note that could not be written never undoes a sign up", async () => {
    const d = deps({
      record: vi.fn(async () => {
        throw new Error("audit down");
      }),
    });
    const res = mockRes();
    await press(d, res);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain("Thank you for joining us");
  });

  it("the thank you page is private too, and has no form", async () => {
    const res = mockRes();
    await press(deps(), res);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.sent).not.toContain("<form");
    expect(res.sent).not.toContain("sam@example.com");
  });
});
