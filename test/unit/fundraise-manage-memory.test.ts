// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// In memory pages (Jaimie, 2026-10-03): in the organiser's private area, an in memory page lists the
// people who asked to let the family know they gave (names, and messages once staff have read them,
// never amounts), and offers the funeral collection envelopes to print. Every other page is as it
// was. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

const fundraiser = (over: Record<string, unknown> = {}) => ({
  id: 9,
  slug: "ime",
  title: "In memory of Margaret Exampleton",
  path: "raising",
  status: "approved",
  public: true,
  pageUrl: "https://nbcc.test/fundraise/ime",
  qrUrl: "/fundraise/ime/qr.svg",
  meter: { raisedPence: 6000, onlinePence: 6000, cashPence: 0, targetPence: null, percent: null, barPercent: null, overTarget: false },
  editable: { description: "Remembering Margaret.", targetPence: null, eventDate: null, startTime: null, venue: "", town: "", socialLink: null },
  waitingEdit: null,
  gifts: [{ name: "Alex Example", amountPence: null, giftAidPence: null, message: "Thinking of you all.", createdAt: "2026-10-02T10:00:00.000Z" }],
  finishedRequestedAt: null,
  memory: { name: "Margaret Exampleton", dates: "1948 to 2026", showTarget: false },
  materials: {
    poster: "/p", posterA3: "/p3", leaflet: "/l", social: "/s", sponsorForm: "/sf", certificate: null, qrPng: "/q.png",
    envelopes: "/api/fundraise/manage/fundraisers/9/materials/envelopes",
  },
  print: null,
  ...over,
});

async function load(...fundraisers: unknown[]) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  const win = {
    location: { search: "", pathname: "/fundraise/manage", assign: () => {} },
    history: { replaceState: () => {} },
    NBCCFormValidation: { validateForm: shared.validateForm, clearValidation: shared.clearValidation },
    NBCCSocialHandles: require(resolve(ROOT, "assets/js/social-handles.js")),
    fetch: vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url === "/api/fundraise/manage/me" ? { fundraisers } : {}) }),
    ),
  };
  initManage(document, win);
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const card = (id: number) => document.querySelector<HTMLElement>(`[data-fundraiser="${id}"]`)!;

describe("an in memory page in the private area", () => {
  it("lists who asked to let the family know, with no amounts", async () => {
    await load(fundraiser());
    const c = card(9);
    expect(c.querySelector("#mineGiftsHeading-9, [id^=mineGiftsHeading]")!.textContent).toBe("People who asked us to let you know they gave");
    expect(c.querySelector("[data-f-gifts]")!.textContent).toContain("Alex Example");
    expect(c.querySelector("[data-f-gifts]")!.textContent).toContain("Thinking of you all.");
    expect(c.querySelector(".fr-wall__amount")).toBeNull();
  });

  it("says gently when no one has asked yet", async () => {
    await load(fundraiser({ gifts: [] }));
    const empty = card(9).querySelector<HTMLElement>("[data-f-gifts-empty]")!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("We never show how much anyone gave.");
  });

  it("offers the funeral collection envelopes", async () => {
    await load(fundraiser());
    const item = card(9).querySelector<HTMLElement>('[data-f-mat="envelopes"]')!;
    expect(item.hidden).toBe(false);
    expect(item.querySelector("a")!.getAttribute("href")).toBe("/api/fundraise/manage/fundraisers/9/materials/envelopes");
  });

  it("leaves every other page as it was", async () => {
    const { memory: _m, ...rest } = fundraiser({ gifts: [] });
    void _m;
    await load({ ...rest, materials: { ...rest.materials, envelopes: undefined } });
    const c = card(9);
    expect(c.querySelector("[id^=mineGiftsHeading]")!.textContent).toBe("Latest gifts and messages");
    expect(c.querySelector<HTMLElement>('[data-f-mat="envelopes"]')!.hidden).toBe(true);
  });
});

describe("review: posting the envelopes back", () => {
  it("tells them to post the sealed envelopes to us unopened", async () => {
    await load(fundraiser());
    const item = card(9).querySelector<HTMLElement>('[data-f-mat="envelopes"]')!;
    expect(item.textContent).toContain("Please post the sealed envelopes to us unopened at The Elves’ Workshop");
  });
});
