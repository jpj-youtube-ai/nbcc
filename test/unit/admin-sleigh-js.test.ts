// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Admin > Giving > Santa Sleigh (assets/js/admin/sleigh.js), against a pretend server, and its place in
// admin.html and app.js. Design: docs/superpowers/specs/2026-11-10-santa-sleigh-design.md. Every figure
// here is invented.
const require = createRequire(import.meta.url);
const { initAdminSleigh } = require(resolve(__dirname, "../../assets/js/admin/sleigh.js"));
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const js = readFileSync(resolve(ROOT, "assets/js/admin/sleigh.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-sleigh.css"), "utf8");

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const night = (id: number, nightOn: string, areas: string, over: Record<string, unknown> = {}) => ({
  id,
  nightOn,
  areas,
  startsAt: null,
  endsAt: null,
  bucketPence: 0,
  cardPence: 0,
  cardGifts: 0,
  window: { from: `${nightOn} 16:00`, to: `${nightOn} 22:00` },
  ...over,
});
const STATE = {
  nights: [
    night(1, "2026-12-15", "New Farm", { cardPence: 2500, cardGifts: 2 }),
    night(2, "2026-12-16", "Wardneuk, Onthank & Altonhill", { startsAt: "18:00", endsAt: "20:30", bucketPence: 15240, window: { from: "2026-12-16 17:00", to: "2026-12-16 21:30" } }),
  ],
  settings: { seasonFrom: "2026-11-01", offOn: "2027-01-31" },
  totals: { onlinePence: 5000, cardPence: 2500, bucketPence: 15240, totalPence: 22740, gifts: 4 },
  mayEdit: true,
};

type Call = { method: string; url: string; body: unknown; auth: string | undefined };

function page(o: { state?: unknown; status?: number; reply?: (c: Call) => { status: number; body: unknown } | undefined } = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-sleigh" hidden><div id="sleighAdmin"></div></section></div>`;
  const calls: Call[] = [];
  const tab = { document: { title: "", body: { textContent: "" } }, location: { href: "" }, closed: false, close: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.open = vi.fn(() => tab);
  win.URL.createObjectURL = vi.fn(() => "blob:made");
  win.URL.revokeObjectURL = vi.fn();
  win.fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization };
    calls.push(call);
    const custom = o.reply?.(call);
    const status = custom?.status ?? o.status ?? 200;
    const body = custom?.body ?? (status >= 400 ? { error: "Admin is temporarily unavailable" } : o.state ?? STATE);
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
      text: () => Promise.resolve(typeof body === "string" ? body : "<!doctype html><title>Poster</title>"),
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t0ken");
  const sl = initAdminSleigh(document, window);
  return { sl, calls, tab };
}

const row = (id: number) => document.querySelector<HTMLElement>(`#sleighAdmin [data-night="${id}"]`)!;
const field = (id: number, name: string) => row(id).querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const status = () => document.querySelector<HTMLElement>("#sleighAdmin .sl-status")!;
const total = (k: string) => document.querySelector(`#sleighAdmin [data-sl-total="${k}"]`)?.textContent;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the Santa Sleigh section in the admin", () => {
  it("has a Santa Sleigh button under Giving, shown to whoever may see Donations", () => {
    const giving = html.slice(html.indexOf('id="adminNavGiving"'), html.indexOf("</ul>", html.indexOf('id="adminNavGiving"')));
    expect(giving).toContain('<button class="admin-nav-link" type="button" data-view="sleigh" data-view-gate="donations">Santa Sleigh</button>');
  });

  it("has its own view, stylesheet and script", () => {
    expect(html).toMatch(/<section class="admin-view" id="view-sleigh"[^>]*hidden>[\s\S]*?<div id="sleighAdmin"><\/div>/);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('<link rel="stylesheet" href="/assets/css/admin-sleigh.css" />');
    expect(head).toContain('<script defer src="/assets/js/admin/sleigh.js"></script>');
  });

  it("is opened by app.js, read afresh each time", () => {
    expect(app).toContain('else if (name === "sleigh") { if (window.AdminSleigh) window.AdminSleigh.open(); }');
  });

  it("says its news with is-ok and is-error, never .err, which the public stylesheet hides", () => {
    expect(js).toContain("is-ok");
    expect(js).toContain("is-error");
    expect(js).not.toMatch(/["' ]err["' ]/);
  });

  it("wraps on a phone rather than scrolling inside a box", () => {
    expect(css).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
    expect(css).toMatch(/@media \(max-width: \d+px\)/);
  });
});

describe("the Donations screen's Santa Sleigh tile", () => {
  it("is a tile straight after the card reader's", () => {
    expect(html).toContain('<label class="gl-tile" for="donationsSleighFilter"><input class="gl-tile__box" type="checkbox" id="donationsSleighFilter"><span class="gl-tile__name">Santa Sleigh</span><span class="gl-tile__score" data-gl-score="sleigh"></span></label>');
    expect(html.indexOf("donationsSleighFilter")).toBeGreaterThan(html.indexOf("donationsCardReaderFilter"));
    expect(html.indexOf("donationsSleighFilter")).toBeLessThan(html.indexOf("donationsMonthlyFilter"));
  });

  it("asks the server for sleigh gifts only when it is ticked, and says so when there are none", () => {
    expect(app).toContain('{ id: "donationsSleighFilter", source: "santa_sleigh", none: "No Santa Sleigh gifts yet.", noneHere: "No Santa Sleigh gifts match these filters." }');
  });

  it("labels a sleigh gift in the lists", () => {
    expect(app).toContain('if (d.source === "santa_sleigh") gift += \' <span class="admin-pill dn-source-pill">Santa Sleigh</span>\';');
  });
});

describe("the nights", () => {
  it("reads the section with the signed in person's token when opened", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/admin/sleigh", auth: "Bearer t0ken" });
  });

  it("draws one row per night: the date, the areas, the times, the bucket cash in pounds, and the card machine total", async () => {
    const { sl } = page();
    await sl.open();
    await flush();
    expect(row(1).querySelector("[data-sl-date]")!.textContent).toBe("Tue 15 Dec");
    expect(field(1, "areas").value).toBe("New Farm");
    expect(field(1, "startsAt").value).toBe("");
    expect(field(1, "startsAt").type).toBe("time");
    expect(field(2, "startsAt").value).toBe("18:00");
    expect(field(2, "endsAt").value).toBe("20:30");
    expect(field(2, "bucket").value).toBe("152.40");
    expect(field(1, "bucket").value).toBe("0.00");
    expect(row(1).querySelector("[data-sl-card]")!.textContent).toBe("£25 from 2 taps");
    expect(row(1).querySelector("[data-sl-window]")!.textContent).toBe("Taps counted 4pm to 10pm");
    expect(row(2).querySelector("[data-sl-window]")!.textContent).toBe("Taps counted 5pm to 9.30pm");
  });

  it("shows the year's parts and the grand total", async () => {
    const { sl } = page();
    await sl.open();
    await flush();
    expect(total("online")).toBe("£50");
    expect(total("card")).toBe("£25");
    expect(total("bucket")).toBe("£152.40");
    expect(total("total")).toBe("£227.40");
  });

  it("saves a row: the areas, the times (empty is Timings TBC), and the bucket cash in pence", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    field(1, "areas").value = "New Farm Loch";
    field(1, "startsAt").value = "18:00";
    field(1, "endsAt").value = "";
    field(1, "bucket").value = "£1,234.5";
    row(1).querySelector<HTMLButtonElement>("[data-sl-save]")!.click();
    await flush();
    const saved = calls.find((c) => c.method === "PATCH")!;
    expect(saved).toMatchObject({ url: "/api/admin/sleigh/nights/1", auth: "Bearer t0ken" });
    expect(saved.body).toEqual({ areas: "New Farm Loch", startsAt: "18:00", endsAt: null, bucketPence: 123450 });
    expect(status().textContent).toBe("Saved Tue 15 Dec.");
    expect(status().classList.contains("is-ok")).toBe(true);
  });

  it("refuses bucket cash it cannot read, without asking the server", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    field(1, "bucket").value = "lots";
    row(1).querySelector<HTMLButtonElement>("[data-sl-save]")!.click();
    await flush();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(status().textContent).toBe("Write the bucket cash in pounds and pence, like 152.40.");
    expect(status().classList.contains("is-error")).toBe(true);
  });

  it("says what the server said when a save is refused", async () => {
    const { sl } = page({ reply: (c) => (c.method === "PATCH" ? { status: 400, body: { error: "The finish time must be after the start time." } } : undefined) });
    await sl.open();
    await flush();
    row(2).querySelector<HTMLButtonElement>("[data-sl-save]")!.click();
    await flush();
    expect(status().textContent).toBe("The finish time must be after the start time.");
    expect(status().classList.contains("is-error")).toBe(true);
  });

  it("lets someone who may only look see everything, and change nothing", async () => {
    const { sl } = page({ state: { ...STATE, mayEdit: false } });
    await sl.open();
    await flush();
    expect(field(1, "areas").disabled).toBe(true);
    expect(field(1, "bucket").disabled).toBe(true);
    expect(row(1).querySelector("[data-sl-save]")).toBeNull();
    expect(document.querySelector("#sleighAdmin [data-sl-save-settings]")).toBeNull();
    // posters are for everyone who may see the section
    expect(row(1).querySelector("[data-sl-poster='a4']")).not.toBeNull();
  });

  it("says so plainly when the section cannot load", async () => {
    const { sl } = page({ status: 500 });
    await sl.open();
    await flush();
    expect(status().textContent).toBe("Admin is temporarily unavailable");
    expect(status().classList.contains("is-error")).toBe(true);
  });
});

describe("the switch off day", () => {
  it("shows the day and saves a new one", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    const day = document.querySelector<HTMLInputElement>("#sleighAdmin [name='offOn']")!;
    expect(day.type).toBe("date");
    expect(day.value).toBe("2027-01-31");
    day.value = "2027-02-14";
    document.querySelector<HTMLButtonElement>("#sleighAdmin [data-sl-save-settings]")!.click();
    await flush();
    const saved = calls.find((c) => c.method === "PATCH")!;
    expect(saved).toMatchObject({ url: "/api/admin/sleigh/settings", body: { offOn: "2027-02-14" } });
    expect(status().textContent).toBe("Saved the switch off day.");
  });
});

describe("the posters and the hand-out QR code", () => {
  it("opens the poster for every night, A4 or A3, in a new tab, fetched with the token", async () => {
    const { sl, calls, tab } = page();
    await sl.open();
    await flush();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#sleighAdmin [data-sl-poster-all]")];
    expect(buttons.map((b) => b.textContent)).toEqual(["All nights A4", "All nights A3"]);
    buttons[1].click();
    await flush();
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(calls[calls.length - 1]).toMatchObject({ url: "/api/admin/sleigh/poster?night=all&size=a3", auth: "Bearer t0ken" });
    expect(tab.location.href).toBe("blob:made");
  });

  it("opens one night's poster from its row", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    expect([...row(2).querySelectorAll("[data-sl-poster]")].map((b) => b.textContent)).toEqual(["Poster A4", "Poster A3"]);
    row(2).querySelector<HTMLButtonElement>("[data-sl-poster='a4']")!.click();
    await flush();
    expect(calls[calls.length - 1].url).toBe("/api/admin/sleigh/poster?night=2&size=a4");
  });

  it("closes the tab and says so when a poster cannot be made", async () => {
    const { sl, tab } = page({ reply: (c) => (c.url.includes("/poster") ? { status: 500, body: { error: "x" } } : undefined) });
    await sl.open();
    await flush();
    document.querySelector<HTMLButtonElement>("#sleighAdmin [data-sl-poster-all='a4']")!.click();
    await flush();
    expect(tab.close).toHaveBeenCalled();
    expect(status().textContent).toBe("That poster could not be made. Please try again.");
    expect(status().classList.contains("is-error")).toBe(true);
  });

  it("downloads the hand-out QR code as santa-sleigh-qr.png", async () => {
    const { sl, calls } = page();
    await sl.open();
    await flush();
    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      const button = document.querySelector<HTMLButtonElement>("#sleighAdmin [data-sl-qr]")!;
      expect(button.textContent).toBe("QR code for hand-outs");
      button.click();
      await flush();
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(calls[calls.length - 1]).toMatchObject({ url: "/api/admin/sleigh/qr-handout", auth: "Bearer t0ken" });
    expect(clicked).toEqual(["santa-sleigh-qr.png"]);
  });
});
