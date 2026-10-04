// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// TASK-476: a panel whose data could not be fetched says so, rather than showing zeros, an empty
// list or "nothing due" as if all were well.
//
// authFetch stops only on a 401. Any other failure still answers in JSON, an { error } with no
// results in it, and most screens read that body as data: the Overview said "0 Adjustments due",
// the GASDS screen said nothing was near its deadline, the pre-send checks said "Everything checks
// out", and a ball hold the server refused said "Held.". TASK-458 fixed one of these (Monthly
// givers); this proves the rest, each both ways: its "could not load" state on a failure, and its
// real answer on a 200, so the fix cannot pass by always saying it failed.
//
// Same harness as admin-app.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js evaluated
// against it. Every name and address here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const adminToken = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

// What the server answers, per path (the query string is ignored). A failure can be keyed by the
// path alone, or by "METHOD path" when a read and a write share a path. Anything not listed gets
// the { results: [] } a queue answers with when it is genuinely empty.
type Failure = { status: number; body?: unknown };
let failing: Record<string, Failure> = {};
let served: Record<string, unknown> = {};
let requested: string[] = [];
const SERVER_DOWN = { status: 500, body: { error: "Admin is temporarily unavailable" } };

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  requested.push(url);
  const path = url.split("?")[0];
  const method = (init?.method || "GET").toUpperCase();
  if (path === "/api/admin/login") return j({ token: adminToken, user: { email: "admin@nbcc", role: "admin" } });
  const failure = failing[method + " " + path] || failing[path];
  if (failure) return j(failure.body ?? SERVER_DOWN.body, failure.status);
  if (path === "/api/admin/me") {
    return j({ email: "admin@nbcc", fullName: "Test Admin", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  }
  if (path in served) return j(served[path]);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
async function open(view: string) {
  (document.querySelector('.admin-nav-link[data-view="' + view + '"]') as HTMLElement).click();
  await settle();
}

beforeEach(() => {
  failing = {};
  served = {};
  requested = [];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.prompt = () => "";
  window.alert = () => undefined;
  // admin.html loads this from its own script before app.js; the enquiry list calls it.
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

// TASK-508: the five Gift Aid figures that used to stand here are lines in "Needs you" now. The
// review of #600 still holds: what is not in your access is left out, not reported as a failure.
describe("the Overview says when it could not check, never that nothing needs you (TASK-476, TASK-508)", () => {
  it("names the parts it could not check", async () => {
    served["/api/admin/overview"] = { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], failed: ["Claims"] };
    await signIn();
    expect(el("overviewNeeds").textContent).toContain("Could not check: Claims");
    expect(el("overviewNeeds").textContent).not.toContain("Nothing needs you");
  });

  it("says recent donations are not part of your access, rather than that they could not load", async () => {
    failing["/api/admin/donations"] = { status: 403, body: { error: "forbidden" } };
    await signIn();
    expect(el("overviewRecent").textContent).toContain("Recent donations are not part of your access.");
    expect(el("overviewRecent").textContent).not.toContain("unavailable");
  });
});

// One row per panel: the screen, the request that fails, where the panel draws, what it says when
// it cannot load, and what it says on a 200 (a genuinely empty answer, or a real figure). The two
// must differ, or "empty" and "could not load" would still look alike.
type Panel = {
  name: string;
  view: string | null; // null: the Overview, where signing in lands
  path: string;
  target: string;
  unavailable: string;
  okBody?: unknown;
  okText: string;
};
const panels: Panel[] = [
  { name: "Needs you", view: null, path: "/api/admin/overview", target: "overviewNeeds",
    unavailable: "The overview could not load.", okText: "Nothing needs you right now." },
  { name: "Recent donations", view: null, path: "/api/admin/donations", target: "overviewRecent",
    unavailable: "Recent donations are unavailable.", okText: "No donations yet." },
  { name: "Donations", view: "donations", path: "/api/admin/donations", target: "donationsTable",
    unavailable: "Donations are unavailable.", okText: "No donations yet." },
  { name: "GASDS deadline", view: "gasds", path: "/api/admin/queues/gasds-deadline", target: "gasdsTable",
    unavailable: "GASDS donations are unavailable.",
    okText: "No GASDS donations are approaching the claim deadline." },
  { name: "GASDS pool", view: "gasds", path: "/api/admin/queues/gasds-pool", target: "gasdsPool",
    unavailable: "The small donations pool is unavailable.",
    okBody: { year: 2026, gasdsPoolTotalPence: 123400, giftAidClaimedPence: 0, remainingHeadroomPence: 876600 },
    okText: "Small donations pool (2026)" },
  { name: "Claims waiting", view: "claims", path: "/api/admin/claims/eligible", target: "eligibleTable",
    unavailable: "Donations waiting to be claimed are unavailable.",
    okText: "No donations are waiting to be claimed." },
  { name: "Claim batches", view: "claims", path: "/api/admin/claim-batches", target: "batchesTable",
    unavailable: "Claim batches are unavailable.", okText: "No claim batches." },
  { name: "Adjustments", view: "claims", path: "/api/admin/claims/adjustment-due", target: "adjustmentTable",
    unavailable: "Adjustments are unavailable.", okText: "No adjustments due." },
  { name: "Flagged subscriptions", view: "subscriptions", path: "/api/admin/subscriptions/dunning",
    target: "subsTable", unavailable: "Flagged subscriptions are unavailable.", okText: "No flagged subscriptions." },
  { name: "Business supporters", view: "fulfilments", path: "/api/admin/fulfilments", target: "fulfilmentsTable",
    unavailable: "Business supporters are unavailable.", okText: "No business supporters yet." },
  { name: "Stories", view: "stories", path: "/api/admin/stories", target: "storiesTable",
    unavailable: "Stories are unavailable.", okText: "No stories yet." },
  { name: "Enquiries", view: "contact", path: "/api/admin/contact", target: "contactTable",
    unavailable: "Enquiries are unavailable.", okText: "No enquiries yet." },
  { name: "Audit log", view: "audit", path: "/api/admin/audit", target: "auditTable",
    unavailable: "The audit log is unavailable.", okText: "No audit entries." },
  { name: "Email log", view: "email-audit", path: "/api/admin/email-log", target: "emailAuditTable",
    unavailable: "The email log is unavailable.", okText: "No emails recorded yet." },
  { name: "Site pages", view: "site", path: "/api/admin/site-pages", target: "siteAliasTable",
    unavailable: "Site pages are unavailable.", okBody: { pages: [], privatePages: [], aliases: [] },
    okText: "No spare addresses yet." },
  { name: "Team", view: "team", path: "/api/admin/users", target: "teamTable",
    unavailable: "Could not load the team.", okText: "No team members yet." },
  { name: "Newsletters", view: "newsletter", path: "/api/admin/newsletters", target: "newsletterList",
    unavailable: "Newsletters are unavailable.", okBody: [], okText: "No newsletters yet." },
  { name: "Thank you: eligible", view: "thank-you", path: "/api/admin/thank-you/eligible", target: "tyEligibleTable",
    unavailable: "Could not load donors.", okText: "No donors over the threshold yet." },
  { name: "Thank you: sent", view: "thank-you", path: "/api/admin/thank-you/sent", target: "tySentTable",
    unavailable: "Could not load the sent history.", okText: "No thank-you letters sent yet." },
  { name: "Outreach: needs you", view: "outreach", path: "/api/admin/outreach/todo", target: "outTodo",
    unavailable: "Could not load this list.", okBody: { todos: [] }, okText: "Nothing needs you right now." },
  { name: "Outreach: businesses", view: "outreach", path: "/api/admin/outreach", target: "outList",
    unavailable: "Could not load the list.", okText: "No businesses yet." },
  { name: "Outreach: how it is going", view: "outreach", path: "/api/admin/outreach/reports", target: "outReports",
    unavailable: "Could not load this.", okBody: { funnel: {}, money: {} },
    okText: "Nothing to report yet." },
  { name: "Supporters ticker", view: "ticker", path: "/api/admin/ticker", target: "tickerTable",
    unavailable: "Could not load supporters.", okText: "No partners yet." },
  { name: "Ball: holds", view: "ball", path: "/api/admin/ball/holds", target: "ballHolds",
    unavailable: "Could not load holds.", okText: "Nothing is held back." },
  { name: "Ball: bookings", view: "ball", path: "/api/admin/ball/bookings", target: "ballBookings",
    unavailable: "Could not load bookings.", okText: "No bookings yet." },
  { name: "Ball: guest details", view: "ball", path: "/api/admin/ball/guest-progress", target: "ballGuestProgress",
    unavailable: "Could not load guest details.",
    okBody: { summary: { guestsNamed: 3, seatsBooked: 10, percentComplete: 30, guestsMissing: 7,
      bookingsOutstanding: 1, needsGiven: 0 }, outstanding: [] },
    okText: "3 of 10" },
  { name: "Ball: menu choices", view: "ball", path: "/api/admin/ball/menu-progress", target: "ballMenuProgress",
    unavailable: "Could not load menu choices.", okBody: { summary: { asking: false } },
    okText: "No menu set yet" },
];

describe("each panel says it could not load, instead of looking empty (TASK-476)", () => {
  async function show(p: Panel) {
    await signIn();
    if (p.view) await open(p.view);
    return el(p.target).textContent || "";
  }

  it.each(panels.map((p) => [p.name, p] as const))("%s: its real answer on a 200", async (_name, p) => {
    if (p.okBody !== undefined) served[p.path] = p.okBody;
    const text = await show(p);
    expect(text).toContain(p.okText);
    expect(text).not.toContain(p.unavailable);
  });

  it.each(panels.map((p) => [p.name, p] as const))("%s: says so on a 500, rather than looking empty", async (_name, p) => {
    failing[p.path] = SERVER_DOWN;
    const text = await show(p);
    expect(text).toContain(p.unavailable);
    expect(text).not.toContain(p.okText);
  });

  // A 403 (access removed mid-session) is a failure like any other: nothing on the screen may read
  // it as an empty list either.
  it("says so on a 403 too", async () => {
    failing["/api/admin/queues/gasds-deadline"] = { status: 403, body: { error: "forbidden" } };
    await signIn();
    await open("gasds");
    expect(el("gasdsTable").textContent).toContain("GASDS donations are unavailable.");
    expect(el("gasdsActions").hidden).toBe(true);
  });

  // The 401 keeps its own meaning: the session is gone, so it is back to the sign-in screen.
  it("still signs you out on a 401", async () => {
    await signIn();
    failing["/api/admin/queues/gasds-deadline"] = { status: 401, body: { error: "unauthorized" } };
    await open("gasds");
    expect(el("loginView").hidden).toBe(false);
    expect(el("appView").hidden).toBe(true);
  });
});

describe("the figures beside a list go with it when it cannot load (TASK-476)", () => {
  // Review of #600: the pager is how someone on page 4 tries again, so a failure leaves it alone.
  it("keeps the donations pager, so you can try that page again", async () => {
    served["/api/admin/donations"] = { results: [], total: 120 };
    await signIn();
    await open("donations");
    expect(el("donationsPager").hidden).toBe(false);

    failing["/api/admin/donations"] = SERVER_DOWN;
    el("donationsNext").click();
    await settle();
    expect(el("donationsTable").textContent).toContain("Donations are unavailable.");
    expect(el("donationsPager").hidden).toBe(false);
    expect((el("donationsNext") as HTMLButtonElement).disabled).toBe(false); // press it again to retry
    // The counter goes back to the page on screen, so Next retries page two rather than skipping to three.
    expect(el("donationsInfo").textContent).toBe("1-25 of 120");
    const offsets = () => requested.filter((u) => u.startsWith("/api/admin/donations?") && u.includes("offset=")).map((u) => /offset=(\d+)/.exec(u)![1]);
    el("donationsNext").click();
    await settle();
    expect(offsets().slice(-2)).toEqual(["25", "25"]);
  });

  it("keeps the email log pager, so you can try that page again", async () => {
    served["/api/admin/email-log"] = { results: [], failures: [], total: 120 };
    await signIn();
    await open("email-audit");
    expect(el("emailAuditPager").hidden).toBe(false);

    failing["/api/admin/email-log"] = SERVER_DOWN;
    el("emailAuditNext").click();
    await settle();
    expect(el("emailAuditTable").textContent).toContain("The email log is unavailable.");
    expect(el("emailAuditPager").hidden).toBe(false);
    expect((el("emailAuditNext") as HTMLButtonElement).disabled).toBe(false); // press it again to retry
    expect((el("emailAuditPrev") as HTMLButtonElement).disabled).toBe(true); // still on the first page
    const offsets = () => requested.filter((u) => u.startsWith("/api/admin/email-log?") && u.includes("offset=")).map((u) => /offset=(\d+)/.exec(u)![1]);
    el("emailAuditNext").click();
    await settle();
    const tried = offsets().slice(-2);
    expect(tried[0]).toBe(tried[1]);
    expect(tried[0]).not.toBe("0");
  });

  it("gives no count of donors to thank", async () => {
    await signIn();
    await open("thank-you");
    expect(el("tyEligibleCount").textContent).toContain("0 listed");

    failing["/api/admin/thank-you/eligible"] = SERVER_DOWN;
    await open("ticker");
    await open("thank-you");
    expect(el("tyEligibleCount").textContent).toBe("");
  });

  it("gives no count of ticker supporters", async () => {
    await signIn();
    await open("ticker");
    expect(el("tickerCount").textContent).toContain("0 total");

    failing["/api/admin/ticker"] = SERVER_DOWN;
    await open("ball");
    await open("ticker");
    expect(el("tickerCount").textContent).toBe("");
  });

  it("shows no outreach totals of 0", async () => {
    failing["/api/admin/outreach"] = SERVER_DOWN;
    await signIn();
    await open("outreach");
    expect(el("outStats").textContent).toBe("");
  });

  it("shows no ball takings of £0 when the ball settings cannot load", async () => {
    failing["/api/admin/ball"] = SERVER_DOWN;
    await signIn();
    await open("ball");
    expect(el("ballGateState").textContent).toBe("Could not load the ball settings.");
    expect(el("ballStats").textContent).not.toContain("£0");
    expect(el("ballStats").textContent).not.toContain("Seats sold");
  });
});

describe("search, and the detail screens, say when they could not load (TASK-476)", () => {
  async function search(q: string) {
    await open("search");
    (el("searchQuery") as HTMLInputElement).value = q;
    el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
  }

  it("search: finds nothing only when the search ran", async () => {
    await signIn();
    await search("rowan");
    expect(el("searchResults").textContent).toContain("No results");

    failing["/api/admin/search/donors"] = SERVER_DOWN;
    await search("rowan");
    expect(el("searchResults").textContent).toContain("Search is unavailable.");
    expect(el("searchResults").textContent).not.toContain("No results");
  });

  const donation = {
    id: 11, donor_id: 5, donor_name: "Rowan Example", mode: "single", plan: null, amount_pence: 2500,
    gift_aid: false, claim_status: "none", payment_status: "paid", refunded_amount_pence: 0,
    created_at: "2026-01-02T00:00:00Z",
  };

  it("a donor who could not be loaded is not shown as a blank record", async () => {
    served["/api/admin/donations"] = { results: [donation], total: 1 };
    failing["/api/admin/donors/5"] = SERVER_DOWN;
    await signIn();
    await open("donations");
    (document.querySelector("#donationsTable [data-donor]") as HTMLElement).click();
    await settle();
    expect(el("donorDetail").textContent).toContain("Could not load this donor. Please try again.");
  });

  it("a donor that is not there still says so", async () => {
    served["/api/admin/donations"] = { results: [donation], total: 1 };
    failing["/api/admin/donors/5"] = { status: 404, body: { error: "not found" } };
    await signIn();
    await open("donations");
    (document.querySelector("#donationsTable [data-donor]") as HTMLElement).click();
    await settle();
    expect(el("donorDetail").textContent).toContain("Donor not found.");
  });

  it("a story that could not be loaded says so", async () => {
    served["/api/admin/stories"] = {
      results: [{ id: 9, created_at: "2026-06-01T00:00:00Z", submitter_role: "family_carer", use_scope: "public",
        status: "new", short_quote: "An invented quote." }],
    };
    failing["/api/admin/stories/9"] = SERVER_DOWN;
    await signIn();
    await open("stories");
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await settle();
    expect(el("storyDetail").textContent).toContain("Could not load this story. Please try again.");
  });

  it("an enquiry that could not be loaded says so", async () => {
    served["/api/admin/contact"] = {
      results: [{ id: 4, first_name: "Rowan", last_name: "Example", email: "rowan@example.test",
        status: "new", message: "An invented message.", created_at: "2026-06-01T00:00:00Z" }],
    };
    failing["/api/admin/contact/4"] = SERVER_DOWN;
    await signIn();
    await open("contact");
    (document.querySelector("#contactTable [data-contact]") as HTMLElement).click();
    await settle();
    expect(el("contactDetail").textContent).toContain("Could not load this enquiry. Please try again.");
  });

  it("my account says it could not load rather than showing an empty name", async () => {
    await signIn();
    failing["/api/admin/me"] = SERVER_DOWN;
    el("accountBtn").click();
    await settle();
    expect(el("accountNameStatus").textContent).toBe("Could not load your account.");
  });
});

describe("outreach: a business, its disclosure and a pasted list (TASK-476)", () => {
  const business = { id: 4, businessName: "Invented Joinery Ltd", contactName: "", contactEmail: "", tags: [], createdAt: "2026-06-01T00:00:00Z" };

  async function openBusiness() {
    served["/api/admin/outreach"] = { results: [business] };
    await signIn();
    await open("outreach");
    (document.querySelector("#outList [data-out-open]") as HTMLElement).click();
    await settle();
  }

  it("a business that could not be loaded says so", async () => {
    failing["/api/admin/outreach/4"] = SERVER_DOWN;
    await openBusiness();
    expect(el("businessDetail").textContent).toContain("Could not load that business.");
  });

  it("does not hand over an empty disclosure when it could not be gathered", async () => {
    failing["/api/admin/outreach/4/disclosure"] = SERVER_DOWN;
    await openBusiness();
    el("businessDisclose").click();
    await settle();
    expect(el("businessDiscloseStatus").textContent).toBe("Could not gather that.");
    expect(el("businessDisclosure").hidden).toBe(true);
    expect(el("businessDiscloseCopy").hidden).toBe(true);
  });

  it("a pasted list that could not be read says so", async () => {
    failing["POST /api/admin/outreach/paste"] = SERVER_DOWN;
    await signIn();
    await open("outreach");
    (el("outPasteText") as HTMLTextAreaElement).value = "Invented Bakery";
    el("outPasteCheck").click();
    await settle();
    expect(el("outPasteStatus").textContent).toBe("Could not read that.");
  });
});

describe("newsletters: nothing reads a failure as all clear (TASK-476)", () => {
  const audience = { id: 1, slug: "test", name: "Invented list", kind: "list", memberCount: 2 };

  it("blocked addresses: nothing blocked only when the list came back", async () => {
    served["/api/admin/newsletters/suppressions"] = [];
    await signIn();
    expect(el("suppressionList").textContent).toContain("Nothing blocked");
  });

  it("blocked addresses: says so when the list could not load", async () => {
    failing["/api/admin/newsletters/suppressions"] = SERVER_DOWN;
    await signIn();
    expect(el("suppressionList").textContent).toContain("Blocked addresses are unavailable.");
    expect(el("suppressionList").textContent).not.toContain("Nothing blocked");
  });

  it("audiences: says so when they could not load, and still loads the blocked list", async () => {
    failing["/api/admin/subscriber-lists"] = SERVER_DOWN;
    served["/api/admin/newsletters/suppressions"] = [];
    await signIn();
    expect(el("nlAudienceCards").textContent).toContain("Audiences are unavailable.");
    expect(el("nlAudienceCards").textContent).not.toContain("No audiences yet");
    expect(el("suppressionList").textContent).toContain("Nothing blocked");
  });

  it("audiences: none only when none came back", async () => {
    served["/api/admin/subscriber-lists"] = [];
    await signIn();
    expect(el("nlAudienceCards").textContent).toContain("No audiences yet");
  });

  it("who is on an audience: nobody only when the list came back", async () => {
    served["/api/admin/subscriber-lists"] = [audience];
    served["/api/admin/subscriber-lists/1/members"] = [];
    await signIn();
    expect(el("audienceMembers").textContent).toContain("No one on this audience yet.");
  });

  it("who is on an audience: says so when it could not load", async () => {
    served["/api/admin/subscriber-lists"] = [audience];
    failing["/api/admin/subscriber-lists/1/members"] = SERVER_DOWN;
    await signIn();
    expect(el("audienceMembers").textContent).toContain("Could not load who is on this audience.");
    expect(el("audienceMembers").textContent).not.toContain("No one on this audience yet.");
  });

  it("the pre-send checks never say everything checks out when they did not run", async () => {
    failing["POST /api/admin/newsletters/preflight"] = SERVER_DOWN;
    await signIn();
    await open("newsletter");
    (document.querySelector('[data-nl-panel="nlPanelSend"]') as HTMLElement).click();
    await settle();
    expect(el("nlChecks").textContent).toContain("Could not run the checks");
    expect(el("nlChecks").textContent).not.toContain("Everything checks out");
    // Review of #600: the send does not run these checks itself, so nothing may say it does.
    expect(el("nlChecks").textContent).toContain("The checks could not run. Look over it yourself before sending.");
    expect(el("nlChecks").textContent).not.toContain("nothing unsafe");
  });

  it("the pre-send checks still say everything checks out when they ran clean", async () => {
    served["/api/admin/newsletters/preflight"] = { findings: [] };
    await signIn();
    await open("newsletter");
    (document.querySelector('[data-nl-panel="nlPanelSend"]') as HTMLElement).click();
    await settle();
    expect(el("nlChecks").textContent).toContain("Everything checks out");
  });

  const sentNewsletter = {
    id: 1, subject: "Invented autumn news", status: "sent", sentAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-08-30T00:00:00Z", sentCount: 2, bodyHtml: "<p>Hi</p>", bodyJson: { blocks: [] },
  };

  it("a newsletter that could not be opened says so, rather than filling the editor with blanks", async () => {
    served["/api/admin/newsletters"] = [sentNewsletter];
    failing["/api/admin/newsletters/1"] = SERVER_DOWN;
    await signIn();
    await open("newsletter");
    expect(el("newsletterMsg").textContent).toBe("Could not open that newsletter. Please try again.");
    expect((el("newsletterSubject") as HTMLInputElement).value).not.toBe("undefined");
  });

  it("a send's figures that could not load say so, not that there are none", async () => {
    served["/api/admin/newsletters"] = [sentNewsletter];
    served["/api/admin/newsletters/1"] = sentNewsletter;
    failing["/api/admin/newsletters/1/stats"] = SERVER_DOWN;
    await signIn();
    await open("newsletter");
    (document.querySelector("[data-who-got]") as HTMLElement).click();
    await settle();
    expect(el("nlResultsNote").textContent).toBe("Could not load the figures for this send.");
  });

  // Review of #600: a newsletter sent before the send queue existed has no per person record, and
  // the server says so with a 404. That is a true answer, not a failure.
  it("who a send reached, for a send from before the send queue, says there is no per person record", async () => {
    served["/api/admin/newsletters"] = [sentNewsletter];
    served["/api/admin/newsletters/1"] = sentNewsletter;
    failing["/api/admin/newsletters/1/send-job/recipients"] = { status: 404, body: { error: "No send for this newsletter" } };
    await signIn();
    await open("newsletter");
    (document.querySelector("[data-who-got]") as HTMLElement).click();
    await settle();
    el("nlResultsWho").click();
    await settle();
    const body = document.querySelector(".nl-who-body") as HTMLElement;
    expect(body.textContent).toContain("No per-person record for this send.");
    expect(body.textContent).not.toContain("Could not load");
  });

  it("the send confirmation says the checks did not run, without claiming the send checks instead", async () => {
    const draft = { ...sentNewsletter, status: "draft", sentAt: null };
    served["/api/admin/newsletters"] = [draft];
    served["/api/admin/newsletters/1"] = draft;
    failing["POST /api/admin/newsletters/preflight"] = SERVER_DOWN;
    await signIn();
    await open("newsletter");
    el("newsletterSend").click();
    await settle();
    const preflight = document.querySelector(".nl-modal .nl-preflight") as HTMLElement;
    expect(preflight.hidden).toBe(false);
    expect(preflight.textContent).toContain("Could not run the checks");
    expect(preflight.textContent).toContain("The checks could not run. Look over it yourself before sending.");
    expect(preflight.textContent).not.toContain("nothing unsafe");
  });

  it("who a send reached, when that could not load, says so", async () => {
    served["/api/admin/newsletters"] = [sentNewsletter];
    served["/api/admin/newsletters/1"] = sentNewsletter;
    failing["/api/admin/newsletters/1/send-job/recipients"] = SERVER_DOWN;
    await signIn();
    await open("newsletter");
    (document.querySelector("[data-who-got]") as HTMLElement).click();
    await settle();
    el("nlResultsWho").click();
    await settle();
    const body = document.querySelector(".nl-who-body") as HTMLElement;
    expect(body.textContent).toBe("Could not load the recipient list.");
  });
});

describe("the ball: a change the server refused is never reported as done (TASK-476)", () => {
  const ballBody = {
    settings: { gateOpensAt: null, totalTables: 20, seatsPerTable: 10, heldSeats: 0, ticketPricePence: 9000,
      tablePricePence: 90000, previewPasswordSet: false },
    availability: { seatsRemaining: 200, tablesRemaining: 20 },
    dashboard: { seatsSold: 0, totalPence: 0 },
    gateOpen: false,
  };
  const hold = { id: 6, name: "Invented Party", kind: "seat", quantity: 2, seats: 2, expiresAt: null, createdBy: "admin@nbcc" };
  const booking = { reference: "NBCC-TEST1", buyerName: "Rowan Example", buyerEmail: "rowan@example.test",
    kind: "ticket", quantity: 2, totalPence: 18000, donationPence: 0, status: "paid", newsletterOptIn: false };

  beforeEach(() => {
    served["/api/admin/ball"] = ballBody;
    served["/api/admin/ball/holds"] = { results: [hold] };
    served["/api/admin/ball/bookings"] = { results: [booking] };
  });

  it("a hold there are not enough seats for", async () => {
    failing["POST /api/admin/ball/holds"] = { status: 409, body: { error: "There are not enough seats left to hold that many." } };
    await signIn();
    await open("ball");
    (el("ballHoldName") as HTMLInputElement).value = "Invented Party";
    el("ballHoldForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(el("ballHoldStatus").textContent).toContain("Could not hold those seats");
    expect(el("ballHoldStatus").textContent).not.toBe("Held.");
  });

  it("a settings change the server refused", async () => {
    failing["PATCH /api/admin/ball"] = { status: 400, body: { error: "Invalid settings" } };
    await signIn();
    await open("ball");
    el("ballGateSchedule").click();
    await settle();
    expect(el("ballGateStatus").textContent).toBe("Could not save. Your changes have not been applied.");
  });

  it("a settings change that went through", async () => {
    await signIn();
    await open("ball");
    el("ballGateSchedule").click();
    await settle();
    expect(el("ballGateStatus").textContent).toBe("Saved.");
  });

  // Review of #600: a hold released elsewhere meanwhile. Say what the server said, and reload, so
  // the stale row goes and the screen matches what is really held.
  it("releasing a hold that had already gone says so and shows the list as it is now", async () => {
    failing["DELETE /api/admin/ball/holds/6"] = { status: 409, body: { error: "Those seats have already been released." } };
    await signIn();
    await open("ball");
    served["/api/admin/ball/holds"] = { results: [] };
    (document.querySelector("#ballHolds [data-release-hold]") as HTMLElement).click();
    await settle();
    expect(el("ballHoldStatus").textContent).toBe("Those seats have already been released.");
    expect(el("ballHolds").textContent).toContain("Nothing is held back.");
  });

  it("releasing a hold when the server is down gives the general message", async () => {
    failing["DELETE /api/admin/ball/holds/6"] = SERVER_DOWN;
    await signIn();
    await open("ball");
    (document.querySelector("#ballHolds [data-release-hold]") as HTMLElement).click();
    await settle();
    expect(el("ballHoldStatus").textContent).toBe("Could not release those seats.");
  });

  it("cancelling a booking already cancelled says so and shows the bookings as they are now", async () => {
    const alerts: string[] = [];
    window.alert = (m?: unknown) => { alerts.push(String(m)); };
    const refusal = "That booking is already cancelled, so there are no seats to give back.";
    failing["POST /api/admin/ball/bookings/NBCC-TEST1/cancel"] = { status: 409, body: { error: refusal } };
    await signIn();
    await open("ball");
    served["/api/admin/ball/bookings"] = { results: [{ ...booking, status: "cancelled" }] };
    (document.querySelector("#ballBookings [data-cancel-booking]") as HTMLElement).click();
    await settle();
    expect(alerts).toEqual([refusal]);
    expect(document.querySelector("#ballBookings [data-cancel-booking]")).toBeNull();
  });

  it("cancelling a booking when the server is down gives the general message", async () => {
    const alerts: string[] = [];
    window.alert = (m?: unknown) => { alerts.push(String(m)); };
    failing["POST /api/admin/ball/bookings/NBCC-TEST1/cancel"] = SERVER_DOWN;
    await signIn();
    await open("ball");
    (document.querySelector("#ballBookings [data-cancel-booking]") as HTMLElement).click();
    await settle();
    expect(alerts).toEqual(["Could not cancel NBCC-TEST1. Nothing has been changed."]);
  });

  it("guest reminders that could not be sent", async () => {
    failing["POST /api/admin/ball/chase"] = { status: 500, body: { error: "Could not send the chase emails" } };
    await signIn();
    await open("ball");
    el("ballChase").click();
    await settle();
    expect(el("ballChaseStatus").textContent).toBe("Could not send the reminders.");
  });

  it("week before reminders that could not be sent", async () => {
    failing["POST /api/admin/ball/reminders"] = SERVER_DOWN;
    await signIn();
    await open("ball");
    const btn = el("ballSendReminders") || el("ballReminders");
    btn.click();
    await settle();
    expect(el("ballReminderStatus").textContent).toContain("Could not send.");
    // Plain words, no dash.
    expect(el("ballReminderStatus").textContent).toBe("Could not send. Nobody has been emailed twice. Please try again.");
  });

  // Review, 2026-10-04: after the Ball the server refuses, and says why. The button shows its words.
  it("the reminder button shows the server's own words when it refuses", async () => {
    failing["POST /api/admin/ball/reminders"] = { status: 409, body: { error: "The Ball has been and gone, so the reminder was not sent." } };
    const asked: string[] = [];
    window.confirm = (m?: string) => { asked.push(String(m)); return true; };
    await signIn();
    await open("ball");
    el("ballSendReminders").click();
    await settle();
    expect(el("ballReminderStatus").textContent).toBe("The Ball has been and gone, so the reminder was not sent.");
    expect((el("ballSendReminders") as HTMLButtonElement).disabled).toBe(false);
    // It is not only sent a week before now, so the question says "the reminder".
    expect(asked).toEqual(["Send the reminder to everyone who has paid and not had it yet? This emails real people."]);
  });
});
