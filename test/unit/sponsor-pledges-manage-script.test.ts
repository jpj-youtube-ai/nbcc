// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Sponsor pledges in the organiser's private area (assets/js/fundraise-pledges.js): for each of their
// cards whose page has pledges, the list of who pledged (names, never emails), where each is up to,
// the totals, and "Paid me in cash". Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const page = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");
const { initPledges } = createRequire(import.meta.url)(resolve(ROOT, "assets/js/fundraise-pledges.js")) as {
  initPledges: (doc: Document, win: unknown) => { refresh: () => void } | null;
};

const template = page.match(/<template data-pledges-pattern>[\s\S]*?<\/template>/)![0];

const pledge = (over: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Alex Example",
  amountPence: 1000,
  paidAmountPence: null,
  status: "open",
  statusWords: "Not paid yet",
  giftAid: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  canMarkCash: true,
  canUnmarkCash: false,
  hidden: false,
  canHide: true,
  ...over,
});

const totals = { openCount: 1, openPence: 1000, paidCount: 1, paidPence: 2500, cashCount: 0, cashPence: 0, cancelledCount: 1, expiredCount: 0, pledgedPence: 3000 };

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

let fetchMock: ReturnType<typeof vi.fn>;
async function start(fundraisers: unknown[], post: { status: number; body: unknown } = { status: 200, body: { pledge: pledge({ status: "cash", statusWords: "Paid you in cash", canMarkCash: false, canUnmarkCash: true }) } }) {
  document.body.innerHTML =
    `<div data-manage-list><article data-fundraiser="7"><section data-f-gifts-part></section><section id="pay"></section></article>` +
    `<article data-fundraiser="8"><section data-f-gifts-part></section></article></div>${template}`;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init && init.method === "POST") return { status: post.status, json: async () => post.body };
    return { status: 200, json: async () => ({ fundraisers }) };
  });
  initPledges(document, { fetch: fetchMock, MutationObserver });
  await flush();
}
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const card = (id: number) => document.querySelector(`[data-fundraiser="${id}"]`)!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the organiser's pledges", () => {
  const mine = [
    {
      id: 7,
      takesPledges: true,
      totals,
      pledges: [
        pledge(),
        pledge({ id: 6, name: "Sam Sample", amountPence: 2000, paidAmountPence: 2500, status: "paid", statusWords: "Paid online", giftAid: false, canMarkCash: false, canHide: false }),
        pledge({ id: 9, name: "Jo Bloggs", status: "cancelled", statusWords: "Cancelled", canMarkCash: false, canHide: false }),
      ],
    },
    { id: 8, takesPledges: true, totals: { ...totals, openCount: 0 }, pledges: [] },
  ];

  it("adds the list just after the latest gifts, only to a card with pledges", async () => {
    await start(mine);
    expect(card(7).querySelector("[data-f-gifts-part] + [data-pledges-part]")).not.toBeNull();
    expect(card(8).querySelector("[data-pledges-part]")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/fundraise/manage/pledges");
  });

  it("says the totals: pledged, paid, and what was cancelled", async () => {
    await start(mine);
    expect(words(card(7).querySelector("[data-pledges-totals]"))).toBe("£30 pledged, £25 paid. 1 cancelled.");
  });

  it("lists each sponsor by name with the amount and where it is up to", async () => {
    await start(mine);
    const items = [...card(7).querySelectorAll("[data-pledges-list] > li")].map(words);
    expect(items[0]).toContain("Alex Example");
    expect(items[0]).toContain("£10");
    expect(items[0]).toContain("Not paid yet");
    expect(items[0]).toContain("Gift Aid");
    expect(items[1]).toContain("Sam Sample");
    expect(items[1]).toContain("Paid online, £25");
    expect(items[2]).toContain("Cancelled");
  });

  it("offers Paid me in cash only on a pledge still to be paid", async () => {
    await start(mine);
    const items = [...card(7).querySelectorAll("[data-pledges-list] > li")];
    expect([...items[0].querySelectorAll("button")].map(words)).toEqual(["Paid me in cash", "Hide from my page"]);
    expect(items[1].querySelector("button")).toBeNull();
    expect(items[2].querySelector("button")).toBeNull();
  });

  it("explains that cash has no Gift Aid online", async () => {
    await start(mine);
    expect(words(card(7).querySelector(".fr-pledges__cash-note"))).toContain("Cash you pay in can’t have Gift Aid added online");
  });

  it("marks it paid in cash, and offers to undo", async () => {
    await start(mine);
    const li = card(7).querySelector("[data-pledges-list] > li")!;
    li.querySelector("button")!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/fundraise/manage/fundraisers/7/pledges/5/cash");
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST").length).toBe(1);
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ paid: true });
    const now = card(7).querySelector("[data-pledges-list] > li")!;
    expect(words(now)).toContain("Paid you in cash");
    expect(words(now.querySelector("button"))).toBe("Undo");
    expect(words(card(7).querySelector("[data-pledges-status]"))).toBe("Saved. Remember to add it to the cash you pay in.");
  });

  it("hides a pledge from their page, says staff have been told, and offers to show it again", async () => {
    await start(mine, { status: 200, body: { pledge: pledge({ hidden: true }) } });
    const hide = [...card(7).querySelectorAll("[data-pledges-list] > li button")].find((b) => words(b) === "Hide from my page")!;
    hide.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/fundraise/manage/fundraisers/7/pledges/5/hide");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ hidden: true });
    const now = card(7).querySelector("[data-pledges-list] > li")!;
    expect(words(now)).toContain("Hidden from your page");
    expect([...now.querySelectorAll("button")].map(words)).toContain("Show on my page");
    expect(words(card(7).querySelector("[data-pledges-status]"))).toBe("Hidden from your page. We have let the NBCC team know. It is still a pledge.");
  });

  it("says so when it could not be saved", async () => {
    await start(mine, { status: 409, body: { error: "That pledge can no longer be changed. Please refresh the page." } });
    card(7).querySelector("[data-pledges-list] button")!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();
    expect(words(card(7).querySelector("[data-pledges-status]"))).toBe("That pledge can no longer be changed. Please refresh the page.");
  });

  it("gives every copy its own ids", async () => {
    await start([mine[0], { ...mine[0], id: 8 }]);
    const ids = [...document.querySelectorAll("[data-pledges-part] [id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(card(7).querySelector("[data-pledges-part]")?.getAttribute("aria-labelledby")).toBe("minePledgesHeading-pledges-7");
  });

  it("writes a name as text, never as markup", async () => {
    await start([{ ...mine[0], pledges: [pledge({ name: "<img src=x onerror=alert(1)>" })] }]);
    expect(card(7).querySelector("[data-pledges-list] img")).toBeNull();
  });

  it("does nothing on a page without the pattern", () => {
    document.body.innerHTML = "<div data-manage-list></div>";
    expect(initPledges(document, { fetch: vi.fn() })).toBeNull();
  });
});
