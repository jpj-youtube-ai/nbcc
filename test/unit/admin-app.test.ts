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
    expect(document.querySelectorAll("#overviewStats .admin-stat").length).toBe(5);
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
