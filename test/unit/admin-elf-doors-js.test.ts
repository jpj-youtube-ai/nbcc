// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
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

const LONG_NAME = "The Very Long Named Pine Cone Café and Gift Emporium of the Old Example Road No 8".slice(0, 80);
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
    placeTown: "Exampleton",
    placeAddress: "1 Example Street",
    contactName: "Sam Example",
    contactPhone: "01632 960 123",
    contactEmail: "hello@example.org",
    closesAt: "20:00",
    elfSpot: "On the shelf",
    agreedBy: "Alex Example",
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
      { id: 12, name: "Bakehouse Exampleton" },
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
  it("draws six tiles, Doors then Finds, between Families and Money", () => {
    page();
    const names = [...document.querySelectorAll("#elfHq [role=tab]")].map((t) => t.textContent!.trim());
    expect(names).toEqual(["HQ", "Families", "Doors", "Finds", "Money", "Settings"]);
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

  it("counts only the not ready doors still to come, not the ones whose day has passed", async () => {
    const doors = tiles().map((t) => ({ ...t, started: t.door <= 7 }));
    page({ "GET /api/admin/elf/doors": { body: { ...LIST, doors } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    // Doors 8 to 24 are still to come and none is ready: 17. Door 3 is ready and doors 1 to 7 have started.
    expect(document.querySelector("#hqTab-doors .hq-count")!.textContent).toBe("17");
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
    const more = sheet({ names: [{ id: 11, name: "The Bakehouse" }, { id: 12, name: "Bakehouse Exampleton" }, { id: 13, name: "Corner Bakehouse Two" }] });
    const { calls } = page({
      "POST /api/admin/elf/doors/7/names": { status: 201, body: { door: more } },
      "DELETE /api/admin/elf/doors/7/names/13": { body: { door: sheet() } },
    });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    type(field("newName"), "Corner Bakehouse Two");
    button(partOf("place"), "Add a name")!.click();
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Corner Bakehouse Two" });
    expect(partOf("place").textContent).toContain("Corner Bakehouse Two");
    partOf("place").querySelector<HTMLButtonElement>('button[aria-label="Remove Corner Bakehouse Two"]')!.click();
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

async function openSeven(answers: Record<string, Answer | Answer[]> = {}) {
  const ctx = page(answers);
  document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
  await flush();
  tile(7).focus();
  tile(7).click();
  await flush();
  return ctx;
}

describe("keeping what was typed, and the focus", () => {
  it("keeps a typed prize when The place is saved", async () => {
    await openSeven({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    type(field("prize"), "A different prize, typed but not saved");
    type(field("placeTown"), "Exampleton Quay");
    button(partOf("place"), "Save")!.click();
    await flush();
    expect(field("prize").value).toBe("A different prize, typed but not saved");
    expect(field("placeTown").value).toBe("Exampleton");
  });

  it("keeps a typed place name and town when a name is added, and clears only the new name", async () => {
    const more = sheet({ names: [{ id: 11, name: "The Bakehouse" }, { id: 12, name: "Bakehouse Exampleton" }, { id: 13, name: "Corner Bakehouse Two" }] });
    await openSeven({ "POST /api/admin/elf/doors/7/names": { status: 201, body: { door: more } } });
    type(field("placeName"), "Typed Name");
    type(field("placeTown"), "Typed Town");
    type(field("newName"), "Corner Bakehouse Two");
    button(partOf("place"), "Add a name")!.click();
    await flush();
    expect(field("placeName").value).toBe("Typed Name");
    expect(field("placeTown").value).toBe("Typed Town");
    expect(field("newName").value).toBe("");
    expect(partOf("place").textContent).toContain("Corner Bakehouse Two");
    expect(document.activeElement).toBe(field("newName"));
  });

  it("keeps the elf's typed name when a new word is made", async () => {
    await openSeven({ "POST /api/admin/elf/doors/7/word": { body: { door: sheet({ tagWord: "MISTLETOE 108" }) } } });
    type(field("elfName"), "Typed Elf");
    button(partOf("elf"), "Make a new word")!.click();
    await flush();
    expect(field("elfName").value).toBe("Typed Elf");
    expect(partOf("elf").textContent).toContain("MISTLETOE 108");
  });

  it("keeps focus on the chosen tile, and moves it to the saved part's Save button after a save", async () => {
    await openSeven({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    expect(document.activeElement).toBe(tile(7));
    expect(tile(7).getAttribute("aria-pressed")).toBe("true");
    type(field("prize"), "Another prize");
    field("prize").focus();
    button(partOf("prize"), "Save")!.click();
    await flush();
    expect(document.activeElement).toBe(button(partOf("prize"), "Save"));
  });

  it("does not let a late save flip the sheet back to the door left", async () => {
    const eight = sheet({ door: 8, day: "Tuesday 8 December", placeName: "Sweet Example Shop" });
    const saved = sheet({ placeName: "Corner Bakehouse Renamed" });
    const { calls } = page({
      "GET /api/admin/elf/doors/8": { body: { door: eight, canEdit: true } },
      "PATCH /api/admin/elf/doors/7": { body: { door: saved } },
    });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    const real = window.fetch;
    let release = () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) =>
      init.method === "PATCH" ? new Promise((res) => { release = () => res(real(url, init)); }) : real(url, init),
    );
    button(partOf("place"), "Save")!.click();
    await flush();
    tile(8).click();
    await flush();
    release();
    await flush();
    expect(tile(8).getAttribute("aria-pressed")).toBe("true");
    expect(tile(7).getAttribute("aria-pressed")).toBe("false");
    expect(sheetEl().querySelector("h2")!.textContent).toBe("Door 8 · Tuesday 8 December");
    expect(tile(7).textContent).toContain("Corner Bakehouse Renamed");
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("long words", () => {
  it("shows a 200 character prize whole, in a field that grows rather than scrolls", async () => {
    const long = "p".repeat(200);
    await openSeven({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ prize: long, placeAddress: long, elfSpot: long }), canEdit: true } } });
    for (const k of ["prize", "placeAddress", "elfSpot"]) {
      const f = field(k) as unknown as HTMLTextAreaElement;
      expect(f.tagName, k).toBe("TEXTAREA");
      expect(f.value, k).toHaveLength(200);
      expect(f.getAttribute("rows"), k).toBeNull();
    }
  });

  it("shows the whole prize in a disabled field too", async () => {
    const long = "q".repeat(200);
    page({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ prize: long }), canEdit: false } } });
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(7).click();
    await flush();
    const f = field("prize") as unknown as HTMLTextAreaElement;
    expect(f.disabled).toBe(true);
    expect(f.value).toBe(long);
  });
});

describe("the stylesheet's Doors rules", () => {
  const NEWLINE = /\r?\n/;
  const css = readFileSync(resolve(__dirname, "../../assets/css/admin-elf-hq.css"), "utf8");
  it("never hyphenates a place name, and lets a long other name wrap", () => {
    expect(css).not.toMatch(/hyphens\s*:\s*auto/);
    const chip = css.split(NEWLINE).find((l) => l.startsWith(".hq-names .hq-chip"))!;
    expect(chip).toContain("white-space: normal");
    expect(chip).toContain("max-width: 100%");
  });
  it("keeps four columns beside the sheet, and three only when the level select is really narrow", () => {
    const m = /@container \(max-width: (\d+)px\) \{\s*\.hq-door-grid/.exec(css)!;
    expect(Number(m[1])).toBeLessThan(360);
  });
});

describe("Make a new word, one question at a time", () => {
  it("shows one question however often it is pressed, and disables Yes while it runs", async () => {
    await openSeven({ "POST /api/admin/elf/doors/7/word": [{ status: 409, body: { error: "Printed.", printed: true } }, { status: 409, body: { error: "Printed.", printed: true } }] });
    button(partOf("elf"), "Make a new word")!.click();
    await flush();
    button(partOf("elf"), "Make a new word")!.click();
    await flush();
    expect(partOf("elf").querySelectorAll(".hq-confirm")).toHaveLength(1);
    const yes = button(partOf("elf"), "Yes")!;
    yes.click();
    expect(yes.disabled).toBe(true);
    await flush();
  });
});

// ---- Task 10: the place's name that wraps, the focus, hidden fields, the snow day and gone home ----

/** Makes every textarea's scrollHeight answer `height`, until the returned function puts it back. */
function stubScrollHeight(height: (box: HTMLElement) => number): () => void {
  const proto = HTMLTextAreaElement.prototype;
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get() { return height(this as HTMLElement); } });
  return () => {
    delete (proto as unknown as Record<string, unknown>).scrollHeight;
  };
}

describe("the name of the place", () => {
  it("is a box that wraps and grows to fit its words, like the other long fields", async () => {
    await openSeven();
    const name = field("placeName");
    expect(name.tagName).toBe("TEXTAREA");
    expect(name.classList.contains("hq-grow")).toBe(true);
    const restore = stubScrollHeight(() => 96);
    try {
      type(name, "x".repeat(80));
      expect(name.style.height).toBe("96px");
      expect(name.value).toHaveLength(80);
    } finally {
      restore();
    }
  });

  it("stays one name: Enter does not add a line, and a pasted line break is a space", async () => {
    await openSeven();
    const name = field("placeName");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    name.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    type(name, "Corner\nBakehouse");
    expect(name.value).toBe("Corner Bakehouse");
  });
});

describe("the focus after a save", () => {
  it("does not move to the Save button when focus was somewhere else", async () => {
    await openSeven({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    type(field("prize"), "Another prize");
    tile(7).focus();
    button(partOf("prize"), "Save")!.click();
    await flush();
    expect(document.activeElement).toBe(tile(7));
  });

  it("moves to the Save button when focus was in the part being saved", async () => {
    await openSeven({ "PATCH /api/admin/elf/doors/7": { body: { door: sheet() } } });
    type(field("prize"), "Another prize");
    field("prize").focus();
    button(partOf("prize"), "Save")!.click();
    await flush();
    expect(document.activeElement).toBe(button(partOf("prize"), "Save"));
  });
});

describe("fields drawn while their tab was hidden", () => {
  it("are fitted to their words when the Doors tab is shown", async () => {
    // A hidden box has no height to measure, as in a browser.
    const restore = stubScrollHeight((box) => (box.closest("[hidden]") ? 0 : 90));
    try {
      page();
      document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
      await flush();
      tile(7).click();
      document.querySelector<HTMLButtonElement>("#hqTab-hq")!.click(); // away before the sheet arrives
      await flush();
      expect(field("placeAddress").style.height).not.toBe("90px");
      document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
      expect(field("placeAddress").style.height).toBe("90px");
    } finally {
      restore();
    }
  });
});

describe("if the door cannot run", () => {
  const WHEN = "2026-12-06T09:00:00.000Z";
  const eight = (over: Record<string, unknown> = {}) => sheet({ door: 8, day: "Tuesday 8 December", ...over });
  const withEight = (over: Record<string, unknown> = {}, more: Record<string, Answer | Answer[]> = {}, canEdit = true) =>
    page({ "GET /api/admin/elf/doors/8": { body: { door: eight(over), canEdit } }, ...more });
  async function openEight() {
    document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
    await flush();
    tile(8).click();
    await flush();
  }

  it("has a part with Call a snow day, which asks first and then posts", async () => {
    const { calls } = withEight({}, { "POST /api/admin/elf/doors/8/snow-day": { body: { door: eight({ snowDay: { at: WHEN, by: "admin:staff@example.org" } }) } } });
    await openEight();
    expect(partOf("snow").querySelector("h3")!.textContent).toBe("If the door cannot run");
    button(partOf("snow"), "Call a snow day")!.click();
    expect(partOf("snow").textContent).toContain("Call a snow day for door 8? Its elf will be snowed in, and every detective gets the door done.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    button(partOf("snow"), "Yes, call a snow day")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", url: "/api/admin/elf/doors/8/snow-day", body: null }]);
    expect(partOf("snow").textContent).toContain("Snow day called by staff@example.org on 6 December");
    expect(button(partOf("snow"), "Cancel the snow day")).toBeTruthy();
    expect(button(partOf("snow"), "Call a snow day")).toBeFalsy();
  });

  it("changes nothing when the question is answered No", async () => {
    const { calls } = withEight();
    await openEight();
    button(partOf("snow"), "Call a snow day")!.click();
    button(partOf("snow"), "Not yet")!.click();
    expect(partOf("snow").textContent).not.toContain("Call a snow day for door 8?");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("cancels the snow day", async () => {
    const { calls } = withEight({ snowDay: { at: WHEN, by: "admin:staff@example.org" } }, { "DELETE /api/admin/elf/doors/8/snow-day": { body: { door: eight() } } });
    await openEight();
    button(partOf("snow"), "Cancel the snow day")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([{ method: "DELETE", url: "/api/admin/elf/doors/8/snow-day", body: null }]);
    expect(button(partOf("snow"), "Call a snow day")).toBeTruthy();
    expect(partOf("snow").textContent).not.toContain("Snow day called by");
  });

  it("says an automatic snow day in its own words", async () => {
    withEight({ snowDay: { at: WHEN, by: "automatic" } });
    await openEight();
    expect(partOf("snow").textContent).toContain("Snow day: the door was not ready at its first clue");
    expect(partOf("snow").textContent).not.toContain("called by");
  });

  it("shows a refusal as an error, and lets the head elf ask again", async () => {
    const { calls } = withEight({}, { "POST /api/admin/elf/doors/8/snow-day": { status: 409, body: { error: "Door 8's evening has started, so it cannot be called off now." } } });
    await openEight();
    button(partOf("snow"), "Call a snow day")!.click();
    button(partOf("snow"), "Yes, call a snow day")!.click();
    await flush();
    const said = partOf("snow").querySelector(".hq-status")!;
    expect(said.textContent).toBe("Door 8's evening has started, so it cannot be called off now.");
    expect(said.classList.contains("is-error")).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(button(partOf("snow"), "Call a snow day")).toBeTruthy();
  });

  it("offers neither the call nor the cancel once the first clue is out", async () => {
    withEight({ started: true, clueOut: [true, false, false], snowDay: { at: WHEN, by: "automatic" } });
    await openEight();
    expect(partOf("snow").textContent).toContain("Snow day: the door was not ready at its first clue");
    expect(partOf("snow").querySelectorAll("button")).toHaveLength(0);
    withEight({ started: true, clueOut: [true, false, false] });
    await openEight();
    expect(button(partOf("snow"), "Call a snow day")).toBeFalsy();
  });

  it("is words only for a head elf who may only look", async () => {
    withEight({ snowDay: { at: WHEN, by: "admin:staff@example.org" } }, {}, false);
    await openEight();
    expect(partOf("snow").textContent).toContain("Snow day called by staff@example.org on 6 December");
    expect(partOf("snow").querySelectorAll("button")).toHaveLength(0);
  });

  it("ticks gone home once the door's day is over, and shows who and when", async () => {
    const done = eight({ dayOver: true, goneHome: { at: "2026-12-09T09:00:00.000Z", by: "admin:staff@example.org" } });
    const { calls } = withEight({ dayOver: true }, { "POST /api/admin/elf/doors/8/gone-home": { body: { door: done } } });
    await openEight();
    const tick = sheetEl().querySelector<HTMLInputElement>("#hqDoor-goneHome")!;
    expect(sheetEl().querySelector('label[for="hqDoor-goneHome"]')!.textContent).toBe("Gone home: the place has stopped hosting the elf");
    expect(tick.checked).toBe(false);
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", url: "/api/admin/elf/doors/8/gone-home", body: null }]);
    expect(partOf("snow").textContent).toContain("Ticked by staff@example.org on 9 December");
    expect(sheetEl().querySelector<HTMLInputElement>("#hqDoor-goneHome")!.checked).toBe(true);
  });

  it("unticks gone home with DELETE", async () => {
    const { calls } = withEight(
      { dayOver: true, goneHome: { at: "2026-12-09T09:00:00.000Z", by: "admin:staff@example.org" } },
      { "DELETE /api/admin/elf/doors/8/gone-home": { body: { door: eight({ dayOver: true }) } } },
    );
    await openEight();
    const tick = sheetEl().querySelector<HTMLInputElement>("#hqDoor-goneHome")!;
    expect(tick.checked).toBe(true);
    tick.checked = false;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([{ method: "DELETE", url: "/api/admin/elf/doors/8/gone-home", body: null }]);
    expect(sheetEl().querySelector<HTMLInputElement>("#hqDoor-goneHome")!.checked).toBe(false);
  });

  it("has no gone home tick before the door's day is over, and the tick is disabled for someone who may only look", async () => {
    withEight({ dayOver: false });
    await openEight();
    expect(sheetEl().querySelector("#hqDoor-goneHome")).toBeNull();
    withEight({ dayOver: true }, {}, false);
    await openEight();
    expect(sheetEl().querySelector<HTMLInputElement>("#hqDoor-goneHome")!.disabled).toBe(true);
  });
});
