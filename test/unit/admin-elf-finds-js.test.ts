// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ's Finds tile, the photo half (assets/js/admin/elf-hq.js): the photos to check and the
// photo log, against a pretend server. Every family and head elf here is invented.
const require = createRequire(import.meta.url);
const { initElfHq } = require(resolve(__dirname, "../../assets/js/admin/elf-hq.js"));

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

const HQ = {
  settings: { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewOn: false },
  canSwitch: true,
  canEdit: true,
  numbers: { families: 0, detectives: 0, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 },
  quests: [],
  recruits: [],
  photosWaiting: 3,
  firstClueAt: "2026-12-01T17:30:00.000Z",
  daysToFirstClue: 6,
};

const FIRST = {
  id: 41,
  token: "aaaaaaaaaaaa",
  year: 2026,
  door: 7,
  practice: false,
  sentAt: "2026-12-07T18:04:00.000Z",
  family: { id: 3, grownUpName: "Alex Example", detectives: 2 },
  placeName: "Pine Cone Café, Snowford",
  placeShownAt: "2026-12-07T19:00:00.000Z",
  firstFamily: false,
};
const SECOND = { ...FIRST, id: 42, token: "bbbbbbbbbbbb", door: 6, sentAt: "2026-12-07T18:07:00.000Z", placeName: "Snowford Library", placeShownAt: null, family: { id: 4, grownUpName: "Sam Example", detectives: 1 } };
const THIRD = { ...FIRST, id: 43, token: "cccccccccccc", door: 0, practice: true, year: 0, sentAt: "2026-12-07T18:10:00.000Z", placeName: "The Pretend Place", placeShownAt: null, family: { id: 5, grownUpName: "Kim Example", detectives: 3 } };
const LOG = [
  { id: 40, door: 6, practice: false, family: { grownUpName: "Sam Example" }, status: "approved", steps: [{ at: "2026-12-07T17:20:00.000Z", words: "Sent" }, { at: "2026-12-07T17:31:00.000Z", words: "Approved by Alex Example" }] },
  { id: 39, door: 5, practice: false, family: { grownUpName: "Kim Example" }, status: "declined", steps: [{ at: "2026-12-07T16:02:00.000Z", words: "Sent" }, { at: "2026-12-07T16:15:00.000Z", words: "Declined by Alex Example: someone else in it" }] },
];
const PHOTOS = { waiting: [FIRST, SECOND, THIRD], log: LOG, lastAlert: { at: "2026-12-07T18:04:00.000Z", textsFailed: [] }, canEdit: true };

type Call = { method: string; url: string; body: unknown; auth: string | null };
type Env = ReturnType<typeof page>;

/** The admin page, the pretend server and Head Elf HQ started on it. `answers` is "METHOD /path" or "/path". */
function page(o: { answers?: Record<string, unknown>; statuses?: Record<string, number> } = {}) {
  document.body.innerHTML = `<div id="appView"><section class="admin-view" id="view-elf" hidden><div id="elfHq"></div></section></div>`;
  const calls: Call[] = [];
  const made: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.URL.createObjectURL = vi.fn(() => {
    const u = `blob:pretend-${++n}`;
    made.push(u);
    return u;
  });
  w.URL.revokeObjectURL = vi.fn((u: string) => revoked.push(u));
  w.fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization ?? null });
    const answers = o.answers ?? {};
    const status = o.statuses?.[`${method} ${url}`] ?? 200;
    if (/\/picture$/.test(url)) {
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["pretend"], { type: "image/jpeg" })), json: () => Promise.resolve({}) });
    }
    const body = answers[`${method} ${url}`] ?? answers[url] ?? (url === "/api/admin/elf/hq" ? HQ : {});
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls, made, revoked };
}

const part = () => document.querySelector<HTMLElement>('#elfHq [role=tabpanel][data-tab="finds"]')!;
const tab = () => document.querySelector<HTMLButtonElement>("#hqTab-finds")!;
const buttonIn = (root: ParentNode, words: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);
const posts = (env: Env) => env.calls.filter((c) => c.method === "POST");

async function openFinds(answers: Record<string, unknown> = {}, statuses: Record<string, number> = {}): Promise<Env> {
  const env = page({ answers: { "GET /api/admin/elf/photos": PHOTOS, ...answers }, statuses });
  await env.hq.open();
  tab().click();
  await flush();
  return env;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe("the Finds tile", () => {
  it("sits after Doors, with the camera icon and the count of photos waiting", async () => {
    const env = page();
    const names = [...document.querySelectorAll("#elfHq [role=tab]")].map((t) => t.getAttribute("data-tab"));
    expect(names.slice(0, 4)).toEqual(["hq", "families", "doors", "finds"]);
    expect(tab().querySelector("img")!.getAttribute("src")).toBe("/assets/img/elf/paper/icons/icon-camera.webp");
    await env.hq.open();
    await flush();
    const count = tab().querySelector(".hq-count") as HTMLElement;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe("3");
  });

  it("reads the queue and the log when it opens, with the bearer token", async () => {
    const env = await openFinds();
    const read = env.calls.find((c) => c.url === "/api/admin/elf/photos")!;
    expect(read.method).toBe("GET");
    expect(read.auth).toBe("Bearer t");
  });
});

describe("the photo to check", () => {
  it("shows the first photo with its door, day, place, time, family and the lines head elves read", async () => {
    await openFinds();
    const box = part().querySelector<HTMLElement>(".hq-queue")!;
    expect(box.querySelector("h2")!.textContent).toBe("Photos to check");
    expect(box.querySelector(".hq-chip")!.textContent).toBe("3 waiting");
    const check = box.querySelector<HTMLElement>(".hq-check")!;
    const t = check.textContent!;
    expect(t).toContain("Door 7 · Monday 7 December");
    expect(t).toContain("Pine Cone Café, Snowford");
    expect(t).toContain("Sent at 6:04pm");
    expect(t).toContain("From Alex Example's family, 2 detectives. Only head elves see who sent it.");
    expect(t).toContain("Door 7's place is shown at 7pm, so this photo waits until then, even once it is approved.");
    expect(t).toContain("Before you approve");
    expect([...check.querySelectorAll(".hq-look li")].map((l) => l.textContent)).toEqual([
      "Only the family in it",
      "No school uniform or badge",
      "Nothing that shows where anyone lives, like a house number or a car number plate",
      "Nothing unkind",
    ]);
    expect(t).toContain("Your name and the time go in the log either way.");
    expect(buttonIn(check, "Approve")).toBeTruthy();
    expect(buttonIn(check, "Decline")).toBeTruthy();
  });

  it("tells the head elf when the photo would be the first family's on its door", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [{ ...FIRST, firstFamily: true }] } });
    expect(part().querySelector(".hq-check")!.textContent).toContain("This is the first family's photo on door 7, so it stays hidden until a photo from a second family is approved.");
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [{ ...THIRD, firstFamily: true }] } });
    expect(part().querySelector(".hq-check")!.textContent).toContain("This is the first family's photo on the practice door, so it stays hidden");
  });

  it("leaves the hold lines out when the place is already shown and a second family is there", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [SECOND] } });
    const t = part().querySelector(".hq-check")!.textContent!;
    expect(t).not.toContain("waits until then");
    expect(t).not.toContain("first family's photo");
    expect(part().querySelector(".hq-hold")).toBeNull();
  });

  it("says one detective for a family of one", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [SECOND] } });
    expect(part().querySelector(".hq-check")!.textContent).toContain("From Sam Example's family, 1 detective. Only");
  });

  it("calls the practice door the practice door, with a Practice chip", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [THIRD] } });
    const check = part().querySelector<HTMLElement>(".hq-check")!;
    expect(check.textContent).toContain("The practice door");
    expect(check.textContent).toContain("The Pretend Place");
    expect(check.textContent).not.toContain("Door 0");
    expect([...check.querySelectorAll(".hq-chip")].map((c) => c.textContent)).toContain("Practice");
  });

  it("fetches the photo with the bearer token into a blob address, and puts it on the page", async () => {
    const env = await openFinds();
    const pic = env.calls.find((c) => c.url === "/api/admin/elf/photos/41/picture")!;
    expect(pic.auth).toBe("Bearer t");
    const img = part().querySelector<HTMLImageElement>(".hq-polaroid img.hq-photo")!;
    expect(img.getAttribute("src")).toBe(env.made[0]);
    expect(img.getAttribute("src")).not.toContain("token");
    expect(part().querySelector(".hq-polaroid")!.textContent).toContain("Door 7");
  });

  it("revokes the blob address when the photo is replaced", async () => {
    const env = await openFinds();
    const first = env.made[0];
    const thumbs = [...part().querySelectorAll<HTMLButtonElement>(".hq-thumb")];
    thumbs[0].click();
    await flush();
    expect(env.revoked).toContain(first);
    expect(part().querySelector(".hq-check")!.textContent).toContain("Door 6");
  });

  it("shows the rest as thumbnails under Next, with no pictures fetched for them", async () => {
    const env = await openFinds();
    const next = part().querySelector<HTMLElement>(".hq-next")!;
    expect(next.querySelector("h3")!.textContent).toBe("Next");
    const thumbs = [...next.querySelectorAll(".hq-thumb")];
    expect(thumbs.map((n) => n.textContent)).toEqual(["Door 6Snowford LibrarySent 6:07pm", "The practice doorThe Pretend PlaceSent 6:10pm"]);
    expect(env.calls.filter((c) => /\/picture$/.test(c.url))).toHaveLength(1);
  });

  it("says when one alert went, or that none has", async () => {
    await openFinds();
    expect(part().querySelector(".hq-queue")!.textContent).toContain("One alert went at 6:04pm.");
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, lastAlert: null } });
    expect(part().querySelector(".hq-queue")!.textContent).toContain("No alert has gone yet.");
  });

  it("says so when nothing is waiting", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [] } });
    expect(part().querySelector(".hq-queue")!.textContent).toContain("No photos are waiting.");
    expect(part().querySelector(".hq-check")).toBeNull();
  });
});

describe("approving and declining", () => {
  it("Approve posts to /approve and reads the queue again", async () => {
    const env = await openFinds({ "POST /api/admin/elf/photos/41/approve": { ok: true } });
    buttonIn(part().querySelector(".hq-check")!, "Approve")!.click();
    await flush();
    expect(posts(env).map((c) => c.url)).toEqual(["/api/admin/elf/photos/41/approve"]);
    expect(env.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/elf/photos")).toHaveLength(2);
  });

  it("Decline asks for the reason in a field and only then posts it", async () => {
    const env = await openFinds({ "POST /api/admin/elf/photos/41/decline": { ok: true } });
    const check = part().querySelector<HTMLElement>(".hq-check")!;
    buttonIn(check, "Decline")!.click();
    expect(posts(env)).toHaveLength(0);
    const field = check.querySelector<HTMLInputElement>("input.hq-reason")!;
    expect(field).toBeTruthy();
    expect(field.maxLength).toBe(200);
    expect(check.textContent).toContain("Only head elves see it.");
    // No reason yet: nothing is sent.
    buttonIn(check, "Decline this photo")!.click();
    await flush();
    expect(posts(env)).toHaveLength(0);
    expect(check.querySelector(".is-error")!.textContent).toBe("Say why in a few words. Only head elves see it.");
    field.value = "someone else in it";
    buttonIn(check, "Decline this photo")!.click();
    await flush();
    expect(posts(env).map((c) => [c.url, c.body])).toEqual([["/api/admin/elf/photos/41/decline", { reason: "someone else in it" }]]);
  });

  it("Cancel puts the buttons back without posting", async () => {
    const env = await openFinds();
    const check = part().querySelector<HTMLElement>(".hq-check")!;
    buttonIn(check, "Decline")!.click();
    buttonIn(check, "Cancel")!.click();
    expect(check.querySelector("input.hq-reason")).toBeNull();
    expect(buttonIn(check, "Approve")).toBeTruthy();
    expect(posts(env)).toHaveLength(0);
  });

  it("shows the other head elf's step in place of the buttons on a 409, then reads the queue again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const env = await openFinds(
      { "POST /api/admin/elf/photos/41/approve": { error: "Someone has already checked this photo.", step: "Approved by Alex Example at 6:13pm" } },
      { "POST /api/admin/elf/photos/41/approve": 409 },
    );
    const check = part().querySelector<HTMLElement>(".hq-check")!;
    buttonIn(check, "Approve")!.click();
    await flush();
    expect(check.textContent).toContain("Approved by Alex Example at 6:13pm");
    expect(buttonIn(check, "Approve")).toBeUndefined();
    expect(env.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/elf/photos")).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    await flush();
    expect(env.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/elf/photos")).toHaveLength(2);
  });

  it("reads the queue again, rather than re enabling the buttons, when the photo has gone (404)", async () => {
    const env = await openFinds({ "POST /api/admin/elf/photos/41/approve": { error: "That photo is not there." } }, { "POST /api/admin/elf/photos/41/approve": 404 });
    buttonIn(part().querySelector(".hq-check")!, "Approve")!.click();
    await flush();
    expect(env.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/elf/photos")).toHaveLength(2);
    expect(part().querySelector(".hq-queue")!.textContent).toContain("That photo is no longer there.");
  });

  it("says in words when something else goes wrong, with is-error, and keeps the buttons", async () => {
    await openFinds({ "POST /api/admin/elf/photos/41/approve": { error: "Admin is temporarily unavailable" } }, { "POST /api/admin/elf/photos/41/approve": 500 });
    const check = part().querySelector<HTMLElement>(".hq-check")!;
    buttonIn(check, "Approve")!.click();
    await flush();
    expect(check.querySelector(".is-error")!.textContent).toBe("Admin is temporarily unavailable");
    expect(buttonIn(check, "Approve")).toBeTruthy();
  });

  it("draws no buttons for someone who may only look", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, canEdit: false } });
    const box = part();
    expect(buttonIn(box.querySelector(".hq-check")!, "Approve")).toBeUndefined();
    expect(buttonIn(box.querySelector(".hq-check")!, "Decline")).toBeUndefined();
    expect(buttonIn(box.querySelector(".hq-log")!, "Take it down")).toBeUndefined();
    expect(box.querySelector(".hq-check")!.textContent).toContain("Before you approve");
  });
});

describe("the photo log", () => {
  it("draws each photo with its door, family, chip and steps, newest first", async () => {
    await openFinds();
    const log = part().querySelector<HTMLElement>(".hq-log")!;
    expect(log.querySelector("h2")!.textContent).toBe("The photo log");
    const rows = [...log.querySelectorAll<HTMLElement>(".hq-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".hq-what")!.textContent).toBe("Door 6 (Sam Example's family)");
    expect(rows[0].querySelector(".hq-chip")!.textContent).toBe("Up");
    expect([...rows[0].querySelectorAll(".hq-steps li")].map((l) => l.textContent)).toEqual(["Mon 5:20pmSent", "Mon 5:31pmApproved by Alex Example"]);
    expect(rows[1].querySelector(".hq-chip")!.textContent).toBe("Declined");
    expect(rows[1].textContent).toContain("Declined by Alex Example: someone else in it");
  });

  it("says in plain words when an approved photo is still hidden for want of a second family's photo", async () => {
    const held = { ...LOG[0], held: true };
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, log: [held, LOG[1]] } });
    const rows = [...part().querySelectorAll<HTMLElement>(".hq-log .hq-row")];
    expect(rows[0].querySelector(".hq-chip")!.textContent).toBe("Up when a second family's photo is approved");
    expect(rows[0].querySelector(".hq-chip")!.className).toContain("hq-chip--long");
    expect(buttonIn(rows[0], "Take it down")).toBeTruthy();
  });

  it("ends with the day every photo is deleted", async () => {
    await openFinds();
    expect(part().querySelector(".hq-log")!.textContent).toContain("Sunday 31 January 2027: every photo is deleted. The log keeps these lines, without the pictures.");
  });

  it("has Take it down only on photos that are up, asking for an optional reason, then posts", async () => {
    const env = await openFinds({ "POST /api/admin/elf/photos/40/take-down": { ok: true } });
    const log = part().querySelector<HTMLElement>(".hq-log")!;
    expect(log.querySelectorAll(".hq-row")[1].querySelector("button")).toBeNull();
    const row = log.querySelectorAll<HTMLElement>(".hq-row")[0];
    buttonIn(row, "Take it down")!.click();
    expect(posts(env)).toHaveLength(0);
    const field = row.querySelector<HTMLInputElement>("input.hq-reason")!;
    expect(field.maxLength).toBe(200);
    field.value = "the family asked by phone";
    buttonIn(row, "Yes, take it down")!.click();
    await flush();
    expect(posts(env).map((c) => [c.url, c.body])).toEqual([["/api/admin/elf/photos/40/take-down", { reason: "the family asked by phone" }]]);
    expect(env.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/elf/photos")).toHaveLength(2);
  });

  it("posts an empty body when no reason is given", async () => {
    const env = await openFinds({ "POST /api/admin/elf/photos/40/take-down": { ok: true } });
    const row = part().querySelectorAll<HTMLElement>(".hq-log .hq-row")[0];
    buttonIn(row, "Take it down")!.click();
    buttonIn(row, "Yes, take it down")!.click();
    await flush();
    expect(posts(env).map((c) => c.body)).toEqual([{}]);
  });
});

describe("what the screen puts on the page", () => {
  it("draws names and places as text, never markup", async () => {
    await openFinds({ "GET /api/admin/elf/photos": { ...PHOTOS, waiting: [{ ...FIRST, placeName: "<b>Pretend</b>" }] } });
    expect(part().querySelector(".hq-check b")).toBeNull();
    expect(part().textContent).toContain("<b>Pretend</b>");
  });
});
