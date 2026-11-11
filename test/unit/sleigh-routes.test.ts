import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { SleighNight } from "../../src/sleigh/model";

// GET /sleigh, /santa-sleigh and /sleigh/thank-you through the real router, with the database and
// Stripe stood in for and the clock set. Every id here is invented.

vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { retrieve: async () => null } } } }));
vi.mock("../../src/db/sleigh", () => ({
  publicNights: async () => [],
  publicSettings: async () => ({ seasonFrom: "2026-11-01", offOn: "2027-01-31" }),
  sleighTotals: async () => null,
}));

const { createSleighRouter } = await import("../../src/routes/sleigh");

const NIGHTS: SleighNight[] = [
  { id: 1, nightOn: "2026-12-15", areas: "New Farm", startsAt: null, endsAt: null },
  { id: 2, nightOn: "2026-12-22", areas: "Caprington & Grange", startsAt: null, endsAt: null },
];

let clock = new Date("2026-11-10T20:00:00Z");
let failNights = false;
let failTotal = false;
let session: unknown = null;
let failDecorate = false;
let seenCookie: string | undefined;
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(
    createSleighRouter({
      now: () => clock,
      nights: async () => {
        if (failNights) throw new Error("database down");
        return NIGHTS;
      },
      settings: async () => ({ seasonFrom: "2026-11-01", offOn: "2027-01-31" }),
      total: async () => {
        if (failTotal) throw new Error("database down");
        return 12_345;
      },
      session: async () => session as never,
      decorate: async (html, cookie) => {
        if (failDecorate) throw new Error("database down");
        seenCookie = cookie;
        return html.replace("</footer>", "<!-- decorated --></footer>");
      },
    }),
  );
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });

describe("GET /sleigh", () => {
  it("is the page, with the nights and the total, never cached long", async () => {
    clock = new Date("2026-11-10T20:00:00Z");
    const r = await get("/sleigh");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=0");
    const html = await r.text();
    expect(html).toContain("New Farm");
    expect(html).toContain('data-total="12345"');
  });

  // The menu and footer are the site's, so they gain what every page gains as it goes out (the
  // switched on menu items, the footer's Fill a Red Bag and fundraising links: src/routes/site.ts).
  it("adds to the site's menu and footer what every other page gets, and stays up if that fails", async () => {
    const r = await fetch(`${base}/sleigh`, { headers: { cookie: "a=1" } });
    expect(await r.text()).toContain("<!-- decorated --></footer>");
    expect(seenCookie).toBe("a=1");
    failDecorate = true;
    const plain = await get("/sleigh");
    const thanks = await get("/sleigh/thank-you");
    failDecorate = false;
    expect(plain.status).toBe(200);
    expect(await plain.text()).toContain('<footer class="site-footer"');
    expect(thanks.status).toBe(200);
  });

  it("dresses the thank you's menu and footer the same way", async () => {
    expect(await (await get("/sleigh/thank-you")).text()).toContain("<!-- decorated --></footer>");
  });

  it("stays up without a number when the total cannot be read", async () => {
    failTotal = true;
    const html = await (await get("/sleigh")).text();
    failTotal = false;
    expect(html).not.toContain("data-total=");
    expect(html).toContain('id="slGive"');
  });

  it("stays up with no houses when the nights cannot be read", async () => {
    failNights = true;
    const r = await get("/sleigh");
    failNights = false;
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain('<li class="sl-house');
  });

  it("thanks Kilmarnock after the last night, and still takes gifts", async () => {
    clock = new Date("2026-12-23T12:00:00Z");
    const html = await (await get("/sleigh")).text();
    expect(html).toContain("Thank you, <em>Kilmarnock.</em>");
    expect(html).toContain('id="slGive"');
  });

  it("goes to the home page from the switch off day, unless staff are previewing", async () => {
    clock = new Date("2027-01-31T09:00:00Z");
    const r = await get("/sleigh");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    const preview = await get("/sleigh?at=after");
    expect(preview.status).toBe(200);
  });

  it("shows the after state for ?at=after, never cached, never for search engines", async () => {
    clock = new Date("2026-11-10T20:00:00Z");
    const r = await get("/sleigh?at=after");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.text()).toContain("Thank you, <em>Kilmarnock.</em>");
  });
});

describe("GET /santa-sleigh", () => {
  it("forwards to /sleigh for good, with its query string", async () => {
    const r = await get("/santa-sleigh?utm_medium=qr&utm_campaign=c41");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/sleigh?utm_medium=qr&utm_campaign=c41");
    expect((await get("/santa-sleigh")).headers.get("location")).toBe("/sleigh");
  });
});

describe("GET /sleigh/thank-you", () => {
  it("thanks the giver for the amount on a paid Santa Sleigh session", async () => {
    session = { payment_status: "paid", amount_total: 2500, metadata: { sleigh: "true" } };
    const r = await get("/sleigh/thank-you?session_id=cs_test_invented123");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await r.text()).toContain("Thank you for your £25");
  });

  it("is a plain thank you for an id that is not Stripe's shape, without asking Stripe", async () => {
    session = { payment_status: "paid", amount_total: 2500, metadata: { sleigh: "true" } };
    const html = await (await get("/sleigh/thank-you?session_id=not-an-id")).text();
    expect(html).not.toContain("£25");
  });
});
