// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { roleToPermissions } from "../../src/admin/permissions";
import { newsletterDocSchema, renderNewsletter } from "../../src/newsletter/blocks";
import { preflightNewsletter } from "../../src/newsletter/preflight";

// TASK-646: the composer's side of the live blocks (Live total, Sleeps to go) and the four built-in
// starters (Christmas appeal, Fill a Red Bag, Santa Sleigh, Thank you for this year). Same harness as
// newsletter-paper-composer.test.ts: admin.html in jsdom, app.js run against it, fetch stubbed.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Doc = { blocks: { type: string; variant: number; data: Record<string, unknown> }[] };
const previews: { bodyJson: Doc }[] = [];
let live: Record<string, number | null> = { redBag: 312, sleigh: 123400 };
let sentNewsletter: unknown = null;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const body = init?.body ? JSON.parse(init.body) : {};
  if (url.includes("/api/admin/login")) {
    const token = signAdminSession({ sub: 3, email: "editor@nbcc", role: "editor", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "s@nbcc", role: "editor" } });
  }
  if (url.includes("/api/admin/me")) return j({ email: "editor@nbcc", permissions: roleToPermissions("editor") });
  if (url.includes("/api/admin/newsletters/preview")) {
    previews.push(body);
    const hasLive = (body.bodyJson?.blocks || []).some((b: { type: string }) => b.type === "liveTotal");
    return j(hasLive ? { html: "<html><body>preview</body></html>", live } : { html: "<html><body>preview</body></html>" });
  }
  if (url === "/api/admin/newsletters") return j(sentNewsletter ? [{ id: 5, subject: "Last winter", status: "sent", sentAt: "2026-01-10T10:00:00Z" }] : []);
  if (/\/api\/admin\/newsletters\/5$/.test(url)) return j(sentNewsletter);
  if (url.includes("/newsletter-templates") || url.includes("/subscriber-lists")) return j([]);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

let timers: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  timers = vi.spyOn(globalThis, "setTimeout");
  previews.length = 0;
  live = { redBag: 312, sleigh: 123400 };
  sentNewsletter = null;
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string })),
  );
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});
afterEach(() => {
  for (const r of timers?.mock.results ?? []) if (r.type === "return") clearTimeout(r.value as ReturnType<typeof setTimeout>);
  timers?.mockRestore();
  timers = null;
  vi.restoreAllMocks();
});

async function openComposer() {
  (el("adminEmail") as HTMLInputElement).value = "s@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  for (let i = 0; i < 3; i++) await flush();
  (document.querySelector('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
  for (let i = 0; i < 3; i++) await flush();
  (el("newsletterNew") as HTMLElement).click();
}
const settle = async () => {
  await new Promise((r) => setTimeout(r, 320));
  for (let i = 0; i < 3; i++) await flush();
};
const paperButtons = () =>
  Array.from(el("nlPalette").querySelectorAll(".nl-palette-group")[1].querySelectorAll("button.nl-add")).map((b) => (b.textContent || "").trim());
function add(label: string) {
  const b = Array.from(el("nlPalette").querySelectorAll("button.nl-add")).find((x) => (x.textContent || "").trim() === label) as HTMLButtonElement;
  expect(b, label).toBeTruthy();
  b.click();
}
const lastBlock = () => {
  const all = el("nlCanvas").querySelectorAll(".nl-block");
  return all[all.length - 1] as HTMLElement;
};
const labelsOf = (block: HTMLElement) => Array.from(block.querySelectorAll(".nl-field-label")).map((n) => (n.textContent || "").trim());
const lastDoc = () => previews[previews.length - 1].bodyJson;

function nextChristmasEve(): string {
  const now = new Date();
  const y = now.getMonth() === 11 && now.getDate() > 24 ? now.getFullYear() + 1 : now.getFullYear();
  return `${y}-12-24`;
}

describe("the live blocks in the palette", () => {
  it("adds Live total and Sleeps to go at the end of the paper look group, each with an icon", async () => {
    await openComposer();
    const names = paperButtons();
    expect(names.slice(-2)).toEqual(["Live total", "Sleeps to go"]);
    for (const label of ["Live total", "Sleeps to go"]) {
      const b = Array.from(el("nlPalette").querySelectorAll("button.nl-add")).find((x) => (x.textContent || "").trim() === label) as HTMLElement;
      expect(b.querySelector("svg")?.innerHTML.trim().length).toBeGreaterThan(10);
    }
  });

  it("adds a Live total reading Fill a Red Bag, with four styles, and says today's number and that it is read again when sent", async () => {
    await openComposer();
    add("Live total");
    const card = lastBlock();
    expect(card.querySelectorAll(".nl-variants .admin-seg")).toHaveLength(4);
    const source = card.querySelector("select[data-nl-choice='source']") as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.textContent)).toEqual([
      "Fill a Red Bag: bags filled", "Santa Sleigh: money raised", "A number I type",
    ]);
    expect(labelsOf(card)).toEqual(expect.arrayContaining(["Words before the number", "Words after the number", "Words when there is no number"]));
    await settle();
    const now = card.querySelector("[data-nl-live-now]") as HTMLElement;
    expect(now.textContent).toBe("Right now: 312 bags filled. It is read again when the newsletter is sent, and everyone gets that number.");
    const doc = lastDoc();
    expect(doc.blocks[0].type).toBe("liveTotal");
    expect(doc.blocks[0].data.source).toBe("redBag");
  });

  it("says when there is no number to show right now, rather than a zero", async () => {
    live = { redBag: 0, sleigh: null };
    await openComposer();
    add("Live total");
    await settle();
    const now = lastBlock().querySelector("[data-nl-live-now]") as HTMLElement;
    expect(now.textContent).toContain("Right now there is no number to show");
    expect(now.textContent).not.toMatch(/\b0 bags/);
  });

  it("follows the source chosen, as money for the sleigh", async () => {
    await openComposer();
    add("Live total");
    const source = lastBlock().querySelector("select[data-nl-choice='source']") as HTMLSelectElement;
    source.value = "sleigh";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect((lastBlock().querySelector("[data-nl-live-now]") as HTMLElement).textContent).toContain("Right now: " + helpers.formatPence(123400) + " raised by the sleigh.");
  });

  it("adds Sleeps to go counting to the next Christmas Eve, and offers sleeps or days", async () => {
    await openComposer();
    add("Sleeps to go");
    const card = lastBlock();
    expect(card.querySelectorAll(".nl-variants .admin-seg")).toHaveLength(4);
    expect((card.querySelector("input[type='date']") as HTMLInputElement).value).toBe(nextChristmasEve());
    const unit = card.querySelector("select[data-nl-choice='unit']") as HTMLSelectElement;
    expect(Array.from(unit.options).map((o) => o.value)).toEqual(["sleeps", "days"]);
    expect(card.textContent).toContain("the real date is always printed beside it");
  });

  it("adds both already filled in with sendable words: nothing to block, no exclamation marks, no notes in brackets", async () => {
    await openComposer();
    add("Live total");
    add("Sleeps to go");
    await settle();
    const doc = newsletterDocSchema.parse(lastDoc());
    expect(JSON.stringify(doc)).not.toContain("!");
    renderNewsletter(doc, { firstName: "Jane", live: { redBag: 312 } });
    const found = preflightNewsletter(doc, { subject: "Hello", testSent: true, live: { redBag: 312 } });
    expect(found.filter((f) => f.level === "block")).toEqual([]);
    expect(found.map((f) => f.message).join(" ")).not.toContain("square brackets");
  });

  it("takes out a number frozen by a past send when it is used again", async () => {
    sentNewsletter = {
      id: 5, subject: "Last winter", status: "sent",
      bodyJson: { blocks: [{ type: "liveTotal", variant: 0, data: { source: "redBag", sent: { value: 99, at: "2026-01-10T10:00:00Z" } } }] },
    };
    await openComposer();
    (document.querySelector("[data-start='again:5']") as HTMLElement).click();
    for (let i = 0; i < 4; i++) await flush();
    await settle();
    expect(lastDoc().blocks[0].data.sent).toBeUndefined();
  });
});

const STARTERS = ["Christmas appeal", "Fill a Red Bag", "Santa Sleigh", "Thank you for this year"];

describe("the four built-in starters", () => {
  it("are offered on the start screen, before the example, each saying what it is for", async () => {
    await openComposer();
    const opts = Array.from(el("nlStartList").querySelectorAll("[data-start]")) as HTMLElement[];
    const starters = opts.filter((o) => (o.getAttribute("data-start") || "").startsWith("starter:"));
    expect(starters.map((o) => o.querySelector("b")?.textContent)).toEqual(STARTERS);
    for (const o of starters) expect((o.querySelector("span")?.textContent || "").length).toBeGreaterThan(20);
    const keys = opts.map((o) => o.getAttribute("data-start"));
    expect(keys.indexOf("example")).toBeGreaterThan(keys.indexOf(starters[3].getAttribute("data-start")));
  });

  it("are offered beside Start from example, which is unchanged", async () => {
    await openComposer();
    expect(el("newsletterTemplate").textContent).toBe("Start from example");
    const pick = el("nlStarterPick") as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual(STARTERS);
    expect(document.querySelector("label[for='nlStarterPick']")?.textContent).toBeTruthy();
    expect(el("nlStarterUse").textContent).toBe("Start from this starter");
  });

  it("asks first before a starter replaces work not yet saved", async () => {
    await openComposer();
    (el("newsletterSubject") as HTMLInputElement).value = "My own words";
    el("newsletterSubject").dispatchEvent(new Event("input", { bubbles: true }));
    add("Text");
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    el("nlStarterUse").click();
    expect(ask).toHaveBeenCalled();
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("My own words");
  });

  for (const [i, name] of STARTERS.entries()) {
    it(`loads "${name}" with a subject, ready to fill in, with nothing that cannot be sent`, async () => {
      await openComposer();
      (el("nlStartList").querySelectorAll("[data-start^='starter:']")[i] as HTMLElement).click();
      await settle();
      const subject = (el("newsletterSubject") as HTMLInputElement).value;
      expect(subject.length).toBeGreaterThan(5);
      expect(el("nlStartScreen").hidden).toBe(true);
      const doc = newsletterDocSchema.parse(lastDoc());
      const words = JSON.stringify(doc) + subject;
      expect(words).not.toContain("!");
      expect(words).not.toMatch(/elf detective|detective|school/i);
      expect(words).not.toMatch(/lorem|ipsum/i);
      const email = renderNewsletter(doc, { firstName: "Jane", live: { redBag: 312, sleigh: 123400 }, today: "2026-11-21" });
      expect(email).toContain("Dear Jane");
      const found = preflightNewsletter(doc, { subject, testSent: true, today: "2026-11-21", live: { redBag: 312, sleigh: 123400 } });
      expect(found.filter((f) => f.level === "block")).toEqual([]);
      // What Jaimie must fill in is in square brackets, which the checks point out.
      expect(found.map((f) => f.message).join(" ")).toContain("square brackets");
      expect(el("newsletterMsg").textContent).toContain("square brackets");
    });
  }

  it("names a collapsed Live total by where its number comes from, never by a raw word", async () => {
    await openComposer();
    (el("nlStartList").querySelector("[data-start='starter:appeal']") as HTMLElement).click();
    await settle();
    const sums = Array.from(el("nlCanvas").querySelectorAll(".nl-block-sum")).map((n) => n.textContent || "");
    expect(sums.join(" | ")).not.toMatch(/redBag|"sleigh"/);
    expect(sums).toContain("Fill a Red Bag: bags filled");
  });

  it("each starter ends by signing off and starts with a picture header", async () => {
    await openComposer();
    for (let i = 0; i < STARTERS.length; i++) {
      (el("nlStarterPick") as HTMLSelectElement).selectedIndex = i;
      vi.spyOn(window, "confirm").mockReturnValue(true);
      el("nlStarterUse").click();
      await settle();
      const types = lastDoc().blocks.map((b) => b.type);
      expect(types[0]).toBe("hero");
      expect(types[types.length - 1]).toBe("signoff");
    }
  });
});
