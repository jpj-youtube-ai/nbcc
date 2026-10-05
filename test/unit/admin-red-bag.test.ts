// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Fill a Red Bag in the admin: the totals at the top of the Donations screen, the Red Bag label on
// a gift wherever the donations table is drawn, and the "Fill a Red Bag only" filter. The real
// admin.html and app.js in jsdom against a mocked fetch, as admin-app.test.ts does it; kept in a
// file of its own so it does not collide with that one. Every name and figure is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const gift = (over: Record<string, unknown>) => ({
  id: 11, donor_id: 5, donor_name: "Ada Test", mode: "once", plan: null, amount_pence: 2500,
  currency: "GBP", gift_aid: false, claim_status: "not_eligible", payment_status: "paid",
  refunded_amount_pence: 0, payment_channel: "online", created_at: "2026-10-05T10:00:00Z", source: null, ...over,
});
const RED = gift({ id: 21, donor_id: 8, donor_name: "Bea Sample", mode: "monthly", source: "red_bag" });
const PLAIN = gift({ id: 20 });
const TOTALS = {
  totals: {},
  lines: [
    { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
    { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
  ],
  note: "Fill a Red Bag gifts are counted from 5 October 2026.",
};

let rows: Array<ReturnType<typeof gift>> = [];
let totalsAnswer: { status: number; body: unknown } = { status: 200, body: TOTALS };
let listUrls: string[] = [];
let totalsAsked = 0;

function respond(url: string, init?: { headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (url.includes("/api/admin/login")) {
    return j({ token: signAdminSession({ sub: 3, email: "viewer@nbcc", role: "viewer", now: new Date(), secret: "s" }).token });
  }
  if (url.includes("/api/admin/me")) {
    const claims = helpers.parseClaims((init?.headers?.Authorization || "").replace(/^Bearer\s+/, "")) as { role?: string } | null;
    return j({ email: "viewer@nbcc", permissions: effectivePermissions({ role: claims?.role || "viewer", permissions: null }) });
  }
  if (url.includes("/api/admin/donations/source-totals")) {
    totalsAsked += 1;
    return j(totalsAnswer.body, totalsAnswer.status);
  }
  if (url.includes("/api/admin/search/donations")) return j({ results: rows });
  if (url.includes("/api/admin/donations")) {
    listUrls.push(url);
    // The server's own filter, so the screen is shown what it would really be sent.
    const only = new URL(url, "https://nbcc.scot").searchParams.get("source") === "red_bag";
    const shown = only ? rows.filter((r) => r.source === "red_bag") : rows;
    return j({ results: shown, total: shown.length });
  }
  if (url.includes("/api/admin/overview")) return j({ updatedAt: "2026-10-05T08:41:00.000Z", needs: [], numbers: [], failed: [] });
  if (url.includes("/api/admin/whats-new")) return j({ areas: [] });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await flush(); };
const el = (id: string) => document.getElementById(id) as HTMLElement;

async function openDonations() {
  (el("adminEmail") as HTMLInputElement).value = "viewer@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
  await settle();
}
const filter = () => el("donationsRedBagFilter") as HTMLInputElement;
const tick = async (on: boolean) => {
  filter().checked = on;
  filter().dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
};
const pillsIn = (host: string) =>
  Array.from(document.querySelectorAll(host + " .dn-table tbody tr")).map((tr) => tr.querySelector(".dn-source-pill")?.textContent ?? null);

beforeEach(() => {
  rows = [RED, PLAIN];
  totalsAnswer = { status: 200, body: TOTALS };
  listUrls = [];
  totalsAsked = 0;
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { headers?: Record<string, string> })),
  );
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the totals at the top of the Donations screen", () => {
  it("sits above the filters and the list", async () => {
    await openDonations();
    const box = el("donationsSources");
    expect(box.closest("#view-donations")).not.toBeNull();
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(el("donations-heading"), box)).toBe(true);
    expect(before(box, el("donationsPaymentFilter"))).toBe(true);
    expect(before(box, el("donationsTable"))).toBe(true);
  });

  it("says each line in words: this month and in all", async () => {
    await openDonations();
    const lines = Array.from(document.querySelectorAll("#donationsSources .dn-source")).map((d) => [
      d.querySelector("dt")?.textContent,
      d.querySelector("dd")?.textContent,
    ]);
    expect(lines).toEqual([
      ["Fill a Red Bag", "£412 from 19 gifts this month, £1,960 from 87 gifts in all"],
      ["Donate page", "£2,130 from 64 gifts this month, £31,400 from 902 gifts in all"],
    ]);
    // Text a screen reader can read: no pictures, and no dashes in the wording.
    expect(document.querySelector("#donationsSources img, #donationsSources svg")).toBeNull();
    expect(el("donationsSources").textContent).not.toMatch(/[–—]/);
  });

  it("says when Fill a Red Bag gifts are counted from", async () => {
    await openDonations();
    expect(document.querySelector("#donationsSources .dn-sources-note")?.textContent).toBe(
      "Fill a Red Bag gifts are counted from 5 October 2026.",
    );
  });

  it("shows a real zero as the server words it", async () => {
    totalsAnswer.body = { ...TOTALS, lines: [{ ...TOTALS.lines[0], month: "£0 from 0 gifts", all: "£0 from 0 gifts" }, TOTALS.lines[1]] };
    await openDonations();
    expect(document.querySelector("#donationsSources .dn-source dd")?.textContent).toBe("£0 from 0 gifts this month, £0 from 0 gifts in all");
    expect(document.querySelector("#donationsSources .admin-unavailable")).toBeNull();
  });

  it("says it could not load when the read fails, never a zero, and the list still works", async () => {
    totalsAnswer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openDonations();
    const box = el("donationsSources");
    expect(box.querySelector(".admin-unavailable")?.textContent).toBe("The Fill a Red Bag and Donate page totals could not load.");
    expect(box.textContent).not.toMatch(/£|0 gifts/);
    expect(box.querySelector(".dn-source")).toBeNull();
    expect(document.querySelectorAll("#donationsTable .dn-table tbody tr")).toHaveLength(2);
    await tick(true);
    expect(document.querySelectorAll("#donationsTable .dn-table tbody tr")).toHaveLength(1);
  });

  it("treats an answer with no lines in it as a failure, not as nothing given", async () => {
    totalsAnswer.body = { results: [], total: 0 };
    await openDonations();
    expect(el("donationsSources").querySelector(".admin-unavailable")).not.toBeNull();
  });

  it("does not keep old figures on show once they can no longer be read", async () => {
    await openDonations();
    expect(document.querySelectorAll("#donationsSources .dn-source")).toHaveLength(2);
    totalsAnswer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    (document.querySelector('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    (document.querySelector('.admin-nav-link[data-view="donations"]') as HTMLElement).click();
    await settle();
    expect(document.querySelectorAll("#donationsSources .dn-source")).toHaveLength(0);
    expect(el("donationsSources").querySelector(".admin-unavailable")).not.toBeNull();
  });

  it("is read when the screen opens, not again for every filter or page", async () => {
    await openDonations();
    expect(totalsAsked).toBe(1);
    await tick(true);
    await tick(false);
    expect(totalsAsked).toBe(1);
  });

  it("escapes what it is given", async () => {
    totalsAnswer.body = { ...TOTALS, lines: [{ ...TOTALS.lines[0], name: "<img src=x onerror=alert(1)>" }], note: "<b>note</b>" };
    await openDonations();
    expect(document.querySelector("#donationsSources img, #donationsSources b")).toBeNull();
  });
});

describe("the Red Bag label on a gift", () => {
  it("marks only the gift started on Fill a Red Bag, in the Donations list", async () => {
    await openDonations();
    expect(pillsIn("#donationsTable")).toEqual(["Red Bag", null]);
  });

  it("sits beside the gift, in the Donation cell, so it rides with it when the list becomes cards", async () => {
    await openDonations();
    const cell = document.querySelector('#donationsTable .dn-table tbody tr td[data-label="Donation"]') as HTMLElement;
    expect(cell.textContent).toBe("monthly Red Bag");
    const pill = cell.querySelector(".dn-source-pill") as HTMLElement;
    // The admin's own pill, with no colours of its own.
    expect(pill.classList.contains("admin-pill")).toBe(true);
    expect(css).not.toMatch(/\.dn-source-pill[^{]*\{[^}]*(color|background)/);
  });

  it("is on the Overview's recent donations too", async () => {
    (el("adminEmail") as HTMLInputElement).value = "viewer@nbcc";
    (el("adminPassword") as HTMLInputElement).value = "pw";
    el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(pillsIn("#overviewRecent")).toEqual(["Red Bag", null]);
  });

  it("is on donation search results too", async () => {
    await openDonations();
    (document.querySelector('.admin-nav-link[data-view="search"]') as HTMLElement).click();
    (document.querySelector('.admin-seg[data-kind="donations"]') as HTMLElement).click();
    (el("searchQuery") as HTMLInputElement).value = "Sample";
    el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(pillsIn("#searchResults")).toEqual(["Red Bag", null]);
  });

  it("is not shown for a source it does not know, or for none", async () => {
    rows = [gift({ id: 30, source: "something_else" }), gift({ id: 31, source: undefined })];
    await openDonations();
    expect(pillsIn("#donationsTable")).toEqual([null, null]);
  });
});

describe("the Fill a Red Bag only filter", () => {
  it("is a real tick box with its own label, beside the other filters", async () => {
    await openDonations();
    expect(filter().type).toBe("checkbox");
    const label = document.querySelector('label[for="donationsRedBagFilter"]') as HTMLElement;
    expect(label.textContent?.trim()).toBe("Fill a Red Bag only");
    expect(label.classList.contains("admin-inline-filter")).toBe(true);
    expect(label.parentElement).toBe((document.querySelector('label[for="donationsModeFilter"]') as HTMLElement).parentElement);
    expect(filter().checked).toBe(false);
  });

  it("asks the server for Fill a Red Bag gifts only, and shows what comes back", async () => {
    await openDonations();
    expect(listUrls[listUrls.length - 1]).not.toContain("source=");
    await tick(true);
    expect(listUrls[listUrls.length - 1]).toContain("&source=red_bag");
    expect(pillsIn("#donationsTable")).toEqual(["Red Bag"]);
  });

  it("works together with the payment status and type filters", async () => {
    await openDonations();
    (el("donationsPaymentFilter") as HTMLSelectElement).value = "paid";
    (el("donationsModeFilter") as HTMLSelectElement).value = "monthly";
    await tick(true);
    const url = listUrls[listUrls.length - 1];
    expect(url).toContain("paymentStatus=paid");
    expect(url).toContain("mode=monthly");
    expect(url).toContain("source=red_bag");
  });

  it("goes back to the first page when it changes", async () => {
    rows = Array.from({ length: 30 }, (_, i) => gift({ id: 100 + i }));
    await openDonations();
    el("donationsNext").click();
    await settle();
    expect(listUrls[listUrls.length - 1]).toContain("offset=25");
    await tick(true);
    expect(listUrls[listUrls.length - 1]).toContain("offset=0");
  });

  it("gives the whole list back when it is cleared", async () => {
    await openDonations();
    await tick(true);
    await tick(false);
    expect(listUrls[listUrls.length - 1]).not.toContain("source=");
    expect(pillsIn("#donationsTable")).toEqual(["Red Bag", null]);
  });

  it("says plainly when there are no Fill a Red Bag gifts yet", async () => {
    rows = [PLAIN];
    await openDonations();
    await tick(true);
    expect(el("donationsTable").textContent).toBe("No Fill a Red Bag gifts yet.");
  });

  it("says so differently when another filter is what left it empty", async () => {
    rows = [PLAIN];
    await openDonations();
    (el("donationsPaymentFilter") as HTMLSelectElement).value = "failed";
    await tick(true);
    expect(el("donationsTable").textContent).toBe("No Fill a Red Bag gifts match these filters.");
  });

  it("leaves the ordinary empty wording alone", async () => {
    rows = [];
    await openDonations();
    expect(el("donationsTable").textContent).toBe("No donations yet.");
  });
});

describe("how it sits on the page", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(selector + "{");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
  };

  it("lets the totals wrap rather than scroll: no box of its own to scroll inside", () => {
    expect(rule(".dn-sources")).not.toBe("");
    expect(css.slice(css.indexOf(".dn-sources{"), css.indexOf("/* end Fill a Red Bag */"))).not.toMatch(/overflow(-x|-y)?:\s*(auto|scroll)|white-space:\s*nowrap/);
    expect(rule(".dn-source dd")).toMatch(/overflow-wrap:anywhere/);
  });

  it("adds no colours or fonts of its own: tokens only", () => {
    const block = css.slice(css.indexOf(".dn-sources{"), css.indexOf("/* end Fill a Red Bag */"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|font-family/i);
  });
});
