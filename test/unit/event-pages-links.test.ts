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
import { buildApprovedEmail } from "../../src/fundraising/emails";
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

// Review fix: a public event whose stored address is not a valid one (it can never be put in a link)
// still goes somewhere useful: Get involved, where it is listed, as before event pages.
describe("a printed piece's QR code, for an event whose address cannot be linked", () => {
  it("goes to Get involved, with its tag", () => {
    expect(scanTarget(event({ slug: "Not A Valid Address" }), "a5")).toBe("/get-involved?utm_medium=qr&utm_campaign=f12-a5");
  });

  it("still goes nowhere for a fundraiser raising money with such an address", () => {
    expect(scanTarget(event({ path: "raising", slug: "Not A Valid Address" }), "a5")).toBeNull();
  });
});

// Review fix: an event's approved email is about its event page, with no sponsorship tips.
describe("the approved email for an event", () => {
  const eventMail = () =>
    buildApprovedEmail(
      { name: "Alex Example", title: "Exampleton Quiz Night", path: "event", booking: "door" },
      { pageUrl: "https://nbcc.test/event/eqn", manageUrl: "https://nbcc.test/fundraise/manage" },
    );

  it("says the event's page is live", () => {
    expect(eventMail().subject).toBe("Your event's page is live: Exampleton Quiz Night");
    expect(eventMail().html).toContain("Your event’s page is live!");
    expect(eventMail().text).toContain("See my event page: https://nbcc.test/event/eqn");
  });

  it("gives an event's tips: share it, put up the posters, give on the page, and ask us for help", () => {
    const t = eventMail().text;
    expect(t).toContain("Share your event page");
    expect(t).toContain("Put up your posters");
    expect(t).toContain(
      "On the day, point people to your page if they’d like to give a little extra. Entry money is separate: collect it as usual and pay it in afterwards from your private area. Gift Aid can’t go on entry or ticket money.",
    );
    expect(t).not.toContain("so anyone who would like to give can do it there");
    expect(t).toContain("Just reply to this email.");
    expect(t).toContain("children, young people and vulnerable adults");
  });

  it("has none of the sponsorship tips, and never says families", () => {
    const all = eventMail().text + eventMail().html;
    expect(all).not.toContain("Make the first gift yourself");
    expect(all).not.toContain("fundraising page");
    // Not the email's own styles (font-family): only words people read.
    expect(all.replace(/font-family/gi, "")).not.toMatch(/famil(y|ies)/i);
  });

  it("is sent to an approved event with a page", async () => {
    await sendApprovedEmail(event());
    expect(mail.sendFundraiseApproved.mock.calls[0][1].subject).toBe("Your event's page is live: Exampleton Quiz Night");
  });

  it("leaves a fundraiser's approved email exactly as it was", () => {
    const m = buildApprovedEmail({ name: "Robin Quill", title: "Robin's Santa Dash" }, { pageUrl: "https://nbcc.test/fundraise/rsd", manageUrl: null });
    expect(m.subject).toBe("Your fundraising page is live: Robin's Santa Dash");
    expect(m.text).toContain("Make the first gift yourself");
  });
});

// TASK-519: an event shared with another cause carries the statement on its printed pieces, by the
// same materials code as a fundraiser's.
describe("an event shared with another cause, in print", () => {
  it("has the statement on its poster and leaflet", () => {
    const f = { ...event({ sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "The Exampleton Lifeboat" }), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }) };
    for (const piece of ["poster", "leaflet"] as const) {
      const html = buildMaterial(piece, f, "staff");
      expect(html).toContain("60% of what we raise goes to the Night Before Christmas Campaign");
      expect(html).toContain("The Exampleton Lifeboat");
      expect(html).toContain("nbcc.test/event/eqn");
    }
  });
});

// Jaimie, 2026-10-03: giving is a donation, not a ticket. An event's poster asks people to scan for
// the details as well as to give, and says how to get in; a fundraiser's poster is unchanged.
describe("an event's poster: the details, and how to get in", () => {
  const poster = (over: Partial<FundraiserRecord> = {}) =>
    buildMaterial("poster", { ...event(over), meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }) }, "staff");

  it("asks people to scan for the details, and to give", () => {
    expect(poster()).toContain("Scan for the details, and to give");
    expect(poster()).not.toContain("Scan to give");
  });

  it("says how to get in, by how people get in", () => {
    expect(poster({ booking: "door", price: "£5" })).toContain('<div class="p-entry">Entry: £5, paid on the door</div>');
    expect(poster({ booking: "away", ticketUrl: "https://tickets.example.com/eqn", price: null })).toContain(
      '<div class="p-entry">Tickets: from tickets.example.com</div>',
    );
    expect(poster({ booking: "free" })).toContain('<div class="p-entry">Entry: free</div>');
    expect(poster({ booking: null })).not.toContain("p-entry\">");
  });

  it("is unchanged for a fundraiser raising money", () => {
    const html = poster({ path: "raising", slug: "rsd", booking: null });
    expect(html).toContain("Scan to give");
    expect(html).not.toContain('<div class="p-entry">');
  });
});

// Event clarity review: the live email's "on the day" point follows how people get in.
describe("the event page live email, by how people get in", () => {
  const mailFor = (booking: FundraiserRecord["booking"]) =>
    buildApprovedEmail(
      { name: "Alex Example", title: "Exampleton Quiz Night", path: "event", booking },
      { pageUrl: "https://nbcc.test/event/eqn", manageUrl: "https://nbcc.test/fundraise/manage" },
    ).text;
  const LEAD = "On the day, point people to your page if they’d like to give a little extra.";

  it("pay on the door: entry money is separate, and never Gift Aided", () => {
    expect(mailFor("door")).toContain(
      `${LEAD} Entry money is separate: collect it as usual and pay it in afterwards from your private area. Gift Aid can’t go on entry or ticket money.`,
    );
  });

  it("tickets elsewhere: ticket money goes through the seller", () => {
    expect(mailFor("away")).toContain(
      `${LEAD} Ticket money goes through your ticket seller as usual; only pay in NBCC’s share of anything you collect yourself. Gift Aid can’t go on entry or ticket money.`,
    );
  });

  it("free: anything given is a donation", () => {
    const t = mailFor("free");
    expect(t).toContain(`${LEAD} Entry is free, so anything people give on your page or on the day is a donation.`);
    expect(t).not.toContain("Entry money is separate");
  });

  it("never asked: if they charge entry", () => {
    expect(mailFor(null)).toContain(
      `${LEAD} If you charge entry, collect it as usual and pay it in afterwards from your private area. Gift Aid can’t go on entry or ticket money.`,
    );
  });
});
