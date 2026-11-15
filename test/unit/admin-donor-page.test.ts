// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// One donor's page (#view-donor), in the kit's look (2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-people.md). The four faults the audit found come
// first, each pinned by a test that failed against the old page; then what the page gained: their
// name as the title, the truth about Gift Aid and the monthly gift, what the cancel buttons do said
// under them, Back to where you came from, their giving, and what has changed.
//
// The pretend server answers as the real routes do: saving a donor answers with the nine snapshot
// fields alone (no address, no declaration), and after Gift Aid is cancelled the snapshot still
// says giftAid (some gift once carried it) while the declaration has gone. Every person, address
// and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Json = Record<string, unknown>;
const SNAPSHOT_FIELDS = ["donorId", "fullName", "email", "emailConsent", "anonymous", "hiddenFromSupporters", "subscriptionPlan", "subscriptionId", "giftAid"];
const freshDonor = (): Json => ({
  donorId: 7, fullName: "Rowan Example", email: "rowan@example.com", emailConsent: true, anonymous: false,
  hiddenFromSupporters: false, subscriptionPlan: "silver", subscriptionId: "sub_pretend", giftAid: true,
  houseNameNumber: "12", address: "Pretend Row, Testtown", postcode: "KA1 1AA",
  declaration: { id: 31, title: "Mx", firstName: "Rowan", lastName: "Example", houseNameNumber: "12", address: "Pretend Row, Testtown", postcode: "KA1 1AA", nonUk: false, scope: "all_donations", confirmedTaxpayer: true },
});
const gift = (over: Json = {}): Json => ({
  id: 90, donorId: 7, date: "2026-11-02T09:30:00.000Z", amountPence: 1000, refundedPence: 0, mode: "monthly", plan: "silver",
  giftAid: true, status: "paid", source: null, invoiceId: null, ...over,
});
const freshGiving = (): Json => ({
  totalPence: 6500, count: 3, listed: 4, firstAt: "2025-12-24T18:00:00.000Z", latestAt: "2026-11-02T09:30:00.000Z",
  gifts: [
    gift(),
    gift({ id: 89, date: "2026-10-02T09:30:00.000Z", status: "failed" }),
    gift({ id: 71, donorId: 5, date: "2026-03-14T12:00:00.000Z", amountPence: 5000, refundedPence: 500, mode: "once", plan: null, giftAid: false, source: "red_bag" }),
    gift({ id: 40, donorId: 4, date: "2025-12-24T18:00:00.000Z", amountPence: 1000, mode: "once", plan: null, giftAid: true }),
  ],
  monthly: { subscriptionId: "sub_pretend", plan: "silver", state: "active", monthlyPence: 1000, firstPaidAt: "2026-05-02T09:30:00.000Z", payments: 7, cancelledAt: null, lapsedAt: null, failedAttempts: 0 },
});
const freshHistory = (): Json => ({
  results: [
    { id: 9, action: "donor.updated", actor: "admin:fern@example.com", at: "2026-11-10T16:05:00.000Z", fields: ["fullName", "email"] },
    { id: 8, action: "declaration.created", actor: "donor", at: "2025-12-24T18:01:00.000Z", fields: [] },
    { id: 7, action: "something.brand_new", actor: "system", at: "2025-12-24T18:00:00.000Z", fields: [] },
  ],
});

let donor: Json;
let giving: Json;
let history: Json;
let perms: PermissionMap | null;
let role: string;
let fail: Record<string, { status: number; body: unknown }>;
let calls: { method: string; path: string; body: unknown }[];
let people: Json[];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  const failing = fail[method + " " + path];
  if (failing) return j(failing.body, failing.status);
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms ?? effectivePermissions({ role: role as "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/search/donors") return j({ results: people });
  if (path === "/api/admin/donors/7" && method === "GET") return j(donor);
  if (path === "/api/admin/donors/7/giving") return j(giving);
  if (path === "/api/admin/donors/7/history") return j(history);
  if (path === "/api/admin/donors/7" && method === "PATCH") {
    Object.assign(donor, body);
    // As the real route: the snapshot alone, with no address and no declaration in it.
    return j(Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, donor[k]])));
  }
  if (path === "/api/admin/donors/7/declaration" && method === "PATCH") {
    donor.declaration = { ...(donor.declaration as Json), ...(body as Json) };
    donor.houseNameNumber = (body as Json).houseNameNumber;
    donor.address = (body as Json).address;
    donor.postcode = (body as Json).postcode;
    return j({ ...donor, outcome: "amended" });
  }
  if (path === "/api/admin/donors/7/subscription/cancel") {
    // The snapshot goes on naming the plan; only the monthly gift's own read knows it has stopped.
    (giving.monthly as Json).state = "cancelled";
    (giving.monthly as Json).cancelledAt = "2026-11-14T16:20:00.000Z";
    return j({ cancelled: true });
  }
  if (path === "/api/admin/donors/7/gift-aid/cancel") {
    donor.declaration = null; // giftAid stays true: a gift of theirs once carried it
    donor.houseNameNumber = null;
    donor.address = null;
    donor.postcode = null;
    return j({ cancelled: true, declarationId: 31 });
  }
  return j({ results: [] });
}

let copied: string[];
let copyWorks: boolean;

beforeEach(() => {
  donor = freshDonor();
  giving = freshGiving();
  history = freshHistory();
  perms = null;
  role = "admin";
  fail = {};
  calls = [];
  copied = [];
  copyWorks = true;
  people = [{ id: 7, donor_type: "individual", full_name: "Rowan Example", business_name: null, email: "rowan@example.com", anonymous: false }];
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => (copyWorks ? (copied.push(t), Promise.resolve()) : Promise.reject(new Error("no"))) },
  });
  // The old page asked in a browser box; the new one asks in the page. Either way the answer is yes.
  window.confirm = () => true;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const part = (name: string) => q(`#donorDetail [data-pp="${name}"]`);
const said = (name: string) => q(`#donorDetail [data-pp-said="${name}"]`) as HTMLElement;
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
/** Opens donor 7 from a button on the Overview, as a recent gift there does. */
async function openDonor() {
  await signIn();
  el("overviewRecent").insertAdjacentHTML("beforeend", '<button type="button" id="pretendGift" data-donor="7">A gift</button>');
  el("pretendGift").click();
  await settle();
}
/** Presses a cancel button and says yes to the question that follows it. */
async function cancel(buttonId: string, yesId: string) {
  el(buttonId).click();
  if (el(yesId)) el(yesId).click();
  await settle();
}
async function save(formId: string) {
  el(formId).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

describe("the faults the audit found", () => {
  it("keeps the address and the Gift Aid form on the page after Save changes", async () => {
    await openDonor();
    (el("edit-fullName") as HTMLInputElement).value = "Rowan Q Example";
    await save("donorEditForm");
    expect(sent("PATCH", "/api/admin/donors/7")).toHaveLength(1);
    expect(text(el("donorDetail"))).toContain("Rowan Q Example");
    expect(text(el("donorDetail"))).toContain("12, Pretend Row, Testtown");
    expect(text(el("donorDetail"))).toContain("KA1 1AA");
    expect(text(el("donorDetail"))).not.toContain("None on file");
    expect(el("donorDeclForm")).not.toBeNull();
  });

  it("keeps them even when the page cannot be read again after the save", async () => {
    await openDonor();
    fail["GET /api/admin/donors/7"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    (el("edit-fullName") as HTMLInputElement).value = "Rowan Q Example";
    await save("donorEditForm");
    expect(text(el("donorDetail"))).toContain("Rowan Q Example");
    expect(text(el("donorDetail"))).toContain("12, Pretend Row, Testtown");
    expect(el("donorDeclForm")).not.toBeNull();
    expect(text(el("view-donor"))).toContain("Saved.");
  });

  it("leaves Monthly donation cancelled. on the page", async () => {
    await openDonor();
    await cancel("cancelSubBtn", "cancelSubYes");
    expect(sent("POST", "/api/admin/donors/7/subscription/cancel")).toHaveLength(1);
    expect(text(el("view-donor"))).toContain("Monthly donation cancelled.");
  });

  it("leaves Gift Aid cancelled. on the page", async () => {
    await openDonor();
    await cancel("cancelGaBtn", "cancelGaYes");
    expect(sent("POST", "/api/admin/donors/7/gift-aid/cancel")).toHaveLength(1);
    expect(text(el("view-donor"))).toContain("Gift Aid cancelled.");
  });

  it("stops offering to cancel Gift Aid, and stops saying it is on, once it has been cancelled", async () => {
    await openDonor();
    expect(el("cancelGaBtn")).not.toBeNull();
    await cancel("cancelGaBtn", "cancelGaYes");
    expect(el("cancelGaBtn")).toBeNull();
    expect(text(el("donorDetail"))).not.toContain("Active");
    expect(qa("#donorMarks .ak-mark").map(text)).not.toContain("Gift Aid");
  });

  it("stops offering to cancel the monthly gift, and says it is cancelled, once it has been", async () => {
    await openDonor();
    expect(el("cancelSubBtn")).not.toBeNull();
    await cancel("cancelSubBtn", "cancelSubYes");
    expect(el("cancelSubBtn")).toBeNull();
    expect(text(part("monthly"))).toContain("Cancelled on 14 November 2026");
    expect(qa("#donorMarks .ak-mark").map(text)).not.toContain("Monthly");
  });

  it("knows the monthly gift is cancelled even if its own read fails straight afterwards", async () => {
    await openDonor();
    el("cancelSubBtn").click();
    fail["GET /api/admin/donors/7/giving"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    el("cancelSubYes").click();
    await settle();
    expect(el("cancelSubBtn")).toBeNull();
    expect(text(part("monthly"))).toContain("Cancelled");
    expect(text(said("sub"))).toBe("Monthly donation cancelled.");
  });

  it("opens a donor whose Gift Aid was cancelled earlier without calling it on", async () => {
    donor.declaration = null;
    await openDonor();
    expect(el("cancelGaBtn")).toBeNull();
    expect(text(part("giftaid"))).toContain("Off");
    expect(text(part("giftaid"))).toContain("given with Gift Aid");
    expect(qa("#donorMarks .ak-mark").map(text)).not.toContain("Gift Aid");
  });
});

describe("the title", () => {
  it("is their name, with a mark for each thing that is true of them", async () => {
    donor.anonymous = true;
    await openDonor();
    expect(text(el("donor-heading"))).toBe("Rowan Example");
    expect(qa("#donorMarks .ak-mark").map(text)).toEqual(["Monthly", "Gift Aid", "Anonymous"]);
  });

  it("has no marks for someone who gives now and then, without Gift Aid, by name", async () => {
    donor.subscriptionPlan = null;
    donor.subscriptionId = null;
    donor.giftAid = false;
    donor.declaration = null;
    giving.monthly = null;
    await openDonor();
    expect(qa("#donorMarks .ak-mark")).toHaveLength(0);
  });

  it("goes back to Donor while the next one loads, so it never names the wrong person", async () => {
    await openDonor();
    fail["GET /api/admin/donors/7"] = { status: 404, body: { error: "Donor not found" } };
    el("pretendGift").click();
    await settle();
    expect(text(el("donor-heading"))).toBe("Donor");
    expect(qa("#donorMarks .ak-mark")).toHaveLength(0);
    expect(text(el("donorDetail"))).toContain("Donor not found.");
  });

  it("opens with one plain sentence saying what the page is for", () => {
    expect(text(q("#view-donor .admin-view-intro")).length).toBeGreaterThan(40);
  });
});

describe("who they are", () => {
  it("says everything the old page said, in plainer words", async () => {
    await openDonor();
    const who = text(part("who"));
    for (const words of ["Name", "Rowan Example", "Email", "rowan@example.com", "Agreed to emails", "Anonymous on the public page", "Hidden from the supporters wall", "Address", "12, Pretend Row, Testtown", "Postcode", "KA1 1AA"]) {
      expect(who, words).toContain(words);
    }
    expect(text(part("monthly"))).toContain("Silver");
    expect(text(part("giftaid"))).toContain("On");
  });

  it("says None on file for an email or an address we do not hold", async () => {
    donor.email = null;
    donor.houseNameNumber = null;
    donor.address = null;
    donor.postcode = null;
    donor.declaration = null;
    await openDonor();
    expect(text(part("who")).match(/None on file/g)).toHaveLength(3);
    expect(el("donorCopyEmail")).toBeNull();
    expect(el("donorCopyAddress")).toBeNull();
  });

  it("makes the email address a link that starts an email", async () => {
    await openDonor();
    expect(q("#donorDetail a#donorEmailLink")!.getAttribute("href")).toBe("mailto:rowan@example.com");
  });

  it("copies the email address, and says so beside the button", async () => {
    await openDonor();
    el("donorCopyEmail").click();
    await settle();
    expect(copied).toEqual(["rowan@example.com"]);
    expect(text(said("copy"))).toBe("Email address copied.");
    expect(said("copy").classList.contains("is-ok")).toBe(true);
  });

  it("copies the address as it would go on an envelope", async () => {
    await openDonor();
    el("donorCopyAddress").click();
    await settle();
    expect(copied).toEqual(["12, Pretend Row, Testtown\nKA1 1AA"]);
    expect(text(said("copy"))).toBe("Address copied.");
  });

  it("says so when the browser will not copy, rather than saying nothing", async () => {
    copyWorks = false;
    await openDonor();
    el("donorCopyEmail").click();
    await settle();
    expect(text(said("copy"))).toBe("Could not copy. Select it and copy by hand.");
    expect(said("copy").classList.contains("is-error")).toBe(true);
  });

  it("shows a name or an address typed with markup in it as words", async () => {
    donor.fullName = '<img src=x onerror="window.hacked=1">';
    donor.address = "<b>Pretend</b> Row";
    await openDonor();
    expect(q("#view-donor img")).toBeNull();
    expect(q("#donorDetail b")).toBeNull();
    expect(text(el("donor-heading"))).toBe('<img src=x onerror="window.hacked=1">');
  });
});

describe("the monthly gift", () => {
  it("says what they give, since when, and that it is still running", async () => {
    await openDonor();
    const m = text(part("monthly"));
    expect(m).toContain("£10 a month");
    expect(m).toContain("since 2 May 2026");
    expect(m).toContain("Giving");
  });

  it("says None, with nothing to cancel, for someone with no monthly gift", async () => {
    donor.subscriptionPlan = null;
    donor.subscriptionId = null;
    giving.monthly = null;
    await openDonor();
    expect(text(part("monthly"))).toContain("None");
    expect(el("cancelSubBtn")).toBeNull();
  });

  it.each([
    ["past_due", { failedAttempts: 2 }, "payment did not go through"],
    ["lapsed", { lapsedAt: "2026-10-03T07:00:00.000Z" }, "Stopped on 3 October 2026"],
    ["unknown", {}, "Giving"],
  ])("puts the state %s in plain words, never the stored one", async (state, over, words) => {
    Object.assign(giving.monthly as Json, { state, ...over });
    await openDonor();
    expect(text(part("monthly"))).toContain(words);
    expect(text(part("monthly"))).not.toContain("past_due");
    expect(text(part("monthly"))).not.toContain("lapsed");
    expect(text(part("monthly"))).not.toContain("unknown");
  });

  it("says it could not check, and still lets it be cancelled, when the monthly gift cannot be read", async () => {
    fail["GET /api/admin/donors/7/giving"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openDonor();
    expect(text(part("monthly"))).toContain("Silver");
    expect(text(part("monthly"))).toContain("could not check whether it is still running");
    expect(el("cancelSubBtn")).not.toBeNull();
  });
});

describe("the two cancel buttons", () => {
  it("each say underneath what they do, and that it cannot be undone", async () => {
    await openDonor();
    const sub = text(part("monthly").querySelector(".ak-says"));
    const ga = text(part("giftaid").querySelector(".ak-says"));
    expect(sub).toContain("no more payments are taken");
    expect(sub).toContain("cannot be undone");
    expect(ga).toContain("Gift Aid declaration");
    expect(ga).toContain("cannot be undone");
  });

  it("ask first, in the page, naming the donor, and do nothing until the answer is yes", async () => {
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    await openDonor();
    expect(el("cancelSubAsk").hidden).toBe(true);
    el("cancelSubBtn").click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(el("cancelSubAsk").hidden).toBe(false);
    expect(text(el("cancelSubAsk"))).toContain("Rowan Example");
    expect(sent("POST", "/api/admin/donors/7/subscription/cancel")).toHaveLength(0);
    expect(document.activeElement).toBe(el("cancelSubNo"));
  });

  it("put everything back, having done nothing, when the answer is no", async () => {
    await openDonor();
    el("cancelGaBtn").click();
    el("cancelGaNo").click();
    await settle();
    expect(el("cancelGaAsk").hidden).toBe(true);
    expect(el("cancelGaBtn").hidden).toBe(false);
    expect(sent("POST", "/api/admin/donors/7/gift-aid/cancel")).toHaveLength(0);
    expect(document.activeElement).toBe(el("cancelGaBtn"));
  });

  it("send the monthly gift's own subscription, with the acknowledgement the server asks for", async () => {
    await openDonor();
    await cancel("cancelSubBtn", "cancelSubYes");
    expect(sent("POST", "/api/admin/donors/7/subscription/cancel")[0].body).toEqual({ subscriptionId: "sub_pretend", accepted: "cancel" });
  });

  it("say beside the button when it did not work, and leave the button there to try again", async () => {
    fail["POST /api/admin/donors/7/subscription/cancel"] = { status: 502, body: { error: "Cancellation is temporarily unavailable" } };
    fail["POST /api/admin/donors/7/gift-aid/cancel"] = { status: 500, body: { error: "Gift Aid cancellation is temporarily unavailable" } };
    await openDonor();
    await cancel("cancelSubBtn", "cancelSubYes");
    expect(text(said("sub"))).toBe("Could not cancel the monthly donation.");
    expect(said("sub").classList.contains("is-error")).toBe(true);
    expect(el("cancelSubBtn").hidden).toBe(false);
    await cancel("cancelGaBtn", "cancelGaYes");
    expect(text(said("ga"))).toBe("Could not cancel Gift Aid.");
    expect(said("ga").classList.contains("is-error")).toBe(true);
    // The first message is still there: one button's news never wipes another's.
    expect(text(said("sub"))).toBe("Could not cancel the monthly donation.");
  });

  it("cannot be sent twice by pressing yes twice", async () => {
    await openDonor();
    el("cancelGaBtn").click();
    el("cancelGaYes").click();
    el("cancelGaYes").click();
    await settle();
    expect(sent("POST", "/api/admin/donors/7/gift-aid/cancel")).toHaveLength(1);
  });
});

describe("changing their details", () => {
  it("sends what the form holds, and says Saved. beside the button, where it stays", async () => {
    await openDonor();
    (el("edit-email") as HTMLInputElement).value = "rowan.new@example.com";
    (el("edit-anonymous") as HTMLInputElement).checked = true;
    await save("donorEditForm");
    expect(sent("PATCH", "/api/admin/donors/7")[0].body).toEqual({
      fullName: "Rowan Example", email: "rowan.new@example.com", emailConsent: true, anonymous: true, hiddenFromSupporters: false,
    });
    expect(text(said("edit"))).toBe("Saved.");
    expect(said("edit").classList.contains("is-ok")).toBe(true);
    expect(said("edit").closest("form")).toBe(el("donorEditForm"));
    expect(text(el("donor-heading"))).toBe("Rowan Example");
    expect(qa("#donorMarks .ak-mark").map(text)).toContain("Anonymous");
  });

  it("leaves the form open after a save, so the message is not folded away", async () => {
    await openDonor();
    (el("donorEditFold") as HTMLDetailsElement).open = true;
    await save("donorEditForm");
    expect((el("donorEditFold") as HTMLDetailsElement).open).toBe(true);
  });

  it("says what to check when the server will not take the changes", async () => {
    fail["PATCH /api/admin/donors/7"] = { status: 400, body: { error: "Invalid donor update", details: {} } };
    await openDonor();
    (el("edit-email") as HTMLInputElement).value = "not-an-address";
    await save("donorEditForm");
    expect(text(said("edit"))).toBe("Could not save the changes. Check the name is filled in and the email address is a real one.");
    expect(said("edit").classList.contains("is-error")).toBe(true);
    // What was typed is still in the box to put right.
    expect((el("edit-email") as HTMLInputElement).value).toBe("not-an-address");
  });

  it("says it could not save when the server is away", async () => {
    fail["PATCH /api/admin/donors/7"] = { status: 500, body: { error: "Admin update is temporarily unavailable" } };
    await openDonor();
    await save("donorEditForm");
    expect(text(said("edit"))).toBe("Could not save the changes.");
  });

  it("saves the Gift Aid declaration's details and says so beside that button", async () => {
    await openDonor();
    (el("edit-declAddress") as HTMLInputElement).value = "New Road, Testtown";
    await save("donorDeclForm");
    expect(sent("PATCH", "/api/admin/donors/7/declaration")[0].body).toEqual({
      title: "Mx", firstName: "Rowan", lastName: "Example", houseNameNumber: "12", address: "New Road, Testtown", nonUk: false, postcode: "KA1 1AA",
    });
    expect(text(said("decl"))).toBe("Declaration details saved.");
    expect(said("decl").closest("form")).toBe(el("donorDeclForm"));
    expect(text(part("who"))).toContain("12, New Road, Testtown");
  });

  it("says when the declaration details could not be saved", async () => {
    fail["PATCH /api/admin/donors/7/declaration"] = { status: 400, body: { error: "Invalid declaration update" } };
    await openDonor();
    await save("donorDeclForm");
    expect(text(said("decl"))).toBe("Could not save the declaration details.");
    expect(said("decl").classList.contains("is-error")).toBe(true);
  });

  it("keeps what is being typed in one form when another button redraws the page", async () => {
    await openDonor();
    (el("edit-fullName") as HTMLInputElement).value = "Rowan Half Typed";
    await cancel("cancelSubBtn", "cancelSubYes");
    expect((el("edit-fullName") as HTMLInputElement).value).toBe("Rowan Half Typed");
  });

  it("has no Gift Aid declaration form for a donor with no declaration", async () => {
    donor.declaration = null;
    await openDonor();
    expect(el("donorEditForm")).not.toBeNull();
    expect(el("donorDeclForm")).toBeNull();
  });

  it("gives someone who may only look no forms and no cancel buttons, but everything to read", async () => {
    role = "viewer";
    await openDonor();
    expect(text(part("who"))).toContain("Rowan Example");
    expect(text(part("monthly"))).toContain("£10 a month");
    for (const id of ["donorEditForm", "donorDeclForm", "cancelSubBtn", "cancelGaBtn", "cancelSubYes", "cancelGaYes"]) {
      expect(el(id), id).toBeNull();
    }
    expect(q("#donorDetail .ak-says")).toBeNull();
  });
});

describe("their giving", () => {
  it("leads with the total, how many gifts, the first and the latest", async () => {
    await openDonor();
    const tiles = qa("#donorDetail .pp-sums .ak-tile").map((t) => [text(t.querySelector(".ak-tile__n")), text(t.querySelector(".ak-tile__name"))]);
    expect(tiles).toEqual([["£65", "Given in all"], ["3", "Gifts paid"], ["24 December 2025", "First gift"], ["2 November 2026", "Latest gift"]]);
  });

  it("shows every gift as a card: the amount, the day, one off or monthly, Gift Aid, and how the payment went", async () => {
    await openDonor();
    const cards = qa("#donorDetail .pp-gift").map((c) => ({
      amount: text(c.querySelector(".pp-gift__amount")),
      when: text(c.querySelector(".pp-gift__when")),
      marks: Array.from(c.querySelectorAll(".ak-mark, .admin-pill")).map(text),
    }));
    expect(cards).toEqual([
      { amount: "£10", when: "2 November 2026", marks: ["Paid", "Monthly", "Gift Aid"] },
      { amount: "£10", when: "2 October 2026", marks: ["Failed", "Monthly", "Gift Aid"] },
      { amount: "£50", when: "14 March 2026", marks: ["Partly refunded", "One off", "Red Bag"] },
      { amount: "£10", when: "24 December 2025", marks: ["Paid", "One off", "Gift Aid"] },
    ]);
    expect(text(qa("#donorDetail .pp-gift")[2])).toContain("£5 refunded");
  });

  it("says they have not given yet, with no figures made up", async () => {
    giving = { totalPence: 0, count: 0, listed: 0, firstAt: null, latestAt: null, gifts: [], monthly: null };
    donor.subscriptionPlan = null;
    donor.subscriptionId = null;
    await openDonor();
    expect(text(part("gifts"))).toContain("No gifts on record yet.");
    expect(qa("#donorDetail .pp-sums .ak-tile").map((t) => text(t.querySelector(".ak-tile__n")))).toEqual(["£0", "0", "None yet", "None yet"]);
  });

  it("says their giving could not be loaded, and shows no figures at all, when the read fails", async () => {
    fail["GET /api/admin/donors/7/giving"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openDonor();
    expect(text(part("gifts"))).toContain("Their giving could not be loaded. Please try again.");
    expect(q("#donorDetail .pp-sums")).toBeNull();
    expect(text(el("donorDetail"))).not.toContain("£0");
    // The rest of the page is still there.
    expect(text(part("who"))).toContain("Rowan Example");
  });

  it("shows the newest twelve of a long list, and the rest when asked", async () => {
    giving.gifts = Array.from({ length: 30 }, (_, i) => gift({ id: 500 - i, date: new Date(Date.UTC(2026, 10, 1) - i * 30 * 864e5).toISOString() }));
    giving.count = 30;
    giving.listed = 30;
    await openDonor();
    expect(qa("#donorDetail .pp-gift")).toHaveLength(12);
    expect(text(el("donorMoreGifts"))).toBe("Show all 30 gifts");
    el("donorMoreGifts").click();
    await settle();
    expect(qa("#donorDetail .pp-gift")).toHaveLength(30);
    expect(el("donorMoreGifts")).toBeNull();
  });

  it("says when there are more gifts than the page was sent", async () => {
    giving.gifts = Array.from({ length: 200 }, (_, i) => gift({ id: 900 - i }));
    giving.listed = 260;
    await openDonor();
    el("donorMoreGifts").click();
    await settle();
    expect(text(part("gifts"))).toContain("These are the newest 200 of 260 gifts.");
  });
});

describe("what has changed", () => {
  it("lists who did what and when, in plain words", async () => {
    await openDonor();
    const lines = qa("#donorDetail .pp-change").map(text);
    expect(lines[0]).toContain("Details changed: name, email");
    expect(lines[0]).toContain("fern@example.com");
    expect(lines[0]).toContain("10 November 2026");
    expect(lines[1]).toContain("Gift Aid declaration made");
    expect(lines[1]).toContain("the donor");
  });

  it("puts a kind of change it has no words for into words, never the stored name", async () => {
    await openDonor();
    const last = qa("#donorDetail .pp-change").map(text)[2];
    expect(last).toContain("Something brand new");
    expect(last).not.toContain("something.brand_new");
    expect(last).toContain("an automatic job");
  });

  it("says nothing has been recorded, or that it could not be loaded", async () => {
    history = { results: [] };
    await openDonor();
    expect(text(part("history"))).toContain("Nothing recorded yet.");
    fail["GET /api/admin/donors/7/history"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    el("pretendGift").click();
    await settle();
    expect(text(part("history"))).toContain("Could not load what has changed.");
  });
});

describe("Back", () => {
  it("goes to the screen you came from, and says which", async () => {
    await openDonor();
    expect(text(el("donorBack"))).toContain("Back to Overview");
    el("donorBack").click();
    await settle();
    expect(el("view-overview").hidden).toBe(false);
    expect(el("view-donor").hidden).toBe(true);
  });

  it("goes back to Search with its results still there", async () => {
    await signIn();
    q('.admin-nav-link[data-view="search"]')!.click();
    (el("searchQuery") as HTMLInputElement).value = "rowan";
    el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    q('#searchResults [data-donor="7"]')!.click();
    await settle();
    expect(el("view-donor").hidden).toBe(false);
    expect(text(el("donorBack"))).toContain("Back to Search");
    const searches = calls.filter((c) => c.path.startsWith("/api/admin/search/")).length;
    el("donorBack").click();
    await settle();
    expect(el("view-search").hidden).toBe(false);
    expect(text(el("searchResults"))).toContain("Rowan Example");
    expect((el("searchQuery") as HTMLInputElement).value).toBe("rowan");
    // Nothing was changed on the donor, so nothing is asked for again.
    expect(calls.filter((c) => c.path.startsWith("/api/admin/search/")).length).toBe(searches);
  });

  it("goes to Donations when the page was opened from nowhere it knows", async () => {
    await signIn();
    q('.admin-nav-link[data-view="donations"]')!.click();
    await settle();
    el("donationsTable").insertAdjacentHTML("beforeend", '<button type="button" id="pretendOpen" data-donor="7">Open the donor</button>');
    el("pretendOpen").click();
    await settle();
    expect(text(el("donorBack"))).toContain("Back to Donations");
    el("donorBack").click();
    await settle();
    expect(el("view-donations").hidden).toBe(false);
  });
});

describe("when the page cannot open", () => {
  it("tells someone without Donations that it is not part of their access, not to try again", async () => {
    fail["GET /api/admin/donors/7"] = { status: 403, body: { error: "Forbidden" } };
    await openDonor();
    expect(text(el("donorDetail"))).toContain("Opening a donor is not part of your access.");
    expect(text(el("donorDetail"))).not.toContain("Please try again");
  });

  it("still says could not load for a failure, and not found for a donor who is not there", async () => {
    fail["GET /api/admin/donors/7"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openDonor();
    expect(text(el("donorDetail"))).toContain("Could not load this donor. Please try again.");
    fail["GET /api/admin/donors/7"] = { status: 404, body: { error: "Donor not found" } };
    el("pretendGift").click();
    await settle();
    expect(text(el("donorDetail"))).toContain("Donor not found.");
  });

  it("starts each donor with a clean page: no message left from the last one", async () => {
    await openDonor();
    await save("donorEditForm");
    expect(text(said("edit"))).toBe("Saved.");
    el("pretendGift").click();
    await settle();
    expect(text(said("edit"))).toBe("");
    expect((el("donorEditFold") as HTMLDetailsElement).open).toBe(false);
  });

  it("never uses a browser alert or question box", () => {
    const start = appSrc.indexOf("// ---- donor detail");
    const end = appSrc.indexOf("// ---- thank-you letters");
    expect(start).toBeGreaterThan(-1);
    const block = appSrc.slice(start, end);
    expect(block).not.toContain("window.confirm");
    expect(block).not.toContain("alert(");
    expect(block).not.toContain(".catch(function () {})");
  });
});
