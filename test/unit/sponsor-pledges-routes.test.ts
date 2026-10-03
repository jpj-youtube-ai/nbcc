import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: vi.fn() } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "",
    NODE_ENV: "test",
    PORTAL_BASE_URL: "https://nbcc.test",
    ADMIN_SESSION_SECRET: "a-test-secret",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/clients/email", () => ({ sendFundraisePledge: vi.fn(), sendFundraisePledgeStaff: vi.fn() }));

import { makePledgeHandlers, type PledgeRouteDeps } from "../../src/routes/pledges";
import { signPledgeToken } from "../../src/pledges/token";
import { buildPledgeSessionParams } from "../../src/pledges/checkout";
import { pledgeDeclarationWording } from "../../src/pledges/model";
import type { PledgeRecord, PledgeWithFundraiser } from "../../src/db/pledges";

// Sponsor pledges: the routes, with everything behind them faked. What is checked: who may pledge and
// on which pages, that robots store nothing, that a pay link only works with its signature and only
// for an open pledge, what goes to Stripe, that an email link never cancels by itself, that an
// organiser only ever touches their own fundraiser's pledges and never sees an email address, and who
// among staff may do what. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const TEMPLATE = readFileSync(resolve(ROOT, "pledge.html"), "utf8");
const SECRET = "a-test-secret";
const NOW = new Date("2026-11-04T12:00:00Z");
const wording = pledgeDeclarationWording(1000);

const fundraiser = (over: Record<string, unknown> = {}) => ({
  id: 7,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  title: "Robin's Santa Dash",
  name: "Robin Testperson",
  email: "robin@example.com",
  public: true,
  status: "approved",
  eventDate: "2026-12-05",
  isTeam: false,
  teamId: null,
  inMemory: false,
  ...over,
});

const pledge = (over: Partial<PledgeRecord> = {}): PledgeRecord => ({
  id: 5,
  fundraiserId: 7,
  firstName: "Alex",
  surname: "Example",
  email: "alex@example.com",
  amountPence: 1000,
  message: null,
  messageHidden: false,
  showName: true,
  showAmount: true,
  giftAid: true,
  status: "open",
  createdAt: "2026-11-01T10:00:00.000Z",
  payEmailClaimedAt: null,
  payEmailSentAt: null,
  reminderClaimedAt: null,
  reminderSentAt: null,
  paidAt: null,
  paidAmountPence: null,
  cashMarkedAt: null,
  cancelledAt: null,
  anonymisedAt: null,
  refunded: false,
  tokenNonce: "nonce-a",
  gaHouse: "12",
  gaAddress: "Example Street, Exampleton",
  gaPostcode: "KA1 1AA",
  gaNonUk: false,
  gaWordingVersion: wording.wording_version,
  gaWordingSnapshot: wording.wording_snapshot,
  gaDeclaredAt: "2026-11-01T10:00:00.000Z",
  donationId: null,
  ...over,
});

const withF = (p: PledgeRecord, f: Record<string, unknown> = {}): PledgeWithFundraiser =>
  ({ p, f: { ...fundraiser(f), finishedAt: null } }) as unknown as PledgeWithFundraiser;

function deps(over: Partial<PledgeRouteDeps> = {}) {
  const d = {
    now: () => NOW,
    secret: SECRET,
    baseUrl: "https://nbcc.test",
    template: () => TEMPLATE,
    decorate: vi.fn(async (html: string) => html),
    fundraisingOn: vi.fn(async () => true),
    getBySlug: vi.fn(async () => fundraiser()),
    production: false,
    create: vi.fn(async () => ({ pledge: pledge({ status: "unconfirmed", confirmEmailSentAt: null }), duplicate: false })),
    sendConfirm: vi.fn(async () => "sent" as const),
    confirm: vi.fn(async () => true),
    expireCheckout: vi.fn(async () => undefined),
    saveCheckout: vi.fn(async () => true),
    retrieveCheckout: vi.fn(async () => ({ status: "expired", paymentStatus: "unpaid" })),
    setHiddenByOrganiser: vi.fn(async () => pledge({ hiddenAt: "2026-11-02T10:00:00.000Z" })),
    notifyStaff: vi.fn(async () => true),
    markChecked: vi.fn(async () => true),
    sendAll: vi.fn(async () => ({ sent: 2, skipped: 1, failed: 0, stopped: null })),
    getPledge: vi.fn(async (id: number) => (id === 5 ? withF(pledge()) : null)),
    list: vi.fn(async () => [pledge()]),
    readAll: vi.fn(async () => [withF(pledge())]),
    cancel: vi.fn(async () => true),
    markCash: vi.fn(async () => pledge({ status: "cash" })),
    setHidden: vi.fn(async () => true),
    buildCheckout: async (input: Parameters<typeof buildPledgeSessionParams>[0], fee: undefined, now: Date) => buildPledgeSessionParams(input, fee, now),
    createCheckout: vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test_1" })),
    cardFee: vi.fn(async () => undefined),
    fundraiserPage: vi.fn(async () => "https://nbcc.test/fundraise/robins-santa-dash"),
    sendNow: vi.fn(async () => "sent" as const),
    captchaEnabled: () => false,
    verifyCaptcha: vi.fn(async () => ({ outcome: "passed" as const })),
    fromOurOwnPage: vi.fn(() => true),
    signedIn: vi.fn(async () => ({ email: "robin@example.com", sessionHash: "h" })),
    listForOrganiser: vi.fn(async () => [fundraiser()]),
    ownFundraiser: vi.fn(async () => fundraiser()),
    authorize: vi.fn(async () => ({ email: "fern@example.com", role: "editor" })),
    authorizeAdmin: vi.fn(async () => ({ email: "jaimie@example.com", role: "admin" })),
    canEdit: vi.fn(async () => true),
    listApprovals: vi.fn(async () => []),
    approve: vi.fn(async (key: string, actor: string) => ({ key, approvedAt: NOW.toISOString(), approvedBy: actor })),
    withdraw: vi.fn(async () => true),
    touchOn: vi.fn(async () => false),
    stubEcho: false,
    ...over,
  };
  return d as unknown as PledgeRouteDeps & typeof d;
}

type Res = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  redirected: [number, string] | null;
  sent: string | null;
  status(c: number): Res;
  json(b: unknown): Res;
  setHeader(k: string, v: string): void;
  type(t: string): Res;
  send(b: string): Res;
  redirect(c: number, to: string): void;
};
function mockRes(): Res {
  const res = { statusCode: 200, body: undefined, headers: {}, redirected: null, sent: null } as Res;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.setHeader = (k, v) => void (res.headers[k.toLowerCase()] = v);
  res.type = () => res;
  res.send = (b) => ((res.sent = b), res);
  res.redirect = (c, to) => void (res.redirected = [c, to]);
  return res;
}
// Each request from its own address, so the per address limits never meet in a test.
let caller = 0;
const req = (over: Record<string, unknown> = {}) =>
  ({ params: {}, query: {}, body: {}, headers: {}, ip: `198.51.100.${(caller += 1)}`, get: () => undefined, ...over }) as never;
const next = vi.fn();
const token = (id = 5, nonce = "nonce-a") => signPledgeToken(id, nonce, SECRET);

let sponsor = 0;
// A different sponsor each time, so the per email limit never meets in a test either.
const good = () => ({ amountPence: 1000, firstName: "Alex", surname: "Example", email: `alex${(sponsor += 1)}@example.com`, showName: true, showAmount: true, giftAid: false, company: "" });

describe("making a pledge", () => {
  it("stores it for an open page, emails the link to confirm, and says so", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ status: "pledged", confirm: true, amountPence: 1000 });
    expect(d.sendConfirm).toHaveBeenCalledTimes(1);
    expect((d.sendConfirm.mock.calls[0] as unknown as [PledgeWithFundraiser])[0].p.id).toBe(5);
    const [fundraiserId, input, nonce] = d.create.mock.calls[0] as unknown as [number, { email: string }, string];
    expect(fundraiserId).toBe(7);
    expect(input.email).toMatch(/^alex\d+@example\.com$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });

  it("a second press of the button sends no second email", async () => {
    const d = deps({ create: vi.fn(async () => ({ pledge: pledge({ status: "unconfirmed", confirmEmailSentAt: "2026-11-04T11:59:00.000Z" }), duplicate: true })) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(201);
    expect(d.sendConfirm).not.toHaveBeenCalled();
  });

  it("a second press sends the confirm email when the first one never went", async () => {
    const d = deps({ create: vi.fn(async () => ({ pledge: pledge({ status: "unconfirmed", confirmEmailSentAt: null }), duplicate: true })) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(d.sendConfirm).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ status: "pledged", confirm: true, amountPence: 1000 });
  });

  it("an address with too many unconfirmed pledges gets the usual answer, no pledge and no email", async () => {
    const d = deps({ create: vi.fn(async () => ({ pledge: null, duplicate: false, capped: true })) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ status: "pledged", confirm: true, amountPence: 1000 });
    expect(d.sendConfirm).not.toHaveBeenCalled();
    expect(d.getPledge).not.toHaveBeenCalled();
  });

  it("in production, is closed while the spam check cannot answer; elsewhere the pledge is kept", async () => {
    const down = { captchaEnabled: () => true, verifyCaptcha: vi.fn(async () => ({ outcome: "unavailable" as const, reason: "timeout" })) as never };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prod = deps({ ...down, production: true });
    const res = mockRes();
    await makePledgeHandlers(prod).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Pledging is not available just now. You can still give on the page." });
    expect(prod.create).not.toHaveBeenCalled();
    const dev = deps(down);
    const ok = mockRes();
    await makePledgeHandlers(dev).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), ok as never);
    expect(ok.statusCode).toBe(201);
  });

  it("answers the same whether or not the confirm email could go, so nobody learns who is on a stop list", async () => {
    const d = deps({ sendConfirm: vi.fn(async () => "blocked" as const) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.body).toEqual({ status: "pledged", confirm: true, amountPence: 1000 });
  });

  it("is closed in production when the spam check is not set up, rather than open to robots", async () => {
    const d = deps({ production: true });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Pledging is not available just now. You can still give on the page." });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses more than £1,000, asking for a call", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: { ...good(), amountPence: 150_000 } }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.amountPence).toBe("For a pledge over £1,000, please call us on 01292 811 015.");
  });

  it("pretends to a robot that filled the hidden field, and stores nothing", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: { ...good(), company: "Robots Ltd" } }), res as never);
    expect(res.statusCode).toBe(201);
    expect(d.create).not.toHaveBeenCalled();
    expect(d.getBySlug).not.toHaveBeenCalled();
  });

  it("refuses a post another website's page sent", async () => {
    const d = deps({ fromOurOwnPage: vi.fn((_req, r) => (r.status(403).json({ error: "no" }), false)) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "x" }, body: good() }), res as never);
    expect(res.statusCode).toBe(403);
    expect(d.create).not.toHaveBeenCalled();
  });

  it("refuses when the spam check refuses, before looking at the form", async () => {
    const d = deps({ captchaEnabled: () => true, verifyCaptcha: vi.fn(async () => ({ outcome: "refused" as const })) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "captcha" });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("is a 404 while fundraising is off, or for a page that is not there", async () => {
    for (const over of [{ fundraisingOn: vi.fn(async () => false) }, { getBySlug: vi.fn(async () => null) }]) {
      const res = mockRes();
      await makePledgeHandlers(deps(over as never)).postPledge(req({ params: { slug: "nope" }, body: good() }), res as never);
      expect(res.statusCode).toBe(404);
    }
  });

  it.each([
    ["an event", { path: "event" }],
    ["a page in memory of someone", { inMemory: true }],
    ["a team's own page", { isTeam: true }],
    ["a finished page", { status: "finished" }],
    ["a page whose day has gone", { eventDate: "2026-11-03" }],
  ])("never takes one on %s", async (_what, over) => {
    const d = deps({ getBySlug: vi.fn(async () => fundraiser(over)) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: good() }), res as never);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "This page is not taking pledges. You can still give on the page." });
    expect(d.create).not.toHaveBeenCalled();
  });

  it("names each answer that needs another look", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postPledge(req({ params: { slug: "robins-santa-dash" }, body: { ...good(), amountPence: 100, email: "nope", giftAid: true } }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields).toMatchObject({
      amountPence: "The smallest pledge is £2.",
      email: "Please give an email address, like you@example.com.",
      address: "Please give your street and town.",
      postcode: "Please give a UK postcode, like KA1 1AA.",
    });
  });
});

describe("confirming by email", () => {
  const confirmToken = (id = 5, nonce = "nonce-a") => signPledgeToken(id, nonce, SECRET, "confirm");
  const waiting = () => deps({ getPledge: vi.fn(async () => withF(pledge({ status: "unconfirmed" }))) as never });

  it("opening the link only asks: nothing is confirmed by a GET", async () => {
    const d = waiting();
    const res = mockRes();
    await makePledgeHandlers(d).getConfirmPage(req({ query: { t: confirmToken() } }), res as never, next);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain("Confirm my £10 pledge");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("pressing the button confirms it, and says what happens next", async () => {
    const d = waiting();
    const res = mockRes();
    await makePledgeHandlers(d).postConfirm(req({ body: { t: confirmToken() } }), res as never, next);
    expect(d.confirm).toHaveBeenCalledWith(5);
    expect(res.sent).toContain("Your pledge is confirmed");
    expect(res.sent).toContain("We will email you a link to pay the day after Saturday 5 December 2026.");
  });

  it("a pay link never confirms, and a confirm link never opens the pay page", async () => {
    const d = waiting();
    const res = mockRes();
    await makePledgeHandlers(d).postConfirm(req({ body: { t: token() } }), res as never, next);
    expect(res.statusCode).toBe(404);
    expect(d.confirm).not.toHaveBeenCalled();
    const pay = mockRes();
    await makePledgeHandlers(deps()).getPayPage(req({ query: { t: confirmToken() } }), pay as never, next);
    expect(pay.statusCode).toBe(404);
  });

  it("says so for one already confirmed, and confirms nothing twice", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postConfirm(req({ body: { t: confirmToken() } }), res as never, next);
    expect(res.sent).toContain("Your pledge is already confirmed");
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("an unconfirmed pledge has no pay page", async () => {
    const res = mockRes();
    await makePledgeHandlers(waiting()).getPayPage(req({ query: { t: token() } }), res as never, next);
    expect(res.sent).toContain("This link no longer works");
  });
});

describe("the pay page", () => {
  it("opens for a genuine link to an open pledge, never kept or indexed", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).getPayPage(req({ query: { t: token() } }), res as never, next);
    expect(res.statusCode).toBe(200);
    expect(res.sent).toContain("Pay your pledge");
    expect(res.sent).toContain('value="10"');
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it.each([
    ["a made up token", "5.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["a link whose nonce has changed", signPledgeToken(5, "old-nonce", SECRET)],
    ["a pledge that is not there", signPledgeToken(9, "nonce-a", SECRET)],
    ["nothing", ""],
  ])("says the link no longer works for %s, the same every time", async (_what, t) => {
    const res = mockRes();
    await makePledgeHandlers(deps()).getPayPage(req({ query: { t } }), res as never, next);
    expect(res.statusCode).toBe(404);
    expect(res.sent).toContain("This link no longer works");
    expect(res.sent).not.toContain("Alex");
  });

  it.each([
    ["paid", "Your pledge is paid"],
    ["cancelled", "This pledge was cancelled"],
    ["cash", "This pledge is marked as paid"],
    ["expired", "This link no longer works"],
  ] as const)("says so for a %s pledge, with no form", async (status, heading) => {
    const d = deps({ getPledge: vi.fn(async () => withF(pledge({ status }))) as never });
    const res = mockRes();
    await makePledgeHandlers(d).getPayPage(req({ query: { t: token() } }), res as never, next);
    expect(res.sent).toContain(heading);
    expect(res.sent).not.toContain('action="/pledge/pay"');
  });

  it("is the site's own 404 while fundraising is off", async () => {
    const n = vi.fn();
    await makePledgeHandlers(deps({ fundraisingOn: vi.fn(async () => false) })).getPayPage(req({ query: { t: token() } }), mockRes() as never, n);
    expect(n).toHaveBeenCalled();
  });
});

describe("paying", () => {
  const post = (body: Record<string, unknown>, d = deps()) => {
    const res = mockRes();
    return makePledgeHandlers(d)
      .postPay(req({ body }), res as never, next)
      .then(() => ({ res, d }));
  };

  it("goes on to Stripe with the pledge's own checkout, Gift Aid kept", async () => {
    const { res, d } = await post({ t: token(), amount: "10", giftAid: "yes" });
    expect(res.redirected).toEqual([303, "https://checkout.stripe.com/c/pay/test_1"]);
    const params = (d.createCheckout.mock.calls[0] as unknown as [{ metadata: Record<string, string>; line_items: Array<{ price_data: { unit_amount: number } }>; cancel_url: string }])[0];
    expect(params.metadata).toMatchObject({ pledgeId: "5", fundraiserId: "7", giftAid: "true", giftAidWording: wording.wording_snapshot });
    expect(params.line_items[0].price_data.unit_amount).toBe(1000);
    expect(params.cancel_url).toBe(`https://nbcc.test/pledge/pay?t=${encodeURIComponent(token())}`);
  });

  it("closes the checkout it opened before, then remembers the new one, so nobody pays twice", async () => {
    const d = deps({ getPledge: vi.fn(async () => withF(pledge({ checkoutSessionId: "cs_test_old" }))) as never });
    await post({ t: token(), amount: "10" }, d);
    expect(d.expireCheckout).toHaveBeenCalledWith("cs_test_old");
    expect(d.expireCheckout.mock.invocationCallOrder[0]).toBeLessThan(d.createCheckout.mock.invocationCallOrder[0]);
    expect(d.saveCheckout).toHaveBeenCalledWith(5, "cs_test_1", "cs_test_old");
  });

  it("still opens a new checkout when the old one had simply expired already", async () => {
    const d = deps({
      getPledge: vi.fn(async () => withF(pledge({ checkoutSessionId: "cs_test_old" }))) as never,
      expireCheckout: vi.fn(async () => Promise.reject(new Error("already expired"))) as never,
    });
    const { res } = await post({ t: token(), amount: "10" }, d);
    expect(d.retrieveCheckout).toHaveBeenCalledWith("cs_test_old");
    expect(res.redirected?.[0]).toBe(303);
  });

  it.each([
    ["complete", "unpaid"],
    ["open", "paid"],
  ])("paid but the webhook has not landed (the old checkout is %s, %s): says it is paid, and opens no new checkout", async (status, paymentStatus) => {
    const d = deps({
      getPledge: vi.fn(async () => withF(pledge({ checkoutSessionId: "cs_test_old" }))) as never,
      expireCheckout: vi.fn(async () => Promise.reject(new Error("cannot expire a completed session"))) as never,
      retrieveCheckout: vi.fn(async () => ({ status, paymentStatus })) as never,
    });
    const { res } = await post({ t: token(), amount: "10" }, d);
    expect(d.createCheckout).not.toHaveBeenCalled();
    expect(res.redirected).toBeNull();
    expect(res.sent).toContain("Your pledge is paid");
    expect(res.sent).toContain("Your receipt is on its way.");
  });

  it("two tabs at once: the one that loses closes its own checkout and sends nobody to pay twice", async () => {
    const d = deps({ saveCheckout: vi.fn(async () => false) as never });
    const { res } = await post({ t: token(), amount: "10" }, d);
    // Saved only if nobody else opened one since this request read the pledge.
    expect(d.saveCheckout).toHaveBeenCalledWith(5, "cs_test_1", null);
    expect(d.expireCheckout).toHaveBeenCalledWith("cs_test_1");
    expect(res.redirected).toBeNull();
    expect(res.statusCode).toBe(409);
    expect(res.sent).toContain("This payment is already open in another tab or window. Please finish it there, or wait a minute and try again.");
  });

  it("takes Gift Aid off when the box was unticked", async () => {
    const { d } = await post({ t: token(), amount: "10" });
    expect((d.createCheckout.mock.calls[0] as unknown as [{ metadata: Record<string, string> }])[0].metadata.giftAid).toBe("false");
  });

  it("takes more than was pledged, and shows the form again for less", async () => {
    const more = await post({ t: token(), amount: "25.50", giftAid: "yes" });
    expect((more.d.createCheckout.mock.calls[0] as unknown as [{ line_items: Array<{ price_data: { unit_amount: number } }> }])[0].line_items[0].price_data.unit_amount).toBe(2550);
    const less = await post({ t: token(), amount: "9.99" });
    expect(less.res.statusCode).toBe(400);
    expect(less.res.sent).toContain("You pledged £10, so that is the least you can pay here.");
    expect(less.d.createCheckout).not.toHaveBeenCalled();
  });

  it("never starts a payment without a genuine link, or for a pledge that is not open", async () => {
    const bad = await post({ t: "5.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", amount: "10" });
    expect(bad.res.statusCode).toBe(404);
    expect(bad.d.createCheckout).not.toHaveBeenCalled();
    for (const [status, words] of [["paid", "Your pledge is paid"], ["cancelled", "This pledge was cancelled"], ["cash", "This pledge is marked as paid"]] as const) {
      const closed = await post({ t: token(), amount: "10" }, deps({ getPledge: vi.fn(async () => withF(pledge({ status }))) as never }));
      expect(closed.d.createCheckout, status).not.toHaveBeenCalled();
      expect(closed.res.sent).toContain(words);
    }
  });

  it("says card payments are not working when Stripe fails, and keeps the pledge", async () => {
    const { res } = await post({ t: token(), amount: "10" }, deps({ createCheckout: vi.fn(async () => Promise.reject(new Error("stripe down"))) as never }));
    expect(res.statusCode).toBe(502);
    expect(res.sent).toContain("Card payments are not working just now");
  });
});

describe("can't pay after all", () => {
  it("opening the link only asks: nothing is cancelled by a GET", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).getCancelPage(req({ query: { t: token() } }), res as never, next);
    expect(res.sent).toContain("Cancel my £10 pledge");
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it("pressing the button cancels it quietly, as the sponsor", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postCancel(req({ body: { t: token() } }), res as never, next);
    expect(d.cancel).toHaveBeenCalledWith(5, "sponsor");
    expect(res.sent).toContain("Your pledge is cancelled");
  });

  it("does nothing without a genuine link", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postCancel(req({ body: { t: "5.nope" } }), res as never, next);
    expect(d.cancel).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });
});

describe("the organiser's list", () => {
  it("gives names, amounts, where each is up to and the totals, never an email or an address", async () => {
    const d = deps({ list: vi.fn(async () => [pledge(), pledge({ id: 6, status: "paid", paidAmountPence: 1500, paidAt: "2026-12-07T10:00:00.000Z" })]) as never });
    const res = mockRes();
    await makePledgeHandlers(d).getOrganiserPledges(req(), res as never);
    expect(res.statusCode).toBe(200);
    const body = res.body as { fundraisers: Array<{ id: number; totals: Record<string, number>; pledges: Array<Record<string, unknown>> }> };
    expect(body.fundraisers[0].totals).toMatchObject({ pledgedPence: 2000, paidPence: 1500, openPence: 1000 });
    expect(body.fundraisers[0].pledges[0]).toEqual({
      id: 5,
      name: "Alex Example",
      amountPence: 1000,
      paidAmountPence: null,
      status: "open",
      statusWords: "Not paid yet",
      giftAid: true,
      createdAt: "2026-11-01T10:00:00.000Z",
      canMarkCash: true,
      canUnmarkCash: false,
      hidden: false,
      canHide: true,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("alex@example.com");
    expect(text).not.toContain("Example Street");
    expect(text).not.toContain("nonce-a");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("never lists a pledge its sponsor has not confirmed", async () => {
    const d = deps({ list: vi.fn(async () => [pledge(), pledge({ id: 6, status: "unconfirmed", firstName: "Not", surname: "Confirmed" })]) as never });
    const res = mockRes();
    await makePledgeHandlers(d).getOrganiserPledges(req(), res as never);
    const body = res.body as { fundraisers: Array<{ pledges: unknown[]; totals: Record<string, number> }> };
    expect(body.fundraisers[0].pledges.length).toBe(1);
    expect(body.fundraisers[0].totals.pledgedPence).toBe(1000);
    expect(JSON.stringify(body)).not.toContain("Confirmed");
  });

  it("hides a pledge from their own page, and staff are told", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postOrganiserHide(req({ params: { id: "7", pledgeId: "5" }, body: { hidden: true } }), res as never);
    expect(d.setHiddenByOrganiser).toHaveBeenCalledWith(7, 5, true, "organiser:robin@example.com");
    expect((res.body as { pledge: { hidden: boolean } }).pledge.hidden).toBe(true);
    const [subject, lines] = d.notifyStaff.mock.calls[0] as unknown as [string, string[]];
    expect(subject).toBe("A pledge was hidden by its organiser");
    expect(lines.join(" ")).toContain("Robin's Santa Dash: pledge 5");
    expect(lines.join(" ")).not.toContain("alex@example.com");
  });

  it("never hides one on a fundraiser that is not theirs", async () => {
    const d = deps({ ownFundraiser: vi.fn(async (_r, res) => (res.status(404).json({ error: "Not found" }), null)) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postOrganiserHide(req({ params: { id: "8", pledgeId: "5" }, body: { hidden: true } }), res as never);
    expect(res.statusCode).toBe(404);
    expect(d.setHiddenByOrganiser).not.toHaveBeenCalled();
  });

  it("needs them signed in", async () => {
    const d = deps({ signedIn: vi.fn(async (_r, res) => (res.status(401).json({ error: "Please sign in again." }), null)) as never });
    const res = mockRes();
    await makePledgeHandlers(d).getOrganiserPledges(req(), res as never);
    expect(res.statusCode).toBe(401);
    expect(d.list).not.toHaveBeenCalled();
  });

  it("marks a pledge on their own fundraiser as paid in cash", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postOrganiserCash(req({ params: { id: "7", pledgeId: "5" }, body: { paid: true } }), res as never);
    expect(d.markCash).toHaveBeenCalledWith(7, 5, true, "organiser:robin@example.com");
    expect((res.body as { pledge: { status: string; statusWords: string } }).pledge).toMatchObject({ status: "cash", statusWords: "Paid you in cash" });
  });

  it("never touches a fundraiser that is not theirs", async () => {
    const d = deps({ ownFundraiser: vi.fn(async (_r, res) => (res.status(404).json({ error: "Not found" }), null)) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postOrganiserCash(req({ params: { id: "8", pledgeId: "5" }, body: { paid: true } }), res as never);
    expect(res.statusCode).toBe(404);
    expect(d.markCash).not.toHaveBeenCalled();
  });

  it("says so when the pledge could not be marked (paid, cancelled, or not on that fundraiser)", async () => {
    const d = deps({ markCash: vi.fn(async () => null) as never });
    const res = mockRes();
    await makePledgeHandlers(d).postOrganiserCash(req({ params: { id: "7", pledgeId: "5" }, body: { paid: true } }), res as never);
    expect(res.statusCode).toBe(409);
  });
});

describe("staff", () => {
  it("see each fundraiser's pledges with emails, the totals, and the two emails waiting for sign off", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).getAdminPledges(req(), res as never);
    expect(d.authorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), "view");
    const body = res.body as {
      fundraisers: Array<{ id: number; title: string; pledges: Array<Record<string, unknown>>; totals: Record<string, number> }>;
      emails: { on: boolean; kinds: Array<{ key: string; approval: unknown }> };
      unpaidTwoWeeks: number;
    };
    expect(body.fundraisers[0]).toMatchObject({ id: 7, title: "Robin's Santa Dash" });
    // Before the event: the pay link is not due, so it cannot be sent by hand yet.
    expect(body.fundraisers[0].pledges[0]).toMatchObject({ id: 5, name: "Alex Example", email: "alex@example.com", statusWords: "Not paid yet", canSend: false, canCancel: true });
    expect(body.emails.on).toBe(false);
    expect(body.emails.kinds.map((k) => [k.key, k.approval])).toEqual([
      ["pledge_pay", null],
      ["pledge_reminder", null],
    ]);
    expect(JSON.stringify(body)).not.toContain("nonce-a");
  });

  it("may send the pay link by hand only once it is due, and see what was paid twice", async () => {
    const d = deps({
      now: () => new Date("2026-12-10T12:00:00Z"),
      readAll: vi.fn(async () => [withF(pledge()), withF(pledge({ id: 6, status: "paid", paidAmountPence: 1000, doublePaidAt: "2026-12-07T10:00:00.000Z" }))]) as never,
    });
    const res = mockRes();
    await makePledgeHandlers(d).getAdminPledges(req(), res as never);
    const body = res.body as { paidTwice: number; fundraisers: Array<{ pledges: Array<Record<string, unknown>> }> };
    expect(body.paidTwice).toBe(1);
    expect(body.fundraisers[0].pledges[0]).toMatchObject({ id: 5, canSend: true });
    expect(body.fundraisers[0].pledges[1]).toMatchObject({ id: 6, paidTwice: true });
  });

  it("an editor marks one paid twice as checked", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postAdminChecked(req({ params: { id: "6" } }), res as never);
    expect(d.authorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), "edit");
    expect(d.markChecked).toHaveBeenCalledWith(6, "admin:fern@example.com");
    expect(res.body).toEqual({ status: "checked" });
  });

  it("only an admin sends new pay links to everyone unpaid, and is told how many went", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postAdminSendAll(req(), res as never);
    expect(d.authorizeAdmin).toHaveBeenCalled();
    expect(d.sendAll).toHaveBeenCalledWith("admin:jaimie@example.com");
    expect(res.body).toEqual({ sent: 2, skipped: 1, failed: 0, stopped: null });
    const stopped = deps({ sendAll: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, stopped: "switched_off" as const })) as never });
    const no = mockRes();
    await makePledgeHandlers(stopped).postAdminSendAll(req(), no as never);
    expect(no.statusCode).toBe(409);
    expect(no.body).toEqual({ error: "Automatic emails are switched off, so no pay link can be sent." });
  });

  it("is told plainly why a pay link cannot go by hand", async () => {
    for (const [outcome, words] of [
      ["early", "Their link goes the day after the event. To send it early, mark the fundraiser finished first."],
      ["too_soon", "A pay link went to this sponsor in the last 10 minutes. Please wait before sending another."],
      ["switched_off", "Automatic emails are switched off, so no pay link can be sent."],
      ["page", "This fundraiser's page no longer takes pledges, so no pay link can be sent."],
    ] as const) {
      const res = mockRes();
      await makePledgeHandlers(deps({ sendNow: vi.fn(async () => outcome) as never })).postAdminSend(req({ params: { id: "5" } }), res as never);
      expect(res.statusCode, outcome).toBe(409);
      expect(res.body).toEqual({ error: words });
    }
  });

  it("read each email before it is ever sent", async () => {
    const res = mockRes();
    await makePledgeHandlers(deps()).getAdminPreview(req({ params: { key: "pledge_pay" } }), res as never);
    expect(res.body).toMatchObject({ key: "pledge_pay", subject: "Sam finished Sam's Santa Dash! Here's your link to pay your £10 pledge", approval: null });
    const none = mockRes();
    await makePledgeHandlers(deps()).getAdminPreview(req({ params: { key: "target" } }), none as never);
    expect(none.statusCode).toBe(404);
  });

  it("only an admin approves a wording, and only one of the two pledge wordings", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postApproval(req({ params: { key: "pledge_pay" } }), res as never);
    expect(d.authorizeAdmin).toHaveBeenCalled();
    expect(d.approve).toHaveBeenCalledWith("pledge_pay", "admin:jaimie@example.com");
    const other = mockRes();
    await makePledgeHandlers(d).postApproval(req({ params: { key: "finished" } }), other as never);
    expect(other.statusCode).toBe(404);
    const refused = deps({ authorizeAdmin: vi.fn(async (_r, r) => (r.status(403).json({ error: "no" }), null)) as never });
    await makePledgeHandlers(refused).postApproval(req({ params: { key: "pledge_pay" } }), mockRes() as never);
    expect(refused.approve).not.toHaveBeenCalled();
  });

  it("an editor sends the pay link by hand, and is told plainly when it cannot go", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postAdminSend(req({ params: { id: "5" } }), res as never);
    expect(d.authorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), "edit");
    expect(d.sendNow).toHaveBeenCalledWith(5, "admin:fern@example.com");
    expect(res.body).toEqual({ status: "sent" });
    const waiting = mockRes();
    await makePledgeHandlers(deps({ sendNow: vi.fn(async () => "waiting" as const) })).postAdminSend(req({ params: { id: "5" } }), waiting as never);
    expect(waiting.statusCode).toBe(409);
    expect(waiting.body).toEqual({ error: "The pay email's wording is waiting for sign off, so it cannot be sent yet." });
  });

  it("an editor cancels a pledge, in their own name", async () => {
    const d = deps();
    const res = mockRes();
    await makePledgeHandlers(d).postAdminCancel(req({ params: { id: "5" } }), res as never);
    expect(d.cancel).toHaveBeenCalledWith(5, "admin:fern@example.com");
    expect(res.body).toEqual({ status: "cancelled" });
  });

  it("a viewer changes nothing", async () => {
    const d = deps({ authorize: vi.fn(async (_r, r, level) => (level === "view" ? { email: "v@example.com", role: "viewer" } : (r.status(403).json({ error: "no" }), null))) as never });
    for (const run of [
      (h: ReturnType<typeof makePledgeHandlers>, r: Res) => h.postAdminSend(req({ params: { id: "5" } }), r as never),
      (h: ReturnType<typeof makePledgeHandlers>, r: Res) => h.postAdminCancel(req({ params: { id: "5" } }), r as never),
      (h: ReturnType<typeof makePledgeHandlers>, r: Res) => h.postAdminMessage(req({ params: { id: "5" }, body: { hidden: true } }), r as never),
    ]) {
      const res = mockRes();
      await run(makePledgeHandlers(d), res);
      expect(res.statusCode).toBe(403);
    }
    expect(d.sendNow).not.toHaveBeenCalled();
    expect(d.cancel).not.toHaveBeenCalled();
    expect(d.setHidden).not.toHaveBeenCalled();
  });
});
