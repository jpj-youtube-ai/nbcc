// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ > Doors (assets/js/admin/elf-hq.js): the 24 doors and a door's sheet, against a pretend
// server. Every place, person and prize here is invented.
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

const LONG_NAME = "The Very Long Named Pine Cone Café and Gift Emporium of the Old Harbour Road No 8".slice(0, 80);
const WEEKDAYS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];

function tiles() {
  return Array.from({ length: 24 }, (_, i) => {
    const door = i + 1;
    const base = { door, weekday: WEEKDAYS[i % 7], placeName: null as string | null, ready: false, toDo: 6 };
    if (door === 3) return { ...base, placeName: "Pine Cone Café", ready: true, toDo: 0 };
    if (door === 7) return { ...base, placeName: "Corner Bakehouse", toDo: 3 };
    if (door === 9) return { ...base, placeName: LONG_NAME, toDo: 4 };
    return base;
  });
}

const LIST = { year: 2026, doors: tiles(), counts: { placesAgreed: 3, prizesChosen: 2, ready: 1 }, prizeList: "Door 1: No prize yet", canEdit: true };

const ITEMS = [
  ["place", true],
  ["prize", true],
  ["picture", false],
  ["elf", true],
  ["clues", false],
  ["droppedOff", false],
] as const;

function sheet(over: Record<string, unknown> = {}) {
  return {
    door: 7,
    placeName: "Corner Bakehouse",
    placeTown: "Girvan",
    placeAddress: "12 Harbour Street",
    contactName: "Morag",
    contactPhone: "01632 960 123",
    contactEmail: "hello@example.org",
    closesAt: "20:00",
    elfSpot: "On the shelf",
    agreedBy: "Jodie",
    prize: "A wooden sledge",
    prizeShowOff: false,
    elfName: "Twinkle",
    tagWord: "SNOWBALL 472",
    tagPrintedAt: null,
    clue1Time: null,
    clue2Time: null,
    clue3Time: null,
    revealTime: null,
    posterCode: "abc",
    droppedOffAt: null,
    droppedOffBy: null,
    thankedAt: null,
    thankedBy: null,
    names: [
      { id: 11, name: "The Bakehouse" },
      { id: 12, name: "Bakehouse Girvan" },
    ],
    clues: [
      { n: 1, words: null },
      { n: 2, words: null },
      { n: 3, words: null },
    ],
    day: "Monday 7 December",
    readiness: { items: ITEMS.map(([key, done]) => ({ key, done })), toDo: 3, ready: false },
    evening: { clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00", problems: [] },
    closesTooSoon: false,
    picture: null,
    posterUrl: "https://example.org/elf/p/abc",
    clueOut: [false, false, false],
    started: false,
    ...over,
  };
}

type Call = { method: string; url: string; body: unknown };
type Answer = { status?: number; body: unknown };

/** The admin page, a pretend server that answers by "METHOD /path", and Head Elf HQ started on it. */
function page(answers: Record<string, Answer | Answer[]> = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-elf"><div id="elfHq"></div></section></div>`;
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const all: Record<string, Answer | Answer[]> = {
      "GET /api/admin/elf/doors": { body: LIST },
      "GET /api/admin/elf/doors/7": { body: { door: sheet(), canEdit: true } },
      ...answers,
    };
    let a = all[`${method} ${url}`] ?? { body: HQ };
    if (Array.isArray(a)) a = a.length > 1 ? (a.shift() as Answer) : a[0];
    const status = a.status ?? 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(a.body))) });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls };
}

const doorsPart = () => document.querySelector<HTMLElement>('#elfHq [role=tabpanel][data-tab="doors"]')!;
const tile = (n: number) => doorsPart().querySelector<HTMLButtonElement>(`.hq-door[data-door="${n}"]`)!;
const sheetEl = () => doorsPart().querySelector<HTMLElement>(".hq-door-sheet")!;
const partOf = (key: string) => sheetEl().querySelector<HTMLElement>(`[data-part="${key}"]`)!;
const button = (within: ParentNode, words: string) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);
const field = (key: string) => sheetEl().querySelector<HTMLInputElement>(`#hqDoor-${key}`)!;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function openDoors() {
  const ctx = page();
  document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
  await flush();
  return ctx;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the menu with the Doors tile", () => {
  it("draws five tiles, Doors between Families and Money", () => {
    page();
    const names = [...document.querySelectorAll("#elfHq [role=tab]")].map((t) => t.textContent!.trim());
    expect(names).toEqual(["HQ", "Families", "Doors", "Money", "Settings"]);
  });
});

describe("the 24 doors", () => {
  it("reads the doors once when the Doors tab opens, and draws 24 tiles", async () => {
    const { calls } = await openDoors();
    expect(calls.filter((c) => c.url === "/api/admin/elf/doors")).toHaveLength(1);
    expect(doorsPart().querySelectorAll(".hq-door")).toHaveLength(24);
    document.querySelector<HTMLButtonElement>("#hqTab-hq")!.click();
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    expect(calls.filter((c) => c.url === "/api/admin/elf/doors")).toHaveLength(1);
  });

  it("shows the heading and the three chips", async () => {
    await openDoors();
    expect(doorsPart().querySelector(".hq-level h2")!.textContent).toBe("The 24 doors");
    const chips = [...doorsPart().querySelectorAll(".hq-level .hq-chip")].map((c) => c.textContent);
    expect(chips).toEqual(["3 places agreed", "2 prizes chosen", "1 ready for their day"]);
  });

  it("shows door 3 with its place, its weekday and Ready, and an empty door as No place yet", async () => {
    await openDoors();
    const t = tile(3);
    expect(t.textContent).toContain("3");
    expect(t.textContent).toContain("Pine Cone Café");
    expect(t.textContent).toContain("Thu");
    expect(t.textContent).toContain("Ready");
    expect(t.classList.contains("is-ready")).toBe(true);
    expect(tile(7).textContent).toContain("3 to do");
    expect(tile(7).classList.contains("is-needs")).toBe(true);
    expect(tile(1).textContent).toContain("No place yet");
    expect(tile(1).classList.contains("is-empty")).toBe(true);
  });

  it("carries an 80 character place name whole in its tile", async () => {
    await openDoors();
    expect(LONG_NAME).toHaveLength(80);
    expect(tile(9).querySelector(".hq-door__where")!.textContent).toBe(LONG_NAME);
  });

  it("puts a count of the doors still to do on the tile", async () => {
    await openDoors();
    expect(document.querySelector("#hqTab-doors .hq-count")!.textContent).toBe("23");
  });

  it("says a failure as an error", async () => {
    page({ "GET /api/admin/elf/doors": { status: 500, body: { error: "Admin is temporarily unavailable" } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    const status = document.querySelector("#elfHq .hq-status")!;
    expect(status.textContent).toContain("Admin is temporarily unavailable");
    expect(status.classList.contains("is-error")).toBe(true);
  });
});

describe("a door's sheet", () => {
  it("opens door 7 from its tile, with its heading and the six ready items", async () => {
    const { calls } = await openDoors();
    tile(7).click();
    await flush();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain("GET /api/admin/elf/doors/7");
    expect(tile(7).getAttribute("aria-pressed")).toBe("true");
    expect(tile(3).getAttribute("aria-pressed")).toBe("false");
    expect(sheetEl().querySelector("h2")!.textContent).toBe("Door 7 · Monday 7 December");
    expect(sheetEl().textContent).toContain("Corner Bakehouse");
    const items = [...sheetEl().querySelectorAll(".hq-ready-list li")];
    expect(items.map((li) => li.textContent!.replace(/\s*(done|to do)$/, ""))).toEqual([
      "The place",
      "The prize",
      "The door picture",
      "The elf and its tag",
      "The three clues",
      "Dropped off",
    ]);
    expect(items.map((li) => li.classList.contains("is-done"))).toEqual([true, true, false, true, false, false]);
  });

  it("fills the place and the evening from the door", async () => {
    await openDoors();
    tile(7).click();
    await flush();
    expect(field("placeName").value).toBe("Corner Bakehouse");
    expect(field("contactPhone").value).toBe("01632 960 123");
    expect(field("clue1Time").value).toBe("17:30");
    expect(field("revealTime").value).toBe("19:00");
    expect(partOf("place").textContent).toContain("The Bakehouse");
    expect(partOf("place").textContent).toContain("The reminder on its day goes here");
    expect(partOf("place").textContent).toContain("Open past 7:30pm, an hour after the last clue.");
    expect(partOf("evening").textContent).toContain("The place gets its reminder email at 9am.");
    expect(partOf("evening").textContent).toContain("On a school holiday, set clue 1 to the morning.");
    expect(partOf("prize").textContent).toContain("A prize must not point at the place giving it.");
    expect(partOf("prize").textContent).toContain("Not made yet. It is made from the prize list.");
    expect(partOf("elf").textContent).toContain("SNOWBALL 472");
    expect(sheetEl().querySelector('[data-part="clues"] h3')!.textContent).toBe("The three clues");
    expect(sheetEl().querySelector('[data-part="prints"] h3')!.textContent).toBe("Print and drop off");
  });

  it("warns, as an error, when the place closes too soon", async () => {
    page({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ closesTooSoon: true }), canEdit: true } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    const hint = partOf("place").querySelector(".hq-hint.is-error")!;
    expect(hint.textContent).toBe("It closes less than an hour after the last clue.");
  });

  it("saves The place with only the place's fields, and redraws the tile from the answer", async () => {
    const saved = sheet({ placeName: "Pine Cone Café", readiness: { items: ITEMS.map(([key]) => ({ key, done: true })), toDo: 0, ready: true } });
    const { calls } = page({ "PATCH /api/admin/elf/doors/7": { body: { door: saved } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    type(field("placeName"), "Pine Cone Café");
    button(partOf("place"), "Save")!.click();
    await flush();
    const patch = calls.filter((c) => c.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0].url).toBe("/api/admin/elf/doors/7");
    expect(Object.keys(patch[0].body as object).sort()).toEqual(
      ["agreedBy", "closesAt", "contactEmail", "contactName", "contactPhone", "elfSpot", "placeAddress", "placeName", "placeTown"].sort(),
    );
    expect((patch[0].body as Record<string, string>).placeName).toBe("Pine Cone Café");
    expect(tile(7).textContent).toContain("Pine Cone Café");
    expect(tile(7).textContent).toContain("Ready");
    expect(partOf("place").querySelector(".hq-status")!.textContent).toBe("Saved.");
    expect(partOf("place").querySelector(".hq-status")!.classList.contains("is-ok")).toBe(true);
  });

  it("shows a 400 answer's sentence as an error and keeps what was typed", async () => {
    page({ "PATCH /api/admin/elf/doors/7": { status: 400, body: { error: "That email does not look right." } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    type(field("contactEmail"), "nonsense");
    button(partOf("place"), "Save")!.click();
    await flush();
    const said = partOf("place").querySelector(".hq-status")!;
    expect(said.textContent).toBe("That email does not look right.");
    expect(said.classList.contains("is-error")).toBe(true);
    expect(field("contactEmail").value).toBe("nonsense");
  });

  it("sends only the evening times that were changed, and never times from The place", async () => {
    const { calls } = page({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    type(field("clue2Time"), "18:15");
    button(partOf("evening"), "Save")!.click();
    await flush();
    button(partOf("place"), "Save")!.click();
    await flush();
    const bodies = calls.filter((c) => c.method === "PATCH").map((c) => c.body as Record<string, unknown>);
    expect(bodies[0]).toEqual({ clue2Time: "18:15" });
    expect(Object.keys(bodies[1])).not.toContain("clue1Time");
    expect(Object.keys(bodies[1]).some((k) => /Time$/.test(k))).toBe(false);
  });

  it("sends the prize part's fields alone, and the elf's name alone", async () => {
    const { calls } = page({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    button(partOf("prize"), "Save")!.click();
    await flush();
    button(partOf("elf"), "Save")!.click();
    await flush();
    const bodies = calls.filter((c) => c.method === "PATCH").map((c) => c.body);
    expect(bodies).toEqual([{ prize: "A wooden sledge", prizeShowOff: false }, { elfName: "Twinkle" }]);
  });

  it("adds and removes a name that counts", async () => {
    const more = sheet({ names: [{ id: 11, name: "The Bakehouse" }, { id: 12, name: "Bakehouse Girvan" }, { id: 13, name: "Corner Bakery" }] });
    const { calls } = page({
      "POST /api/admin/elf/doors/7/names": { status: 201, body: { door: more } },
      "DELETE /api/admin/elf/doors/7/names/13": { body: { door: sheet() } },
    });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    type(field("newName"), "Corner Bakery");
    button(partOf("place"), "Add a name")!.click();
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Corner Bakery" });
    expect(partOf("place").textContent).toContain("Corner Bakery");
    partOf("place").querySelector<HTMLButtonElement>('button[aria-label="Remove Corner Bakery"]')!.click();
    await flush();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/elf/doors/7/names/13")).toBe(true);
  });

  it("with no edit access has no Save, Add or remove button, and every field is disabled", async () => {
    page({ "GET /api/admin/elf/doors/7": { body: { door: sheet(), canEdit: false } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    const labels = [...sheetEl().querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent!.trim());
    expect(labels.filter((t) => t.startsWith("Save") || t === "Add a name" || t === "Make a new word" || t.startsWith("Remove"))).toEqual([]);
    const inputs = [...sheetEl().querySelectorAll("input")];
    expect(inputs.length).toBeGreaterThan(10);
    for (const i of inputs) expect(i.disabled, i.id).toBe(true);
    expect(partOf("place").textContent).toContain("The Bakehouse");
  });

  it("makes the four times read only once the evening has started", async () => {
    page({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ started: true, clueOut: [true, false, false] }), canEdit: true } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    for (const k of ["clue1Time", "clue2Time", "clue3Time", "revealTime"]) expect(field(k).readOnly, k).toBe(true);
    expect(partOf("evening").textContent).toContain("This door's evening has started.");
    expect(field("placeName").readOnly).toBe(false);
  });

  it("shows the picture when there is one", async () => {
    page({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ picture: "/assets/img/elf/doors/7.webp" }), canEdit: true } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    expect(partOf("prize").querySelector("img")!.getAttribute("src")).toBe("/assets/img/elf/doors/7.webp");
    expect(partOf("prize").textContent).not.toContain("Not made yet");
  });
});

describe("Make a new word", () => {
  it("asks first when the tag was printed, and Yes sends confirm", async () => {
    const fresh = sheet({ tagWord: "MISTLETOE 108" });
    const { calls } = page({
      "POST /api/admin/elf/doors/7/word": [
        { status: 409, body: { error: "This door's tag has been printed. Make a new word only if you will print the tag again.", printed: true } },
        { body: { door: fresh } },
      ],
    });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    button(partOf("elf"), "Make a new word")!.click();
    await flush();
    expect(partOf("elf").textContent).toContain("This door's tag has been printed. Make a new word anyway?");
    expect(button(partOf("elf"), "No")).toBeTruthy();
    expect(calls.filter((c) => c.url.endsWith("/word"))).toHaveLength(1);
    button(partOf("elf"), "Yes")!.click();
    await flush();
    const posts = calls.filter((c) => c.url.endsWith("/word"));
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toEqual({ confirm: true });
    expect(partOf("elf").textContent).toContain("MISTLETOE 108");
    expect(partOf("elf").textContent).not.toContain("has been printed");
  });

  it("No leaves the word alone", async () => {
    const { calls } = page({ "POST /api/admin/elf/doors/7/word": { status: 409, body: { error: "Printed.", printed: true } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    button(partOf("elf"), "Make a new word")!.click();
    await flush();
    button(partOf("elf"), "No")!.click();
    expect(partOf("elf").textContent).not.toContain("has been printed");
    expect(calls.filter((c) => c.url.endsWith("/word"))).toHaveLength(1);
  });
});
