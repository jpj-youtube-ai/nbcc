// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Sponsor pledges in Admin > Fundraising (assets/js/admin/pledges.js, its own file beside app.js):
// the folded card with the totals, each fundraiser's pledges with emails for staff, send the pay
// link, cancel, hide a message, and whether the two emails to sponsors are going, with a button that
// opens them in the All emails card (where they are read and approved now). A fake fetch stands in
// for the API. Every name and address is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const { initAdminPledges } = require(resolve(ROOT, "assets/js/admin/pledges.js")) as {
  initAdminPledges: (doc: Document, win: unknown) => { load: () => Promise<unknown> } | null;
};

const card = admin.match(/<section class="fr-card fr-card--fold" id="frPledges"[\s\S]*?<\/section>/)![0];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenFor = (role: string) => `${b64({ email: "fern@example.com", role, exp: 9_999_999_999 })}.sig`;

const pledge = (over: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Alex Example",
  email: "alex@example.com",
  amountPence: 1000,
  paidAmountPence: null,
  status: "open",
  statusWords: "Not paid yet",
  giftAid: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  message: "Go on Robin!",
  messageHidden: false,
  payEmailSentAt: null,
  reminderSentAt: null,
  paidAt: null,
  canSend: true,
  canCancel: true,
  ...over,
});
const totals = { openCount: 1, openPence: 1000, paidCount: 1, paidPence: 2500, cashCount: 0, cashPence: 0, cancelledCount: 0, expiredCount: 0, pledgedPence: 3000 };
const overview = (over: Record<string, unknown> = {}) => ({
  today: "2026-12-20",
  totals,
  unpaidTwoWeeks: 1,
  paidTwice: 0,
  fundraisers: [
    {
      id: 7,
      title: "Robin's Santa Dash",
      organiser: "Robin Testperson",
      slug: "robins-santa-dash",
      status: "approved",
      eventDate: "2026-12-05",
      payDue: "2026-12-06",
      totals,
      unpaidTwoWeeks: 1,
      pledges: [pledge(), pledge({ id: 6, name: "Sam Sample", email: null, status: "paid", statusWords: "Paid online", paidAmountPence: 2500, amountPence: 2000, message: null, canSend: false, canCancel: false })],
    },
  ],
  emails: {
    on: false,
    approvalsUnavailable: false,
    kinds: [
      { key: "pledge_pay", label: "Here’s your link to pay your pledge", when: "The day after.", approval: null },
      { key: "pledge_reminder", label: "A reminder about your pledge", when: "A week later.", approval: { approvedAt: "2026-10-04T09:00:00.000Z", approvedBy: "admin:jaimie@example.com" } },
    ],
  },
  ...over,
});

const flush = async () => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
};
const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

let fetchMock: ReturnType<typeof vi.fn>;
let posts: Array<[string, string]>;
async function start(role = "editor", data = overview(), answers: Record<string, { status: number; body: unknown }> = {}) {
  document.body.innerHTML = `<section class="admin-view" id="view-fundraising">${card}</section>`;
  posts = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      posts.push([method, url]);
      const a = answers[url] ?? { status: 200, body: { status: "ok" } };
      return { status: a.status, ok: a.status < 400, json: async () => a.body };
    }
    return { status: 200, ok: true, json: async () => data };
  });
  const storage = { getItem: (k: string) => (k === "nbcc_admin_token" ? tokenFor(role) : null) };
  const api = initAdminPledges(document, { fetch: fetchMock, sessionStorage: storage, AdminHelpers: helpers, confirm: () => true, MutationObserver });
  await api!.load();
  await flush();
  return api!;
}
const el = (id: string) => document.getElementById(id);
const click = async (node: Element | null) => {
  node!.dispatchEvent(new Event("click", { bubbles: true }));
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the Sponsor pledges card", () => {
  it("is in Admin > Get involved, under Tickets and pledges, folded, after Event tickets", () => {
    const part = admin.slice(admin.indexOf('data-gi-part="tickets"'), admin.indexOf('data-gi-part="emails"'));
    expect(part.indexOf('id="frPledges"')).toBeGreaterThan(part.indexOf('id="etAdmin"'));
    expect(part.indexOf('id="etAdmin"')).toBeGreaterThan(0);
    expect(admin.indexOf('id="frPledges"')).toBeGreaterThan(admin.indexOf('id="view-fundraising"'));
    expect(card).toContain('<details class="fr-fold"');
  });

  it("asks with the signed in person's token, and shows the card", async () => {
    await start();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/fundraising/pledges");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect(el("frPledges")!.hidden).toBe(false);
  });

  it("says the totals in the bar, with how many are unpaid two weeks on", async () => {
    await start();
    expect(words(el("frPledgesState"))).toBe("£30 pledged, £25 paid. 1 pledge unpaid 2 weeks after the event.");
  });

  it("says there are none yet when there are none", async () => {
    await start("editor", overview({ fundraisers: [], unpaidTwoWeeks: 0, totals: { ...totals, pledgedPence: 0, paidPence: 0, openCount: 0 } }));
    expect(words(el("frPledgesState"))).toBe("No pledges yet.");
    expect(words(el("frPledgesList"))).toBe("Nobody has pledged yet. Pledges will show here, by fundraiser.");
  });

  it("lists each fundraiser's pledges with the sponsor's email, for staff", async () => {
    await start();
    const group = el("frPledgesList")!.querySelector("[data-pledge-fundraiser]")!;
    expect(words(group.querySelector("h4"))).toContain("Robin's Santa Dash");
    const rows = [...group.querySelectorAll("[data-pledge]")];
    expect(words(rows[0])).toContain("Alex Example");
    expect(words(rows[0])).toContain("alex@example.com");
    expect(words(rows[0])).toContain("£10");
    expect(words(rows[0])).toContain("Not paid yet");
    expect(words(rows[0])).toContain("Gift Aid declared");
    expect(words(rows[1])).toContain("Paid online, £25");
  });

  it("offers send and cancel only where they apply, and never to a viewer", async () => {
    await start();
    const rows = [...document.querySelectorAll("[data-pledge]")];
    expect([...rows[0].querySelectorAll("button")].map(words)).toEqual(["Send pay link", "Cancel pledge", "Hide message"]);
    expect(rows[1].querySelectorAll("button").length).toBe(0);
    await start("viewer");
    expect(document.querySelectorAll("[data-pledge] button").length).toBe(0);
  });

  it("only offers the pay link once it is due", async () => {
    const data = overview();
    data.fundraisers[0].pledges[0] = pledge({ canSend: false });
    await start("editor", data);
    expect([...document.querySelectorAll("[data-pledge] button")].map(words)).toEqual(["Cancel pledge", "Hide message"]);
  });

  it("flags a pledge paid twice, in the bar and on its row, until an editor marks it checked", async () => {
    const data = overview({ paidTwice: 1 });
    data.fundraisers[0].pledges[1] = { ...data.fundraisers[0].pledges[1], paidTwice: true } as never;
    await start("editor", data);
    expect(words(el("frPledgesState"))).toContain("1 pledge paid twice: check and refund.");
    const row = document.querySelector('[data-pledge="6"]')!;
    expect(words(row)).toContain("Paid twice: check the payments and refund the extra one.");
    await click(row.querySelector('[data-pledge-checked="6"]'));
    expect(posts).toContainEqual(["POST", "/api/admin/pledges/6/checked"]);
  });

  it("shows a pledge still waiting for its sponsor to confirm, and one hidden by its organiser", async () => {
    const data = overview();
    data.fundraisers[0].pledges[0] = pledge({ status: "unconfirmed", statusWords: "Waiting for the sponsor to confirm by email", canSend: false, canCancel: false, message: null });
    data.fundraisers[0].pledges[1] = pledge({ id: 6, hidden: true, message: null });
    await start("editor", data);
    expect(words(document.querySelector('[data-pledge="5"]'))).toContain("Waiting for the sponsor to confirm by email");
    expect(words(document.querySelector('[data-pledge="6"]'))).toContain("Hidden from the page by the organiser");
  });

  it("only an admin can send new pay links to everyone unpaid, after asking", async () => {
    await start("editor");
    expect(el("frPledgesTools")!.hidden).toBe(true);
    await start("admin", overview(), { "/api/admin/fundraising/pledges/send-pay-links": { status: 200, body: { sent: 2, skipped: 1, failed: 0, stopped: null } } });
    expect(el("frPledgesTools")!.hidden).toBe(false);
    await click(el("frPledgesSendAll"));
    expect(posts).toContainEqual(["POST", "/api/admin/fundraising/pledges/send-pay-links"]);
    expect(words(el("frPledgesStatus"))).toBe("New pay links sent to 2 sponsors. 1 held back.");
  });

  it("says Resend once the pay link has gone", async () => {
    const data = overview();
    data.fundraisers[0].pledges[0] = pledge({ payEmailSentAt: "2026-12-06T08:00:00.000Z", statusWords: "Not paid yet, pay link sent" });
    await start("editor", data);
    expect(words(document.querySelector("[data-pledge] button"))).toBe("Resend pay link");
  });

  it("sends the pay link, and says what the server said when it cannot", async () => {
    await start();
    await click(document.querySelector('[data-pledge-send="5"]'));
    expect(posts).toContainEqual(["POST", "/api/admin/pledges/5/send-pay-link"]);
    expect(words(el("frPledgesStatus"))).toBe("Pay link sent.");
    await start("editor", overview(), { "/api/admin/pledges/5/send-pay-link": { status: 409, body: { error: "The pay email's wording is waiting for sign off, so it cannot be sent yet." } } });
    await click(document.querySelector('[data-pledge-send="5"]'));
    expect(words(el("frPledgesStatus"))).toBe("The pay email's wording is waiting for sign off, so it cannot be sent yet.");
  });

  it("cancels a pledge after asking, and hides a message", async () => {
    await start();
    await click(document.querySelector('[data-pledge-cancel="5"]'));
    expect(posts).toContainEqual(["POST", "/api/admin/pledges/5/cancel"]);
    await click(document.querySelector('[data-pledge-hide="5"]'));
    const hide = fetchMock.mock.calls.find((c) => c[0] === "/api/admin/pledges/5/message")!;
    expect(JSON.parse(String((hide[1] as RequestInit).body))).toEqual({ hidden: true });
  });

  it("no longer shows the two emails itself, and fetches neither", async () => {
    await start("admin");
    for (const id of ["frPledgesKinds", "frPledgesMeta", "frPledgesPreview", "frPledgesPreviewWrap"]) expect(el(id), id).toBeNull();
    expect(words(el("frPledges"))).not.toMatch(/The two emails to sponsors|Approve this wording|Withdraw approval/);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/preview/"))).toBe(false);
  });

  it("has a button that opens All emails at Sponsor pledges", async () => {
    await start();
    const link = el("frPledges")!.querySelector('[data-allemails-open="pledges"]')!;
    expect(link.tagName).toBe("BUTTON");
    expect(link.getAttribute("type")).toBe("button");
    expect(words(link)).toBe("Read and approve these in All emails");
  });

  it("says the automatic emails are off, so neither email goes yet, and how many are waiting for sign off", async () => {
    await start();
    expect(words(el("frPledgesEmailsState"))).toBe("Automatic emails are switched off, so the pay link and the reminder are not being sent. 1 is waiting for sign off.");
  });

  it("says they are on, and that each goes only once approved", async () => {
    const data = overview();
    data.emails.on = true;
    data.emails.kinds[1].approval = null;
    await start("editor", data);
    expect(words(el("frPledgesEmailsState"))).toBe(
      "Automatic emails are switched on. The pay link and the reminder are each sent only once their wording is approved. Both are waiting for sign off.",
    );
  });

  it("says nothing about waiting once both are approved", async () => {
    const data = overview();
    data.emails.on = true;
    data.emails.kinds[0].approval = data.emails.kinds[1].approval as never;
    await start("editor", data);
    expect(words(el("frPledgesEmailsState"))).toBe("Automatic emails are switched on. The pay link and the reminder are each sent only once their wording is approved.");
  });

  it("says so when the sign offs could not be checked", async () => {
    const data = overview();
    data.emails.approvalsUnavailable = true;
    await start("editor", data);
    expect(words(el("frPledgesEmailsState"))).toContain("Couldn't check sign-offs just now, so both are held.");
  });

  it("reads it all again when a sign off changes in All emails", async () => {
    await start();
    const before = fetchMock.mock.calls.length;
    document.getElementById("frPledges")!.dispatchEvent(new CustomEvent("nbcc:wording-changed", { bubbles: true, detail: { key: "pledge_pay" } }));
    await flush();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(fetchMock.mock.calls[before][0]).toBe("/api/admin/fundraising/pledges");
  });

  it("writes names and messages as text, never as markup", async () => {
    const data = overview();
    data.fundraisers[0].pledges[0] = pledge({ name: "<img src=x onerror=alert(1)>", message: "<script>alert(1)</script>" });
    await start("editor", data);
    expect(el("frPledgesList")!.querySelector("img, script")).toBeNull();
  });

  it("says so when it cannot load", async () => {
    document.body.innerHTML = `<section class="admin-view" id="view-fundraising">${card}</section>`;
    const api = initAdminPledges(document, {
      fetch: vi.fn(async () => ({ status: 500, ok: false, json: async () => ({}) })),
      sessionStorage: { getItem: () => tokenFor("editor") },
      AdminHelpers: helpers,
      MutationObserver,
    });
    await api!.load();
    await flush();
    expect(words(el("frPledgesState"))).toBe("Sponsor pledges could not load just now. Try again in a moment.");
  });
});
