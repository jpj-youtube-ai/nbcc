// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { roleToPermissions } from "../../src/admin/permissions";

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
    return j({ email: claims?.email || "", permissions: roleToPermissions(role) });
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
  if (url.includes("/api/admin/fulfilments")) return j({ results: fulfilments });
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
    fulfilments = makeFulfilments();
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
  it("shows a Delete permanently control distinct from Withdraw, and deletes on confirm", async () => {
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();

    const deleteBtn = el("deleteStoryBtn") as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn).not.toBe(el("withdrawStoryBtn"));
    expect(deleteBtn.className).toContain("btn-danger");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteBtn.click();
    await flush();
    await flush();

    expect(confirmSpy).toHaveBeenCalled();
    // A confirmed delete returns to the Stories list view.
    expect(el("view-stories").hidden).toBe(false);
    expect(el("view-story").hidden).toBe(true);
  });

  it("does not delete when the confirm is declined", async () => {
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();

    vi.spyOn(window, "confirm").mockReturnValue(false);
    (el("deleteStoryBtn") as HTMLButtonElement).click();
    await flush();
    await flush();

    // Declined => still on the story detail view, nothing deleted.
    expect(el("view-story").hidden).toBe(false);
  });

  it("hides the Delete permanently control for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await flush();
    await flush();
    (document.querySelector("#storiesTable [data-story]") as HTMLElement).click();
    await flush();
    await flush();
    expect(el("deleteStoryBtn")).toBeNull();
  });

  // TASK-208: Business supporters tab — an Editor lists the fulfilment records (business name, band,
  // submitted preferences) and marks a recognition step done; the row refetches and the button becomes
  // a Done pill.
  it("lists business supporters and marks a fulfilment flag done (Editor)", async () => {
    await signIn();

    (document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement).click();
    await flush();
    await flush();
    const table = document.querySelector("#fulfilmentsTable table");
    expect(table).not.toBeNull();
    const tableText = el("fulfilmentsTable").textContent || "";
    expect(tableText).toContain("Acme Ltd"); // business name
    expect(tableText).toContain("Platinum"); // band, capitalised
    expect(tableText).toContain("Submitted"); // captured_at present → preferences submitted
    expect(tableText).toContain("Awaiting preferences"); // the second row has none yet
    expect(tableText).toContain("Bramble Cafe Ltd"); // business_name null → donor name fallback

    // The "Certificate sent" step for supporter 1 is a not-yet-done action button.
    const markBtn = document.querySelector(
      '#fulfilmentsTable [data-fulfil-id="1"][data-fulfil-mark="certificate_sent"]',
    ) as HTMLButtonElement;
    expect(markBtn).not.toBeNull();

    markBtn.click();
    await flush();
    await flush();

    // The mark POSTed the exact flag, and after the refetch the button is gone (now a Done pill).
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const markCall = fetchMock.mock.calls.find((c) => /\/api\/admin\/fulfilments\/1\/mark$/.test(String(c[0])));
    expect(markCall).toBeTruthy();
    const markInit = (markCall as unknown[])[1] as { method?: string; body?: string };
    expect(markInit.method).toBe("POST");
    expect(JSON.parse(markInit.body || "{}")).toEqual({ flag: "certificate_sent" });
    expect(
      document.querySelector('#fulfilmentsTable [data-fulfil-id="1"][data-fulfil-mark="certificate_sent"]'),
    ).toBeNull();
    expect(el("fulfilmentsTable").textContent).toContain("Certificate sent"); // still shown, now as a Done pill
  });

  // TASK-208: the tab is an Editor+ area — a Viewer (who has donations:view, not edit) never sees it in
  // the nav (data-edit-gate="donations" hides it below edit level).
  it("hides the Business supporters tab for a Viewer", async () => {
    loginToken = tokenFor("viewer");
    await signIn();
    const navLink = document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement;
    expect(navLink).not.toBeNull();
    expect(navLink.hidden).toBe(true);
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
