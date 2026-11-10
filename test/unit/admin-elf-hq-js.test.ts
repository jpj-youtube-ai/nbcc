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
  canEdit: true,
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
    // A fresh copy each time, as a real answer is: the screen may change what it was given.
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
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
  it("draws five tiles, with HQ open", () => {
    page();
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(["HQ", "Families", "Doors", "Money", "Settings"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(panel("hq").hidden).toBe(false);
    for (const id of ["families", "doors", "money", "settings"]) expect(panel(id).hidden, id).toBe(true);
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
    expect(hqPart().textContent).toContain("Switch it off? Families cannot see Elf Detective School or sign in while it is off.");
    buttonCalled("Keep it on")!.click();
    expect(hqPart().textContent).not.toContain("Switch it off?");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("lets only an admin pull the lever", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": { ...BUSY, canSwitch: false } } });
    await hq.open();
    expect(lever().disabled).toBe(true);
    expect(hqPart().textContent).toContain("Only an admin can switch Elf Detective School on or off.");
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
    expect(hqPart().textContent).toContain("Nothing needs you. Elf Detective School is running itself.");
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

  it("says each number in its heading too, since to a screen reader the rosettes are only pictures", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    expect([...hqPart().querySelectorAll(".hq-clock h3")].map((h) => h.textContent)).toEqual(["26 days to the first clue", "231 detectives enrolled"]);
  });

  it("makes a long number smaller, so it fits inside its rosette", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    const [days, detectives] = [...hqPart().querySelectorAll(".hq-rosette b")];
    expect(days.className).toBe("");
    expect(detectives.className).toBe("is-long");
  });
});

// ---- the Families screen (Task 6) ----

const T = "/assets/img/elf/paper/tiles/costumes/";
const SAM = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam@example.org",
  enrolledAt: "2026-11-13T19:04:00.000Z",
  removed: false,
  namesToCheck: 1,
  detectives: [
    { id: 7, firstName: "Ruby", badge: "EDS 0427", approved: false, tile: `${T}reindeer-s2.webp` },
    { id: 8, firstName: "Leo", badge: "EDS 0428", approved: true, tile: `${T}snowman-s2.webp` },
  ],
};
const ALEX = { id: 4, grownUpName: "Alex Sample", email: "alex@example.org", enrolledAt: "2026-11-13T18:00:00.000Z", removed: false, namesToCheck: 0, detectives: [{ id: 9, firstName: "Isla", badge: "EDS 0429", approved: true, tile: `${T}puffin-s1.webp` }] };
const LIST = { families: [SAM, ALEX], total: 2, counts: { all: 2, check: 1, week: 2, removed: 0 } };
const SAM_SHEET = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam@example.org",
  newsletter: true,
  enrolledAt: "2026-11-13T19:04:00.000Z",
  removedAt: null,
  removedBy: null,
  detectives: [
    { id: 7, firstName: "Ruby", surname: "Tinselfoot", badge: "EDS 0427", approved: false, tile: `${T}reindeer-s2.webp` },
    { id: 8, firstName: "Leo", surname: "Frostwhistle", badge: "EDS 0428", approved: true, tile: `${T}snowman-s2.webp` },
  ],
  payments: [{ reference: "EDS-K4F9Q2", status: "paid", paidAt: "2026-11-13T19:04:00.000Z", entryPence: 1000, giftPence: 500, giftAid: true }],
};
const SHEET_ANSWER = { family: SAM_SHEET, surnames: ["Tinselfoot", "Frostwhistle", "Snowsleuth"] };
const FAMILY_SERVER = {
  "/api/admin/elf/hq": { ...HQ, numbers: { ...HQ.numbers, namesToCheck: 1 } },
  "/api/admin/elf/families": LIST,
  "/api/admin/elf/families/3": SHEET_ANSWER,
};

const familiesPart = () => panel("families");
async function openFamilies(answers: Record<string, unknown> = FAMILY_SERVER) {
  const env = page({ answers });
  await env.hq.open();
  tabs()[1].click();
  await flush();
  return env;
}
const cards = () => [...familiesPart().querySelectorAll<HTMLButtonElement>(".hq-fam")];
const inFamilies = (words: string) => [...familiesPart().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);
const urls = (calls: Call[]) => calls.map((c) => `${c.method} ${c.url}`);

describe("the Families screen", () => {
  it("lists families as cards with their elves, and the filters with their counts", async () => {
    await openFamilies();
    expect(cards()).toHaveLength(2);
    expect(cards()[0].textContent).toContain("Sam Example");
    expect(cards()[0].textContent).toContain("Ruby, Leo");
    expect(cards()[0].textContent).toContain("EDS 0427");
    expect(cards()[0].textContent).toContain("1 name to check");
    expect(cards()[1].textContent).toContain("All names ticked");
    expect([...cards()[0].querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual([`${T}reindeer-s2.webp`, `${T}snowman-s2.webp`]);
    const chips = [...familiesPart().querySelectorAll(".hq-filter")].map((c) => c.textContent!.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(["All 2", "Names to check 1", "This week 2", "Removed 0"]);
  });

  it("opens with the names to check when HQ's quest sent it there", async () => {
    const { hq, calls } = page({ answers: { ...FAMILY_SERVER, "/api/admin/elf/hq": { ...HQ, quests: [{ id: "names", count: 1, title: "First names to check", words: "w", go: "families", button: "Check names", filter: "check" }] } } });
    await hq.open();
    [...document.querySelectorAll<HTMLButtonElement>("#elfHq button")].find((b) => b.textContent === "Check names")!.click();
    await flush();
    expect(urls(calls)).toContain("GET /api/admin/elf/families?filter=check");
  });

  it("searches as you type, after a short pause, and filters", async () => {
    vi.useFakeTimers();
    try {
      const { calls } = await openFamilies();
      const box = familiesPart().querySelector<HTMLInputElement>("input[type=search]")!;
      box.value = "ruby";
      box.dispatchEvent(new Event("input"));
      box.value = "ruby t";
      box.dispatchEvent(new Event("input"));
      expect(urls(calls).filter((u) => u.includes("q="))).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(350);
      expect(urls(calls).filter((u) => u.includes("q="))).toEqual(["GET /api/admin/elf/families?filter=all&q=ruby%20t"]);
      [...familiesPart().querySelectorAll<HTMLButtonElement>(".hq-filter")][3].click();
      await vi.advanceTimersByTimeAsync(10);
      expect(urls(calls).at(-1)).toBe("GET /api/admin/elf/families?filter=removed&q=ruby%20t");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a family's sheet, with Back to families for a phone", async () => {
    const { calls } = await openFamilies();
    cards()[0].click();
    await flush();
    expect(urls(calls)).toContain("GET /api/admin/elf/families/3");
    const sheet = familiesPart().querySelector(".hq-sheet")!;
    expect(sheet.textContent).toContain("Sam Example");
    expect(sheet.textContent).toContain("sam@example.org");
    expect(sheet.textContent).toContain("Detective Ruby Tinselfoot");
    expect(sheet.textContent).toContain("£15");
    expect(sheet.textContent).toContain("entry £10, gift £5");
    expect(sheet.textContent).toContain("Gift Aid on the gift");
    expect(familiesPart().querySelector(".hq-families")!.classList.contains("is-open")).toBe(true);
    inFamilies("Back to families")!.click();
    expect(familiesPart().querySelector(".hq-families")!.classList.contains("is-open")).toBe(false);
  });

  it("ticks a name in one press, and the Families tile counts one fewer", async () => {
    const { calls } = await openFamilies({ ...FAMILY_SERVER, "/api/admin/elf/detectives/7": { detective: { ...SAM_SHEET.detectives[0], familyId: 3, approved: true } } });
    cards()[0].click();
    await flush();
    const toggle = familiesPart().querySelector<HTMLButtonElement>('.hq-toggle[data-detective="7"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Show Ruby in public? Until then it is R.");
    toggle.click();
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([{ method: "PATCH", url: "/api/admin/elf/detectives/7", body: { approved: true } }]);
    const now = familiesPart().querySelector<HTMLButtonElement>('.hq-toggle[data-detective="7"]')!;
    expect(now.getAttribute("aria-checked")).toBe("true");
    expect(now.textContent).toContain("Ruby shows in public");
    expect(tabs()[1].querySelector(".hq-count")!.hidden).toBe(true);
  });

  it("changes a detective's names in place, and shows the server's refusal as an error", async () => {
    const { calls } = await openFamilies({ ...FAMILY_SERVER, "/api/admin/elf/detectives/7": { error: "Please give just one first name: the festive surname comes from the list." } });
    cards()[0].click();
    await flush();
    familiesPart().querySelector<HTMLButtonElement>('.hq-det[data-detective="7"] .hq-rename')!.click();
    const form = familiesPart().querySelector<HTMLFormElement>('.hq-det[data-detective="7"] form')!;
    expect([...form.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Tinselfoot", "Frostwhistle", "Snowsleuth"]);
    form.querySelector<HTMLInputElement>("input[name=firstName]")!.value = "Ruby Mae";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "Please give just one first name: the festive surname comes from the list." }) });
    });
    form.requestSubmit();
    await flush();
    expect(calls.at(-1)).toEqual({ method: "PATCH", url: "/api/admin/elf/detectives/7", body: { firstName: "Ruby Mae", surname: "Tinselfoot" } });
    const said = familiesPart().querySelector('.hq-det[data-detective="7"] .hq-status')!;
    expect(said.textContent).toBe("Please give just one first name: the festive surname comes from the list.");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("changes the grown up's details, and says when another family has the email", async () => {
    await openFamilies();
    cards()[0].click();
    await flush();
    inFamilies("Change details")!.click();
    const form = familiesPart().querySelector<HTMLFormElement>(".hq-sheet__details form")!;
    expect(form.querySelector<HTMLInputElement>("input[name=grownUpName]")!.value).toBe("Sam Example");
    form.querySelector<HTMLInputElement>("input[name=email]")!.value = "alex@example.org";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "Another family already uses that email." }) }));
    form.requestSubmit();
    await flush();
    const said = familiesPart().querySelector(".hq-sheet__details .hq-status")!;
    expect(said.textContent).toBe("Another family already uses that email.");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("sends a sign in code and says where it went", async () => {
    const { calls } = await openFamilies({ ...FAMILY_SERVER, "/api/admin/elf/families/3/sign-in-code": { sent: true, email: "sam@example.org" } });
    cards()[0].click();
    await flush();
    inFamilies("Send a sign in code")!.click();
    await flush();
    expect(urls(calls)).toContain("POST /api/admin/elf/families/3/sign-in-code");
    expect(familiesPart().querySelector(".hq-sheet")!.textContent).toContain("We sent a sign in code to sam@example.org.");
  });

  it("asks before removing, then shows the family as removed, with Put back", async () => {
    const removed = { family: { ...SAM_SHEET, removedAt: "2026-11-14T10:00:00.000Z", removedBy: "admin:boss@example.org" }, surnames: [] };
    const { calls } = await openFamilies({ ...FAMILY_SERVER, "/api/admin/elf/families/3/remove": removed });
    cards()[0].click();
    await flush();
    inFamilies("Remove this family")!.click();
    expect(familiesPart().textContent).toContain(
      "Remove Sam Example's family? They cannot sign in or enrol again with this email until they are put back, and they leave the counts and the money. If they paid, refund them in Stripe first.",
    );
    expect(urls(calls)).not.toContain("POST /api/admin/elf/families/3/remove");
    inFamilies("Yes, remove them")!.click();
    await flush();
    expect(urls(calls)).toContain("POST /api/admin/elf/families/3/remove");
    expect(familiesPart().querySelector(".hq-sheet")!.textContent).toContain("Removed on Saturday 14 November");
    expect(familiesPart().querySelector(".hq-sheet")!.textContent).toContain(
      "They cannot sign in or enrol again with this email until they are put back, and they are left out of the counts and the money.",
    );
    expect(inFamilies("Put back")).toBeTruthy();
    expect(inFamilies("Send a sign in code")).toBeFalsy();
  });

  it("shows a head elf who may only look a family as words, with nothing to change", async () => {
    await openFamilies({ ...FAMILY_SERVER, "/api/admin/elf/hq": { ...HQ, canEdit: false, numbers: { ...HQ.numbers, namesToCheck: 1 } } });
    cards()[0].click();
    await flush();
    const sheet = familiesPart().querySelector(".hq-sheet")!;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Back to families"]);
    expect(sheet.textContent).toContain("You can look at this family. Changing it needs edit access to Head Elf HQ, which an admin can give in Team.");
    expect(sheet.textContent).toContain("Ruby waits for a tick. Until then it is R.");
    expect(sheet.textContent).toContain("Leo shows in public.");
  });

  it("puts a refusal for want of access in plain words", async () => {
    await openFamilies();
    cards()[0].click();
    await flush();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) }));
    inFamilies("Send a sign in code")!.click();
    await flush();
    expect(familiesPart().querySelector(".hq-sheet")!.textContent).toContain("You do not have access to do that. An admin can give it in Team.");
    expect(familiesPart().querySelector(".hq-sheet")!.textContent).not.toContain("forbidden");
  });

  it("opens the family the Donations link asked for", async () => {
    window.sessionStorage.setItem("nbcc_elf_hq_family", "3");
    const { hq, calls } = page({ answers: FAMILY_SERVER });
    await hq.open();
    await flush();
    expect(panel("families").hidden).toBe(false);
    expect(urls(calls)).toContain("GET /api/admin/elf/families/3");
    expect(window.sessionStorage.getItem("nbcc_elf_hq_family")).toBeNull();
  });

  it("opens a family the Donations link asked for whatever its number, and ignores anything else", async () => {
    window.sessionStorage.setItem("nbcc_elf_hq_family", "1234");
    const first = page({ answers: FAMILY_SERVER });
    await first.hq.open();
    await flush();
    expect(urls(first.calls)).toContain("GET /api/admin/elf/families/1234");
    for (const junk of ["0", "12a", "-4", "1d"]) {
      window.sessionStorage.setItem("nbcc_elf_hq_family", junk);
      const { hq, calls } = page({ answers: FAMILY_SERVER });
      await hq.open();
      await flush();
      expect(urls(calls).filter((u) => u.startsWith("GET /api/admin/elf/families/")), junk).toEqual([]);
    }
  });
});

// ---- the Money and Settings screens (Task 8) ----

const moneyPart = () => panel("money");
const settingsPart = () => panel("settings");
const inPart = (part: HTMLElement, words: string) => [...part.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);

describe("the Money screen", () => {
  it("shows the money as HQ does, with what entries are, and a button to Donations showing only the school", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    document.body.insertAdjacentHTML("beforeend", '<button class="admin-nav-link" data-view="donations">Donations</button><input type="checkbox" id="donationsElfFilter">');
    await hq.open();
    tabs()[2].click();
    expect(moneyPart().textContent).toContain("£1,486");
    expect(moneyPart().textContent).toContain("from 128 families");
    expect(moneyPart().textContent).toContain("Entries are a payment to take part, so they are never claimed for Gift Aid.");
    const nav = document.querySelector<HTMLButtonElement>('.admin-nav-link[data-view="donations"]')!;
    const clicked = vi.fn();
    nav.addEventListener("click", clicked);
    const filter = document.getElementById("donationsElfFilter") as HTMLInputElement;
    const changed = vi.fn();
    filter.addEventListener("change", changed);
    inPart(moneyPart(), "Every payment, in Donations")!.click();
    expect(filter.checked).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(clicked).toHaveBeenCalled();
  });

  it("says when there is no money yet", async () => {
    const { hq } = page();
    await hq.open();
    tabs()[2].click();
    expect(moneyPart().textContent).toContain("No payments yet.");
  });
});

describe("the Settings screen", () => {
  it("steps the prices in pounds within their limits, and saves both in pence", async () => {
    const { hq, calls } = page({ answers: { "/api/admin/elf/hq": BUSY, "/api/admin/elf/settings": { settings: { ...BUSY.settings, entryFromPence: 200, entrySuggestedPence: 600 } } } });
    await hq.open();
    tabs()[3].click();
    const [least, suggested] = [...settingsPart().querySelectorAll<HTMLElement>(".hq-stepper")];
    const out = (s: HTMLElement) => s.querySelector("output")!.textContent;
    const press = (s: HTMLElement, which: "less" | "more", times = 1) => {
      for (let i = 0; i < times; i++) s.querySelector<HTMLButtonElement>(`[data-step="${which}"]`)!.click();
    };
    expect([out(least), out(suggested)]).toEqual(["£1", "£5"]);
    press(least, "less");
    expect(out(least)).toBe("£1");
    press(least, "more", 20);
    expect(out(least)).toBe("£10");
    expect(out(suggested)).toBe("£10");
    press(suggested, "less");
    expect(out(suggested)).toBe("£10");
    press(suggested, "more", 60);
    expect(out(suggested)).toBe("£50");
    press(least, "less", 8);
    press(suggested, "less", 44);
    expect([out(least), out(suggested)]).toEqual(["£2", "£6"]);
    inPart(settingsPart(), "Save the prices")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([{ method: "PATCH", url: "/api/admin/elf/settings", body: { entryFromPence: 200, entrySuggestedPence: 600 } }]);
    expect(settingsPart().textContent).toContain("Saved.");
  });

  it("shows the server's refusal as an error", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": BUSY } });
    await hq.open();
    tabs()[3].click();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "The suggested amount cannot be less than the least a family pays." }) }));
    inPart(settingsPart(), "Save the prices")!.click();
    await flush();
    const said = settingsPart().querySelector(".hq-prices .hq-status")!;
    expect(said.textContent).toBe("The suggested amount cannot be less than the least a family pays.");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("makes a preview link and shows it once, to copy", async () => {
    const url = "https://nbcc.scot/elf/preview/" + "a".repeat(64);
    const { hq, calls } = page({ answers: { "/api/admin/elf/hq": BUSY, "/api/admin/elf/preview": { url } } });
    await hq.open();
    tabs()[3].click();
    expect(settingsPart().textContent).toContain("There is no preview link.");
    inPart(settingsPart(), "Make a preview link")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/admin/elf/preview"]);
    const box = settingsPart().querySelector<HTMLInputElement>("#hqPreviewLink")!;
    expect(box.value).toBe(url);
    expect(box.readOnly).toBe(true);
    expect(settingsPart().querySelector('label[for="hqPreviewLink"]')!.textContent).toBe("Copy it now: it is shown only once");
    expect(settingsPart().textContent).toContain("A preview link is open. Anyone who has it can see Elf Detective School.");
    expect(inPart(settingsPart(), "End the link")).toBeTruthy();
  });

  it("ends the preview link", async () => {
    const { hq, calls } = page({ answers: { "/api/admin/elf/hq": { ...BUSY, settings: { ...BUSY.settings, previewOn: true } }, "/api/admin/elf/preview": { ok: true } } });
    await hq.open();
    tabs()[3].click();
    inPart(settingsPart(), "End the link")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/admin/elf/preview"]);
    expect(settingsPart().textContent).toContain("There is no preview link.");
    expect(settingsPart().textContent).toContain("Preview link ended.");
  });

  it("shows someone who is not an admin the prices and the link as words, with nothing to press", async () => {
    const { hq } = page({ answers: { "/api/admin/elf/hq": { ...BUSY, canSwitch: false, settings: { ...BUSY.settings, previewOn: true } } } });
    await hq.open();
    tabs()[3].click();
    expect(settingsPart().textContent).toContain("The least anyone pays is £1 for each detective, and we suggest £5.");
    expect(settingsPart().textContent).toContain("A preview link is open. Anyone who has it can see Elf Detective School.");
    expect(settingsPart().textContent).toContain("Only an admin can change these.");
    expect(settingsPart().querySelectorAll("button")).toHaveLength(0);
  });
});
