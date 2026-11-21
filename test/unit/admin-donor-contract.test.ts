// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: one donor's page and Search fed what the REAL server sends. The route handlers in
// src/routes/admin.ts run for real, with every query they make (src/db/portal.ts, src/db/admin.ts,
// src/db/donor-page.ts) answered by invented rows in the tables' own shape (helpers/real-rows.ts).
// Only the database is pretend. admin-donor-page.test.ts and the search tests answer by hand.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { donorRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, qa, text } from "./helpers/admin-settings-harness";
import {
  getAdminDonor, getAdminDonorGiving, getAdminDonorHistory, getAdminSearchDonors, getAdminSearchDeclarations, getAdminSearchDonations,
} from "../../src/routes/admin";

vi.setConfig({ testTimeout: 30_000 });

const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  const get = async (key: string, handler: Parameters<typeof callRoute>[0], opts: Parameters<typeof callRoute>[1]) => {
    db.answer(donorRows());
    real[key] = await callRoute(handler, opts);
  };
  const donor = { params: { id: "7" } };
  await get("GET /api/admin/donors/7", getAdminDonor, donor);
  await get("GET /api/admin/donors/7/giving", getAdminDonorGiving, donor);
  await get("GET /api/admin/donors/7/history", getAdminDonorHistory, donor);
  const asked = { query: { q: "Rowan" } };
  await get("GET /api/admin/search/donors", getAdminSearchDonors, asked);
  await get("GET /api/admin/search/declarations", getAdminSearchDeclarations, asked);
  await get("GET /api/admin/search/donations", getAdminSearchDonations, asked);

  db.answer([...donorRows().filter(([m]) => m !== "AS paid_count"), down("AS paid_count")]);
  broken["GET /api/admin/donors/7/giving"] = await callRoute(getAdminDonorGiving, donor);
  db.answer([down("dn.business_name, dn.email, dn.anonymous")]);
  broken["GET /api/admin/search/donors"] = await callRoute(getAdminSearchDonors, asked);
});

async function openDonor(replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  el("overviewRecent").insertAdjacentHTML("beforeend", '<button type="button" id="pretendGift" data-donor="7">A gift</button>');
  el("pretendGift").click();
  await admin.settle(12);
  return admin;
}
async function search(replies: Record<string, Reply>, words: string) {
  const admin = mountAdmin({ role: "admin" }, replyWith(replies));
  await admin.signIn();
  await admin.open("search");
  (el("searchQuery") as HTMLInputElement).value = words;
  el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await admin.settle(12);
  return admin;
}
const part = (name: string) => q(`#donorDetail [data-pp="${name}"]`);
const found = (kind: string) => q(`#searchResults [data-found="${kind}"]`);
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]|null/;

describe("one donor's page with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    for (const r of Object.values(broken)) expect(r.status).toBe(500);
  });

  it("names them and shows their details, address and Gift Aid", async () => {
    await openDonor(real);
    const page = text(el("donorDetail"));
    for (const s of ["Rowan Example", "rowan@example.com", "Pretend Row, Testtown", "KA1 1AA"]) expect(page).toContain(s);
    expect(page).not.toMatch(NOTHING_MADE_UP);
  });

  it("leads with what they have given, then each gift", async () => {
    await openDonor(real);
    const tiles = qa("#donorDetail .pp-sums .ak-tile").map((t) => [text(t.querySelector(".ak-tile__n")), text(t.querySelector(".ak-tile__name"))]);
    expect(tiles).toEqual([["£55", "Given in all"], ["2", "Gifts paid"], ["24 December 2025", "First gift"], ["2 November 2026", "Latest gift"]]);
    const cards = qa("#donorDetail .pp-gift").map((c) => text(c));
    expect(cards).toHaveLength(3);
    expect(cards[1]).toContain("Failed");
    expect(cards[2]).toContain("£5 refunded");
    expect(cards[2]).toContain("Red Bag");
  });

  it("says what their monthly gift is and that it is still running", async () => {
    await openDonor(real);
    const page = text(el("donorDetail"));
    expect(page).toContain("£10");
    expect(page).toContain("2 May 2026");
  });

  it("lists what has changed in plain words, and never an audit row's own data", async () => {
    await openDonor(real);
    const page = text(el("donorDetail"));
    expect(page).toContain("Details changed");
    expect(page).toContain("Gift Aid declaration made");
    expect(document.body.innerHTML).not.toContain("pretend-secret-never-shown");
  });

  it("says their giving could not be loaded when that read fails, and keeps the rest", async () => {
    await openDonor({ ...real, ...broken });
    expect(text(part("gifts"))).toContain("Their giving could not be loaded. Please try again.");
    expect(text(el("donorDetail"))).toContain("Rowan Example");
  });
});

describe("Search with the real server's answers", () => {
  it("draws people, declarations and donations from the real rows", async () => {
    await search(real, "Rowan");
    const people = text(found("donors"));
    for (const s of ["Rowan Example", "rowan@example.com", "Pretend Bakery Ltd", "Contact: Robin Contact", "No email address", "Business", "Anonymous"]) {
      expect(people).toContain(s);
    }
    const declarations = text(found("declarations"));
    for (const s of ["KA1 1AA", "Covers all their gifts", "In force", "No UK postcode", "Covers one gift only", "Ended on 1 June 2025"]) {
      expect(declarations).toContain(s);
    }
    const gifts = text(found("donations"));
    for (const s of ["£10", "£50", "Gift Aid", "Red Bag", "Paid", "Partly refunded"]) expect(gifts).toContain(s);
    expect(text(el("searchResults"))).not.toMatch(NOTHING_MADE_UP);
  });

  it("says one part could not be searched and still shows the others", async () => {
    await search({ ...real, ...broken }, "Rowan");
    expect(text(found("donors"))).toContain("Search is unavailable. Please try again.");
    expect(text(found("declarations"))).toContain("KA1 1AA");
  });
});
