// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Welcome packs: in the organiser's private area, a small line under the status once their pack has
// been sent ("Your welcome pack is on its way", with the day), and nothing at all before. Every name
// here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

const fundraiser = (over: Record<string, unknown> = {}) => ({
  id: 9,
  slug: "rw",
  title: "Robin's Walk",
  path: "raising",
  status: "approved",
  public: true,
  pageUrl: "https://nbcc.test/fundraise/rw",
  qrUrl: "/fundraise/rw/qr.svg",
  meter: { raisedPence: 6000, onlinePence: 6000, cashPence: 0, targetPence: null, percent: null, barPercent: null, overTarget: false },
  editable: { description: "Five miles.", targetPence: null, eventDate: null, startTime: null, venue: "", town: "", socialLink: null },
  waitingEdit: null,
  gifts: [],
  finishedRequestedAt: null,
  materials: { poster: "/p", posterA3: "/p3", leaflet: "/l", social: "/s", sponsorForm: "/sf", certificate: null, qrPng: "/q.png" },
  print: null,
  pack: null,
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

const line = (id: number) => document.querySelector<HTMLElement>(`[data-fundraiser="${id}"] [data-f-pack]`)!;

describe("the welcome pack line in the private area", () => {
  it("shows nothing before the pack is sent", async () => {
    await load(fundraiser());
    expect(line(9)).toBeTruthy();
    expect(line(9).hidden).toBe(true);
    expect(line(9).textContent).toBe("");
  });

  it("says it is on its way once sent, as the server worded it", async () => {
    await load(fundraiser({ pack: "Your welcome pack is on its way. We posted it on 4 October 2026." }), fundraiser({ id: 10 }));
    expect(line(9).hidden).toBe(false);
    expect(line(9).textContent).toBe("Your welcome pack is on its way. We posted it on 4 October 2026.");
    expect(line(10).hidden).toBe(true);
  });

  it("shows nothing for an answer from before this, with no pack in it", async () => {
    const old = fundraiser();
    delete (old as Record<string, unknown>).pack;
    await load(old);
    expect(line(9).hidden).toBe(true);
  });

  it("never writes the words as HTML", async () => {
    await load(fundraiser({ pack: "<b>on its way</b>" }));
    expect(line(9).querySelector("b")).toBeNull();
  });
});
