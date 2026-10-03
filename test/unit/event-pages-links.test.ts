import { describe, it, expect, vi, beforeEach } from "vitest";

// Event pages: everything that links to a page now links an event to its own, at
// nbcc.scot/event/<short name>: a printed piece's QR code, the materials, the organiser's emails,
// and where a giver comes back to after paying. A fundraiser raising money is linked exactly as
// before. Every name and address here is invented.

const mail = vi.hoisted(() => ({
  sendFundraiseApproved: vi.fn(),
  sendFundraiseEditApproved: vi.fn(),
  sendFundraiseEditRejected: vi.fn(),
  sendFundraiseNewsApproved: vi.fn(),
  sendFundraiseNewsRejected: vi.fn(),
}));
const db = vi.hoisted(() => ({ getFundraiser: vi.fn(), fundraisingIsOn: vi.fn() }));
vi.mock("../../src/clients/email", () => mail);
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: vi.fn() } } }, stripeConfigured: true }));
vi.mock("../../src/db/fundraisers", () => db);
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));

import { scanTarget } from "../../src/fundraising/material-codes";
import { materialFacts } from "../../src/fundraising/materials";
import { touchUrls } from "../../src/fundraising/touch-emails";
import { sendApprovedEmail, sendEditDecisionEmail, sendNewsDecisionEmail } from "../../src/fundraising/send";
import { pageUrlFor } from "../../src/fundraising/page-url";
import { fundraiserReturnPage } from "../../src/routes/api";
import { buildMaterial } from "../../src/routes/fundraise-materials";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

const event = (over: Partial<FundraiserRecord> = {}): FundraiserRecord => ({
  id: 12, slug: "eqn", path: "event", kind: "quiz", title: "Exampleton Quiz Night", description: "A quiz.", eventDate: "2026-12-05",
  startTime: "19:00", venue: "The Hall", town: "Exampleton", targetPence: null, public: true, status: "approved",
  name: "Alex Example", email: "alex@example.com", phone: "07700 900222", socialLink: null, socialOk: false,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
  postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
  declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z", approvedAt: null, approvedBy: null,
  updatedAt: "2026-10-01T10:00:00.000Z", updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null,
  venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null,
  creditName: null, slugSetAt: "2026-10-01T11:00:00.000Z",
  ...over,
});
const URLS = { pageUrl: "https://nbcc.test/event/eqn", getInvolvedUrl: "https://nbcc.test/get-involved" };

beforeEach(() => {
  for (const fn of Object.values(mail)) fn.mockReset().mockResolvedValue(undefined);
  db.fundraisingIsOn.mockReset().mockResolvedValue(true);
  db.getFundraiser.mockReset();
});

describe("a page's full address", () => {
  it("is /event/ for an event and /fundraise/ for raising money", () => {
    expect(pageUrlFor(event())).toBe("https://nbcc.test/event/eqn");
    expect(pageUrlFor(event({ path: "raising", slug: "rsd" }))).toBe("https://nbcc.test/fundraise/rsd");
  });
});

describe("a printed piece's QR code", () => {
  it("goes to the event's own page, with its tag", () => {
    expect(scanTarget(event(), "a4")).toBe("/event/eqn?utm_medium=qr&utm_campaign=f12-a4");
  });

  it("still goes to Get involved for a public event with no page yet (only ever approved or finished)", () => {
    expect(scanTarget(event({ status: "new" }), "a4")).toBeNull();
  });
});

describe("the materials", () => {
  it("carry the event's own page, as a fundraiser's carry theirs", () => {
    const facts = materialFacts(event(), meter({ onlinePence: 0, cashPence: 0, targetPence: null }), URLS);
    expect(facts.link).toBe("https://nbcc.test/event/eqn");
    expect(facts.linkKind).toBe("page");
    expect(facts.linkWords).toBe("nbcc.test/event/eqn");
    expect(facts.qrLinks?.poster).toBe("https://nbcc.test/q/12-a4");
  });
});

describe("an event's poster, as staff and the organiser open it", () => {
  it("prints the event page's address under its QR code", () => {
    const html = buildMaterial("poster", { ...event(), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }) }, "staff");
    expect(html).toContain("nbcc.test/event/eqn");
    expect(html).not.toContain("nbcc.test/get-involved");
  });
});

describe("the keep in touch emails", () => {
  it("link an event's own page", () => {
    expect(touchUrls("https://nbcc.test", event()).page).toBe("https://nbcc.test/event/eqn");
    expect(touchUrls("https://nbcc.test", { id: 7, slug: "rsd", path: "raising" }).page).toBe("https://nbcc.test/fundraise/rsd");
  });
});

describe("the organiser's emails", () => {
  it("approved: links the event's own page", async () => {
    await sendApprovedEmail(event());
    expect(mail.sendFundraiseApproved.mock.calls[0][1].text).toContain("https://nbcc.test/event/eqn");
  });

  it("a change approved: links the event's own page", async () => {
    await sendEditDecisionEmail(event(), true, true);
    expect(mail.sendFundraiseEditApproved.mock.calls[0][1].text).toContain("https://nbcc.test/event/eqn");
  });

  it("a news update approved: links the event's own page", async () => {
    await sendNewsDecisionEmail(event(), true, true);
    expect(mail.sendFundraiseNewsApproved.mock.calls[0][1].text).toContain("https://nbcc.test/event/eqn");
  });
});

describe("after giving on an event's page", () => {
  it("the giver comes back to that page", async () => {
    db.getFundraiser.mockResolvedValue(event());
    expect(await fundraiserReturnPage(12)).toBe("https://nbcc.test/event/eqn");
  });
});
