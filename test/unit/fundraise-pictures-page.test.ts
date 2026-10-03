// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Profile pictures (Jaimie, 2026-10-03): "Your photos" in the organiser's private area
// (assets/js/fundraise-pictures.js). On each card for a fundraiser running with its own page: a main
// photo and a small round photo of themselves, each with a live preview of how their page will look
// (the round photo dragged into place in its circle), sent to wait for staff, and where each is up
// to. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initManage } = require(resolve(ROOT, "assets/js/fundraise-manage.js"));
const { initPictures, cropFor } = require(resolve(ROOT, "assets/js/fundraise-pictures.js"));
const template = readFileSync(resolve(ROOT, "fundraise-manage.html"), "utf8");

type Reply = { status: number; body: unknown };
let calls: Array<{ url: string; method: string; body: unknown }>;

const editable = { description: "Five kilometres in a red suit.", targetPence: 25000, eventDate: "2026-12-05", startTime: null, venue: "", town: "Exampleton" };
const mine = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  slug: `walk-${id}`,
  title: `Walk ${id}`,
  path: "raising",
  status: "approved",
  public: true,
  pageUrl: `https://nbcc.test/fundraise/walk-${id}`,
  qrUrl: `/fundraise/walk-${id}/qr.svg`,
  meter: { raisedPence: 0, targetPence: 25000 },
  editable,
  waitingEdit: null,
  gifts: [],
  finishedRequestedAt: null,
  ...over,
});
const pic = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  kind: "profile",
  status: "pending",
  statusWords: "Waiting for us to check",
  createdAt: "2026-11-20T10:00:00.000Z",
  photoUrl: `/api/fundraise/manage/pictures/${id}/photo`,
  note: null,
  ...over,
});
const entry = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  canSend: true,
  profileAllowed: true,
  name: "Robin O.",
  title: `Walk ${id}`,
  path: "raising",
  isTeam: false,
  inTeam: false,
  pageImageSrc: null,
  main: { inUse: null, latest: null },
  profile: { inUse: null, latest: null },
  ...over,
});

let pictures: unknown;
let postReply: Reply;

async function load(opts: Record<string, unknown> = {}) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(template, "text/html").documentElement.innerHTML;
  calls = [];
  const win = {
    location: { search: "", pathname: "/fundraise/manage", assign: () => {} },
    history: { replaceState: () => {} },
    MutationObserver: window.MutationObserver,
    fetch: vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      let r: Reply = { status: 200, body: {} };
      if (url === "/api/fundraise/manage/me") r = { status: 200, body: { fundraisers: [mine(7), mine(8, { status: "finished" })] } };
      if (url === "/api/fundraise/manage/pictures") r = { status: 200, body: pictures };
      if (/\/pictures$/.test(url) && method === "POST") r = postReply;
      return Promise.resolve({ ok: r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
    }),
  };
  const read = vi.fn(async (file: File) => (file.type === "image/gif" ? null : { src: "blob:chosen-" + file.name, width: 800, height: 600 }));
  const make = vi.fn(async () => ({ mime: "image/jpeg", base64: "MADE" }));
  initManage(document, win);
  initPictures(document, win, { read, make, ...opts });
  await flush();
  return { read, make };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const card = (id: number) => $(`[data-fundraiser="${id}"]`)!;
const part = (id: number) => $("[data-pictures-part]", card(id));
const form = (id: number, kind: string) => $<HTMLFormElement>(`form[data-pic-form="${kind}"]`, part(id)!)!;
const posts = () => calls.filter((c) => c.method === "POST");
async function choose(f: HTMLFormElement, name = "me.jpg", type = "image/jpeg") {
  const input = f.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
  return file;
}
const submit = async (f: HTMLElement) => {
  f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};

describe("the Your photos part", () => {
  it("is on a fundraiser running with a page, before Change your details", async () => {
    pictures = { fundraisers: [entry(7), entry(8, { canSend: false })] };
    await load();
    const p = part(7)!;
    expect(p.querySelector("h3")?.textContent).toBe("Your photos");
    expect(p.nextElementSibling?.querySelector("[data-f-edit]")).not.toBeNull();
    expect(part(8)).toBeNull();
  });

  it("shows a preview of the top of their page: their title, and Organised by with the person icon until they have a photo", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    const preview = $("[data-pic-preview]", part(7)!)!;
    expect(preview.querySelector("[data-pic-title]")?.textContent).toBe("Walk 7");
    expect(preview.querySelector("[data-pic-by]")?.textContent).toBe("Organised by Robin O.");
    expect(preview.querySelector("[data-pic-avatar] img")).toBeNull();
    expect(preview.querySelector("[data-pic-avatar] svg")).not.toBeNull();
  });

  it("shows the photos already on their page in the preview", async () => {
    pictures = {
      fundraisers: [entry(7, { pageImageSrc: "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d", profile: { inUse: pic(3, { status: "approved", statusWords: "On your page" }), latest: null } })],
    };
    await load();
    const preview = $("[data-pic-preview]", part(7)!)!;
    expect(preview.querySelector<HTMLImageElement>("[data-pic-main-img]")?.getAttribute("src")).toBe("/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
    expect(preview.querySelector("[data-pic-avatar] img")?.getAttribute("src")).toBe("/api/fundraise/manage/pictures/3/photo");
    expect(form(7, "profile").querySelector("[data-pic-now]")?.textContent).toContain("On your page");
  });

  it("says one is waiting for us to check, and shows that one in the preview", async () => {
    pictures = { fundraisers: [entry(7, { profile: { inUse: pic(3, { status: "approved" }), latest: pic(4) } })] };
    await load();
    const now = form(7, "profile").querySelector("[data-pic-now]")!;
    expect(now.textContent).toContain("Waiting for us to check");
    expect(now.textContent).toContain("Your page keeps showing your last approved photo until then.");
    expect($("[data-pic-avatar] img", part(7)!)?.getAttribute("src")).toBe("/api/fundraise/manage/pictures/4/photo");
  });

  it("gives our note on one not used", async () => {
    pictures = {
      fundraisers: [entry(7, { main: { inUse: null, latest: pic(5, { kind: "main", status: "declined", statusWords: "Not used", note: "Could you send one without the poster?" }) } })],
    };
    await load();
    const now = form(7, "main").querySelector("[data-pic-now]")!;
    expect(now.textContent).toContain("Not used");
    expect(now.textContent).toContain("Our note: Could you send one without the poster?");
  });

  it("has no round photo where the page does not show one", async () => {
    pictures = { fundraisers: [entry(7, { profileAllowed: false })] };
    await load();
    expect(form(7, "profile").hidden).toBe(true);
    expect($("[data-pic-avatar]", part(7)!)?.hidden).toBe(true);
  });

  it("asks for only photos of people happy to be on the page, and a parent's OK for anyone under 18", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    expect(part(7)!.textContent).toContain(
      "Only send photos of people who are happy to be on the page. For anyone under 18, you need their parent or guardian's OK.",
    );
  });

  it("on a page in memory of someone, asks for a photo of the person remembered, and no round photo", async () => {
    pictures = { fundraisers: [entry(7, { inMemory: true, profileAllowed: false })] };
    await load();
    const main = form(7, "main");
    expect(main.querySelector(".fr-pic__title")?.textContent).toBe("A photo of them");
    expect(main.querySelector("[data-pic-main-help]")?.textContent).toBe("A photo of the person you are remembering. It shows at the top of the page.");
    expect(form(7, "profile").hidden).toBe(true);
  });

  it("says the round photo shows on the team's page too, for someone in a team", async () => {
    pictures = { fundraisers: [entry(7, { inTeam: true })] };
    await load();
    expect(form(7, "profile").textContent).toContain("and on your team’s page");
  });

  it("gives every id its own ending, and every label its box", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    const ids = Array.from(document.querySelectorAll("[data-pictures-part] [id]")).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of Array.from(part(7)!.querySelectorAll("label[for]"))) {
      expect(document.getElementById(label.getAttribute("for")!)).not.toBeNull();
    }
  });
});

describe("choosing and sending a round photo", () => {
  it("shows it at once in a circle to drag, and in the preview beside their name", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    await choose(form(7, "profile"));
    const crop = $("[data-crop]", form(7, "profile"))!;
    expect(crop.closest<HTMLElement>("[data-pic-crop]")!.hidden).toBe(false);
    expect(crop.querySelector("img")?.getAttribute("src")).toBe("blob:chosen-me.jpg");
    expect($("[data-pic-avatar] img", part(7)!)?.getAttribute("src")).toBe("blob:chosen-me.jpg");
  });

  it("moves with the arrow keys, from the middle, and never past an edge", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    await choose(form(7, "profile"));
    const crop = $("[data-crop]", form(7, "profile"))!;
    expect(crop.getAttribute("data-x")).toBe("0.5");
    for (let i = 0; i < 30; i++) crop.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(crop.getAttribute("data-x")).toBe("1");
    // A wide photo only moves sideways.
    crop.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(crop.getAttribute("data-y")).toBe("0.5");
  });

  it("sends the square made from where they put it, then says it is waiting", async () => {
    pictures = { fundraisers: [entry(7)] };
    postReply = { status: 202, body: { status: "waiting", picture: pic(9) } };
    const { make } = await load();
    await choose(form(7, "profile"));
    const crop = $("[data-crop]", form(7, "profile"))!;
    crop.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await submit(form(7, "profile"));
    expect(make).toHaveBeenCalledWith("profile", expect.objectContaining({ width: 800, height: 600 }), { x: 0, y: 0.5 });
    expect(posts()).toEqual([{ url: "/api/fundraise/manage/fundraisers/7/pictures", method: "POST", body: { kind: "profile", mime: "image/jpeg", dataBase64: "MADE" } }]);
    expect(form(7, "profile").querySelector("[data-pic-status]")?.textContent).toBe("Thank you. We will check your photo soon, and it goes on your page once we have.");
    expect(form(7, "profile").querySelector("[data-pic-now]")?.textContent).toContain("Waiting for us to check");
  });

  it("asks for a photo before sending", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    await submit(form(7, "profile"));
    expect(posts()).toHaveLength(0);
    expect(form(7, "profile").querySelector("[data-pic-status]")?.textContent).toBe("Choose a photo first.");
  });

  it("will not take a file that is not a JPG, PNG or WebP", async () => {
    pictures = { fundraisers: [entry(7)] };
    await load();
    await choose(form(7, "profile"), "me.gif", "image/gif");
    expect(form(7, "profile").querySelector("[data-pic-status]")?.textContent).toBe("That picture is not one we can use. Try a JPG, PNG or WebP photo.");
    expect($("[data-pic-crop]", form(7, "profile"))!.hidden).toBe(true);
  });

  it("says what the server says is wrong with it", async () => {
    pictures = { fundraisers: [entry(7)] };
    postReply = { status: 400, body: { error: "Your picture needs another look", fields: { photo: "We could not open that picture. Please try a different photo." } } };
    await load();
    await choose(form(7, "profile"));
    await submit(form(7, "profile"));
    expect(form(7, "profile").querySelector("[data-pic-status]")?.textContent).toBe("We could not open that picture. Please try a different photo.");
  });
});

describe("choosing and sending a main photo", () => {
  it("shows it at once at the top of the preview, then sends it made smaller", async () => {
    pictures = { fundraisers: [entry(7)] };
    postReply = { status: 202, body: { status: "waiting", picture: pic(10, { kind: "main" }) } };
    const { make } = await load();
    await choose(form(7, "main"), "day.jpg");
    expect($<HTMLImageElement>("[data-pic-main-img]", part(7)!)?.getAttribute("src")).toBe("blob:chosen-day.jpg");
    expect($("[data-pic-crop]", form(7, "main"))).toBeNull();
    await submit(form(7, "main"));
    expect(make).toHaveBeenCalledWith("main", expect.objectContaining({ src: "blob:chosen-day.jpg" }), null);
    expect(posts()[0].body).toEqual({ kind: "main", mime: "image/jpeg", dataBase64: "MADE" });
  });
});

describe("where the square is cut from", () => {
  it("takes the whole short side, from where they put it", () => {
    expect(cropFor(800, 600, { x: 0.5, y: 0.5 })).toEqual({ sx: 100, sy: 0, side: 600 });
    expect(cropFor(800, 600, { x: 0, y: 0.5 })).toEqual({ sx: 0, sy: 0, side: 600 });
    expect(cropFor(600, 900, { x: 0.5, y: 1 })).toEqual({ sx: 0, sy: 300, side: 600 });
  });
});
