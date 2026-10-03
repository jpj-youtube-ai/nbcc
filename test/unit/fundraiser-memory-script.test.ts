// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderMemoryPage } from "../../src/fundraising/memory-render";
import { meter, type PublicPage } from "../../src/fundraising/model";

// In memory pages (Jaimie, 2026-10-03): after giving, the page's own script sends the giver's
// message and choices as on every page, and "Let the family know I gave" with them (unticked unless
// they tick it). Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initWallStep } = require(resolve(ROOT, "assets/js/fundraiser.js"));
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const SESSION = "cs_test_memory1";

const page: PublicPage = {
  id: 9, slug: "ime", path: "raising", kind: "other", kindLabel: "Other", title: "In memory of Margaret Exampleton",
  description: "Remembering Margaret.", eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, organisedBy: "Robin T.",
  url: "/fundraise/ime", meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }), wall: [],
  giving: { fundraiserId: 9, minimumPence: 200 }, finished: false,
  memory: { name: "Margaret Exampleton", dates: "1948 to 2026", showTarget: false },
};

function load() {
  const html = renderMemoryPage(template, page, { pageUrl: "https://nbcc.test/fundraise/ime", now: new Date(), thanks: { message: false, sessionId: SESSION } });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  const calls: Array<Record<string, unknown>> = [];
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "added", entry: null }) });
  });
  initWallStep(document, { fetch, location: { pathname: "/fundraise/ime", search: "" }, history: { replaceState: () => {} } }, { assign: () => {} });
  return calls;
}

const send = async () => {
  document.getElementById("frWallForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
};

describe("Let the family know I gave", () => {
  it("is sent as No unless they tick it", async () => {
    const calls = load();
    await send();
    expect(calls[0]).toEqual({ sessionId: SESSION, message: "", showName: true, showAmount: false, familyNotify: false });
  });

  it("is sent as Yes when they tick it", async () => {
    const calls = load();
    (document.getElementById("frFamilyNotify") as HTMLInputElement).checked = true;
    await send();
    expect(calls[0].familyNotify).toBe(true);
  });
});
