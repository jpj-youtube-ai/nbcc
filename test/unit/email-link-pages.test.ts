import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// TASK-615: the pages a link in an email opens are pages of the site. A thank-you letter's link that
// cannot show the letter, the unsubscribe link and the email choices link all wear the site's banner
// and footer, and go out with what every page gains (src/routes/site.ts, here leaving a mark). What
// they do is as it was: the unsubscribe link's GET asks and never acts, its button unsubscribes, and
// the email choices still save. A page that cannot be drawn is a plain 500, never a promise left to
// reject. Through the real routers, with the database mocked; every address and id is invented.

const db = vi.hoisted(() => ({
  query: vi.fn(),
  getThankYouSentById: vi.fn(),
  unsubscribeDonor: vi.fn(),
  unsubscribeAllListsForEmail: vi.fn(),
  donorConsentForEmail: vi.fn(),
  setDonorConsents: vi.fn(),
  unsubscribeListMember: vi.fn(),
  listMembershipsForEmail: vi.fn(),
  listOfferableLists: vi.fn(),
  addListSubscriber: vi.fn(),
  recordUnsubscribeEvent: vi.fn(),
  recordUnsubscribeEventForEmail: vi.fn(),
  addOptOut: vi.fn(),
  liftOptOut: vi.fn(),
}));
const drawing = vi.hoisted(() => {
  const state = { fail: false };
  const breakable =
    <A extends unknown[]>(draw: (...a: A) => string) =>
    (...a: A): string => {
      if (state.fail) throw new Error("a page that will not draw");
      return draw(...a);
    };
  return { state, breakable };
});

vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "a-test-secret" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: db.query, connect: vi.fn() } }));
vi.mock("../../src/db/thank-you", () => ({ getThankYouSentById: db.getThankYouSentById }));
vi.mock("../../src/db/newsletters", () => ({
  unsubscribeDonor: db.unsubscribeDonor,
  unsubscribeAllListsForEmail: db.unsubscribeAllListsForEmail,
  donorConsentForEmail: db.donorConsentForEmail,
  setDonorConsents: db.setDonorConsents,
}));
vi.mock("../../src/db/subscriber-lists", () => ({
  unsubscribeListMember: db.unsubscribeListMember,
  listMembershipsForEmail: db.listMembershipsForEmail,
  listOfferableLists: db.listOfferableLists,
  addListSubscriber: db.addListSubscriber,
}));
vi.mock("../../src/db/newsletter-events", () => ({
  recordUnsubscribeEvent: db.recordUnsubscribeEvent,
  recordUnsubscribeEventForEmail: db.recordUnsubscribeEventForEmail,
}));
vi.mock("../../src/db/email-opt-outs", () => ({ addOptOut: db.addOptOut, liftOptOut: db.liftOptOut }));
// What every page of the site gains as it goes out: here a mark, and the cookie it was handed.
const dressed = vi.hoisted(() => ({ cookies: [] as (string | undefined)[] }));
vi.mock("../../src/routes/site", () => ({
  decorateSitePage: async (html: string, cookie: string | undefined) => {
    dressed.cookies.push(cookie);
    return html.replace("</footer>", "<!-- dressed --></footer>");
  },
}));
// A page that will not draw, when a test asks for one.
vi.mock("../../src/newsletter/email-pages", async (orig) => {
  const real = await orig<typeof import("../../src/newsletter/email-pages")>();
  return {
    unsubscribeMessagePage: drawing.breakable(real.unsubscribeMessagePage),
    unsubscribeConfirmPage: drawing.breakable(real.unsubscribeConfirmPage),
    preferencesPage: drawing.breakable(real.preferencesPage),
    preferencesInvalidPage: drawing.breakable(real.preferencesInvalidPage),
  };
});
vi.mock("../../src/thank-you/letter-notice", async (orig) => {
  const real = await orig<typeof import("../../src/thank-you/letter-notice")>();
  return { letterNoticePage: drawing.breakable(real.letterNoticePage) };
});

import { thankYouLetterRouter } from "../../src/routes/thank-you";
import { unsubscribeRouter } from "../../src/routes/unsubscribe";
import { preferencesRouter } from "../../src/routes/preferences";
import { signSubscriberUnsubscribeToken, signUnsubscribeToken, signUnsubscribeTokenV2 } from "../../src/donors/unsubscribe-token";
import { signThankYouLetterToken } from "../../src/thank-you/letter-token";
import { doneMessage } from "../../src/newsletter/unsubscribe-copy";
import { PAGE_FAILED_WORDS } from "../../src/site/chrome";

const SECRET = "a-test-secret";
const DONOR = signUnsubscribeTokenV2(5, 9, SECRET); // donor 5, from newsletter 9
const SUBSCRIBER = signSubscriberUnsubscribeToken(21, 9, SECRET); // list member 21, from newsletter 9

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(thankYouLetterRouter, unsubscribeRouter, preferencesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  drawing.state.fail = false;
  dressed.cookies.length = 0;
  db.query.mockResolvedValue({ rows: [{ email: "robin@example.com" }] });
  db.getThankYouSentById.mockResolvedValue(null);
  db.unsubscribeDonor.mockResolvedValue("robin@example.com");
  db.unsubscribeAllListsForEmail.mockResolvedValue(1);
  db.unsubscribeListMember.mockResolvedValue({ email: "kit@example.com" });
  db.donorConsentForEmail.mockResolvedValue({ id: 5, emailConsent: true, thankyouConsent: true });
  db.listMembershipsForEmail.mockResolvedValue([{ id: 11, listId: 3, listName: "Volunteers" }]);
  db.listOfferableLists.mockResolvedValue([]);
  db.addOptOut.mockResolvedValue(true);
  db.liftOptOut.mockResolvedValue(true);
});

const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const post = (path: string, form: Record<string, string> = {}) =>
  get(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });

/** The page is a page of the site: the site's banner and footer, dressed as it went out. */
function expectSitePage(html: string): void {
  expect(html).toMatch(/<header class="nav" id="nav"/);
  expect(html).toContain('<a class="nav-cta" href="/donate">Donate</a>');
  expect(html).toMatch(/<footer class="site-footer"/);
  expect(html).toContain("<!-- dressed --></footer>");
  expect(html).toContain('<script defer src="/assets/js/main.js"></script>');
}

/** Every write the unsubscribe link and the email choices can make. */
const WRITES = ["unsubscribeDonor", "unsubscribeAllListsForEmail", "unsubscribeListMember", "recordUnsubscribeEvent", "recordUnsubscribeEventForEmail", "setDonorConsents", "addListSubscriber", "addOptOut", "liftOptOut"] as const;
const expectNoWrites = () => {
  for (const name of WRITES) expect(db[name], name).not.toHaveBeenCalled();
};

/** A page that will not draw answers 500 with the plain words, never cached, and says so in the log. */
async function expectFailedAnswer(r: Response, logged: ReturnType<typeof vi.spyOn>): Promise<void> {
  expect(r.status).toBe(500);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.text()).toBe(PAGE_FAILED_WORDS);
  expect(logged).toHaveBeenCalledOnce();
}

describe("a thank-you letter's link", () => {
  it("that is not valid answers 400 with a page of the site", async () => {
    const r = await get("/thank-you/letter/not-a-token");
    expect(r.status).toBe(400);
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain("<p>This letter link is not valid.</p>");
  });

  it("whose letter is gone answers 404 with a page of the site, read with the visitor's cookie", async () => {
    const r = await get(`/thank-you/letter/${signThankYouLetterToken(7, SECRET)}`, { headers: { cookie: "a=1" } });
    expect(r.status).toBe(404);
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain("<p>This letter could not be found.</p>");
    expect(db.getThankYouSentById).toHaveBeenCalledWith(7);
    expect(dressed.cookies).toEqual(["a=1"]);
  });

  it("answers 500, never a promise left to reject, when its page will not draw", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      await expectFailedAnswer(await get("/thank-you/letter/not-a-token"), logged);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("the unsubscribe link", () => {
  it("asks on a page of the site, and never acts", async () => {
    const r = await get(`/unsubscribe/${DONOR}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain(`<form method="post" action="/unsubscribe/${DONOR}" class="row">`);
    expect(html).toContain("Yes, unsubscribe me");
    expectNoWrites();
  });

  it("unsubscribes a donor from the button, as before, and says so on a page of the site", async () => {
    const r = await post(`/unsubscribe/${DONOR}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(db.unsubscribeDonor).toHaveBeenCalledWith(5);
    expect(db.unsubscribeAllListsForEmail).toHaveBeenCalledWith("robin@example.com");
    expect(db.recordUnsubscribeEvent).toHaveBeenCalledWith(9, 5);
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain(doneMessage("everything"));
    expect(html).toContain(`<a href="/preferences/${encodeURIComponent(DONOR)}">`);
  });

  it("takes a list member off that one list, as before", async () => {
    const r = await post(`/unsubscribe/${SUBSCRIBER}`);
    expect(r.status).toBe(200);
    expect(db.unsubscribeListMember).toHaveBeenCalledWith(21);
    expect(db.recordUnsubscribeEventForEmail).toHaveBeenCalledWith(9, "kit@example.com");
    expect(db.unsubscribeDonor).not.toHaveBeenCalled();
    expect(await r.text()).toContain(doneMessage("one-list"));
  });

  it("answers a link that is not ours with 400 and a page of the site, and changes nothing", async () => {
    for (const r of [await get("/unsubscribe/not-a-token"), await post("/unsubscribe/not-a-token")]) {
      expect(r.status).toBe(400);
      const html = await r.text();
      expectSitePage(html);
      expect(html).toContain("This unsubscribe link is not valid.");
    }
    expectNoWrites();
  });

  it("still unsubscribes when the answer will not draw, and answers 500 rather than leaving a promise to reject", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      await expectFailedAnswer(await post(`/unsubscribe/${DONOR}`), logged);
      expect(db.unsubscribeDonor).toHaveBeenCalledWith(5);
      expect(db.unsubscribeAllListsForEmail).toHaveBeenCalledWith("robin@example.com");
    } finally {
      logged.mockRestore();
    }
  });

  it("answers the question with 500 when it will not draw, still acting on nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      await expectFailedAnswer(await get(`/unsubscribe/${DONOR}`), logged);
      expectNoWrites();
    } finally {
      logged.mockRestore();
    }
  });
});

describe("the email choices link", () => {
  const CHOICES = `/preferences/${signUnsubscribeToken(5, SECRET)}`;

  it("shows the choices on a page of the site", async () => {
    const r = await get(CHOICES);
    expect(r.status).toBe(200);
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain("<b>Volunteers</b>");
    expect(html).toContain("Save my choices");
    expectNoWrites();
  });

  it("saves as before, and shows the saved page of the site", async () => {
    const r = await post(CHOICES, { all: "off" });
    expect(r.status).toBe(200);
    expect(db.addOptOut).toHaveBeenCalledWith("robin@example.com", "all", "preferences");
    expect(db.unsubscribeListMember).toHaveBeenCalledWith(11);
    expect(db.setDonorConsents).toHaveBeenCalledWith("robin@example.com", { newsletter: false, thankYou: false });
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain("<b>Saved.</b>");
  });

  it("answers a link that is not ours with 400 and a page of the site", async () => {
    const r = await get("/preferences/not-a-token");
    expect(r.status).toBe(400);
    const html = await r.text();
    expectSitePage(html);
    expect(html).toContain("<p>This link is not valid.</p>");
  });

  it("answers 500, never a promise left to reject, when its page will not draw", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      await expectFailedAnswer(await get(CHOICES), logged);
    } finally {
      logged.mockRestore();
    }
  });

  it("still saves when the saved page will not draw, and answers 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      await expectFailedAnswer(await post(CHOICES, { all: "off" }), logged);
      expect(db.setDonorConsents).toHaveBeenCalledWith("robin@example.com", { newsletter: false, thankYou: false });
    } finally {
      logged.mockRestore();
    }
  });
});
