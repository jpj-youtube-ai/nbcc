// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ > Doors: the three clues, paste all the clues, the prints and the drop off ticks, against a
// pretend server. Every place, person and prize here is invented.
const require = createRequire(import.meta.url);
const { initElfHq } = require(resolve(__dirname, "../../assets/js/admin/elf-hq.js"));

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
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

const WEEKDAYS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
const LIST = {
  year: 2026,
  doors: Array.from({ length: 24 }, (_, i) => ({ door: i + 1, weekday: WEEKDAYS[i % 7], placeName: i === 6 ? "Pine Cone Café" : null, ready: false, toDo: 5 })),
  counts: { placesAgreed: 1, prizesChosen: 1, ready: 0 },
  prizeList: "Door 7: A wooden sledge",
  canEdit: true,
};

function sheet(over: Record<string, unknown> = {}) {
  return {
    door: 7,
    placeName: "Pine Cone Café",
    placeTown: "Exampleton",
    placeAddress: "1 Example Street",
    contactName: "Alex Example",
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
    names: [],
    clues: [
      { n: 1, words: "Saved words one" },
      { n: 2, words: null },
      { n: 3, words: null },
    ],
    day: "Monday 7 December",
    readiness: { items: [{ key: "place", done: true }, { key: "clues", done: false }], toDo: 1, ready: false },
    evening: { clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00", problems: [] },
    closesTooSoon: false,
    picture: null,
    posterUrl: "https://example.org/elf/p/abc",
    clueOut: [false, false, false],
    started: false,
    ...over,
  };
}

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };
type Answer = { status?: number; body?: unknown; text?: string };

function page(answers: Record<string, Answer | Answer[]> = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-elf"><div id="elfHq"></div></section></div>`;
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null, headers: (init.headers ?? {}) as Record<string, string> });
    const all: Record<string, Answer | Answer[]> = {
      "GET /api/admin/elf/doors": { body: LIST },
      "GET /api/admin/elf/doors/7": { body: { door: sheet(), canEdit: true } },
      ...answers,
    };
    let a = all[`${method} ${url}`] ?? { body: HQ };
    if (Array.isArray(a)) a = a.length > 1 ? (a.shift() as Answer) : a[0];
    const status = a.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(a.body ?? {}))),
      text: () => Promise.resolve(a.text ?? (a.body !== undefined ? JSON.stringify(a.body) : "<p>page</p>")),
    });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "tok");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls };
}

const doorsPart = () => document.querySelector<HTMLElement>('#elfHq [role=tabpanel][data-tab="doors"]')!;
const sheetEl = () => doorsPart().querySelector<HTMLElement>(".hq-door-sheet")!;
const button = (within: ParentNode, words: string) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);
const clueBox = (n: number) => sheetEl().querySelector<HTMLTextAreaElement>(`#hqDoor-clue${n}`)!;
const partOf = (key: string) => sheetEl().querySelector<HTMLElement>(`[data-part="${key}"]`)!;
const clueItem = (n: number) => sheetEl().querySelector<HTMLElement>(`[data-part="clue${n}"]`)!;
const type = (input: HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function openDoor7(answers: Record<string, Answer | Answer[]> = {}) {
  const ctx = page(answers);
  document.querySelector<HTMLButtonElement>("#hqTab-doors")!.click();
  await flush();
  doorsPart().querySelector<HTMLButtonElement>('.hq-door[data-door="7"]')!.click();
  await flush();
  return ctx;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

// Stand-ins for the clipboard and the tab opener are put back after every test.
afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  delete (window as unknown as Record<string, unknown>).ClipboardItem;
  vi.restoreAllMocks();
});

describe("the three clues", () => {
  it("draws three numbered clues with their times, growing boxes and a count", async () => {
    await openDoor7();
    const part = sheetEl().querySelector('[data-part="clues"]')!;
    expect(part.querySelectorAll("textarea")).toHaveLength(3);
    expect(clueItem(1).textContent).toContain("Clue 1 · 5:30pm");
    expect(clueItem(2).textContent).toContain("Clue 2 · 6pm");
    expect(clueItem(3).textContent).toContain("Clue 3 · 6:30pm");
    expect(clueBox(1).value).toBe("Saved words one");
    expect(clueItem(1).textContent).toContain("15 of 500");
    expect(clueItem(2).textContent).toContain("0 of 500");
    expect(clueBox(1).classList.contains("hq-grow")).toBe(true);
  });

  it("counts as you type, and saves only that clue with a PUT", async () => {
    const saved = sheet({ clues: [{ n: 1, words: "Saved words one" }, { n: 2, words: "New second words" }, { n: 3, words: null }] });
    const { calls } = await openDoor7({ "PUT /api/admin/elf/doors/7/clues/2": { body: { door: saved } } });
    type(clueBox(2), "New second words");
    expect(clueItem(2).textContent).toContain("16 of 500");
    button(clueItem(2), "Save")!.click();
    await flush();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/admin/elf/doors/7/clues/2");
    expect(put.body).toEqual({ words: "New second words" });
    expect(clueItem(2).querySelector(".hq-status")!.textContent).toBe("Saved.");
  });

  it("keeps unsaved typing in the other clues when one is saved", async () => {
    const saved = sheet({ clues: [{ n: 1, words: "Saved words one" }, { n: 2, words: "Two" }, { n: 3, words: null }] });
    await openDoor7({ "PUT /api/admin/elf/doors/7/clues/2": { body: { door: saved } } });
    type(clueBox(3), "Half written third");
    type(clueBox(2), "Two");
    button(clueItem(2), "Save")!.click();
    await flush();
    expect(clueBox(3).value).toBe("Half written third");
  });

  it("shows a count over 500 as an error and sends nothing", async () => {
    const { calls } = await openDoor7();
    type(clueBox(3), "x".repeat(501));
    const count = clueItem(3).querySelector(".hq-count-words")!;
    expect(count.textContent).toBe("501 of 500");
    expect(count.classList.contains("is-error")).toBe(true);
    button(clueItem(3), "Save")!.click();
    await flush();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(clueItem(3).querySelector(".hq-status")!.classList.contains("is-error")).toBe(true);
  });

  it("saves an emptied clue as null", async () => {
    const { calls } = await openDoor7({ "PUT /api/admin/elf/doors/7/clues/1": { body: { door: sheet() } } });
    type(clueBox(1), "   ");
    button(clueItem(1), "Save")!.click();
    await flush();
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ words: null });
  });

  it("shows a clue that is out as read only, with when it went out, and no Save", async () => {
    await openDoor7({ "GET /api/admin/elf/doors/7": { body: { door: sheet({ clueOut: [true, false, false] }), canEdit: true } } });
    expect(clueBox(1).hasAttribute("readonly")).toBe(true);
    expect(button(clueItem(1), "Save")).toBeUndefined();
    expect(clueItem(1).textContent).toContain("Out since 5:30pm.");
    expect(button(clueItem(2), "Save")).toBeDefined();
  });
});

describe("the prints", () => {
  function fakeTab() {
    const tab = { opener: window as unknown, closed: false, location: { href: "" }, document: { title: "", body: { textContent: "" } }, close: vi.fn() };
    const open = vi.fn(() => tab);
    window.open = open as unknown as typeof window.open;
    return { tab, open };
  }

  it("opens a tab on the click, fetches the staff card with the token and shows it through a Blob address", async () => {
    const { tab, open } = fakeTab();
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (created.push(b), "blob:card"));
    URL.revokeObjectURL = vi.fn();
    const { calls } = await openDoor7({ "GET /api/admin/elf/doors/7/staff-card": { text: "<p>card</p>" } });
    button(sheetEl(), "Print the staff card")!.click();
    expect(open).toHaveBeenCalledWith("", "_blank");
    await flush();
    const get = calls.find((c) => c.url === "/api/admin/elf/doors/7/staff-card")!;
    expect(get.headers.Authorization).toBe("Bearer tok");
    expect(created).toHaveLength(1);
    expect(tab.location.href).toBe("blob:card");
    expect(tab.opener).toBeNull();
  });

  it("shows a JSON error answer in the sheet and closes the tab", async () => {
    const { tab } = fakeTab();
    await openDoor7({ "GET /api/admin/elf/doors/7/poster": { status: 409, body: { error: "Add the prize first." } } });
    button(sheetEl(), "Print the poster")!.click();
    await flush();
    expect(tab.close).toHaveBeenCalled();
    const line = sheetEl().querySelector('[data-part="prints"] .hq-status')!;
    expect(line.textContent).toBe("Add the prize first.");
    expect(line.classList.contains("is-error")).toBe(true);
  });

  it("has the three print buttons", async () => {
    await openDoor7();
    ["Print the poster", "Print the staff card", "Print the tag"].forEach((w) => expect(button(sheetEl(), w)).toBeDefined());
  });
});

describe("the drop off ticks", () => {
  it("ticks with POST and unticks with DELETE, showing who and when", async () => {
    const on = sheet({ droppedOffAt: "2026-11-20T10:00:00.000Z", droppedOffBy: "staff@example.org" });
    const { calls } = await openDoor7({
      "POST /api/admin/elf/doors/7/dropped-off": { body: { door: on } },
      "DELETE /api/admin/elf/doors/7/dropped-off": { body: { door: sheet() } },
    });
    const box = () => sheetEl().querySelector<HTMLInputElement>("#hqDoor-droppedOff")!;
    box().click();
    await flush();
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/dropped-off"))).toBeDefined();
    expect(sheetEl().querySelector('[data-part="prints"]')!.textContent).toContain("Ticked by staff@example.org on 20 November");
    expect(box().checked).toBe(true);
    box().click();
    await flush();
    expect(calls.find((c) => c.method === "DELETE" && c.url === "/api/admin/elf/doors/7/dropped-off")).toBeDefined();
    expect(box().checked).toBe(false);
  });

  it("has a Thank you sent tick that posts to thanked", async () => {
    const { calls } = await openDoor7({ "POST /api/admin/elf/doors/7/thanked": { body: { door: sheet({ thankedAt: "2026-11-21T10:00:00.000Z", thankedBy: "staff@example.org" }) } } });
    sheetEl().querySelector<HTMLInputElement>("#hqDoor-thanked")!.click();
    await flush();
    expect(calls.find((c) => c.method === "POST" && c.url === "/api/admin/elf/doors/7/thanked")).toBeDefined();
  });
});

describe("the level select tools", () => {
  it("prints the list of places", async () => {
    const open = vi.fn(() => ({ closed: false, location: { href: "" }, document: { title: "", body: {} }, close: vi.fn() }));
    window.open = open as unknown as typeof window.open;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const { calls } = await openDoor7();
    button(doorsPart(), "Print the list of places")!.click();
    await flush();
    expect(calls.find((c) => c.url === "/api/admin/elf/places-list")).toBeDefined();
  });

  it("copies the prize list to the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openDoor7();
    button(doorsPart(), "Copy the prize list")!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("Door 7: A wooden sledge");
    expect(doorsPart().textContent).toContain("Copied. Send it to Claude for the door pictures.");
  });

  it("shows the list in a read only box when the clipboard is refused", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("no")));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openDoor7();
    button(doorsPart(), "Copy the prize list")!.click();
    await flush();
    const box = doorsPart().querySelector<HTMLTextAreaElement>("#hqPrizeList")!;
    expect(box.value).toBe("Door 7: A wooden sledge");
    expect(box.hasAttribute("readonly")).toBe(true);
  });
});

describe("paste all the clues", () => {
  const TEXT = "Door 7: x\nClue 1: a\nClue 2: b\nClue 3: c";
  const openPanel = async (answers: Record<string, Answer | Answer[]>) => {
    const ctx = await openDoor7(answers);
    button(doorsPart(), "Paste all the clues")!.click();
    await flush();
    return ctx;
  };
  const box = () => doorsPart().querySelector<HTMLTextAreaElement>("#hqPasteText")!;

  it("shows the format help", async () => {
    await openPanel({});
    const t = doorsPart().textContent!;
    expect(t).toContain("Door 7: anything after the number is a note for people and is ignored");
    expect(t).toContain("which can run on to more lines");
  });

  it("checks the text, lists each door with its place and clues, and offers Save when all is well", async () => {
    const { calls } = await openPanel({
      "POST /api/admin/elf/clues/check": {
        body: {
          doors: [
            { door: 7, line: 1, placeName: "Pine Cone Café", clues: [{ n: 1, words: "a" }, { n: 2, words: "b" }, { n: 3, words: "c" }] },
            { door: 8, line: 5, placeName: null, clues: [{ n: 1, words: "d" }, { n: 2, words: "e" }, { n: 3, words: "f" }] },
          ],
          problems: [],
        },
      },
      "POST /api/admin/elf/clues/save": { body: { doors: 2, clues: 6 } },
    });
    type(box(), TEXT);
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    expect(calls.find((c) => c.url === "/api/admin/elf/clues/check")!.body).toEqual({ text: TEXT });
    const found = doorsPart().querySelector(".hq-paste-found")!.textContent!;
    expect(found).toContain("Door 7");
    expect(found).toContain("Pine Cone Café");
    expect(found).toContain("No place yet");
    expect(found).toContain("Clue 1: d");
    button(doorsPart(), "Save these clues")!.click();
    await flush();
    expect(calls.find((c) => c.url === "/api/admin/elf/clues/save")!.body).toEqual({ text: TEXT });
    expect(doorsPart().textContent).toContain("Saved 6 clues for 2 doors.");
    expect(calls.filter((c) => c.url === "/api/admin/elf/doors").length).toBeGreaterThanOrEqual(2);
  });

  it("shows problems as errors and offers no Save", async () => {
    await openPanel({
      "POST /api/admin/elf/clues/check": { body: { doors: [], problems: [{ kind: "bad-door", line: 2, door: null, message: "Line 2: there is no door 40." }] } },
    });
    type(box(), TEXT);
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    const p = doorsPart().querySelector(".hq-paste-problems li")!;
    expect(p.textContent).toBe("Line 2: there is no door 40.");
    expect(p.classList.contains("is-error")).toBe(true);
    expect(button(doorsPart(), "Save these clues")).toBeUndefined();
  });
});

describe("fixes after the first review", () => {
  const fakeOpen = () => {
    const tab = { opener: window as unknown, closed: false, location: { href: "" }, document: { title: "", body: { textContent: "" } }, close: vi.fn() };
    window.open = vi.fn(() => tab) as unknown as typeof window.open;
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    return tab;
  };
  const evening = (clue2: string) => ({ clue1: "17:30", clue2, clue3: "18:30", reveal: "19:00", problems: [] });
  const pasteBox = () => doorsPart().querySelector<HTMLTextAreaElement>("#hqPasteText")!;
  const withClipboardItem = (clipboard: Record<string, unknown>) => {
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    (window as unknown as Record<string, unknown>).ClipboardItem = class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    };
  };

  it("gives the tick rows a class of their own, not the round tick badge", async () => {
    await openDoor7();
    const prints = sheetEl().querySelector('[data-part="prints"]')!;
    expect(prints.querySelectorAll(".hq-tick")).toHaveLength(0);
    expect(prints.querySelectorAll(".hq-dtick")).toHaveLength(2);
  });

  it("keeps typing on the open door when a paste is saved for another door only", async () => {
    await openDoor7({
      "POST /api/admin/elf/clues/check": { body: { doors: [{ door: 8, line: 1, placeName: null, clues: [{ n: 1, words: "a" }, { n: 2, words: "b" }, { n: 3, words: "c" }] }], problems: [] } },
      "POST /api/admin/elf/clues/save": { body: { doors: 1, clues: 3 } },
    });
    type(clueBox(2), "Half written");
    button(doorsPart(), "Paste all the clues")!.click();
    type(pasteBox(), "Door 8: x");
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    button(doorsPart(), "Save these clues")!.click();
    await flush();
    expect(doorsPart().textContent).toContain("Saved 3 clues for 1 door.");
    expect(clueBox(2).value).toBe("Half written");
  });

  it("refreshes the open door's clues when that door is in the paste", async () => {
    const fresh = sheet({ clues: [{ n: 1, words: "From the paste" }, { n: 2, words: null }, { n: 3, words: null }] });
    await openDoor7({
      "POST /api/admin/elf/clues/check": { body: { doors: [{ door: 7, line: 1, placeName: "Pine Cone Café", clues: [{ n: 1, words: "From the paste" }] }], problems: [] } },
      "POST /api/admin/elf/clues/save": { body: { doors: 1, clues: 1 } },
      "GET /api/admin/elf/doors/7": [{ body: { door: sheet(), canEdit: true } }, { body: { door: fresh, canEdit: true } }],
    });
    button(doorsPart(), "Paste all the clues")!.click();
    type(pasteBox(), "x");
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    button(doorsPart(), "Save these clues")!.click();
    await flush();
    expect(clueBox(1).value).toBe("From the paste");
  });

  it("updates the clue times and the place in the prints sentence after a save, keeping typing in the clue boxes", async () => {
    const saved = sheet({ placeName: "Holly Bakehouse", evening: evening("18:15") });
    await openDoor7({ "PATCH /api/admin/elf/doors/7": { body: { door: saved } } });
    type(clueBox(2), "Unsaved second");
    const t = sheetEl().querySelector<HTMLInputElement>("#hqDoor-clue2Time")!;
    t.value = "18:15";
    t.dispatchEvent(new Event("input", { bubbles: true }));
    button(partOf("evening"), "Save")!.click();
    await flush();
    expect(clueItem(2).textContent).toContain("Clue 2 · 6:15pm");
    expect(sheetEl().querySelector("[data-prints-place]")!.textContent).toContain("Holly Bakehouse only.");
    expect(clueBox(2).value).toBe("Unsaved second");
  });

  it("says so when the browser stops the new tab, and fetches nothing", async () => {
    const { calls } = await openDoor7();
    window.open = vi.fn(() => null) as unknown as typeof window.open;
    button(sheetEl(), "Print the tag")!.click();
    await flush();
    expect(calls.some((c) => c.url.endsWith("/tag"))).toBe(false);
    const line = sheetEl().querySelector('[data-part="prints"] .hq-status')!;
    expect(line.textContent).toBe("Your browser stopped the new tab. Let this site open new tabs, then try again.");
    expect(line.classList.contains("is-error")).toBe(true);
  });

  it("opens one tab for a double click on a print button", async () => {
    fakeOpen();
    const { calls } = await openDoor7();
    const b = button(sheetEl(), "Print the poster")!;
    b.click();
    b.click();
    await flush();
    expect(calls.filter((c) => c.url.endsWith("/poster"))).toHaveLength(1);
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it("copies the prize list inside the click with a ClipboardItem where there is one", async () => {
    const write = vi.fn((items: unknown) => (void items, Promise.resolve()));
    const writeText = vi.fn(() => Promise.resolve());
    withClipboardItem({ write, writeText });
    await openDoor7();
    button(doorsPart(), "Copy the prize list")!.click();
    expect(write).toHaveBeenCalledTimes(1); // synchronously, inside the click
    await flush();
    const item = (write.mock.calls[0][0] as { data: Record<string, Promise<Blob>> }[])[0];
    const blob = await item.data["text/plain"];
    expect(blob.size).toBe("Door 7: A wooden sledge".length);
    expect(writeText).not.toHaveBeenCalled();
    expect(doorsPart().textContent).toContain("Copied. Send it to Claude for the door pictures.");
  });

  it("falls back to writeText when the ClipboardItem write is refused", async () => {
    const write = vi.fn(() => Promise.reject(new Error("no")));
    const writeText = vi.fn(() => Promise.resolve());
    withClipboardItem({ write, writeText });
    await openDoor7();
    button(doorsPart(), "Copy the prize list")!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("Door 7: A wooden sledge");
  });

  it("draws the problems of a refused save and hides Save", async () => {
    await openDoor7({
      "POST /api/admin/elf/clues/check": { body: { doors: [{ door: 7, line: 1, placeName: null, clues: [{ n: 1, words: "a" }] }], problems: [] } },
      "POST /api/admin/elf/clues/save": { status: 400, body: { error: "Fix the problems in the text first.", problems: [{ kind: "clue-out", line: 3, door: 7, message: "Line 3: clue 1 of door 7 is already out." }] } },
    });
    button(doorsPart(), "Paste all the clues")!.click();
    type(pasteBox(), "x");
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    button(doorsPart(), "Save these clues")!.click();
    await flush();
    expect(doorsPart().querySelector(".hq-paste-problems li")!.textContent).toBe("Line 3: clue 1 of door 7 is already out.");
    expect(button(doorsPart(), "Save these clues")).toBeUndefined();
  });

  it("reopens the door when a clue went out while it was typed, so it shows read only", async () => {
    const gone = sheet({ clueOut: [true, false, false] });
    await openDoor7({
      "PUT /api/admin/elf/doors/7/clues/1": { status: 409, body: { error: "Door 7, clue 1 is already out, so it cannot be changed." } },
      "GET /api/admin/elf/doors/7": [{ body: { door: sheet(), canEdit: true } }, { body: { door: gone, canEdit: true } }],
    });
    type(clueBox(1), "Changed");
    button(clueItem(1), "Save")!.click();
    await flush();
    expect(clueBox(1).hasAttribute("readonly")).toBe(true);
    expect(clueItem(1).textContent).toContain("Out since 5:30pm.");
    expect(clueItem(1).querySelector(".hq-status")!.textContent).toContain("already out");
  });

  it("puts focus on the first problem after a check, and on Save these clues when all is well", async () => {
    await openDoor7({
      "POST /api/admin/elf/clues/check": [
        { body: { doors: [], problems: [{ kind: "bad-door", line: 1, door: null, message: "Line 1: no such door." }] } },
        { body: { doors: [{ door: 7, line: 1, placeName: null, clues: [] }], problems: [] } },
      ],
    });
    button(doorsPart(), "Paste all the clues")!.click();
    type(pasteBox(), "x");
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    expect(document.activeElement).toBe(doorsPart().querySelector(".hq-paste-problems li"));
    button(doorsPart(), "Check these clues")!.click();
    await flush();
    expect(document.activeElement).toBe(button(doorsPart(), "Save these clues"));
  });

  it("gives a head elf with view access only no Save on clues, no live ticks and no paste", async () => {
    await openDoor7({
      "GET /api/admin/elf/doors": { body: { ...LIST, canEdit: false } },
      "GET /api/admin/elf/doors/7": { body: { door: sheet(), canEdit: false } },
    });
    [1, 2, 3].forEach((n) => expect(button(clueItem(n), "Save")).toBeUndefined());
    expect(clueBox(1).hasAttribute("disabled")).toBe(true);
    expect(sheetEl().querySelector<HTMLInputElement>("#hqDoor-droppedOff")!.disabled).toBe(true);
    expect(sheetEl().querySelector<HTMLInputElement>("#hqDoor-thanked")!.disabled).toBe(true);
    expect(button(doorsPart(), "Paste all the clues")).toBeUndefined();
    expect(button(doorsPart(), "Print the list of places")).toBeDefined();
    expect(button(sheetEl(), "Print the poster")).toBeDefined();
  });

  it("puts a tick back when its request fails", async () => {
    await openDoor7({ "POST /api/admin/elf/doors/7/dropped-off": { status: 500, body: { error: "Admin is temporarily unavailable" } } });
    const box = sheetEl().querySelector<HTMLInputElement>("#hqDoor-droppedOff")!;
    box.click();
    await flush();
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    const line = sheetEl().querySelector('[data-part="prints"] .hq-status')!;
    expect(line.textContent).toBe("Admin is temporarily unavailable");
    expect(line.classList.contains("is-error")).toBe(true);
  });
});
