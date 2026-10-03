// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { SECTIONS, roleToPermissions, effectivePermissions, type PermissionMap } from "../../src/admin/permissions";
import { permissionsSchema } from "../../src/admin/user-schema";

// TASK-118 (REQ-066): an integration test of the admin dashboard app wiring (assets/js/admin/app.js).
// It mounts admin.html's <body> into jsdom, stubs window.AdminHelpers + a mocked fetch, evaluates
// app.js against that DOM, and drives the real flow — sign in, the app + overview render, browse
// donations, open a donor — asserting the wiring holds. This is the repeatable, CI-run stand-in for a
// manual browser click-through (the endpoints themselves are covered by admin-api / admin-read).

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const tokenFor = (role: string) =>
  signAdminSession({ sub: 3, email: role + "@nbcc", role, now: new Date(), secret: "s" }).token;

let loginToken = tokenFor("editor"); // the token the mocked /login hands back (per test)
// A person's own saved access, which /me returns in place of their role's defaults (per test).
let storedPermissions: PermissionMap | null = null;
// TASK-458: who the Monthly givers list holds, and how its request fails when a test wants it to
// (per test). The server answers a failure in JSON too, just an { error } with no results in it.
let monthlyGivers: unknown[] = [];
let monthlyFailure: { status: number; body: unknown } | null = null;
const monthlyGiver = {
  donorId: 7, fullName: "Grace Test", email: "grace@x.co", monthlyPence: 1000,
  firstPaidAt: "2026-05-01T00:00:00Z", mostRecentPaidAt: "2026-09-01T00:00:00Z", paymentCount: 5,
  totalPence: 5000, giftAid: true, state: "active", cancelledAt: null, lapsedAt: null,
  failedAttempts: 0, thankedAt: "2026-05-03T00:00:00Z",
};

const donation = {
  id: 11, donor_id: 5, donor_name: "Ada Test", mode: "monthly", plan: "silver",
  amount_pence: 2500, currency: "gbp", gift_aid: true, claim_status: "eligible",
  payment_status: "paid", refunded_amount_pence: 0,
  payment_channel: "online", created_at: "2026-01-02T00:00:00Z",
};
const snapshot = {
  fullName: "Ada Test", email: "ada@x.co", emailConsent: true, anonymous: false,
  subscriptionPlan: "silver", subscriptionId: "sub_1", giftAid: true,
};
const storyRow = {
  id: 9, created_at: "2026-06-01T00:00:00Z", consent_captured_at: "2026-06-01T00:00:00Z",
  submitter_role: "family_carer", use_scope: "public", consent_share_first_name: true,
  consent_share_town: false, third_party_consent: true, status: "new", short_quote: "It helped us.",
};
const storyDetail = {
  ...storyRow, story_text: "The full story text.", contact_for_more: false,
  submitter_first_name: "Ada", submitter_email: "ada@x.co", submitter_phone: null,
  submitter_town: "Ayr", age_band: "25_44", gender: "female", recipient_type: "child",
  heard_about: "Facebook", confirmed_over_16: true, admin_tags: ["funding"], admin_notes: "note",
};

// TASK-208: business-supporter fulfilment rows (fulfilment joined to its donor), as
// GET /api/admin/fulfilments returns them. One with submitted preferences (all five flags still to do)
// and one still awaiting its preferences. A fresh copy per test — the mocked mark POST mutates it so a
// subsequent list reflects the flip (the app refetches after a mark).
type FulfilmentListRow = {
  id: number; donor_id: number; donor_name: string; business_name: string | null; band: string;
  credit_name: string | null; website: null; socials: null; list_on_supporters: boolean;
  want_social: boolean; want_badge: boolean; want_certificate: boolean; certificate_delivery: string | null;
  certificate_address: string | null; consent_featured: boolean; captured_at: string | null;
  certificate_sent: boolean; certificate_posted: boolean; badge_sent: boolean; social_done: boolean;
  added_to_supporters: boolean; created_at: string;
};
const makeFulfilments = (): FulfilmentListRow[] => [
  {
    id: 1, donor_id: 42, donor_name: "Ada Lovelace", business_name: "Acme Ltd", band: "platinum",
    credit_name: "Acme Ltd", website: null, socials: null, list_on_supporters: true, want_social: true,
    want_badge: true, want_certificate: true, certificate_delivery: "post", certificate_address: "1 Office Park",
    consent_featured: true, captured_at: "2026-07-01T00:00:00Z", certificate_sent: false, certificate_posted: false,
    badge_sent: false, social_done: false, added_to_supporters: false, created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 2, donor_id: 43, donor_name: "Bramble Cafe Ltd", business_name: null, band: "bronze",
    credit_name: null, website: null, socials: null, list_on_supporters: false, want_social: false,
    want_badge: false, want_certificate: false, certificate_delivery: null, certificate_address: null,
    consent_featured: false, captured_at: null, certificate_sent: false, certificate_posted: false,
    badge_sent: false, social_done: false, added_to_supporters: false, created_at: "2026-06-02T00:00:00Z",
  },
];
let fulfilments: FulfilmentListRow[] = makeFulfilments();

// TASK-459: the Team screen's people, as GET /api/admin/users returns them (none unless a test adds
// some).
type TeamMember = {
  id: number; email: string; full_name: string; role: string; status: string;
  invited_at: string; last_login_at: string | null; permissions: PermissionMap;
};
let teamMembers: TeamMember[] = [];

// TASK-465: the Events screen's events, as GET /api/admin/events returns them (none unless a test
// adds some). Every field the list and the editor read, with a test's own values laid on top.
const eventRecord = (over: Record<string, unknown>) => ({
  id: 1, slug: "e", name: "An event", subtitle: "", gist: "", date: "2026-11-04", start: "18:00",
  end: "22:00", timeTbc: false, venue: "The Hall", town: "Ayr", address: "", access: [],
  imageSrc: null, imageFit: "cover", imageGround: "night", imageAlt: "", cover: "crimson",
  costFront: "", costBack: "", flag: "", listHeading: "", whatsOn: "", note: "", runBy: "nbcc",
  partnerName: "", partnerFront: "Organised by", partnerCredit: "Organised by", partnerLogoSrc: null,
  partnerLine: "", bookingHow: "none", bookingUrl: "", bookingLabel: "", bookingNote: "",
  status: "live", showFrom: null, ...over,
});
let events: ReturnType<typeof eventRecord>[] = [];
let eventsFailure = false; // the list answers 500, as the server does when it cannot read them
let deleteFailure = false; // TASK-468: a delete answers 500
// TASK-478: which sections are new to the person signed in, as GET /api/admin/whats-new answers
// (nothing unless a test says so), and whether that request fails.
let whatsNew: Array<{ area: string; new: boolean; since: string }> = [];
let whatsNewFailure = false;
// TASK-484: the Festive Ball's bank transfer settings, the bookings awaiting a transfer, and the
// bookings table (all empty unless a test says otherwise). Invented details.
let transferSettings = { on: false, accountName: null as string | null, sortCode: null as string | null, accountNumber: null as string | null, ready: false };
let awaitingTransfers: unknown[] = [];
let ballBookings: unknown[] = [];
// TASK-488: what adding a booking by hand answers.
let addTransferAnswer: { status: number; body: unknown } = { status: 201, body: {} };
// Jaimie 2026-10-03: how many paid bookings have no phone number (null: the server did not say), and
// what adding or changing one answers.
let ballNoPhone: number | null = null;
let ballPhoneAnswer: { status: number; body: unknown } = { status: 200, body: {} };
// TASK-492: the QR codes screen's list, and every code image asked for.
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h1v1H0z"/></svg>';
let qrPages: unknown[] = [];
// TASK-508: what the Overview's "Needs you" answers, or that it fails.
let overviewAnswer: { status: number; body: unknown } = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], failed: [] } };
let qrImageUrls: string[] = [];

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (url.includes("/api/admin/login")) return j({ token: loginToken, user: { email: "s@nbcc", role: "editor" } });
  if (url.includes("/api/admin/me")) {
    // Admin Phase 2 (TASK-186): app.js calls GET /api/admin/me on init to filter the nav and gate
    // write controls via canEdit(section). Decode the bearer token's role (same as the server's
    // effectivePermissions with an empty stored map) so this mock stays a faithful stand-in.
    const auth = init?.headers?.Authorization || "";
    const claims = helpers.parseClaims(auth.replace(/^Bearer\s+/, "")) as { role?: string; email?: string } | null;
    const role = claims?.role || "viewer";
    // The server's own rule: a saved per-person map when a test sets one, else the role's defaults.
    return j({ email: claims?.email || "", permissions: effectivePermissions({ role, permissions: storedPermissions }) });
  }
  if (url.includes("/api/admin/donors/")) return j(snapshot);
  if (url.includes("/api/admin/search/donations")) return j({ results: [donation] }); // TASK-483
  if (url.includes("/api/admin/donations")) return j({ results: [donation], total: 1 });
  if (/\/api\/admin\/stories\/\d+/.test(url) && init?.method === "PATCH") {
    const patch = JSON.parse(init.body || "{}");
    return j({ ...storyDetail, ...patch });
  }
  if (/\/api\/admin\/stories\/\d+/.test(url) && init?.method === "DELETE") {
    return j({ deleted: true, id: 9 });
  }
  if (/\/api\/admin\/stories\/\d+/.test(url)) return j(storyDetail);
  if (url.includes("/api/admin/stories")) return j({ results: [storyRow] });
  // TASK-208: mark one fulfilment flag (checked before the list route, whose prefix it shares). Flips
  // the flag in the shared store and echoes the API's { id, flag, value, record } shape.
  const markMatch = url.match(/\/api\/admin\/fulfilments\/(\d+)\/mark/);
  if (markMatch && init?.method === "POST") {
    const id = Number(markMatch[1]);
    const flag = (JSON.parse(init.body || "{}") as { flag?: string }).flag || "";
    const row = fulfilments.find((f) => f.id === id);
    if (row) (row as unknown as Record<string, unknown>)[flag] = true;
    return j({ id, flag, value: true, record: row });
  }
  // TASK-436: the detail panel asks for this supporter's audit trail. Checked BEFORE the list
  // route, whose prefix it shares.
  if (/\/api\/admin\/fulfilments\/\d+\/history/.test(url)) {
    return j({
      results: [
        { id: 9, actor: "admin:kenny@nbcc.test", action: "fulfilment.badge_sent",
          entity: "business_supporter_fulfilment", entity_id: 1, data: {},
          created_at: "2026-07-02T09:00:00Z" },
      ],
    });
  }
  if (url.includes("/api/admin/fulfilments")) return j({ results: fulfilments });
  if (url.includes("/api/admin/monthly-supporters")) {
    return monthlyFailure ? j(monthlyFailure.body, monthlyFailure.status) : j({ results: monthlyGivers });
  }
  // TASK-459: saving someone's access is held to the server's own schema, which requires every
  // section, so a save the real endpoint would refuse is refused here too.
  const permsMatch = url.match(/\/api\/admin\/users\/(\d+)\/permissions$/);
  if (permsMatch && init?.method === "PATCH") {
    const parsed = permissionsSchema.safeParse(JSON.parse(init.body || "{}"));
    if (!parsed.success) return j({ error: "Invalid permissions update" }, 400);
    const member = teamMembers.find((m) => m.id === Number(permsMatch[1]));
    return j({ ...member, permissions: parsed.data.permissions });
  }
  if (url.endsWith("/api/admin/users")) return j({ results: teamMembers });
  // TASK-465: the Events screen. The preview is checked first, since it shares the list's prefix.
  if (url.includes("/api/admin/events/preview")) {
    return j({ card: "<p>card</p>", page: "<p>page</p>", problems: [], onPage: true });
  }
  if (/\/api\/admin\/events\/\d+$/.test(url) && init?.method === "DELETE") {
    return deleteFailure ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ deleted: true });
  }
  if (/\/api\/admin\/events$/.test(url)) {
    if (eventsFailure) return j({ error: "Admin is temporarily unavailable" }, 500);
    return j({ pageOn: false, updatedAt: null, updatedBy: null, today: "2026-09-30", events });
  }
  // TASK-484: bank transfer on the Festive Ball screen.
  if (url.includes("/api/admin/ball/transfer-settings")) {
    if (init?.method === "PUT") return j({ ...transferSettings, ...JSON.parse(init.body || "{}") });
    return j(transferSettings);
  }
  if (url.includes("/api/admin/ball/transfer-bookings")) return j(addTransferAnswer.body, addTransferAnswer.status);
  // TASK-492: a code image, as SVG text or a file; a path not on nbcc.scot is refused as the server does.
  if (url.includes("/api/admin/qr-codes/image")) {
    qrImageUrls.push(url);
    const path = new URL(url, "https://nbcc.scot").searchParams.get("path") || "";
    if (!path.startsWith("/")) {
      return { ...j({ error: "Give an address on nbcc.scot, starting with /" }, 400), blob: () => Promise.resolve(new Blob([])) };
    }
    return { ...j({}), text: () => Promise.resolve(QR_SVG), blob: () => Promise.resolve(new Blob([QR_SVG])) };
  }
  if (url.includes("/api/admin/qr-codes")) return j({ pages: qrPages });
  if (url.includes("/api/admin/overview")) return j(overviewAnswer.body, overviewAnswer.status);
  if (url.includes("/api/admin/ball/transfers")) return j({ results: awaitingTransfers });
  if (/\/api\/admin\/ball\/bookings\/[^/]+\/mark-paid$/.test(url)) return j({ reference: "BALL-7KQ2MZ", reinstated: false });
  if (/\/api\/admin\/ball\/bookings\/[^/]+\/pay-by$/.test(url)) return j({ reference: "BALL-7KQ2MZ", payBy: "2026-10-20" });
  if (/\/api\/admin\/ball\/bookings\/[^/]+\/phone$/.test(url)) return j(ballPhoneAnswer.body, ballPhoneAnswer.status);
  if (/\/api\/admin\/ball\/bookings$/.test(url)) {
    return j({ results: ballBookings, abandoned: 0, abandonedRows: [], ...(ballNoPhone === null ? {} : { noPhone: ballNoPhone }) });
  }
  // TASK-478: the seen POST is checked first, since it shares the list's prefix.
  if (url.includes("/api/admin/whats-new/seen") && init?.method === "POST") {
    const area = (JSON.parse(init.body || "{}") as { area?: string }).area;
    return j({ area, seenAt: "2026-10-06T08:00:00.000Z" });
  }
  if (url.includes("/api/admin/whats-new")) {
    return whatsNewFailure ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ areas: whatsNew });
  }
  return j({ results: [] }); // queues / adjustment-due
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "s@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await flush();
  await flush();
  await flush();
}

describe("admin app integration (jsdom, TASK-118)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    storedPermissions = null;
    monthlyGivers = [];
    monthlyFailure = null;
    fulfilments = makeFulfilments();
    teamMembers = [];
    events = [];
    eventsFailure = false;
    deleteFailure = false;
    whatsNew = [];
    whatsNewFailure = false;
    transferSettings = { on: false, accountName: null, sortCode: null, accountNumber: null, ready: false };
    awaitingTransfers = [];
    ballBookings = [];
    addTransferAnswer = { status: 201, body: {} };
    ballNoPhone = null;
    ballPhoneAnswer = { status: 200, body: {} };
    qrPages = [];
    overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], failed: [] } };
    qrImageUrls = [];
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc); // run the IIFE against this DOM
  });

  it("boots to the login view with the app hidden", () => {
    expect(el("loginView").hidden).toBe(false);
    expect(el("appView").hidden).toBe(true);
  });

  it("signs in, renders the app + overview, browses donations, opens a donor", async () => {
    await signIn();

    expect(el("appView").hidden).toBe(false);
    expect(el("userEmail").textContent).toBe("editor@nbcc");
    expect(el("userRole").textContent).toBe("editor");
    expect(el("overviewNeeds").textContent).toContain("Nothing needs you right now");
    await flush();
    expect(document.querySelector("#overviewRecent table")).not.toBeNull();

    // Browse donations
    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await flush();
    await flush();
    expect(document.querySelector("#donationsTable table")).not.toBeNull();
    // TASK-241: the donations table has a Payment column rendering a state pill (paid here).
    expect(document.querySelector("#donationsTable table")?.textContent).toContain("Payment");
    expect(document.querySelector("#donationsTable .admin-pill--paid")?.textContent).toBe("Paid");
    const view = document.querySelector("#donationsTable [data-donor]") as HTMLElement;
    expect(view).not.toBeNull();

    // Open the donor detail
    view.click();
    await flush();
    await flush();
    expect(el("view-donor").hidden).toBe(false);
    expect(el("donorDetail").textContent).toContain("Ada Test");
    // Editor => the edit form + cancel actions are present
    expect(el("donorEditForm")).not.toBeNull();
    expect(el("cancelSubBtn")).not.toBeNull();
    expect(el("cancelGaBtn")).not.toBeNull();
  });

  it("hides the write controls for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    // Open a donor via search-free path: click Donations, then the View button.
    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#donationsTable [data-donor]") as HTMLElement).click();
    await flush();
    await flush();
    expect(el("donorDetail").textContent).toContain("Ada Test");
    // Viewer => no edit form / cancel actions
    expect(el("donorEditForm")).toBeNull();
    expect(el("cancelSubBtn")).toBeNull();
    expect(el("cancelGaBtn")).toBeNull();
  });

  // Task C: Stories tab — list renders scope/consent/status badges, opening a row shows the full
  // story (HTML-escaped), and an Editor can withdraw it via the PATCH endpoint.
  it("lists stories, opens the detail, and withdraws it", async () => {
    await signIn();

    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    expect(document.querySelector("#storiesTable table")).not.toBeNull();
    expect(el("storiesTable").textContent).toContain("Public");

    const row = document.querySelector("#storiesTable [data-story]") as HTMLElement;
    expect(row).not.toBeNull();
    row.click();
    await flush();
    await flush();
    expect(el("view-story").hidden).toBe(false);
    expect(el("storyDetail").textContent).toContain("The full story text.");
    // Editor => the manage form + Withdraw control are present
    expect(el("storyEditForm")).not.toBeNull();
    const withdrawBtn = el("withdrawStoryBtn") as HTMLButtonElement;
    expect(withdrawBtn).not.toBeNull();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    withdrawBtn.click();
    await flush();
    await flush();
    expect(confirmSpy).toHaveBeenCalled();
    expect(el("storyDetail").textContent).toContain("Withdrawn");
    expect(el("storyActionStatus").textContent).toContain("withdrawn");
  });

  it("hides the story manage form for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();
    expect(el("storyDetail").textContent).toContain("The full story text.");
    expect(el("storyEditForm")).toBeNull();
    expect(el("withdrawStoryBtn")).toBeNull();
  });

  // G2 item 6: permanent erasure — a distinct, danger-styled control from Withdraw, behind its
  // own confirm() guard, calling DELETE and returning to the (refreshed) Stories list.
  // TASK-311: these two used to pin a Delete button that erased a story on confirm. Three stories
  // were erased from production that way and nothing could say what had gone, so the everyday action
  // is now Archive - reversible, and the only destructive control on a live story is gone entirely.
  it("offers Archive on a live story, and no way to erase it from here", async () => {
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();

    const archiveBtn = el("archiveStoryBtn") as HTMLButtonElement;
    expect(archiveBtn).not.toBeNull();
    expect(archiveBtn).not.toBe(el("withdrawStoryBtn"));

    // The whole point: nothing irreversible is reachable until the story has been archived.
    expect(el("eraseStoryBtn")).toBeNull();
    expect(el("deleteStoryBtn")).toBeNull();
  });

  it("archives without asking, because archiving can be undone", async () => {
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();

    // A confirm() here would be friction for a reversible action - and worse, it would train people
    // to click through the dialog that DOES guard the irreversible one.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    (el("archiveStoryBtn") as HTMLButtonElement).click();
    await flush();
    await flush();

    expect(confirmSpy).not.toHaveBeenCalled();
    // Archiving returns to the Stories list, same as the old delete did.
    expect(el("view-stories").hidden).toBe(false);
    expect(el("view-story").hidden).toBe(true);
  });

  it("hides the Archive control for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();
    // TASK-311: deleteStoryBtn no longer exists for ANYBODY, so asserting it is absent would pass
    // whatever the role. The control a Viewer must not get is Archive.
    expect(el("archiveStoryBtn")).toBeNull();
    expect(el("eraseStoryBtn")).toBeNull();
  });

  // TASK-208: Business supporters tab — someone holding business-supporters:edit (an admin here, since
  // TASK-406) lists the fulfilment records (business name, band, submitted preferences) and marks a
  // recognition step done; the row refetches and the button becomes a Done pill.
  it("lists supporters, opens one, and marks a job done after confirming", async () => {
    // Signed in as an ADMIN, not the editor the other tests use. business-supporters is not one of
    // an editor's default sections - it holds donor-identifying data and is granted per person - so
    // an editor cannot do this work, and the buttons now say so. They used to be gated on
    // donations:edit, which showed an editor controls the server would have refused.
    loginToken = tokenFor("admin");
    await signIn();

    (document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement).click();
    await flush();
    await flush();
    expect(document.querySelector("#fulfilmentsTable table")).not.toBeNull();

    // The collapsed list answers the question the page is opened to ask: who still needs something?
    const listText = el("fulfilmentsTable").textContent || "";
    expect(listText).toContain("Acme Ltd");
    expect(listText).toContain("Platinum");
    expect(listText).toContain("Bramble Cafe Ltd"); // business_name null -> donor name fallback
    expect(listText).toContain("things to do"); // Acme submitted, jobs outstanding
    expect(listText).toContain("Invite not sent yet"); // Bramble has neither invite nor form

    // Nothing is actionable from the list itself. Previously every button sat in every row, so a
    // stray click on a row you were only reading could permanently mark a job done.
    expect(document.querySelector("#fulfilmentsTable [data-fulfil-mark]")).toBeNull();

    (document.querySelector('[data-fulfil-toggle="1"]') as HTMLElement).click();
    await flush();
    await flush();

    const openText = el("fulfilmentsTable").textContent || "";
    expect(openText).toContain("Form submitted");
    // TASK-440: what the system already did, stated rather than offered as a job. The supporters
    // wall reads the form answer live and the badge/certificate links ride the confirmation email,
    // so presenting those as work waiting to be done had somebody "sending" what was already sent.
    expect(openText).toContain("Listed on the supporters page");
    // TASK-441: the badge and certificate go the next weekday morning as their own email, so this
    // reports when it will happen rather than claiming it already has. Acme wants both, so they
    // travel together.
    expect(openText).toContain("Badge and certificate sent");
    expect(openText).toContain("Goes out automatically on the next weekday morning");
    // The postal address for a certificate they asked us to POST. The old page never showed this
    // anywhere, which made the job it asks you to tick off impossible to actually do.
    expect(openText).toContain("1 Office Park");
    // And the audit trail: who did what, which was recorded all along and never surfaced.
    expect(openText).toContain("Badge sent");
    expect(openText).toContain("kenny@nbcc.test");

    const markBtn = document.querySelector(
      '#fulfilmentsTable [data-fulfil-id="1"][data-fulfil-mark="certificate_posted"]',
    ) as HTMLButtonElement;
    expect(markBtn).not.toBeNull();

    // The automatic three are stated, never clickable: a button there would invite somebody to
    // redo work that has already happened.
    for (const gone of ["added_to_supporters", "badge_sent", "certificate_sent"]) {
      expect(document.querySelector(`#fulfilmentsTable [data-fulfil-mark="${gone}"]`)).toBeNull();
    }

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const markCalls = () =>
      fetchMock.mock.calls.filter((c) => /\/api\/admin\/fulfilments\/1\/mark$/.test(String(c[0])));

    // Marking cannot be undone, so it asks first — and saying no writes nothing at all.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    markBtn.click();
    await flush();
    expect(markCalls()).toHaveLength(0);

    confirmSpy.mockReturnValue(true);
    markBtn.click();
    await flush();
    await flush();

    const markCall = markCalls()[0];
    expect(markCall).toBeTruthy();
    const markInit = (markCall as unknown[])[1] as { method?: string; body?: string };
    expect(markInit.method).toBe("POST");
    expect(JSON.parse(markInit.body || "{}")).toEqual({ flag: "certificate_posted" });

    // The row stays open across the refresh, so you can carry on with the next job rather than
    // having to find the supporter again after every single tick.
    expect(document.querySelector('[data-fulfil-toggle="1"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(el("fulfilmentsTable").textContent).toContain("Certificate posted");
    confirmSpy.mockRestore();
  });

  // TASK-208: a Viewer never sees the tab in the nav. It is gated on business-supporters:edit
  // (data-edit-gate="business-supporters", since TASK-406), which a Viewer's role never gives them.
  it("hides the Business supporters tab for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    const navLink = document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement;
    expect(navLink).not.toBeNull();
    expect(navLink.hidden).toBe(true);
  });

  // Monthly givers was hidden from everyone, admins included, from the day it shipped (TASK-447).
  // Its link was gated on a "monthly" permission that does not exist, where the screen's own data
  // is gated on donations:view. Anyone who may see the donations list may see this screen.
  it.each([
    ["an admin", "admin"],
    ["an editor", "editor"],
    ["a viewer", "viewer"],
  ])("shows Monthly givers to %s, who may see donations", async (_who, role) => {
    loginToken = tokenFor(role);
    await signIn();
    const link = document.querySelector('.admin-nav-link[data-view="monthly"]') as HTMLElement;
    expect(link.hidden).toBe(false);
  });

  it("hides Monthly givers from someone whose access leaves out donations", async () => {
    loginToken = tokenFor("viewer");
    storedPermissions = { ...roleToPermissions("viewer"), donations: "none" };
    try {
      await signIn();
      const link = document.querySelector('.admin-nav-link[data-view="monthly"]') as HTMLElement;
      expect(link.hidden).toBe(true);
      // ...and it is the donations gate hiding it, not a failed sign-in that hides everything.
      expect((document.querySelector('.admin-nav-link[data-view="claims"]') as HTMLElement).hidden).toBe(false);
    } finally {
      storedPermissions = null;
    }
  });

  // TASK-459: opening somebody's access and pressing Save, changing nothing, must leave them with
  // exactly what they had. For an editor never given access of their own it took Contact businesses
  // away: the screen pre-filled from the browser's copy of the editor defaults, which had never
  // listed it, showed None, and Save stored that None as their complete access.
  it("saves an editor's untouched access as exactly the access they already had", async () => {
    loginToken = tokenFor("admin");
    teamMembers = [
      {
        id: 7, email: "ed@nbcc", full_name: "Ed Itor", role: "editor", status: "active",
        invited_at: "2026-08-01T00:00:00Z", last_login_at: null, permissions: {},
      },
    ];
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="team"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector('[data-team-perms="7"]') as HTMLElement).click();
    el("teamPermSave").click();
    await flush();
    await flush();

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const save = fetchMock.mock.calls.find((c) => /\/api\/admin\/users\/7\/permissions$/.test(String(c[0])));
    expect(save, "Save sent the permissions PATCH").toBeDefined();
    const sent = JSON.parse(((save as unknown[])[1] as { body: string }).body).permissions;
    // What the server gives them today: nothing stored, so the editor defaults, and none for every
    // section those leave out.
    const had = {
      ...Object.fromEntries(SECTIONS.map((s) => [s, "none"])),
      ...effectivePermissions({ role: "editor", permissions: {} }),
    };
    expect(sent).toEqual(had);
    expect(el("teamPermStatus").textContent).toBe("Access updated.");
  });

  // TASK-462: every preset button on Manage access must fill in a matrix the save accepts. The Editor
  // one never did: it named only the sections the editor role names, the save needs every section,
  // and all anyone saw was "Could not save that access." (since TASK-313).
  it.each(["viewer", "editor", "admin"])("saves the %s preset as that role's complete defaults", async (role) => {
    loginToken = tokenFor("admin");
    // Saved access that matches no preset, so every button has to change what is on screen: an editor
    // with no saved access already shows the editor defaults, and a dead Editor button would pass.
    teamMembers = [
      {
        id: 7, email: "ed@nbcc", full_name: "Ed Itor", role: "editor", status: "active",
        invited_at: "2026-08-01T00:00:00Z", last_login_at: null,
        permissions: Object.fromEntries(SECTIONS.map((s) => [s, "none"])) as PermissionMap,
      },
    ];
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="team"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector('[data-team-perms="7"]') as HTMLElement).click();
    (document.querySelector(`[data-perm-preset="${role}"]`) as HTMLElement).click();
    el("teamPermSave").click();
    await flush();
    await flush();

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const save = fetchMock.mock.calls.find((c) => /\/api\/admin\/users\/7\/permissions$/.test(String(c[0])));
    expect(save, "Save sent the permissions PATCH").toBeDefined();
    expect(JSON.parse(((save as unknown[])[1] as { body: string }).body).permissions).toEqual({
      ...Object.fromEntries(SECTIONS.map((s) => [s, "none"])),
      ...roleToPermissions(role),
    });
    expect(el("teamPermStatus").textContent).toBe("Access updated.");
  });

  // TASK-458: when the list cannot be fetched, the server still answers in JSON, an { error } with no
  // results. Read as a list, that drew an empty table and "0 giving, £0 a month" (formatPence writes
  // a whole pound without pence, so "£0" is the thing to look for, and it covers "£0.00" too). On the
  // screen that exists to say how much regular income is dependable, a false £0 is worse than an error.
  describe("Monthly givers: a list that never came is not nobody giving (TASK-458)", () => {
    async function openMonthly() {
      (document.querySelector('.admin-nav-link[data-view="monthly"]') as HTMLElement).click();
      await flush();
      await flush();
    }

    it.each([
      [500, { error: "Admin is temporarily unavailable" }],
      [403, { error: "forbidden" }],
    ])("says so on a %i, rather than showing nobody giving and £0 a month", async (status, body) => {
      loginToken = tokenFor("editor");
      monthlyFailure = { status, body };
      await signIn();
      await openMonthly();

      expect(el("view-monthly").textContent).not.toContain("£0");
      expect(el("monthlyTable").textContent).toContain("Monthly givers are unavailable.");
    });

    // "Show" stays on screen after the failure, and changing it redraws from whatever list is held.
    it("keeps saying so when you change what it shows, rather than counting a list that never came", async () => {
      loginToken = tokenFor("editor");
      monthlyFailure = { status: 500, body: { error: "Admin is temporarily unavailable" } };
      await signIn();
      await openMonthly();

      const show = el("monthlyStateFilter") as HTMLSelectElement;
      show.value = "";
      show.dispatchEvent(new Event("change"));

      expect(el("view-monthly").textContent).not.toContain("£0");
      expect(el("monthlyTable").textContent).toContain("Monthly givers are unavailable.");
    });

    // A list that loaded once is not what is there now if the next load fails. Leaving it up, or
    // letting "Show" redraw it, would pass off old figures as current (and, after a 403 for access
    // just taken away, show names that person may no longer see).
    it("leaves nothing of an earlier list up when a later load fails", async () => {
      loginToken = tokenFor("editor");
      monthlyGivers = [monthlyGiver];
      await signIn();
      await openMonthly();
      expect(el("monthlySummary").textContent).toBe("1 giving, £10 a month");

      (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
      await flush();
      monthlyFailure = { status: 500, body: { error: "Admin is temporarily unavailable" } };
      await openMonthly();

      expect(el("monthlySummary").textContent).toBe("");
      const show = el("monthlyStateFilter") as HTMLSelectElement;
      show.value = "";
      show.dispatchEvent(new Event("change"));
      expect(el("monthlyTable").textContent).toContain("Monthly givers are unavailable.");
      expect(el("monthlyTable").textContent).not.toContain("Grace Test");
    });

    // The other side of the line: a list that did come back, empty, is a true answer.
    it("still says nobody is giving when the list came back empty, because then it is true", async () => {
      loginToken = tokenFor("editor");
      await signIn();
      await openMonthly();

      expect(el("monthlySummary").textContent).toBe("0 giving, £0 a month");
      expect(el("monthlyTable").textContent).toContain("Nobody matches that.");
    });
  });

  // TASK-454: below 860px the menu is one button that opens the whole list. jsdom has no layout, so
  // this pins the wiring rather than the widths (admin-fits-a-phone.test.ts has those): the button
  // opens the list, and choosing a section closes it again, so the section you picked is what you see.
  it("opens the phone menu from its button, and closes it when you choose a section", async () => {
    await signIn();
    const toggle = el("adminNavToggle");
    const nav = toggle.closest(".admin-nav") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(nav.classList.contains("is-open")).toBe(false);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(nav.classList.contains("is-open")).toBe(true);

    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await flush();
    expect(el("view-donations").hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(nav.classList.contains("is-open")).toBe(false);
  });

  it("closes the phone menu from its button again, or with Escape", async () => {
    await signIn();
    const toggle = el("adminNavToggle");
    toggle.click();
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // Escape from a keyboard user working down the open list.
    toggle.click();
    const link = document.querySelector('.admin-nav-link[data-view="claims"]') as HTMLElement;
    link.focus();
    link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Back on the button, so they are not left focused on a list that has just vanished.
    expect(document.activeElement).toBe(toggle);
  });

  // jsdom has no layout, so these give the menu a place on the page by hand and stand in for the
  // browser's scrolling, then put jsdom's own back afterwards.
  describe("the phone menu and where it leaves you", () => {
    const realScrollTo = window.scrollTo;
    const realScrollBy = window.scrollBy;
    const realOffset = Object.getOwnPropertyDescriptor(window, "pageYOffset");
    let y = 0;
    const scrollTo = vi.fn((_x: number, top: number) => {
      y = top;
    });
    const rectAt = (top: number, height: number) =>
      ({ top, bottom: top + height, left: 0, right: 390, width: 390, height, x: 0, y: top, toJSON() {} }) as DOMRect;

    beforeEach(() => {
      y = 0;
      scrollTo.mockClear();
      Object.defineProperty(window, "pageYOffset", { configurable: true, get: () => y });
      window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    });
    afterEach(() => {
      window.scrollTo = realScrollTo;
      window.scrollBy = realScrollBy;
      if (realOffset) Object.defineProperty(window, "pageYOffset", realOffset);
      else delete (window as unknown as Record<string, unknown>).pageYOffset;
    });

    // Found in the browser, deep in the Festive Ball. Laying out the opened list adds its 614px to
    // the page above you, and the browser moves the scroll position down to keep your place on
    // screen, so a position read after the menu opened was 614px out and "back where you were"
    // put you that much further down the page.
    it("takes you up to the menu from further down, and back to exactly where you were", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      y = 4000;
      let anchored = false;
      nav.getBoundingClientRect = () => {
        const open = nav.classList.contains("is-open");
        if (open && !anchored) {
          anchored = true;
          y += 614; // the browser keeping your place on screen as the list opens above you
        }
        return rectAt(open ? 3500 - y : 0, open ? 685 : 61);
      };

      toggle.click();
      expect(scrollTo).toHaveBeenLastCalledWith(0, 3500);
      toggle.click();
      expect(scrollTo).toHaveBeenLastCalledWith(0, 4000);
    });

    // The pinned button exists so changing section never means scrolling back up. An open list you
    // scroll on past without choosing has been dismissed: close it, and the pinned button is back.
    it("closes the open menu once you scroll on past it, so the pinned button comes back", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      let navRect = rectAt(0, 685);
      nav.getBoundingClientRect = () => navRect;
      toggle.click();

      navRect = rectAt(-300, 685); // part of the list still on screen: still reading it
      window.dispatchEvent(new Event("scroll"));
      expect(toggle.getAttribute("aria-expanded")).toBe("true");

      navRect = rectAt(-700, 685); // all of it gone past the top of the screen
      window.dispatchEvent(new Event("scroll"));
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });

    // ...but not on the way up to it. Opened from further down, the list starts off above the
    // screen while the page scrolls up to it, and that is not you scrolling past it.
    it("keeps it open while taking you up to it", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      y = 6000;
      let navRect = rectAt(0, 61);
      nav.getBoundingClientRect = () => navRect;
      navRect = rectAt(-5861, 685);
      toggle.click();

      navRect = rectAt(-3000, 685); // still travelling up to it
      window.dispatchEvent(new Event("scroll"));
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    // Closing the list takes its height out of the page above you. Chrome keeps your place by itself;
    // a browser that does not would jump the page by the height of the list, so put back whatever
    // moved.
    it("keeps your place on the page when it closes itself", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      const content = document.querySelector(".admin-content") as HTMLElement;
      const scrollBy = vi.fn();
      window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
      let navRect = rectAt(0, 685);
      nav.getBoundingClientRect = () => navRect;
      content.getBoundingClientRect = () => rectAt(nav.classList.contains("is-open") ? -1000 : -1624, 9000);
      toggle.click();
      navRect = rectAt(-700, 685);
      window.dispatchEvent(new Event("scroll"));

      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(scrollBy).toHaveBeenCalledWith({ top: -624, behavior: "instant" });
      expect(scrollTo).not.toHaveBeenCalled();
    });

    // Where the browser did keep your place, what is left over can still be a fraction of a pixel
    // on a phone whose pixels are not whole CSS pixels. Correcting that would fire an instant scroll
    // in the middle of the flick that closed the menu, and stop it dead, to move nothing you can see.
    it("leaves the page alone when what moved is less than a pixel", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      const content = document.querySelector(".admin-content") as HTMLElement;
      const scrollBy = vi.fn();
      window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
      let navRect = rectAt(0, 685);
      nav.getBoundingClientRect = () => navRect;
      content.getBoundingClientRect = () => rectAt(nav.classList.contains("is-open") ? -1000 : -1000.4, 9000);
      toggle.click();
      navRect = rectAt(-700, 685);
      window.dispatchEvent(new Event("scroll"));

      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(scrollBy).not.toHaveBeenCalled();
    });

    // A list taller than a small phone's screen has to be scrolled to reach its last few sections.
    // Choosing one of those used to leave the page where it was, with the top of the new section
    // hidden under the pinned bar.
    it("lands you at the top of the section you chose, not partway down it", async () => {
      await signIn();
      const toggle = el("adminNavToggle");
      const nav = toggle.closest(".admin-nav") as HTMLElement;
      const grid = document.querySelector(".admin-body-grid") as HTMLElement;
      nav.getBoundingClientRect = () => rectAt(0, 685);
      toggle.click();
      y = 250; // scrolled down the open list to reach Team
      grid.getBoundingClientRect = () => rectAt(-111, 3000);

      (document.querySelector('.admin-nav-link[data-view="team"]') as HTMLElement).click();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(scrollTo).toHaveBeenLastCalledWith(0, 139);
    });
  });

  // Turning a phone or a tablet on its side can take the screen past 860px with the menu open. The
  // open state means nothing at that width, and left behind it would leave aria-expanded saying
  // "true" on a button nobody can see.
  it("closes the phone menu when the screen widens past it", async () => {
    let widened: ((e: { matches: boolean }) => void) | null = null;
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => {
        if (query === "(max-width:860px)") widened = fn;
      },
    })) as unknown as typeof window.matchMedia;
    try {
      document.body.innerHTML = bodyHtml;
      // eslint-disable-next-line no-eval
      (0, eval)(appSrc);
      await signIn();
      const toggle = el("adminNavToggle");
      toggle.click();
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(widened, "app.js listens for the 860px breakpoint").not.toBeNull();
      widened!({ matches: false });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  // TASK-465: each Events list row clear on its own. In TASK-460's compact rows the column headings
  // are out of sight, so a scheduled event's "From 14 Oct" read like the event's own date, the status
  // said "On the page" where the editor says "On the website", and every button was a bare "Edit".
  // Opening an event also redrew the list inside a live region, so the list was read out again and
  // the button just pressed was gone.
  describe("the Events list: each row clear on its own (TASK-465)", () => {
    const realScrollIntoView = Element.prototype.scrollIntoView;
    // What was scrolled into view, and how. jsdom does no layout, so it has no scrollIntoView of its
    // own, and the list's buttons scroll to the editor.
    let scrolls: { el: Element; options: unknown }[] = [];
    beforeEach(() => {
      scrolls = [];
      Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
        scrolls.push({ el: this, options });
      } as Element["scrollIntoView"];
      events = [
        eventRecord({ id: 1, name: "EmpowHer ’26", date: "2026-11-04", status: "live" }),
        eventRecord({ id: 2, name: "Christmas Jumper Day", date: "2026-12-09", status: "scheduled", showFrom: "2026-10-14" }),
        eventRecord({ id: 3, name: "Carols at the Cross", date: "2026-10-20", status: "scheduled", showFrom: "2026-09-20" }),
        eventRecord({ id: 4, name: "Festive Quiz Night", date: "2026-11-14", status: "draft" }),
        eventRecord({ id: 5, name: "Red Bag packing morning", date: "2026-09-18", status: "live" }),
      ];
    });
    afterEach(() => {
      if (realScrollIntoView) Element.prototype.scrollIntoView = realScrollIntoView;
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    // Arriving opens the soonest event by itself: Carols at the Cross, on 20 Oct.
    async function openEvents() {
      await signIn();
      (document.querySelector('.admin-nav-link[data-view="events"]') as HTMLElement).click();
      await flush();
      await flush();
      await flush();
    }
    const pills = () => Array.from(el("evList").querySelectorAll(".admin-pill")).map((p) => p.textContent);
    const buttons = () => Array.from(el("evList").querySelectorAll<HTMLButtonElement>(".ev-admin-edit"));

    it("says an event that is up is on the website, and when one that is waiting goes up", async () => {
      await openEvents();
      expect(pills()).toEqual(["On the website", "On the website", "Goes up 14 Oct"]);
      expect(el("evList").textContent).not.toContain("On the page");

      (document.querySelector('[data-evlist="drafts"]') as HTMLElement).click();
      expect(pills()).toEqual(["Draft"]);
      (document.querySelector('[data-evlist="past"]') as HTMLElement).click();
      expect(pills()).toEqual(["Past"]);
    });

    // The visible word first, so "click Edit" still works for someone using speech input.
    it("names each event's button after its event, and marks the one that is open", async () => {
      await openEvents();
      expect(buttons().map((b) => b.textContent)).toEqual(["Open", "Edit", "Edit"]);
      expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open Carols at the Cross, 20 Oct", "Edit EmpowHer ’26, 4 Nov", "Edit Christmas Jumper Day, 9 Dec",
      ]);
      expect(buttons().map((b) => b.getAttribute("aria-current"))).toEqual(["true", null, null]);
    });

    // It redraws whenever an event opens. Saving and deleting announce through their own status
    // lines, and a failed load's message is an alert of its own (below).
    it("is not a live region, so opening an event does not read the whole list out again", async () => {
      await openEvents();
      expect(el("evList").hasAttribute("aria-live")).toBe(false);
    });

    it("takes you to the editor when you open an event, rather than losing your place", async () => {
      await openEvents();
      buttons()[2].click();
      await flush();
      expect(document.activeElement).toBe(el("evEditorTitle"));
      expect(el("evEditorTitle").textContent).toBe("Editing: Christmas Jumper Day");
      expect(buttons()[2].getAttribute("aria-current")).toBe("true");
      expect(buttons()[0].getAttribute("aria-label")).toBe("Edit Carols at the Cross, 20 Oct");
      // Scrolled there without a "smooth" of its own: the page scrolls smoothly already, and the site
      // turns that off for anyone whose device asks for reduced motion. A forced "smooth" would not.
      expect(scrolls.at(-1)?.el).toBe(el("evEditor"));
      expect(scrolls.at(-1)?.options).toEqual({ block: "start" });
    });

    it("scrolls to the editor for a new event without forcing motion either", async () => {
      await openEvents();
      el("evAdd").click();
      await flush();
      expect(scrolls.at(-1)?.el).toBe(el("evEditor"));
      expect(scrolls.at(-1)?.options).toEqual({ block: "start" });
    });

    // Saying no to "leave your unsaved changes?" keeps you where you were: on the button you pressed,
    // with the event you were editing still open.
    it("leaves focus on the button when you choose to keep unsaved changes", async () => {
      await openEvents();
      const name = el("evf-name") as HTMLInputElement;
      name.value = "Carols at the Cross, changed";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      try {
        const pressed = buttons()[2];
        pressed.focus();
        pressed.click();
        await flush();
        expect(confirm).toHaveBeenCalled();
        expect(document.activeElement).toBe(pressed);
        expect(el("evEditorTitle").textContent).toBe("Editing: Carols at the Cross, changed");
      } finally {
        confirm.mockRestore();
      }
    });

    // A name is typed by staff and lands inside an HTML attribute here, so it has to be escaped: not
    // cut short at a quote, and never able to add an attribute of its own.
    it("keeps an event's name inside its button's label, whatever characters it holds", async () => {
      events.push(eventRecord({ id: 6, name: `Tom & Jerry's "Big" <Night>`, date: "2026-12-20", status: "live" }));
      await openEvents();
      const b = buttons().find((x) => x.getAttribute("data-evopen") === "6")!;
      expect(b.getAttribute("aria-label")).toBe(`Edit Tom & Jerry's "Big" <Night>, 20 Dec`);
      expect(b.getAttributeNames()).toEqual(["class", "type", "data-evopen", "aria-label"]);
    });

    // Someone who may only look sees "View", and hears which event it is too.
    it("names a viewer's buttons the same way", async () => {
      loginToken = tokenFor("viewer");
      await openEvents();
      expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open Carols at the Cross, 20 Oct", "View EmpowHer ’26, 4 Nov", "View Christmas Jumper Day, 9 Dec",
      ]);
      expect(el("evEditorTitle").textContent).toBe("Carols at the Cross");
    });

    // The list is no longer a live region, so the one message in it that must be heard carries its own.
    it("says out loud when the events could not be loaded", async () => {
      eventsFailure = true;
      await openEvents();
      const alert = el("evList").querySelector('[role="alert"]');
      expect(alert?.textContent).toBe("The events could not be loaded just now. Try again in a moment.");
    });

    // TASK-468: the gaps TASK-465's review found. A recurring event must not sound like its twin.
    it("tells apart events that share a name by their dates", async () => {
      events.push(eventRecord({ id: 7, name: "EmpowHer ’26", date: "2026-11-18", status: "live" }));
      await openEvents();
      const labels = buttons().map((b) => b.getAttribute("aria-label"));
      expect(labels).toContain("Edit EmpowHer ’26, 4 Nov");
      expect(labels).toContain("Edit EmpowHer ’26, 18 Nov");
    });

    // Arrives the way a keyboard user does: focus on the menu's Events link, which must keep it.
    async function arriveFromMenu() {
      await signIn();
      const link = document.querySelector('.admin-nav-link[data-view="events"]') as HTMLElement;
      link.focus();
      link.click();
      await flush();
      await flush();
      await flush();
      return link;
    }

    // Arriving never moves focus, even when there is nothing to list and a blank event opens itself.
    it("leaves focus alone when an empty list opens a blank event by itself", async () => {
      events = [];
      const link = await arriveFromMenu();
      expect(el("evEditorTitle").textContent).toBe("A new event");
      expect(document.activeElement).toBe(link);
    });

    it("puts you in the name field when you ask for a new event", async () => {
      await openEvents();
      el("evAdd").click();
      await flush();
      expect(document.activeElement).toBe(el("evf-name"));
    });

    // Delete hides the editor and the button with it; focus lands on the likeliest next step.
    it("leaves focus on Add an event after you delete one", async () => {
      await openEvents();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      try {
        el("evDelete").focus();
        el("evDelete").click();
        await flush();
        await flush();
        expect(el("evSwitchStatus").textContent).toBe("Deleted.");
        expect(document.activeElement).toBe(el("evAdd"));
      } finally {
        confirm.mockRestore();
      }
    });

    // A delete that fails deletes nothing: the editor and its Delete button are still there.
    it("leaves focus on Delete when the delete fails", async () => {
      deleteFailure = true;
      await openEvents();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      try {
        el("evDelete").focus();
        el("evDelete").click();
        await flush();
        await flush();
        expect(el("evSaveState").textContent).toBe("Not deleted. Please try again.");
        expect(el("evEditor").hidden).toBe(false);
        expect(document.activeElement).toBe(el("evDelete"));
      } finally {
        confirm.mockRestore();
      }
    });

    it("takes you to the editor from the event already open, too", async () => {
      await openEvents();
      buttons()[0].click();
      await flush();
      expect(document.activeElement).toBe(el("evEditorTitle"));
    });

    // Arriving opens the soonest event by itself, and must not pull focus away from where it is.
    it("leaves focus alone when the screen opens an event by itself", async () => {
      const link = await arriveFromMenu();
      expect(el("evEditorTitle").textContent).toBe("Editing: Carols at the Cross");
      expect(document.activeElement).toBe(link);
    });
  });

  // TASK-483: on a phone the donations table becomes cards, each line labelled by its cell's
  // data-label (admin.css). All three lists that draw it must carry the labels and the wrapper the
  // stylesheet measures.
  describe("the donations table on a phone (TASK-483)", () => {
    const LABELS = ["ID", "Donor", "Donation", "Amount", "Gift Aid", "Claim", "Payment", "Date", ""];
    const labelsIn = (host: string) =>
      Array.from(document.querySelectorAll(host + " .dn-list .dn-table tbody tr:first-child td")).map((td) =>
        td.getAttribute("data-label"),
      );

    it("labels every cell on the Donations screen", async () => {
      await signIn();
      (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
      await flush();
      await flush();
      expect(labelsIn("#donationsTable")).toEqual(LABELS);
    });

    it("labels every cell in the Overview's recent donations", async () => {
      await signIn();
      await flush();
      expect(labelsIn("#overviewRecent")).toEqual(LABELS);
    });

    it("labels every cell in donation search results", async () => {
      await signIn();
      (document.querySelector('.admin-seg[data-kind="donations"]') as HTMLElement).click();
      (el("searchQuery") as HTMLInputElement).value = "Ada";
      el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await flush();
      await flush();
      expect(labelsIn("#searchResults")).toEqual(LABELS);
    });
  });

  // TASK-478: a New pill on each section holding something this person has not seen. Opening the
  // section clears it for them; the server keeps everyone else's.
  // TASK-508: the Overview opens with "Needs you": what is waiting on someone, most urgent first,
  // each one click from the screen that deals with it. The server decides what each person may see.
  describe("Needs you on the Overview (TASK-508)", () => {
    const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
    const NEEDS = [
      { key: "transfersOverdue", level: 1, text: "1 bank transfer is overdue", view: "ball", button: "Festive Ball" },
      { key: "contactWaiting", level: 2, text: "3 contact messages are waiting for a reply", view: "contact", button: "Contact form" },
      { key: "declarationsAwaiting", level: 3, text: "12 Gift Aid declarations have not come back yet", view: "claims", button: "Claims" },
    ];
    const lines = () => Array.from(document.querySelectorAll("#overviewNeeds .ov-need")) as HTMLElement[];

    it("lists what is waiting, most urgent first, with a button to each screen", async () => {
      overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: NEEDS, failed: [] } };
      await signIn();
      await settle();
      expect(lines().map((l) => l.textContent)).toEqual([
        expect.stringContaining("1 bank transfer is overdue"),
        expect.stringContaining("3 contact messages are waiting for a reply"),
        expect.stringContaining("12 Gift Aid declarations have not come back yet"),
      ]);
      expect(lines().map((l) => l.getAttribute("data-level"))).toEqual(["1", "2", "3"]);
      expect(lines().map((l) => (l.querySelector("button") as HTMLElement).textContent)).toEqual(["Festive Ball", "Contact form", "Claims"]);
      expect(el("overviewUpdated").textContent).toMatch(/^Updated \d{1,2}:\d{2}/);
    });

    it("opens the screen that deals with an item", async () => {
      overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: NEEDS, failed: [] } };
      await signIn();
      await settle();
      (lines()[1].querySelector("button") as HTMLElement).click();
      await settle();
      expect(el("view-contact").hidden).toBe(false);
      expect(el("view-overview").hidden).toBe(true);
    });

    it("says so on a quiet day", async () => {
      await signIn();
      await settle();
      expect(lines()).toHaveLength(0);
      expect(el("overviewNeeds").textContent).toContain("Nothing needs you right now");
    });

    it("says which parts it could not check, and never calls a day quiet when it could not tell", async () => {
      overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], failed: ["Festive Ball", "Claims"] } };
      await signIn();
      await settle();
      expect(el("overviewNeeds").textContent).toContain("Could not check: Festive Ball, Claims");
      expect(el("overviewNeeds").textContent).not.toContain("Nothing needs you right now");
    });

    it("says when the whole thing could not load", async () => {
      overviewAnswer = { status: 500, body: { error: "The overview could not load. Try again." } };
      await signIn();
      await settle();
      expect(el("overviewNeeds").textContent).toMatch(/could not load/i);
      expect(el("overviewNeeds").textContent).not.toContain("Nothing needs you right now");
    });

    it("keeps the latest five donations underneath", async () => {
      await signIn();
      await settle();
      const asked = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls.map(([u]) => String(u));
      expect(asked).toContain("/api/admin/donations?limit=5");
      expect(document.querySelector("#overviewRecent table")).not.toBeNull();
    });

    it("asks once when you sign in, not twice", async () => {
      await signIn();
      await settle();
      const asked = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls.filter(
        ([u]) => String(u) === "/api/admin/overview",
      ).length;
      expect(asked).toBe(1);
    });

    it("asks again each time the Overview is opened", async () => {
      await signIn();
      await settle();
      const count = () =>
        (globalThis.fetch as unknown as { mock: { calls: Array<[unknown]> } }).mock.calls.filter(([u]) => String(u) === "/api/admin/overview").length;
      const before = count();
      (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
      await settle();
      (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
      await settle();
      expect(count()).toBeGreaterThan(before);
    });
  });

  // TASK-509: the Overview's numbers, how we are doing, one line each, under "Needs you". The server
  // words them and decides which a person may see; this only draws them.
  describe("How we are doing on the Overview (TASK-509)", () => {
    const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
    const NUMBERS = [
      { key: "money", title: "Money in", headline: "£4,210 this month so far", detail: "£3,900 by this time last month.", view: "donations", button: "Donations" },
      { key: "ball", title: "Festive Ball", headline: "212 of 300 seats sold", detail: "£18,400 taken. 36 days to go.", view: "ball", button: "Festive Ball" },
    ];
    const rows = () => Array.from(document.querySelectorAll("#overviewNumbers .ov-number")) as HTMLElement[];
    const answer = (numbers: unknown[]) => {
      overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], numbers, failed: [] } };
    };

    it("shows each number with its title, headline, detail and a button to its screen", async () => {
      answer(NUMBERS);
      await signIn();
      await settle();
      expect(el("ovNumbersCard").hidden).toBe(false);
      expect(rows()).toHaveLength(2);
      const first = rows()[0];
      expect(first.querySelector(".ov-number-title")?.textContent).toBe("Money in");
      expect(first.querySelector(".ov-number-headline")?.textContent).toBe("£4,210 this month so far");
      expect(first.querySelector(".ov-number-detail")?.textContent).toBe("£3,900 by this time last month.");
      expect(rows().map((r) => (r.querySelector("button") as HTMLElement).textContent)).toEqual(["Donations", "Festive Ball"]);
    });

    it("opens the screen behind a number", async () => {
      answer(NUMBERS);
      await signIn();
      await settle();
      (rows()[1].querySelector("button") as HTMLElement).click();
      await settle();
      expect(el("view-ball").hidden).toBe(false);
      expect(el("view-overview").hidden).toBe(true);
    });

    it("leaves the card out for someone who may see none of the numbers", async () => {
      answer([]);
      await signIn();
      await settle();
      expect(el("ovNumbersCard").hidden).toBe(true);
    });

    it("leaves the card out when the whole overview could not load, rather than showing old numbers", async () => {
      answer(NUMBERS);
      await signIn();
      await settle();
      overviewAnswer = { status: 500, body: { error: "The overview could not load. Try again." } };
      (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
      await settle();
      (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
      await settle();
      expect(el("ovNumbersCard").hidden).toBe(true);
      expect(rows()).toHaveLength(0);
    });

    it("escapes what it is given", async () => {
      answer([{ ...NUMBERS[0], headline: "<img src=x onerror=alert(1)>" }]);
      await signIn();
      await settle();
      expect(document.querySelector("#overviewNumbers img")).toBeNull();
      expect(rows()[0].querySelector(".ov-number-headline")?.textContent).toBe("<img src=x onerror=alert(1)>");
    });
  });

  // TASK-510: Coming up, the next 14 days by day, under the numbers. The server gathers and words it.
  describe("Coming up on the Overview (TASK-510)", () => {
    const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
    const COMING = [
      {
        day: "2026-10-03",
        label: "Today",
        items: [{ text: "The newsletter goes out: October news", when: "8am", view: "newsletter", button: "Newsletter" }],
      },
      {
        day: "2026-10-07",
        label: "Wednesday 7 October",
        items: [
          { text: "Quiz night", when: "7:30pm", view: "events", button: "Events" },
          { text: "Bake sale (a fundraiser)", when: "", view: "fundraising", button: "Fundraising" },
        ],
      },
    ];
    const days = () => Array.from(document.querySelectorAll("#overviewComing .ov-day")) as HTMLElement[];
    const answer = (comingUp: unknown[]) => {
      overviewAnswer = { status: 200, body: { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], numbers: [], comingUp, failed: [] } };
    };

    it("shows the fortnight by day, each thing with its time and a button to its screen", async () => {
      answer(COMING);
      await signIn();
      await settle();
      expect(el("ovComingCard").hidden).toBe(false);
      expect(days().map((d) => d.querySelector(".ov-day-label")?.textContent)).toEqual(["Today", "Wednesday 7 October"]);
      const items = Array.from(days()[1].querySelectorAll(".ov-event")) as HTMLElement[];
      expect(items.map((i) => i.querySelector(".ov-event-when")?.textContent)).toEqual(["7:30pm", ""]);
      expect(items.map((i) => i.querySelector(".ov-event-text")?.textContent)).toEqual(["Quiz night", "Bake sale (a fundraiser)"]);
      expect(items.map((i) => (i.querySelector("button") as HTMLElement).textContent)).toEqual(["Events", "Fundraising"]);
    });

    it("opens the screen behind a thing coming up", async () => {
      answer(COMING);
      await signIn();
      await settle();
      (days()[1].querySelector(".ov-event button") as HTMLElement).click();
      await settle();
      expect(el("view-events").hidden).toBe(false);
      expect(el("view-overview").hidden).toBe(true);
    });

    it("leaves the card out when nothing this person may see is coming up", async () => {
      answer([]);
      await signIn();
      await settle();
      expect(el("ovComingCard").hidden).toBe(true);
    });

    it("leaves the card out when the whole overview could not load", async () => {
      answer(COMING);
      await signIn();
      await settle();
      overviewAnswer = { status: 500, body: { error: "The overview could not load. Try again." } };
      (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
      await settle();
      (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
      await settle();
      expect(el("ovComingCard").hidden).toBe(true);
      expect(days()).toHaveLength(0);
    });

    it("escapes what it is given", async () => {
      answer([{ day: "2026-10-03", label: "<b>x</b>", items: [{ text: "<img src=x onerror=alert(1)>", when: "", view: "events", button: "Events" }] }]);
      await signIn();
      await settle();
      expect(document.querySelector("#overviewComing img, #overviewComing b")).toBeNull();
    });
  });

  // TASK-492: QR codes for every page, to print or share. Anyone who can view Site pages.
  describe("QR codes (TASK-492)", () => {
    const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
    const nav = () => document.querySelector('.admin-nav-link[data-view="qr"]') as HTMLElement;
    const openQr = async () => {
      await signIn();
      nav().click();
      await settle();
    };
    const PAGES = [
      { path: "/", title: "Home", live: true, link: "https://nbcc.scot/?utm_medium=qr&utm_campaign=home", svg: QR_SVG },
      { path: "/ball", title: "Festive Ball", live: false, link: "https://nbcc.scot/ball?utm_medium=qr&utm_campaign=ball", svg: QR_SVG },
    ];
    let saved: Array<{ href: string; download: string }> = [];
    beforeEach(() => {
      saved = [];
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:qr";
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ href: this.href, download: this.download });
      });
    });

    it("is in the menu for anyone who can view Site pages", async () => {
      loginToken = tokenFor("viewer");
      await signIn();
      expect(nav().hidden).toBe(false);
    });

    it("is not in the menu for someone who cannot", async () => {
      loginToken = tokenFor("viewer");
      storedPermissions = { ...roleToPermissions("viewer"), site: "none" };
      await signIn();
      expect(nav().hidden).toBe(true);
    });

    it("lists every page with its name, address, a preview, and both downloads", async () => {
      qrPages = PAGES;
      await openQr();
      const rows = Array.from(document.querySelectorAll("#qrList .qr-card"));
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("Home");
      expect(rows[0].textContent).toContain("nbcc.scot/");
      const img = rows[0].querySelector("img") as HTMLImageElement;
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
      expect(img.getAttribute("alt")).toBe("QR code for Home");
      expect(Array.from(rows[0].querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Download SVG", "Download PNG"]);
      expect(rows[0].textContent).not.toMatch(/not live yet/i);
      expect(rows[1].textContent).toMatch(/not live yet/i);
    });

    it("downloads a code, named after its page", async () => {
      qrPages = PAGES;
      await openQr();
      (document.querySelectorAll("#qrList .qr-card")[1].querySelectorAll("button")[1] as HTMLElement).click();
      await settle();
      expect(qrImageUrls.some((u) => u.includes("path=%2Fball") && u.includes("format=png"))).toBe(true);
      expect(saved).toEqual([{ href: "blob:qr", download: "nbcc-qr-ball.png" }]);
    });

    it("makes a code for any other nbcc.scot address", async () => {
      qrPages = PAGES;
      await openQr();
      (el("qrOtherPath") as HTMLInputElement).value = "/give";
      el("qrOtherForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      const card = document.querySelector("#qrOther .qr-card") as HTMLElement;
      expect(card.textContent).toContain("nbcc.scot/give");
      expect((card.querySelector("img") as HTMLImageElement).getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
      (card.querySelectorAll("button")[0] as HTMLElement).click();
      await settle();
      expect(saved).toEqual([{ href: "blob:qr", download: "nbcc-qr-give.svg" }]);
    });

    // Staff often paste the address from the browser, whole.
    it("takes a pasted whole nbcc.scot address", async () => {
      qrPages = PAGES;
      await openQr();
      (el("qrOtherPath") as HTMLInputElement).value = "https://www.nbcc.scot/give";
      el("qrOtherForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      expect(qrImageUrls.some((u) => u.includes("path=%2Fgive&"))).toBe(true);
      expect((document.querySelector("#qrOther .qr-card") as HTMLElement).textContent).toContain("nbcc.scot/give");
    });

    it("refuses an address that is not on nbcc.scot, before asking", async () => {
      qrPages = PAGES;
      await openQr();
      const before = qrImageUrls.length;
      (el("qrOtherPath") as HTMLInputElement).value = "give";
      el("qrOtherForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      expect(el("qrStatus").textContent).toBe("Give an address on nbcc.scot, starting with /");
      expect(qrImageUrls.length).toBe(before);
      expect(document.querySelector("#qrOther .qr-card")).toBeNull();
      // An empty box is not the home page.
      (el("qrOtherPath") as HTMLInputElement).value = "  ";
      el("qrOtherForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      expect(el("qrStatus").textContent).toBe("Give an address on nbcc.scot, starting with /");
      expect(qrImageUrls.length).toBe(before);
    });

    it("says so when the list cannot load", async () => {
      qrPages = PAGES;
      const original = globalThis.fetch;
      (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string, init?: never) =>
        String(url).endsWith("/api/admin/qr-codes")
          ? Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({ error: "x" }), text: () => Promise.resolve(""), headers: { get: () => "application/json" } })
          : (original as (u: string, i?: never) => Promise<unknown>)(url, init),
      );
      await openQr();
      expect(el("qrList").textContent).toMatch(/could not load/i);
      (globalThis as unknown as { fetch: unknown }).fetch = original;
    });
  });

  describe("New pills (TASK-478)", () => {
    const link = (view: string) => document.querySelector('.admin-nav-link[data-view="' + view + '"]') as HTMLElement;
    const pill = (host: Element | null) => host?.querySelector(".admin-new-pill") ?? null;
    const seenPosts = () =>
      (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { method?: string; body?: string }?]> } }).mock.calls
        .filter(([url, init]) => String(url).includes("/whats-new/seen") && init?.method === "POST")
        .map(([, init]) => JSON.parse(init?.body || "{}").area);
    const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };

    it("puts a pill on each section that is new, and on the phone's Menu button", async () => {
      whatsNew = [
        { area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" },
        { area: "donations", new: false, since: "2026-10-01T00:00:00.000Z" },
      ];
      await signIn();
      await settle();
      expect(pill(link("contact"))).not.toBeNull();
      // Read aloud as "Contact form, New": the comma is there for a screen reader, not the eye.
      expect(link("contact").textContent).toBe("Contact form, New");
      expect(pill(link("donations"))).toBeNull();
      expect(pill(el("adminNavToggle"))).not.toBeNull();
    });

    it("clears a section's pill when it is opened, and records the visit", async () => {
      whatsNew = [{ area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("contact").click();
      await settle();
      expect(pill(link("contact"))).toBeNull();
      expect(pill(el("adminNavToggle"))).toBeNull();
      expect(seenPosts()).toEqual(["contact"]);
    });

    // An answer already on its way when the visit was recorded must not bring the pill back.
    it("keeps it cleared when a slower answer still says it is new", async () => {
      whatsNew = [{ area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("contact").click();
      await settle();
      link("donations").click();
      await settle();
      expect(pill(link("contact"))).toBeNull();
    });

    it("marks the rows that arrived since the person's last visit", async () => {
      whatsNew = [{ area: "donations", new: true, since: "2026-01-01T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("donations").click();
      await settle();
      expect(pill(document.querySelector("#donationsTable tbody tr"))).not.toBeNull();
    });

    // The server counts an arrival within the same millisecond as new (times reach us cut to
    // milliseconds), so the row that lit the menu pill must carry one too.
    it("marks a row from the same millisecond as the last visit", async () => {
      whatsNew = [{ area: "donations", new: true, since: "2026-01-02T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("donations").click();
      await settle();
      expect(pill(document.querySelector("#donationsTable tbody tr"))).not.toBeNull();
    });

    it("leaves older rows alone", async () => {
      whatsNew = [{ area: "donations", new: false, since: "2026-02-01T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("donations").click();
      await settle();
      expect(pill(document.querySelector("#donationsTable tbody tr"))).toBeNull();
    });

    // The Overview shares the Donations table. Refreshing on Donations reopens it before the Overview
    // loads, and the Overview's rows must never be marked, then or later.
    it("never marks the Overview's recent donations, even after a refresh on Donations", async () => {
      loginToken = tokenFor("admin");
      whatsNew = [{ area: "donations", new: true, since: "2026-01-01T00:00:00.000Z" }];
      window.sessionStorage.setItem("nbccAdminView", "donations");
      // jsdom lays nothing out, so every link has no offsetParent and nothing would be restored.
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
      Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() { return (this as HTMLElement).parentElement; },
      });
      try {
        await signIn();
        await settle();
        expect(el("view-donations").hidden).toBe(false);
        link("overview").click();
        await settle();
        expect(document.querySelector("#overviewRecent table")).not.toBeNull();
        expect(pill(el("overviewRecent"))).toBeNull();
      } finally {
        if (desc) Object.defineProperty(HTMLElement.prototype, "offsetParent", desc);
      }
    });

    // Manage access names each section after its menu link, and must not read the pill as part of it.
    it("keeps the pill out of the section names on Manage access", async () => {
      loginToken = tokenFor("admin");
      teamMembers = [
        {
          id: 7, email: "ed@nbcc", full_name: "Ed Itor", role: "editor", status: "active",
          invited_at: "2026-08-01T00:00:00Z", last_login_at: null, permissions: {},
        },
      ];
      whatsNew = [{ area: "contact", new: true, since: "2026-10-01T00:00:00.000Z" }];
      await signIn();
      await settle();
      link("team").click();
      await settle();
      (document.querySelector('[data-team-perms="7"]') as HTMLElement).click();
      const labels = Array.from(document.querySelectorAll(".admin-perm-label")).map((l) => l.textContent);
      expect(labels).toContain("Contact form");
      expect(labels.filter((l) => /\bNew\b/.test(l || ""))).toEqual([]); // "Newsletter" is fine
      const group = document.querySelector('[data-perm-section="contact"]');
      expect(group?.getAttribute("aria-label")).toBe("Contact form access");
    });

    it("shows no pills, and nothing else breaks, when the list cannot be fetched", async () => {
      whatsNewFailure = true;
      await signIn();
      await settle();
      expect(document.querySelectorAll(".admin-new-pill").length).toBe(0);
      expect(el("overviewNeeds").textContent).toContain("Nothing needs you right now");
      link("donations").click();
      await settle();
      expect(document.querySelector("#donationsTable table")).not.toBeNull();
      expect(seenPosts()).toEqual([]);
    });
  });

  // TASK-484: paying for the Festive Ball by bank transfer, on the admin screen. The client reserved
  // setting the bank details and confirming money to ADMINS; giving more time and cancelling need
  // Festive Ball edit. The server enforces all of it; these check what each person is offered.
  describe("bank transfer on the Festive Ball screen (TASK-484)", () => {
    const awaiting = {
      reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test",
      buyerEmail: "ada@example.com", totalPence: 102_000, payBy: "2026-10-08", createdAt: "2026-10-01T09:00:00Z",
    };
    const fetchCalls = () =>
      (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { method?: string; body?: string }?]> } }).mock.calls;
    const posted = (pattern: RegExp) =>
      fetchCalls().filter(([url, init]) => pattern.test(String(url)) && (init?.method === "POST" || init?.method === "PUT"));
    const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
    const openBall = async () => {
      await signIn();
      (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
      await settle();
    };
    const asEditorWithBallEdit = () => {
      loginToken = tokenFor("editor");
      storedPermissions = { ...roleToPermissions("editor"), ball: "edit" };
    };
    const buttonsIn = (host: string) =>
      Array.from(document.querySelectorAll(host + " button")).map((b) => (b.textContent || "").trim());

    it("shows the bank details, which only an admin can change", async () => {
      loginToken = tokenFor("admin");
      transferSettings = { on: true, accountName: "Night Before Christmas Campaign", sortCode: "12-34-56", accountNumber: "12345678", ready: true };
      await openBall();
      expect((el("ballTransferAccountName") as HTMLInputElement).value).toBe("Night Before Christmas Campaign");
      expect((el("ballTransferSortCode") as HTMLInputElement).value).toBe("12-34-56");
      expect((el("ballTransferAccountNumber") as HTMLInputElement).value).toBe("12345678");
      expect((el("ballTransferOn") as HTMLInputElement).checked).toBe(true);
      expect((el("ballTransferSave") as HTMLButtonElement).disabled).toBe(false);
    });

    it("lets an editor with Festive Ball edit see the bank details but not change them", async () => {
      asEditorWithBallEdit();
      await openBall();
      expect((el("ballTransferSave") as HTMLButtonElement).disabled).toBe(true);
      expect((el("ballTransferOn") as HTMLInputElement).disabled).toBe(true);
    });

    it("saves the bank details and the switch", async () => {
      loginToken = tokenFor("admin");
      await openBall();
      (el("ballTransferAccountName") as HTMLInputElement).value = "Night Before Christmas Campaign";
      (el("ballTransferSortCode") as HTMLInputElement).value = "123456";
      (el("ballTransferAccountNumber") as HTMLInputElement).value = "12345678";
      (el("ballTransferOn") as HTMLInputElement).checked = true;
      (el("ballTransferLastDay") as HTMLInputElement).value = "2026-10-31";
      el("ballTransferForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      const [, init] = posted(/\/api\/admin\/ball\/transfer-settings$/)[0];
      expect(JSON.parse(init?.body || "{}")).toEqual({
        accountName: "Night Before Christmas Campaign", sortCode: "123456", accountNumber: "12345678", on: true,
        lastDay: "2026-10-31",
      });
    });

    // TASK-485: an empty box means no last day, so it is sent as null, which clears it.
    it("clears the last day for transfers when the box is emptied", async () => {
      loginToken = tokenFor("admin");
      transferSettings = { on: false, accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678", ready: false, lastDay: "2026-10-31" } as typeof transferSettings;
      await openBall();
      expect((el("ballTransferLastDay") as HTMLInputElement).value).toBe("2026-10-31");
      (el("ballTransferLastDay") as HTMLInputElement).value = "";
      el("ballTransferForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      const [, init] = posted(/\/api\/admin\/ball\/transfer-settings$/)[0];
      expect(JSON.parse(init?.body || "{}").lastDay).toBeNull();
    });

    // TASK-485: switched on is not the same as offered once the last day has passed.
    it("says so when saving after the last day for transfers has passed", async () => {
      loginToken = tokenFor("admin");
      transferSettings = {
        on: true, accountName: "NBCC", sortCode: "12-34-56", accountNumber: "12345678", ready: true,
        lastDay: "2020-01-01", offered: false,
      } as typeof transferSettings;
      await openBall();
      el("ballTransferForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await settle();
      expect(el("ballTransferStatus").textContent).toBe(
        "Saved. The last day for transfers has passed, so the ticket page offers card only.",
      );
    });

    // TASK-485: past its date, flagged; and whether the reminder has gone.
    it("flags an overdue booking, and says when the reminder has gone", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [
        { ...awaiting, overdue: true, reminded: true },
        { ...awaiting, reference: "BALL-2PQRST", overdue: false, reminded: false },
      ];
      await openBall();
      const rows = Array.from(document.querySelectorAll("#ballTransfers tbody tr"));
      expect(rows[0].textContent).toContain("Overdue");
      expect(rows[0].textContent).toContain("Reminder sent");
      expect(rows[1].textContent).not.toContain("Overdue");
      expect(rows[1].textContent).not.toContain("Reminder sent");
    });

    // TASK-488: staff add a booking by hand for a phone or email order. Festive Ball edit only.
    describe("adding a booking by hand (TASK-488)", () => {
      const field = (id: string) => el(id) as HTMLInputElement;
      const openAdd = async () => {
        await openBall();
        el("ballAddTransferOpen").click();
      };
      const fillAdd = () => {
        (el("ballAddKind") as HTMLSelectElement).value = "table";
        field("ballAddQuantity").value = "1";
        field("ballAddFirstName").value = "Ada";
        field("ballAddSurname").value = "Test";
        field("ballAddEmail").value = "ada@example.com";
        field("ballAddBuyerPhone").value = "07700 900123";
        field("ballAddDonation").value = "20";
        field("ballAddTerms").checked = true;
      };
      const submitAdd = async () => {
        el("ballAddTransferForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        await settle();
      };
      const transferListLoads = () => fetchCalls().filter(([url]) => String(url).includes("/api/admin/ball/transfers")).length;

      it("is offered to someone with Festive Ball edit, closed until asked for", async () => {
        asEditorWithBallEdit();
        await openBall();
        expect(el("ballAddTransferOpen").hidden).toBe(false);
        expect(el("ballAddTransferForm").hidden).toBe(true);
        el("ballAddTransferOpen").click();
        expect(el("ballAddTransferForm").hidden).toBe(false);
        expect(el("ballAddTransferOpen").getAttribute("aria-expanded")).toBe("true");
      });

      it("is not offered to someone who can only view the Festive Ball", async () => {
        loginToken = tokenFor("viewer");
        await openBall();
        expect(el("ballAddTransferOpen").hidden).toBe(true);
      });

      it("asks for the company's details only when an invoice is needed", async () => {
        loginToken = tokenFor("admin");
        await openAdd();
        expect(el("ballAddInvoiceFields").hidden).toBe(true);
        field("ballAddInvoice").checked = true;
        field("ballAddInvoice").dispatchEvent(new Event("change", { bubbles: true }));
        expect(el("ballAddInvoiceFields").hidden).toBe(false);
      });

      // Review of PR #650: staff may not have the number for a phone or email order. Optional here;
      // the booking is then flagged until someone adds it.
      it("adds it without a phone number when staff do not have one", async () => {
        loginToken = tokenFor("admin");
        addTransferAnswer = { status: 201, body: { reference: "BALL-7KQ2MZ", totalPence: 102_000, payBy: "2026-10-08" } };
        await openAdd();
        fillAdd();
        field("ballAddBuyerPhone").value = "";
        await submitAdd();
        const [, init] = posted(/\/api\/admin\/ball\/transfer-bookings$/)[0];
        expect(JSON.parse(init?.body || "{}")).not.toHaveProperty("buyerPhone");
        expect(field("ballAddBuyerPhone").getAttribute("type")).toBe("tel");
        expect(field("ballAddBuyerPhone").getAttribute("autocomplete")).toBe("off");
        expect(document.querySelector('label[for="ballAddBuyerPhone"]')?.textContent).toBe("Phone number (optional)");
      });

      it("needs the buyer's agreement to the terms before it sends anything", async () => {
        loginToken = tokenFor("admin");
        await openAdd();
        fillAdd();
        field("ballAddTerms").checked = false;
        await submitAdd();
        expect(posted(/\/api\/admin\/ball\/transfer-bookings$/)).toHaveLength(0);
        expect(el("ballAddStatus").textContent).toMatch(/agreed to the ticket terms/);
      });

      it("adds it, says what the buyer must pay and by when, and refreshes the list", async () => {
        loginToken = tokenFor("admin");
        addTransferAnswer = {
          status: 201,
          body: { reference: "BALL-7KQ2MZ", totalPence: 102_000, payBy: "2026-10-08", accountName: "N", sortCode: "12-34-56", accountNumber: "12345678" },
        };
        await openAdd();
        const before = transferListLoads();
        fillAdd();
        await submitAdd();
        const [, init] = posted(/\/api\/admin\/ball\/transfer-bookings$/)[0];
        expect(JSON.parse(init?.body || "{}")).toEqual({
          kind: "table",
          quantity: 1,
          buyerFirstName: "Ada",
          buyerSurname: "Test",
          buyerEmail: "ada@example.com",
          buyerPhone: "07700 900123",
          donationPence: 2000,
          termsAccepted: true,
        });
        const said = el("ballAddStatus").textContent || "";
        for (const part of ["BALL-7KQ2MZ", "£1,020.00", "Thursday 8 October"]) expect(said, part).toContain(part);
        expect(transferListLoads()).toBeGreaterThan(before);
        expect(el("ballAddTransferForm").hidden).toBe(true);
        expect(field("ballAddFirstName").value).toBe("");
      });

      // A table order is at most 4 and a ticket order at most 9, as on the ticket page.
      it("says the limit before sending more tables than one booking can take", async () => {
        loginToken = tokenFor("admin");
        await openAdd();
        fillAdd();
        field("ballAddQuantity").value = "5";
        await submitAdd();
        expect(posted(/\/api\/admin\/ball\/transfer-bookings$/)).toHaveLength(0);
        expect(el("ballAddStatus").textContent).toMatch(/up to 4 tables/);
      });

      it("takes a donation in pounds and pence", async () => {
        loginToken = tokenFor("admin");
        addTransferAnswer = { status: 201, body: { reference: "BALL-7KQ2MZ", totalPence: 102_050, payBy: "2026-10-08" } };
        await openAdd();
        fillAdd();
        field("ballAddDonation").value = "20.50";
        await submitAdd();
        const [, init] = posted(/\/api\/admin\/ball\/transfer-bookings$/)[0];
        expect(JSON.parse(init?.body || "{}").donationPence).toBe(2050);
        expect(field("ballAddDonation").getAttribute("step")).toBe("0.01");
      });

      it("sends the invoice details when ticked", async () => {
        loginToken = tokenFor("admin");
        addTransferAnswer = { status: 201, body: { reference: "BALL-7KQ2MZ", totalPence: 100_000, payBy: "2026-10-15" } };
        await openAdd();
        fillAdd();
        field("ballAddInvoice").checked = true;
        field("ballAddCompany").value = "Example Widgets Ltd";
        (el("ballAddAddress") as HTMLTextAreaElement).value = "1 Test Street";
        await submitAdd();
        const [, init] = posted(/\/api\/admin\/ball\/transfer-bookings$/)[0];
        expect(JSON.parse(init?.body || "{}").invoice).toEqual({
          company: "Example Widgets Ltd", address: "1 Test Street", po: "", accountsEmail: "", phone: "",
        });
      });

      it("says what went wrong and keeps what was typed", async () => {
        loginToken = tokenFor("admin");
        addTransferAnswer = { status: 409, body: { error: "There are not enough whole tables left for that booking" } };
        await openAdd();
        fillAdd();
        await submitAdd();
        expect(el("ballAddStatus").textContent).toBe("There are not enough whole tables left for that booking");
        expect(field("ballAddFirstName").value).toBe("Ada");
        expect(el("ballAddTransferForm").hidden).toBe(false);
      });
    });

    // TASK-487: a transfer booking made since this person last opened Festive Ball carries the New pill.
    it("marks a transfer booking made since the last visit as New, and leaves older ones alone", async () => {
      loginToken = tokenFor("admin");
      whatsNew = [{ area: "ball", new: true, since: "2026-10-01T08:00:00.000Z" }];
      awaitingTransfers = [
        { ...awaiting, createdAt: "2026-10-01T09:00:00.000Z" },
        { ...awaiting, reference: "BALL-2PQRST", createdAt: "2026-09-30T09:00:00.000Z" },
      ];
      await openBall();
      const rows = Array.from(document.querySelectorAll("#ballTransfers tbody tr"));
      expect(rows[0].querySelector(".admin-new-pill")).not.toBeNull();
      expect(rows[1].querySelector(".admin-new-pill")).toBeNull();
    });

    // TASK-486: the company it is invoiced to, and its invoice, which opens in a new tab.
    it("names the company and links the invoice of an invoiced booking", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [
        { ...awaiting, company: "Example Widgets Ltd", invoiceUrl: "https://nbcc.scot/ball/invoice/42.abc" },
        { ...awaiting, reference: "BALL-2PQRST", company: null, invoiceUrl: null },
      ];
      await openBall();
      const rows = Array.from(document.querySelectorAll("#ballTransfers tbody tr"));
      expect(rows[0].textContent).toContain("Example Widgets Ltd");
      const link = rows[0].querySelector("a") as HTMLAnchorElement;
      expect(link.textContent).toBe("Invoice");
      expect(link.getAttribute("href")).toBe("https://nbcc.scot/ball/invoice/42.abc");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(rows[1].querySelector("a")).toBeNull();
      expect(rows[1].textContent).not.toContain("Invoice");
    });

    it("lists the bookings awaiting a transfer", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [awaiting];
      await openBall();
      const list = el("ballTransfers").textContent || "";
      for (const part of ["BALL-7KQ2MZ", "Ada Test", "ada@example.com", "£1,020.00", "Thu 8 Oct"]) expect(list, part).toContain(part);
    });

    it("offers an admin Mark as paid, Give more time and Cancel", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [awaiting];
      await openBall();
      expect(buttonsIn("#ballTransfers .ball-transfer-actions")).toEqual(["Mark as paid", "Give more time", "Cancel"]);
    });

    it("offers an editor with Festive Ball edit only Give more time and Cancel", async () => {
      asEditorWithBallEdit();
      awaitingTransfers = [awaiting];
      await openBall();
      expect(buttonsIn("#ballTransfers .ball-transfer-actions")).toEqual(["Give more time", "Cancel"]);
    });

    it("asks before marking paid, naming the amount, and sends that amount", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [awaiting];
      await openBall();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      (document.querySelector("#ballTransfers [data-mark-paid]") as HTMLElement).click();
      await settle();
      expect(confirm.mock.calls[0][0]).toContain("Has £1,020.00 arrived for BALL-7KQ2MZ (Ada Test)?");
      expect(posted(/mark-paid$/)).toHaveLength(0);

      confirm.mockReturnValue(true);
      (document.querySelector("#ballTransfers [data-mark-paid]") as HTMLElement).click();
      await settle();
      const [, init] = posted(/\/bookings\/BALL-7KQ2MZ\/mark-paid$/)[0];
      expect(JSON.parse(init?.body || "{}")).toEqual({ confirmTotalPence: 102_000 });
      confirm.mockRestore();
    });

    it("gives more time to the date staff type", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [awaiting];
      await openBall();
      const prompt = vi.spyOn(window, "prompt").mockReturnValue("2026-10-20");
      (document.querySelector("#ballTransfers [data-pay-by]") as HTMLElement).click();
      await settle();
      expect(prompt.mock.calls[0][1]).toBe("2026-10-15"); // a week on from the date it has now
      const [, init] = posted(/\/bookings\/BALL-7KQ2MZ\/pay-by$/)[0];
      expect(JSON.parse(init?.body || "{}")).toEqual({ payBy: "2026-10-20" });
      prompt.mockRestore();
    });

    it("finds a payment by reference, name or amount", async () => {
      loginToken = tokenFor("admin");
      awaitingTransfers = [
        awaiting,
        { ...awaiting, reference: "BALL-2PQRST", buyerName: "Bo Example", buyerEmail: "bo@example.com", totalPence: 30_000 },
        // £720: its amount starts with the digits in "BALL-7KQ2MZ", which is a reference, not an amount.
        { ...awaiting, reference: "BALL-9WXYZA", buyerName: "Cy Example", buyerEmail: "cy@example.com", totalPence: 72_000 },
      ];
      await openBall();
      const search = el("ballTransferSearch") as HTMLInputElement;
      const visible = () =>
        Array.from(document.querySelectorAll("#ballTransfers tbody tr")).filter((r) => !(r as HTMLElement).hidden).length;
      for (const [query, expected] of [
        ["1,020", 1], ["£300", 1], ["720.00", 1], ["bo exa", 1], ["2pqr", 1], ["BALL-7KQ2MZ", 1], ["", 3], ["nobody", 0],
      ] as const) {
        search.value = query;
        search.dispatchEvent(new Event("input", { bubbles: true }));
        expect(visible(), query).toBe(expected);
      }
    });

    // Money arriving for a booking already cancelled: it comes back if its seats are still free.
    it("offers an admin Mark as paid on a cancelled transfer booking, and nobody else", async () => {
      ballBookings = [{
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        totalPence: 102_000, donationPence: 2000, giftAid: true, newsletterOptIn: false, status: "cancelled",
        createdAt: "2026-10-01T09:00:00Z", paidAt: null, paymentMethod: "transfer", cancelledFrom: "pending",
      }];
      loginToken = tokenFor("admin");
      await openBall();
      expect(document.querySelector("#ballBookings [data-mark-paid]")).not.toBeNull();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      (document.querySelector("#ballBookings [data-mark-paid]") as HTMLElement).click();
      expect(confirm.mock.calls[0][0]).toContain("This booking was cancelled.");
      confirm.mockRestore();
    });

    it("does not offer an editor Mark as paid on a cancelled transfer booking", async () => {
      ballBookings = [{
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        totalPence: 102_000, donationPence: 2000, giftAid: true, newsletterOptIn: false, status: "cancelled",
        createdAt: "2026-10-01T09:00:00Z", paidAt: null, paymentMethod: "transfer", cancelledFrom: "pending",
      }];
      asEditorWithBallEdit();
      await openBall();
      expect(document.querySelector("#ballBookings [data-mark-paid]")).toBeNull();
    });

    // Paid, then cancelled and refunded by hand: there is nothing to bring back.
    it("does not offer Mark as paid on a transfer that had been paid before it was cancelled", async () => {
      ballBookings = [{
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        totalPence: 102_000, donationPence: 2000, giftAid: true, newsletterOptIn: false, status: "cancelled",
        createdAt: "2026-10-01T09:00:00Z", paidAt: "2026-10-02T09:00:00Z", paymentMethod: "transfer", cancelledFrom: "paid",
      }];
      loginToken = tokenFor("admin");
      await openBall();
      expect(document.querySelector("#ballBookings [data-mark-paid]")).toBeNull();
    });

    // Their money came by bank transfer, so the refund goes back the same way, not through Stripe.
    it("tells staff cancelling a paid transfer to refund it from the bank", async () => {
      ballBookings = [{
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        totalPence: 102_000, donationPence: 2000, giftAid: true, newsletterOptIn: false, status: "paid",
        createdAt: "2026-10-01T09:00:00Z", paidAt: "2026-10-02T09:00:00Z", paymentMethod: "transfer", cancelledFrom: null,
      }];
      loginToken = tokenFor("admin");
      await openBall();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      (document.querySelector("#ballBookings [data-cancel-booking]") as HTMLElement).click();
      expect(confirm.mock.calls[0][0]).toContain("refund them from the bank");
      expect(confirm.mock.calls[0][0]).not.toContain("Stripe");
      confirm.mockRestore();
    });

    // Each load used to add another click handler to the bookings table, so after the screen had
    // been opened a few times one click on Cancel asked as many times.
    it("asks once per click, however many times the screen has been opened", async () => {
      loginToken = tokenFor("admin");
      ballBookings = [{
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        totalPence: 100_000, donationPence: 0, giftAid: false, newsletterOptIn: false, status: "paid",
        createdAt: "2026-10-01T09:00:00Z", paidAt: "2026-10-01T09:00:00Z", paymentMethod: "card",
      }];
      await openBall();
      (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
      await settle();
      (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
      await settle();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      (document.querySelector("#ballBookings [data-cancel-booking]") as HTMLElement).click();
      expect(confirm).toHaveBeenCalledTimes(1);
      confirm.mockRestore();
    });

    // Jaimie 2026-10-03: the ticket page now asks for the booker's phone number, so NBCC can contact
    // them about menu choices. Bookings made before have none: staff chase them by hand, so the screen
    // flags them, counts them, can show only them, and lets staff add or change the number.
    describe("the booker's phone number", () => {
      const paid = (over: Record<string, unknown> = {}) => ({
        id: 1, reference: "BALL-7KQ2MZ", kind: "table", quantity: 1, seats: 10, buyerName: "Ada Test", buyerEmail: "ada@example.com",
        buyerPhone: null, totalPence: 100_000, donationPence: 0, giftAid: false, newsletterOptIn: false, status: "paid",
        createdAt: "2026-10-01T09:00:00Z", paidAt: "2026-10-01T09:00:00Z", paymentMethod: "card", cancelledFrom: null, ...over,
      });
      const rowOf = (ref: string) =>
        Array.from(document.querySelectorAll("#ballBookings tbody tr")).find((r) => (r.textContent || "").includes(ref)) as HTMLElement;

      it("shows the number, as a link to ring it", async () => {
        ballBookings = [paid({ buyerPhone: "07700 900123" })];
        loginToken = tokenFor("admin");
        await openBall();
        const link = document.querySelector('#ballBookings a[href="tel:07700900123"]') as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.textContent).toBe("07700 900123");
        expect(rowOf("BALL-7KQ2MZ").textContent).not.toContain("No phone number yet");
      });

      it("flags a paid booking with no number", async () => {
        ballBookings = [paid()];
        loginToken = tokenFor("admin");
        await openBall();
        expect(rowOf("BALL-7KQ2MZ").textContent).toContain("No phone number yet");
      });

      it("does not flag a cancelled booking", async () => {
        ballBookings = [paid({ status: "cancelled" })];
        loginToken = tokenFor("admin");
        await openBall();
        expect(rowOf("BALL-7KQ2MZ").textContent).not.toContain("No phone number yet");
      });

      it("flags a booking awaiting a bank transfer with no number", async () => {
        awaitingTransfers = [{
          reference: "BALL-2PQRST", kind: "seat", quantity: 2, seats: 2, buyerName: "Bo Example",
          buyerEmail: "bo@example.com", buyerPhone: null, totalPence: 20_000, payBy: "2026-10-08", createdAt: "2026-10-01T09:00:00Z",
        }];
        loginToken = tokenFor("admin");
        await openBall();
        expect(el("ballTransfers").textContent).toContain("No phone number yet");
      });

      it("says how many bookings have no number", async () => {
        ballBookings = [paid(), paid({ id: 2, reference: "BALL-2PQRST", buyerPhone: "01632 960123" })];
        ballNoPhone = 3;
        loginToken = tokenFor("admin");
        await openBall();
        expect(el("ballNoPhone").hidden).toBe(false);
        expect(el("ballNoPhoneCount").textContent).toBe("3 bookings have no phone number yet.");
        ballNoPhone = 1;
        (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
        await settle();
        (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
        await settle();
        expect(el("ballNoPhoneCount").textContent).toBe("1 booking has no phone number yet.");
      });

      it("says so when every booking has one", async () => {
        ballBookings = [paid({ buyerPhone: "07700 900123" })];
        ballNoPhone = 0;
        loginToken = tokenFor("admin");
        await openBall();
        expect(el("ballNoPhoneCount").textContent).toBe("Every booking has a phone number.");
        expect(el("ballNoPhoneOnlyLabel").hidden).toBe(true);
      });

      it("can show only the bookings with no number", async () => {
        ballBookings = [paid(), paid({ id: 2, reference: "BALL-2PQRST", buyerPhone: "01632 960123" })];
        ballNoPhone = 1;
        loginToken = tokenFor("admin");
        await openBall();
        const only = el("ballNoPhoneOnly") as HTMLInputElement;
        only.checked = true;
        only.dispatchEvent(new Event("change", { bubbles: true }));
        expect(rowOf("BALL-7KQ2MZ").hidden).toBe(false);
        expect(rowOf("BALL-2PQRST").hidden).toBe(true);
        only.checked = false;
        only.dispatchEvent(new Event("change", { bubbles: true }));
        expect(rowOf("BALL-2PQRST").hidden).toBe(false);
      });

      // The count covers bookings awaiting a transfer too, so the filter does as well, alongside the
      // search over that list.
      it("shows only the bookings awaiting a transfer with no number too", async () => {
        const t = {
          reference: "BALL-4MNPQR", kind: "seat", quantity: 2, seats: 2, buyerName: "Dee Example",
          buyerEmail: "dee@example.com", buyerPhone: null, totalPence: 20_000, payBy: "2026-10-08", createdAt: "2026-10-01T09:00:00Z",
        };
        awaitingTransfers = [t, { ...t, reference: "BALL-5RSTUV", buyerName: "Eve Example", buyerPhone: "07700 900123" }];
        ballBookings = [paid()];
        ballNoPhone = 2;
        loginToken = tokenFor("admin");
        await openBall();
        const transferRow = (ref: string) => document.querySelector(`#ballTransfers tr[data-ref="${ref}"]`) as HTMLElement;
        const only = el("ballNoPhoneOnly") as HTMLInputElement;
        only.checked = true;
        only.dispatchEvent(new Event("change", { bubbles: true }));
        expect(transferRow("BALL-4MNPQR").hidden).toBe(false);
        expect(transferRow("BALL-5RSTUV").hidden).toBe(true);
        // Searching keeps the filter: Eve stays hidden, and Dee goes because the search does not match her.
        const search = el("ballTransferSearch") as HTMLInputElement;
        search.value = "eve";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        expect(transferRow("BALL-5RSTUV").hidden).toBe(true);
        expect(transferRow("BALL-4MNPQR").hidden).toBe(true);
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        only.checked = false;
        only.dispatchEvent(new Event("change", { bubbles: true }));
        expect(transferRow("BALL-5RSTUV").hidden).toBe(false);
      });

      // Review of PR #650: a browser holding an admin.html from before this change has none of the
      // phone boxes. The rest of the Festive Ball screen must still work.
      it("leaves the rest of the screen working when the page has no phone count or filter", async () => {
        el("ballNoPhone").remove();
        ballBookings = [paid()];
        ballNoPhone = 1;
        loginToken = tokenFor("admin");
        await openBall();
        expect(rowOf("BALL-7KQ2MZ").textContent).toContain("No phone number yet");
        // Wired after the filter: the bank details form still saves.
        (el("ballTransferAccountName") as HTMLInputElement).value = "Example Account";
        (el("ballTransferSortCode") as HTMLInputElement).value = "000000";
        (el("ballTransferAccountNumber") as HTMLInputElement).value = "00000000";
        el("ballTransferForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        await settle();
        expect(posted(/\/api\/admin\/ball\/transfer-settings$/)).toHaveLength(1);
      });

      // Review of PR #650: on a desktop the money and the status must not break mid-value.
      // Not by nowrap, which paints a cell over its neighbour in a fixed table
      // (admin-no-sideways-scroll.test.ts): Status gets the width "cancelled" needs, taken from Who,
      // and below the width eight whole columns need, each booking is a labelled card.
      it("gives the status and the amount room, and becomes cards before the columns get too narrow", () => {
        const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
        const width = (n: number) =>
          Number((css.match(new RegExp(`\\.ball-bookings-table td:nth-child\\(${n}\\)\\{width:(\\d+)%\\}`)) || [])[1]);
        const widths = [1, 2, 3, 4, 5, 6, 7, 8].map(width);
        expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
        // "cancelled" is about 75px and a cell has 24px of padding: 11% of the 1000px minimum is 110px.
        expect(width(6)).toBeGreaterThanOrEqual(11);
        expect(width(4)).toBeGreaterThanOrEqual(9);
        expect(css).toContain("@container bblist (max-width:999px)");
      });

      it("lets someone with Festive Ball edit add a number, then shows the list again", async () => {
        ballBookings = [paid()];
        asEditorWithBallEdit();
        await openBall();
        const prompt = vi.spyOn(window, "prompt").mockReturnValue(" 07700 900123 ");
        const button = rowOf("BALL-7KQ2MZ").querySelector("[data-booking-phone]") as HTMLElement;
        expect((button.textContent || "").trim()).toBe("Add phone");
        const loadsBefore = fetchCalls().filter(([u]) => /\/api\/admin\/ball\/bookings$/.test(String(u))).length;
        button.click();
        await settle();
        const [, init] = posted(/\/api\/admin\/ball\/bookings\/BALL-7KQ2MZ\/phone$/)[0];
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(init?.body || "{}")).toEqual({ phone: "07700 900123" });
        expect(fetchCalls().filter(([u]) => /\/api\/admin\/ball\/bookings$/.test(String(u))).length).toBeGreaterThan(loadsBefore);
        prompt.mockRestore();
      });

      it("offers the number already there to change", async () => {
        ballBookings = [paid({ buyerPhone: "07700 900123" })];
        loginToken = tokenFor("admin");
        await openBall();
        const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
        const button = rowOf("BALL-7KQ2MZ").querySelector("[data-booking-phone]") as HTMLElement;
        expect((button.textContent || "").trim()).toBe("Change phone");
        button.click();
        await settle();
        expect(prompt.mock.calls[0][1]).toBe("07700 900123");
        // Cancelled: nothing sent.
        expect(posted(/\/phone$/)).toHaveLength(0);
        prompt.mockRestore();
      });

      it("says the server's reason when a number is refused", async () => {
        ballBookings = [paid()];
        ballPhoneAnswer = { status: 400, body: { error: "That phone number does not look right." } };
        loginToken = tokenFor("admin");
        await openBall();
        const prompt = vi.spyOn(window, "prompt").mockReturnValue("call me");
        const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
        (rowOf("BALL-7KQ2MZ").querySelector("[data-booking-phone]") as HTMLElement).click();
        await settle();
        expect(alert.mock.calls[0][0]).toBe("That phone number does not look right.");
        prompt.mockRestore();
        alert.mockRestore();
      });

      it("is not offered to someone who can only view the Festive Ball", async () => {
        ballBookings = [paid()];
        loginToken = tokenFor("viewer");
        await openBall();
        expect(document.querySelector("#ballBookings [data-booking-phone]")).toBeNull();
        expect(rowOf("BALL-7KQ2MZ").textContent).toContain("No phone number yet");
      });
    });

    // A card checkout someone never finished holds its seats for up to an hour now (TASK-484), so
    // "no seats are held" was wrong as well as stale.
    it("says what an abandoned checkout really does to the seats", () => {
      const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
      expect(app).not.toContain("no seats are held");
      expect(app).toContain("Their seats are kept for up to an hour in case they are still paying, then go back on sale.");
    });
  });
});

// TASK-251: the thank-you letter's signer picker is now built from AdminHelpers.SIGNERS instead of
// hardcoded <option> tags, so the newsletter's sign-off block can share ONE list and "the same list of
// names" survives a signer joining or leaving. That refactor touched a feature with no coverage at
// all: app.js dereferences el("tySigner").selectedOptions[0] to read the role, so an unpopulated
// select is a TypeError that takes the letter form down. These tests exist so that can't happen
// silently.
describe("thank-you signer picker is built from the shared SIGNERS list (TASK-251)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });

  it("populates the picker at script-eval, before anything reads it", () => {
    const opts = (el("tySigner") as HTMLSelectElement).options;
    expect(opts.length).toBe(helpers.SIGNERS.length);
    expect(opts.length).toBeGreaterThan(0); // an empty select would throw on selectedOptions[0]
  });

  it("carries each signer's name as the value and their role as data-role", () => {
    const opts = Array.from((el("tySigner") as HTMLSelectElement).options);
    helpers.SIGNERS.forEach((s: { name: string; role: string }, i: number) => {
      expect(opts[i].value).toBe(s.name);
      expect(opts[i].textContent).toBe(s.name);
      expect(opts[i].getAttribute("data-role")).toBe(s.role);
    });
  });

  it("has a usable selectedOptions[0] — the exact thing app.js dereferences for the role", () => {
    const sel = el("tySigner") as HTMLSelectElement;
    expect(sel.selectedOptions[0]).toBeTruthy();
    expect(sel.selectedOptions[0].getAttribute("data-role")).toBeTruthy();
    expect(sel.value).toBe(helpers.SIGNERS[0].name);
  });
});
