// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ (assets/js/admin/elf-hq.js): the Elf Detective School's own admin section, against a
// pretend server. Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md. Every family and
// detective here is invented.
const require = createRequire(import.meta.url);
const { initElfHq } = require(resolve(__dirname, "../../assets/js/admin/elf-hq.js"));

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const HQ = {
  settings: { schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewOn: false },
  canSwitch: true,
  numbers: { families: 0, detectives: 0, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 },
  quests: [],
  recruits: [],
  firstClueAt: "2026-12-01T17:30:00.000Z",
  daysToFirstClue: 26,
};

type Call = { method: string; url: string; body: unknown };

/** The admin page around the section, the pretend server, and Head Elf HQ started on it. */
function page(o: { answers?: Record<string, unknown>; status?: number; shown?: boolean } = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-elf"${o.shown ? "" : " hidden"}><div id="elfHq"></div></section></div>`;
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const status = o.status ?? 200;
    const body = (o.answers ?? {})[url.split("?")[0]] ?? (status >= 400 ? { error: "Admin is temporarily unavailable" } : HQ);
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls };
}

const tabs = () => [...document.querySelectorAll<HTMLButtonElement>("#elfHq [role=tab]")];
const panel = (id: string) => document.querySelector<HTMLElement>(`#elfHq [role=tabpanel][data-tab="${id}"]`)!;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("Head Elf HQ's menu", () => {
  it("draws four tiles, with HQ open", () => {
    page();
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(["HQ", "Families", "Money", "Settings"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(panel("hq").hidden).toBe(false);
    for (const id of ["families", "money", "settings"]) expect(panel(id).hidden, id).toBe(true);
    expect(document.querySelector("#elfHq h1")!.textContent).toBe("Elf Detective School");
  });

  it("opens a tile's part, and remembers it for the browser tab", () => {
    page();
    tabs()[1].click();
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(panel("families").hidden).toBe(false);
    expect(panel("hq").hidden).toBe(true);
    expect(window.sessionStorage.getItem("nbcc_elf_hq_tab")).toBe("families");
    page();
    expect(panel("families").hidden).toBe(false);
  });

  it("reads HQ when the section is opened", async () => {
    const { hq, calls } = page();
    expect(calls).toHaveLength(0);
    await hq.open();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET /api/admin/elf/hq");
  });

  it("reads HQ straight away when the section is already showing as it starts", async () => {
    const { calls } = page({ shown: true });
    await flush();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET /api/admin/elf/hq");
  });

  it("says a failure in words, as an error", async () => {
    const { hq } = page({ status: 500 });
    await hq.open();
    const status = document.querySelector("#elfHq .hq-status")!;
    expect(status.textContent).toContain("Admin is temporarily unavailable");
    expect(status.classList.contains("is-error")).toBe(true);
  });
});

// ---- the HQ screen (Task 4) ----

const BUSY = {
  ...HQ,
  numbers: { families: 128, detectives: 231, namesToCheck: 6, waitingPayments: 2, entryPence: 115500, giftPence: 33100, giftAidPence: 21000 },
  quests: [
    { id: "names", count: 6, title: "First names to check", words: "Until you tick a name, the public sees only its first letter.", go: "families", button: "Check names", filter: "check" },
    { id: "waiting", count: 2, title: "Payments not finished", words: "Started over an hour ago and never paid: usually someone who changed their mind. Nothing to do.", go: null, button: null, filter: null },
  ],
  recruits: [
    { detectiveId: 7, familyId: 3, name: "Ruby Tinselfoot", badge: "EDS 0427", approved: false, tile: "/assets/img/elf/paper/tiles/costumes/reindeer-s3.webp" },
    { detectiveId: 8, familyId: 3, name: "Leo Frostwhistle", badge: "EDS 0428", approved: true, tile: "/assets/img/elf/paper/tiles/costumes/snowman-s3.webp" },
  ],
};

const hqPart = () => panel("hq");
const lever = () => document.getElementById("hqLever") as HTMLButtonElement;
const buttonCalled = (words: string) => [...document.querySelectorAll<HTMLButtonElement>("#elfHq button")].find((b) => b.textContent!.trim() === words);

describe("the HQ screen", () => {
  it("asks a second time before switching the school on, and only then sends it", async () => {
    const { hq, calls } = page({ answers: { "/api/admin/elf/hq": BUSY, "/api/admin/elf/settings": { settings: { ...BUSY.settings, schoolOn: true } } } });
    await hq.open();
    expect(lever().getAttribute("aria-checked")).toBe("false");
    lever().click();
    expect(hqPart().textContent).toContain("Switch it on for everyone?");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    buttonCalled("Yes, switch it on")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([{ method: "PATCH", url: "/api/admin/elf/settings", body: { schoolOn: true } }]);
    expect(lever().getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("#elfHq .hq-state")!.textContent).toBe("Live");
  });

  it("asks before switching it off too, and Not yet changes nothing", async () => {
    const { hq, calls } = page({ answers: { "/api/admin/elf/hq": { ...BUSY, settings: { ...BUSY.settings, schoolOn: true } } } });
    await hq.open();
    lever().click();
    expect(hqPart().textContent).toContain("Switch it off? Families cannot see the school or sign in while it is off.");
    buttonCalled("Keep it on")!.click();
    expect(hqPart().textContent).not.toContain("Switch it off?");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("lets only an admin pull the lever", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": { ...BUSY, canSwitch: false } } });
    await hq.open();
    expect(lever().disabled).toBe(true);
    expect(hqPart().textContent).toContain("Only an admin can switch the school on or off.");
  });

  it("draws the quests with their counts, and a quest's button opens its part", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    const quests = [...hqPart().querySelectorAll(".hq-quest")];
    expect(quests).toHaveLength(2);
    expect(quests[0].textContent).toContain("First names to check");
    expect(quests[0].querySelector(".hq-count")!.textContent).toBe("6");
    expect(quests[1].querySelector("button")).toBeNull();
    buttonCalled("Check names")!.click();
    expect(panel("families").hidden).toBe(false);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("says when nothing needs anyone", async () => {
    const { hq } = page();
    await hq.open();
    expect(hqPart().querySelectorAll(".hq-quest")).toHaveLength(0);
    expect(hqPart().textContent).toContain("Nothing needs you. The school is running itself.");
  });

  it("shows the money as one bar, with the Gift Aid it could add", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    expect(hqPart().textContent).toContain("£1,486");
    const parts = [...hqPart().querySelectorAll<HTMLElement>(".hq-bar span")];
    expect(parts.map((p) => p.style.flexGrow)).toEqual(["115500", "33100"]);
    expect(hqPart().textContent).toContain("Entries £1,155");
    expect(hqPart().textContent).toContain("Gifts £331");
    expect(hqPart().textContent).toContain("£210 of the gifts came with Gift Aid, which could add about £52.50 when we claim it.");
  });

  it("says when there is no money yet, with no bar", async () => {
    const { hq } = page();
    await hq.open();
    expect(hqPart().textContent).toContain("No payments yet.");
    expect(hqPart().querySelector(".hq-bar")).toBeNull();
  });

  it("draws the newest recruits as cards, and counts the names to check on the Families tile", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    const cards = [...hqPart().querySelectorAll(".hq-char")];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector("img")!.getAttribute("src")).toBe("/assets/img/elf/paper/tiles/costumes/reindeer-s3.webp");
    expect(cards[0].textContent).toContain("Ruby Tinselfoot");
    expect(cards[0].textContent).toContain("EDS 0427");
    expect(cards[0].textContent).toContain("Name to check");
    expect(cards[1].textContent).not.toContain("Name to check");
    const count = tabs()[1].querySelector(".hq-count")!;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe("6");
  });

  it("counts down to the first clue on a rosette, beside the detectives enrolled", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    const clocks = [...hqPart().querySelectorAll(".hq-clock")];
    expect(clocks[0].textContent).toContain("26");
    expect(clocks[0].textContent).toContain("days to the first clue");
    expect(clocks[0].textContent).toContain("Tuesday 1 December, 5:30pm");
    expect(clocks[1].textContent).toContain("231");
    expect(clocks[1].textContent).toContain("detectives enrolled");
  });

  it("makes a long number smaller, so it fits inside its rosette", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    const [days, detectives] = [...hqPart().querySelectorAll(".hq-rosette b")];
    expect(days.className).toBe("");
    expect(detectives.className).toBe("is-long");
  });
});
