// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ's Grand prize part (assets/js/admin/elf-hq.js, Plan 2c-2): every picture sent in for the grand
// prize, the one winner, and who to ring, against a pretend server. Design:
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2. Every family, detective
// and number here is invented.
const require = createRequire(import.meta.url);
const { initElfHq } = require(resolve(__dirname, "../../assets/js/admin/elf-hq.js"));

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

const HQ = {
  settings: { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewOn: false, doorsOn: true },
  canSwitch: true,
  canEdit: true,
  numbers: { families: 3, detectives: 3, namesToCheck: 0, waitingPayments: 0, entryPence: 0, giftPence: 0, giftAidPence: 0 },
  quests: [],
  recruits: [],
  photosWaiting: 0,
  grandPrizeEntries: 3,
  firstClueAt: "2026-12-01T17:30:00.000Z",
  daysToFirstClue: 0,
};

// Three pictures, in the order they came in on Christmas Eve 2026 (GMT in December, so the times are London's).
const RUBY = { id: 12, detective: "Ruby Tinselfoot", grownUpName: "Alex Example", mobile: "+447700900123", sentAt: "2026-12-24T10:45:00.000Z", winner: false };
const LEO = { id: 13, detective: "Leo Frostwhistle", grownUpName: "Sam Example", mobile: null, sentAt: "2026-12-24T15:12:00.000Z", winner: false };
const KIM = { id: 14, detective: "Kim Hollyhunt", grownUpName: "Jo Example", mobile: "+447700900456", sentAt: "2026-12-24T16:20:00.000Z", winner: false };
const FIVE_PM = "2026-12-24T17:00:00.000Z";
const OPEN = { closesAt: FIVE_PM, closed: false, entries: [RUBY, LEO, KIM], canEdit: true };
/** Closed, with Kim's picture marked as the winner. */
const CLOSED = { closesAt: FIVE_PM, closed: true, entries: [RUBY, LEO, { ...KIM, winner: true }], canEdit: true };
/** The marking's answer: Ruby's picture is the winner now, and Kim's is not. */
const RUBY_WINS = { ...CLOSED, entries: [{ ...RUBY, winner: true }, LEO, KIM] };

const PART_PATH = "/api/admin/elf/grand-prize";
const NOTE = "The website announces nothing. NBCC rings the winner's grown up on Christmas Eve and takes the prize round on Christmas Day.";
const WINNER_TAKEN = "Someone has just marked a winner. Reload to see it.";

type Call = { method: string; url: string; body: unknown; auth: string | null };
type Answer = { status?: number; body: unknown };
/** An answer, or one that waits to be let go. */
type OneAnswer = Answer | (() => Promise<Answer>);
/** An answer, or a list of answers taken in turn (the last one stays). */
type Answers = Record<string, OneAnswer | OneAnswer[]>;
type Env = ReturnType<typeof page>;

/** The admin page, a pretend server that answers by "METHOD /path", and Head Elf HQ started on it. A picture's
 *  address answers a picture, unless `pictures` is "broken", or "slow", which never answers. */
function page(o: { answers?: Answers; pictures?: "broken" | "slow" } = {}) {
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
    if (/\/picture$/.test(url)) {
      if (o.pictures === "slow") return new Promise(() => undefined);
      if (o.pictures === "broken") return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "That picture is not there." }) });
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["pretend"], { type: "image/jpeg" })), json: () => Promise.resolve({}) });
    }
    const all: Answers = { "GET /api/admin/elf/hq": { body: HQ }, ...(o.answers ?? {}) };
    const found = all[`${method} ${url}`] ?? { body: {} };
    const one = Array.isArray(found) ? (found.length > 1 ? (found.shift() as OneAnswer) : found[0]) : found;
    const answer = typeof one === "function" ? one() : Promise.resolve(one);
    return answer.then((a) => {
      const status = a.status ?? 200;
      return { ok: status < 400, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(a.body))) };
    });
  });
  window.sessionStorage.setItem("nbcc_admin_token", "t");
  const hq = initElfHq(document, window, { confirm: () => true });
  return { hq, calls, made, revoked };
}

const tab = (id: string) => document.querySelector<HTMLButtonElement>(`#hqTab-${id}`)!;
const part = () => document.querySelector<HTMLElement>('#elfHq [role=tabpanel][data-tab="prize"]')!;
const cards = () => [...part().querySelectorAll<HTMLElement>(".hq-gp-entry")];
const card = (name: string) => cards().find((c) => c.querySelector("h3")!.textContent === name)!;
const buttonIn = (root: ParentNode, words: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === words);
const markButtons = () => [...part().querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent!.trim() === "Mark as the winner");
const chipsOf = (c: HTMLElement) => [...c.querySelectorAll(".hq-chip")].map((x) => x.textContent);
const pictureCalls = (env: Env) => env.calls.filter((c) => /\/picture$/.test(c.url));

/** Head Elf HQ opened, then the Grand prize tile, with the part's read answering `answer`. */
async function openPrize(answer: unknown = CLOSED, more: Answers = {}, o: { pictures?: "broken" | "slow" } = {}): Promise<Env> {
  const env = page({ answers: { [`GET ${PART_PATH}`]: { body: answer }, ...more }, ...o });
  await env.hq.open();
  tab("prize").click();
  await flush();
  return env;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the Grand prize tile", () => {
  it("sits after Finds, with the surprise icon", () => {
    page();
    const ids = [...document.querySelectorAll("#elfHq [role=tab]")].map((t) => t.getAttribute("data-tab"));
    expect(ids).toEqual(["hq", "families", "doors", "finds", "prize", "money", "settings"]);
    expect(tab("prize").textContent!.trim()).toBe("Grand prize");
    expect(tab("prize").querySelector("img")!.getAttribute("src")).toBe("/assets/img/elf/paper/icons/icon-surprise.webp");
  });

  it("counts the pictures sent in, and says the count as pictures", async () => {
    const env = page();
    await env.hq.open();
    const count = tab("prize").querySelector<HTMLElement>(".hq-count")!;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe("3");
    expect(tab("prize").getAttribute("aria-label")).toBe("Grand prize, 3 pictures");
  });

  it("says one picture as one", async () => {
    const env = page({ answers: { "GET /api/admin/elf/hq": { body: { ...HQ, grandPrizeEntries: 1 } } } });
    await env.hq.open();
    expect(tab("prize").getAttribute("aria-label")).toBe("Grand prize, 1 picture");
  });

  it("shows no count before any picture has come in, or from an answer without one", async () => {
    for (const hq of [{ ...HQ, grandPrizeEntries: 0 }, { ...HQ, grandPrizeEntries: undefined }]) {
      const env = page({ answers: { "GET /api/admin/elf/hq": { body: hq } } });
      await env.hq.open();
      expect(tab("prize").querySelector<HTMLElement>(".hq-count")!.hidden).toBe(true);
      expect(tab("prize").hasAttribute("aria-label")).toBe(false);
    }
  });

  it("still says the other tiles' counts as waiting", async () => {
    const env = page({ answers: { "GET /api/admin/elf/hq": { body: { ...HQ, photosWaiting: 2 } } } });
    await env.hq.open();
    expect(tab("finds").getAttribute("aria-label")).toBe("Finds, 2 waiting");
  });

  it("reads the part afresh each time it opens, with the bearer token", async () => {
    const env = await openPrize();
    const reads = () => env.calls.filter((c) => c.method === "GET" && c.url === PART_PATH);
    expect(reads()).toHaveLength(1);
    expect(reads()[0].auth).toBe("Bearer t");
    tab("hq").click();
    tab("prize").click();
    await flush();
    expect(reads()).toHaveLength(2);
  });

  it("keeps the tile's count to the part's own read", async () => {
    await openPrize({ ...CLOSED, entries: [RUBY, LEO] });
    expect(tab("prize").querySelector(".hq-count")!.textContent).toBe("2");
    expect(tab("prize").getAttribute("aria-label")).toBe("Grand prize, 2 pictures");
  });
});

describe("the Grand prize part", () => {
  it("says what it holds and when the entries close, while they are open", async () => {
    await openPrize(OPEN);
    const t = part().textContent!;
    expect(part().querySelector("h2")!.textContent).toBe("Grand prize");
    expect(t).toContain("Every picture sent in for the grand prize, in the order they came in. Only head elves see them.");
    expect(t).toContain("Entries close at 5pm on Christmas Eve. You can mark the winner after that.");
    expect(t).not.toContain("Entries closed");
    expect(t).toContain(NOTE);
  });

  it("says when they closed, once they have", async () => {
    await openPrize(CLOSED);
    const t = part().textContent!;
    expect(t).toContain("Entries closed at 5pm on Christmas Eve.");
    expect(t).not.toContain("You can mark the winner after that.");
    expect(t).toContain(NOTE);
  });

  it("names a time with its minutes", async () => {
    await openPrize({ ...OPEN, closesAt: "2026-12-24T17:30:00.000Z" });
    expect(part().textContent).toContain("Entries close at 5:30pm on Christmas Eve.");
  });

  it("draws every entry as a card, in the order they came in", async () => {
    await openPrize(CLOSED);
    expect(cards().map((c) => c.querySelector("h3")!.textContent)).toEqual(["Ruby Tinselfoot", "Leo Frostwhistle", "Kim Hollyhunt"]);
  });

  it("gives each card the detective's full name, the grown up, the mobile to ring and when the picture came in", async () => {
    await openPrize(CLOSED);
    const ruby = card("Ruby Tinselfoot");
    const lines = [...ruby.querySelectorAll("p")].map((p) => p.textContent);
    expect(lines).toContain("Grown up: Alex Example");
    expect(lines).toContain("Mobile 07700 900123");
    expect(lines).toContain("Came in Thursday 24 December at 10:45am");
    const ring = ruby.querySelector<HTMLAnchorElement>("a")!;
    expect(ring.getAttribute("href")).toBe("tel:+447700900123");
    expect(ring.textContent).toBe("07700 900123");
  });

  it("says when a family has no mobile number, with nothing to ring", async () => {
    await openPrize(CLOSED);
    const leo = card("Leo Frostwhistle");
    expect([...leo.querySelectorAll("p")].map((p) => p.textContent)).toContain("No mobile number");
    expect(leo.querySelector("a")).toBeNull();
    expect(leo.textContent).toContain("Came in Thursday 24 December at 3:12pm");
  });

  it("fetches each picture with the bearer token into a blob address, never a link", async () => {
    const env = await openPrize(CLOSED);
    expect(pictureCalls(env).map((c) => c.url)).toEqual([
      "/api/admin/elf/grand-prize/12/picture",
      "/api/admin/elf/grand-prize/13/picture",
      "/api/admin/elf/grand-prize/14/picture",
    ]);
    for (const c of pictureCalls(env)) expect(c.auth).toBe("Bearer t");
    const img = card("Ruby Tinselfoot").querySelector<HTMLImageElement>("img")!;
    expect(env.made).toContain(img.getAttribute("src"));
    expect(img.hidden).toBe(false);
    expect(img.getAttribute("alt")).toBe("The picture sent in for Ruby Tinselfoot");
    const wait = [...card("Ruby Tinselfoot").querySelectorAll<HTMLElement>("figure span")].find((s) => s.textContent === "Loading the picture…")!;
    expect(wait.hidden).toBe(true);
  });

  it("says the picture is loading until it comes", async () => {
    await openPrize(CLOSED, {}, { pictures: "slow" });
    const ruby = card("Ruby Tinselfoot");
    const wait = [...ruby.querySelectorAll<HTMLElement>("figure span")].find((s) => s.textContent === "Loading the picture…")!;
    expect(wait.hidden).toBe(false);
    expect(ruby.querySelector<HTMLImageElement>("img")!.hidden).toBe(true);
  });

  it("says so when a picture cannot be loaded", async () => {
    await openPrize(CLOSED, {}, { pictures: "broken" });
    const ruby = card("Ruby Tinselfoot");
    expect(ruby.textContent).toContain("The picture could not be loaded.");
    expect(ruby.querySelector<HTMLImageElement>("img")!.hidden).toBe(true);
  });

  it("puts the chip on the winner's card only", async () => {
    await openPrize(CLOSED);
    expect(chipsOf(card("Kim Hollyhunt"))).toEqual(["The winner"]);
    expect(chipsOf(card("Ruby Tinselfoot"))).toEqual([]);
    expect(chipsOf(card("Leo Frostwhistle"))).toEqual([]);
  });

  it("offers Mark as the winner on every other card once the entries have closed, to a head elf who may edit", async () => {
    await openPrize(CLOSED);
    expect(buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")).toBeTruthy();
    expect(buttonIn(card("Leo Frostwhistle"), "Mark as the winner")).toBeTruthy();
    expect(card("Kim Hollyhunt").querySelector("button")).toBeNull();
  });

  it("draws no button while the entries are open", async () => {
    await openPrize(OPEN);
    expect(cards()).toHaveLength(3);
    expect(part().querySelectorAll("button")).toHaveLength(0);
  });

  it("draws no button for a head elf who may only look", async () => {
    await openPrize({ ...CLOSED, canEdit: false });
    expect(cards()).toHaveLength(3);
    expect(part().querySelectorAll("button")).toHaveLength(0);
    expect(chipsOf(card("Kim Hollyhunt"))).toEqual(["The winner"]);
  });

  it("says no pictures have come in yet when there are none", async () => {
    await openPrize({ ...OPEN, entries: [] });
    expect(cards()).toHaveLength(0);
    expect(part().textContent).toContain("No pictures have come in yet.");
    expect(part().textContent).toContain(NOTE);
  });

  it("says a failed read in the server's words, as an error", async () => {
    await openPrize(undefined, { [`GET ${PART_PATH}`]: { status: 500, body: { error: "Admin is temporarily unavailable" } } });
    const said = part().querySelector<HTMLElement>(".hq-status.is-error")!;
    expect(said.textContent).toBe("Admin is temporarily unavailable");
    expect(cards()).toHaveLength(0);
  });
});

describe("marking the winner", () => {
  it("posts to the entry's own address, then redraws with the chip on that card only", async () => {
    const env = await openPrize(CLOSED, { [`POST ${PART_PATH}/12/winner`]: { body: RUBY_WINS } });
    buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")!.click();
    await flush();
    const posts = env.calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([{ method: "POST", url: "/api/admin/elf/grand-prize/12/winner", body: null, auth: "Bearer t" }]);
    expect(chipsOf(card("Ruby Tinselfoot"))).toEqual(["The winner"]);
    expect(chipsOf(card("Kim Hollyhunt"))).toEqual([]);
    expect(chipsOf(card("Leo Frostwhistle"))).toEqual([]);
    expect(card("Ruby Tinselfoot").querySelector("button")).toBeNull();
    expect(buttonIn(card("Kim Hollyhunt"), "Mark as the winner")).toBeTruthy();
    expect(buttonIn(card("Leo Frostwhistle"), "Mark as the winner")).toBeTruthy();
  });

  it("then says Marked as the winner. on that card, as good news, and takes the focus there", async () => {
    await openPrize(CLOSED, { [`POST ${PART_PATH}/12/winner`]: { body: RUBY_WINS } });
    buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")!.click();
    await flush();
    const said = card("Ruby Tinselfoot").querySelector<HTMLElement>(".hq-status")!;
    expect(said.textContent).toBe("Marked as the winner.");
    expect(said.classList.contains("is-ok")).toBe(true);
    expect(said.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(said);
    expect(part().textContent!.match(/Marked as the winner\./g)).toHaveLength(1);
  });

  it("keeps the pictures it already has when it redraws", async () => {
    const env = await openPrize(CLOSED, { [`POST ${PART_PATH}/12/winner`]: { body: RUBY_WINS } });
    const before = card("Ruby Tinselfoot").querySelector("img")!.getAttribute("src");
    buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")!.click();
    await flush();
    expect(pictureCalls(env)).toHaveLength(3);
    expect(card("Ruby Tinselfoot").querySelector("img")!.getAttribute("src")).toBe(before);
    expect(env.revoked).toEqual([]);
  });

  it("holds every button while a marking is on its way", async () => {
    let letGo: (a: Answer) => void = () => undefined;
    await openPrize(CLOSED, { [`POST ${PART_PATH}/12/winner`]: () => new Promise<Answer>((r) => (letGo = r)) });
    buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")!.click();
    await flush();
    expect(markButtons()).toHaveLength(2);
    for (const b of markButtons()) expect(b.disabled).toBe(true);
    letGo({ body: RUBY_WINS });
    await flush();
    expect(markButtons()).toHaveLength(2);
    for (const b of markButtons()) expect(b.disabled).toBe(false);
  });

  it("never lets a read already on its way draw the old winner back over a marking", async () => {
    let letGo: (a: Answer) => void = () => undefined;
    const reads: OneAnswer[] = [{ body: CLOSED }, () => new Promise<Answer>((r) => (letGo = r))];
    await openPrize(CLOSED, { [`GET ${PART_PATH}`]: reads, [`POST ${PART_PATH}/12/winner`]: { body: RUBY_WINS } });
    tab("hq").click();
    tab("prize").click(); // read again, and that read is slow
    await flush();
    buttonIn(card("Ruby Tinselfoot"), "Mark as the winner")!.click();
    await flush();
    expect(chipsOf(card("Ruby Tinselfoot"))).toEqual(["The winner"]);
    letGo({ body: CLOSED }); // read before the marking, it still says Kim
    await flush();
    expect(chipsOf(card("Ruby Tinselfoot"))).toEqual(["The winner"]);
    expect(chipsOf(card("Kim Hollyhunt"))).toEqual([]);
  });

  // Task 5's review, Minor 1: the tile opened again while a marking is on its way must never draw over the
  // marking, whichever answer comes back first.
  describe("when the tile is opened again while a marking is on its way", () => {
    /** Opens the part, presses Mark as the winner on Ruby's card with the marking held, then opens the tile
     *  again. `post` lets the marking's answer go; `read` lets go of a read asked for meanwhile, if any was,
     *  with what the part was before the marking. */
    async function markThenReopen() {
      let letGoPost: (a: Answer) => void = () => undefined;
      let letGoRead: (a: Answer) => void = () => undefined;
      const readAnswers: OneAnswer[] = [{ body: CLOSED }, () => new Promise<Answer>((r) => (letGoRead = r))];
      const env = await openPrize(CLOSED, {
        [`GET ${PART_PATH}`]: readAnswers,
        [`POST ${PART_PATH}/12/winner`]: () => new Promise<Answer>((r) => (letGoPost = r)),
      });
      const ruby = card("Ruby Tinselfoot");
      buttonIn(ruby, "Mark as the winner")!.click();
      await flush();
      tab("hq").click();
      tab("prize").click();
      await flush();
      const reads = () => env.calls.filter((c) => c.method === "GET" && c.url === PART_PATH).length;
      return { ruby, reads, post: (a: Answer) => letGoPost(a), read: (a: Answer) => letGoRead(a) };
    }
    const saysMarked = () => card("Ruby Tinselfoot").querySelector<HTMLElement>(".hq-status")!.textContent;

    it("asks for no read until the marking is answered", async () => {
      const m = await markThenReopen();
      expect(m.reads()).toBe(1);
    });

    it("keeps the new winner when the marking is answered first", async () => {
      const m = await markThenReopen();
      m.post({ body: RUBY_WINS });
      await flush();
      m.read({ body: CLOSED });
      await flush();
      expect(chipsOf(card("Ruby Tinselfoot"))).toEqual(["The winner"]);
      expect(chipsOf(card("Kim Hollyhunt"))).toEqual([]);
      expect(saysMarked()).toBe("Marked as the winner.");
    });

    it("keeps the buttons held, then the new winner, when a read would be answered first", async () => {
      const m = await markThenReopen();
      m.read({ body: CLOSED });
      await flush();
      expect(markButtons()).toHaveLength(2);
      for (const b of markButtons()) expect(b.disabled).toBe(true);
      m.post({ body: RUBY_WINS });
      await flush();
      expect(chipsOf(card("Ruby Tinselfoot"))).toEqual(["The winner"]);
      expect(chipsOf(card("Kim Hollyhunt"))).toEqual([]);
      expect(saysMarked()).toBe("Marked as the winner.");
    });

    it("says a refusal on its card, which is still on the page", async () => {
      const m = await markThenReopen();
      m.read({ body: CLOSED });
      await flush();
      m.post({ status: 409, body: { error: WINNER_TAKEN } });
      await flush();
      expect(card("Ruby Tinselfoot")).toBe(m.ruby);
      const said = m.ruby.querySelector<HTMLElement>(".hq-status")!;
      expect(said.textContent).toBe(WINNER_TAKEN);
      expect(said.classList.contains("is-error")).toBe(true);
      for (const b of markButtons()) expect(b.disabled).toBe(false);
    });

    it("reads again when the tile is opened once the marking is answered", async () => {
      const m = await markThenReopen();
      m.post({ body: RUBY_WINS });
      await flush();
      tab("hq").click();
      tab("prize").click();
      await flush();
      expect(m.reads()).toBe(2);
    });
  });

  it("shows a refusal's sentence on that card as an error, and keeps the card as it was", async () => {
    await openPrize(CLOSED, { [`POST ${PART_PATH}/12/winner`]: { status: 409, body: { error: WINNER_TAKEN } } });
    const ruby = card("Ruby Tinselfoot");
    const press = buttonIn(ruby, "Mark as the winner")!;
    press.click();
    await flush();
    const said = ruby.querySelector<HTMLElement>(".hq-status")!;
    expect(said.textContent).toBe(WINNER_TAKEN);
    expect(said.classList.contains("is-error")).toBe(true);
    expect(said.classList.contains("is-ok")).toBe(false);
    expect(card("Ruby Tinselfoot")).toBe(ruby);
    expect(chipsOf(card("Kim Hollyhunt"))).toEqual(["The winner"]);
    for (const b of markButtons()) expect(b.disabled).toBe(false);
    expect(document.activeElement).toBe(press);
  });

  it("lets go of the old blob addresses when the part is read again", async () => {
    const env = await openPrize(CLOSED);
    const first = [...env.made];
    expect(first).toHaveLength(3);
    tab("hq").click();
    tab("prize").click();
    await flush();
    expect(env.revoked).toEqual(first);
    expect(pictureCalls(env)).toHaveLength(6);
  });
});

// The Doors prize part already owns .hq-prize (assets/css/admin-elf-hq.css), so the Grand prize part's pieces
// are named .hq-gp, and nothing in it is reached by a .hq-prize rule (Task 4's report).
describe("the Grand prize part's own names", () => {
  const CSS = readFileSync(resolve(__dirname, "../../assets/css/admin-elf-hq.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("draws nothing with a class the Doors prize part's rules reach", async () => {
    await openPrize(CLOSED);
    const names = [...part().querySelectorAll("[class]")].flatMap((n) => [...n.classList]);
    expect(names).toContain("hq-gp");
    expect(names).toContain("hq-gp-entry");
    expect(names.filter((c) => c.startsWith("hq-prize"))).toEqual([]);
  });

  it("has its pieces in the stylesheet, with the cards in two columns once the part is wide", () => {
    for (const s of [".hq-gp", ".hq-gp-entry", ".hq-gp-entry__pic"]) expect(CSS, s).toMatch(new RegExp(`(^|[\\s,}])${s.replace(/[.]/g, "[.]")}[\\s,{:.]`));
    const wide = /@container \(min-width: 1040px\) \{([^}]*)\}/g;
    const blocks = [...CSS.matchAll(wide)].map((m) => m[1]);
    expect(blocks.some((b) => b.includes(".hq-gp__list") && b.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"))).toBe(true);
  });
});
