// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-643: Admin > QR codes, and Site pages' "Make a QR code", fed what the REAL server sends. The
// handlers in src/routes/qr-codes.ts, src/routes/admin-qr.ts and src/routes/admin.ts run for real,
// with every query answered by invented rows in the tables' own shape (helpers/real-rows.ts), so a
// mismatch between server and screen fails here. The screen tests beside this one answer by hand.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { qrRows, siteRows } from "./helpers/real-rows";
import { mountAdmin, el, q, qa, text, press, type Call } from "./helpers/admin-settings-harness";
import { getNamedCodes, postNamedCode, patchNamedCode } from "../../src/routes/qr-codes";
import { getQrCodes } from "../../src/routes/admin-qr";
import { getAdminSitePages } from "../../src/routes/admin";
import { qrRows as pageRows, ALL_GATES_OPEN } from "../../src/site/qr";
import { SITE_PAGES } from "../../src/site/pages";

vi.setConfig({ testTimeout: 30_000 });

const NEW = { name: "Leaflet, Morag", target: "/donate" };
const real: Record<string, Reply> = {};
const afterMaking: Record<string, Reply> = {};
beforeAll(async () => {
  db.answer(qrRows());
  real["GET /api/admin/qr-codes/named"] = await callRoute(getNamedCodes);
  db.answer(qrRows());
  real["GET /api/admin/qr-codes"] = await callRoute(getQrCodes);
  db.answer(siteRows());
  real["GET /api/admin/site-pages"] = await callRoute(getAdminSitePages);
  db.answer(qrRows());
  real["POST /api/admin/qr-codes/named"] = await callRoute(postNamedCode, { body: NEW });
  db.answer(qrRows());
  real["PATCH /api/admin/qr-codes/named/13"] = await callRoute(patchNamedCode, { params: { id: "13" }, body: { hidden: true } });
  db.answer(qrRows({ extra: [{ id: 15, ...NEW }] }));
  afterMaking["GET /api/admin/qr-codes/named"] = await callRoute(getNamedCodes);
});

async function open(view: string, route = replyWith(real), role: "admin" | "viewer" = "admin") {
  const admin = mountAdmin({ role }, route);
  await admin.signIn();
  await admin.open(view);
  return admin;
}
const titles = (sel: string) => qa(sel + " .qr-title").map((n) => text(n));

describe("QR codes with the real server's answer", () => {
  it("the real handlers answered", () => {
    expect(real["GET /api/admin/qr-codes/named"].status).toBe(200);
    expect(real["GET /api/admin/qr-codes"].status).toBe(200);
    expect(real["GET /api/admin/site-pages"].status).toBe(200);
    expect(real["POST /api/admin/qr-codes/named"].status).toBe(201);
    expect(real["PATCH /api/admin/qr-codes/named/13"].status).toBe(200);
  });

  it("adds up the tiles from the real scans", async () => {
    await open("qr");
    const tiles = qa("#qrTiles .ak-tile__n").map((n) => text(n));
    // 5 codes (one hidden); this week 38 + 41; in all 214 + 41 + 77.
    expect(tiles).toEqual(["5", "79", "332"]);
  });

  it("draws a card for each code the server sends, with its real picture, and the hidden one under Hidden codes", async () => {
    await open("qr");
    expect(titles("#qrNamedList")).toEqual([
      "Donate billboard, High Street",
      "Business card, Sam",
      "Table card at the Festive Ball, with a very long name to see it wrap",
      "Volunteer sign up",
    ]);
    expect(titles("#qrHiddenList")).toEqual(["Old leaflet"]);
    expect(el("qrHidden").hidden).toBe(false);
    const img = q('#qrNamedList [data-qr-id="14"] .qr-img') as HTMLImageElement;
    expect(decodeURIComponent(img.getAttribute("src") || "")).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    const card14 = text(q('#qrNamedList [data-qr-id="14"]'));
    expect(card14).toContain("Goes to Donate");
    expect(card14).toContain("214 scans · 38 in the last 7 days");
    expect(card14).toContain("nbcc.scot/q/c14");
    expect(card14).toContain("last scanned today");
    expect(text(q('#qrNamedList [data-qr-id="10"]'))).toContain("Goes to Volunteering (vol.nbcc.scot)");
    expect(text(q('#qrNamedList [data-qr-id="13"]'))).toContain("No scans yet");
    expect(text(el("view-qr"))).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it("offers the real Goes to list, the pages and then the sign up sites", async () => {
    await open("qr");
    const groups = qa("#qrNewTarget optgroup").map((g) => g.getAttribute("label"));
    expect(groups).toEqual(["Pages of nbcc.scot", "Our sign up sites"]);
    const values = qa("#qrNewTarget option").map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(values).toContain("/donate");
    expect(values).toContain("https://vol.nbcc.scot");
  });

  it("sorts the real codes by scans and by name", async () => {
    await open("qr");
    press(q('[data-qr-sort="scans"]'));
    expect(titles("#qrNamedList")[0]).toBe("Donate billboard, High Street");
    press(q('[data-qr-sort="name"]'));
    expect(titles("#qrNamedList")[0]).toBe("Business card, Sam");
  });

  it("lists a quick code for every page of the site, and finds one", async () => {
    await open("qr");
    expect(qa("#qrList .qr-card")).toHaveLength(pageRows(SITE_PAGES, ALL_GATES_OPEN).length);
    const search = el("qrSearch") as HTMLInputElement;
    search.value = "ticket terms";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(qa("#qrList .qr-card").filter((c) => !c.hidden).map((c) => text(q(".qr-title", c)))).toEqual(["Ticket terms"]);
  });

  it("makes a new code with the real POST answer, and shows it first", async () => {
    let made = false;
    const sent: Call[] = [];
    const admin = await open("qr", (c) => {
      if (c.method === "POST") {
        sent.push(c);
        made = true;
      }
      return replyWith(made ? { ...real, ...afterMaking } : real)(c);
    });
    (el("qrNewName") as HTMLInputElement).value = NEW.name;
    (el("qrNewTarget") as HTMLSelectElement).value = NEW.target;
    press(el("qrNewBtn"));
    await admin.settle();
    expect(sent.map((c) => c.body)).toEqual([NEW]);
    expect(el("qrNewStatus").className).toContain("is-ok");
    expect(titles("#qrNamedList")[0]).toBe(NEW.name);
  });

  it("hides a code with the real PATCH answer and says where it went", async () => {
    const admin = await open("qr");
    press(q('[data-qr-hide="13"]'));
    await admin.settle();
    expect(admin.calls.find((c) => c.method === "PATCH")?.body).toEqual({ hidden: true });
    expect(el("qrNamedSaid").className).toContain("is-ok");
    expect(text(el("qrNamedSaid"))).toBe("Hid Business card, Sam. It is in Hidden codes below, and still works.");
  });

  it("lets someone who may only look download, copy and share, but not make, change or hide", async () => {
    await open("qr", replyWith(real), "viewer");
    expect(el("qrNewForm").hidden).toBe(true);
    expect(qa("#view-qr [data-qr-edit], #view-qr [data-qr-hide]")).toHaveLength(0);
    expect(qa('#qrNamedList [data-qr-format="svg"]')).toHaveLength(4);
    expect(qa("#qrNamedList [data-qr-copy]")).toHaveLength(4);
  });
});

describe("Site pages with the real server's answer", () => {
  it("lists every page and hands one to QR codes with Goes to already set", async () => {
    const admin = await open("site");
    const asked = qa("#view-site [data-site-qr]").map((b) => b.getAttribute("data-site-qr"));
    expect(asked).toContain("/donate");
    expect(text(el("view-site"))).toContain("/give");
    expect(text(el("view-site"))).not.toMatch(/undefined|NaN|\[object Object\]/);
    press(q('#view-site [data-site-qr="/donate"]'));
    await admin.settle();
    expect((el("qrNewTarget") as HTMLSelectElement).value).toBe("/donate");
    expect(text(el("qrNewStatus"))).toBe("Goes to is set to Donate. Give the code a name, then make it.");
  });
});
