// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { roleToPermissions } from "../../src/admin/permissions";
import { newsletterDocSchema, renderNewsletter } from "../../src/newsletter/blocks";
import { STILL_PAPER_TYPES, EMAIL_ART_FILES } from "../../src/newsletter/paper-blocks";
import { preflightNewsletter } from "../../src/newsletter/preflight";

// The composer's side of the paper look blocks (14 November 2026): the palette in two labelled groups,
// each new block's label, icon, starting words and fields. Same harness as
// newsletter-builder-ui.test.ts: admin.html mounted in jsdom, app.js run against it, fetch stubbed.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

let role = "editor";
const previews: { bodyJson: { blocks: { type: string; variant: number; data: Record<string, unknown> }[] } }[] = [];

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const body = init?.body ? JSON.parse(init.body) : {};
  if (url.includes("/api/admin/login")) {
    const token = signAdminSession({ sub: 3, email: role + "@nbcc", role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "s@nbcc", role } });
  }
  if (url.includes("/api/admin/me")) return j({ email: role + "@nbcc", permissions: roleToPermissions(role) });
  if (url.includes("/api/admin/newsletters/preview")) {
    previews.push(body);
    return j({ html: "<html><body>preview</body></html>" });
  }
  if (url === "/api/admin/newsletters" || url.includes("/newsletter-templates") || url.includes("/subscriber-lists")) return j([]);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

let timers: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  timers = vi.spyOn(globalThis, "setTimeout");
});
afterEach(() => {
  for (const r of timers?.mock.results ?? []) if (r.type === "return") clearTimeout(r.value as ReturnType<typeof setTimeout>);
  timers?.mockRestore();
  timers = null;
});

async function openComposer() {
  (el("adminEmail") as HTMLInputElement).value = "s@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  for (let i = 0; i < 3; i++) await flush();
  (document.querySelector('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
  for (let i = 0; i < 3; i++) await flush();
  if (role !== "viewer") (el("newsletterNew") as HTMLElement).click();
}

const palette = () => el("nlPalette");
const groups = () => Array.from(palette().querySelectorAll(".nl-palette-group")) as HTMLElement[];
const buttonsIn = (group: HTMLElement) =>
  Array.from(group.querySelectorAll("button.nl-add")).map((b) => (b.textContent || "").trim());
function add(label: string) {
  const b = Array.from(palette().querySelectorAll("button.nl-add")).find((x) => (x.textContent || "").trim() === label) as HTMLButtonElement;
  expect(b, label).toBeTruthy();
  b.click();
}
const lastBlock = () => {
  const all = el("nlCanvas").querySelectorAll(".nl-block");
  return all[all.length - 1] as HTMLElement;
};
const labelsOf = (block: HTMLElement) =>
  Array.from(block.querySelectorAll(".nl-field-label")).map((n) => (n.textContent || "").trim());
// The blocks as the composer holds them, read back through the preview it asks for.
async function currentDoc() {
  await new Promise((r) => setTimeout(r, 320));
  await flush();
  return previews[previews.length - 1].bodyJson;
}

const NEW_LABELS = [
  "Picture header", "Photo row", "Handwritten note", "Event card", "Partner logos", "Gift tags",
  "What goes in a bag", "Festive divider", "Story, paper look",
];
const CLASSIC_LABELS = [
  "Masthead", "Sign-off", "Greeting", "Text", "Heading", "Image", "Story", "Spotlight", "Impact stats",
  "Ways to help", "Events", "Donation CTA", "Button", "Divider",
];

describe("the composer's paper look blocks", () => {
  beforeEach(() => {
    role = "editor";
    previews.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });

  it("lays the palette out in two labelled groups, the classic blocks first and unchanged", async () => {
    await openComposer();
    const [classic, paper] = groups();
    expect(groups()).toHaveLength(2);
    expect(classic.querySelector(".nl-palette-head")?.textContent).toBe("The classic blocks");
    expect(paper.querySelector(".nl-palette-head")?.textContent).toBe("The paper look (new)");
    expect(buttonsIn(classic)).toEqual(CLASSIC_LABELS);
    expect(buttonsIn(paper)).toEqual(NEW_LABELS);
  });

  it("gives every new block an icon and a button that says what it adds", async () => {
    await openComposer();
    for (const b of Array.from(groups()[1].querySelectorAll("button.nl-add"))) {
      expect(b.querySelector("svg")?.innerHTML.trim().length, b.textContent || "").toBeGreaterThan(10);
      expect(b.getAttribute("aria-label")).toBe(`Add ${(b.textContent || "").trim()} block`);
    }
  });

  it("still shows nothing to add in read mode", async () => {
    role = "viewer";
    await openComposer();
    expect(palette().querySelectorAll(".nl-add").length).toBe(0);
    expect(palette().textContent).toMatch(/read-only/i);
  });

  it("adds each new block already filled in with sendable words, a working picture and four named styles", async () => {
    await openComposer();
    for (const label of NEW_LABELS) {
      add(label);
      const card = lastBlock();
      expect(card.querySelector(".nl-block-title")?.textContent).toBe(label);
      expect(card.querySelectorAll(".nl-variants .admin-seg")).toHaveLength(4);
    }
    const doc = await currentDoc();
    expect(doc.blocks.map((b) => b.type)).toEqual([...STILL_PAPER_TYPES]);
    // What it adds is a document the server accepts, renders, and has nothing to block in.
    const parsed = newsletterDocSchema.parse(doc);
    const email = renderNewsletter(parsed, { firstName: "Jane" });
    const words = JSON.stringify(doc);
    expect(words).not.toMatch(/lorem|ipsum|!/i);
    // No [note to fill in] either: the starting words are ready to send as they are.
    const all = preflightNewsletter(newsletterDocSchema.parse(doc), { subject: "Hello", testSent: true });
    expect(all.map((f) => f.message).join(" ")).not.toContain("square brackets");
    for (const src of email.match(/https:\/\/nbcc\.scot\/assets\/img\/email\/[^"]+/g) || []) {
      expect(EMAIL_ART_FILES.concat(["hero-workshop.jpg", "hero-sleigh.jpg", "print-workshop-1.jpg", "print-workshop-2.jpg", "print-workshop-3.jpg", "logo-kilmarnock-santa-sleigh.png"])).toContain(
        src.split("/").pop(),
      );
    }
    const blocking = preflightNewsletter(parsed, { subject: "Hello", testSent: true, today: "2026-11-14" }).filter((f) => f.level === "block");
    expect(blocking).toEqual([]);
  });

  it("shows only the fields each style draws, and a picture field with the upload tools", async () => {
    await openComposer();
    add("Picture header");
    expect(labelsOf(lastBlock())).toEqual(["Picture", "Picture description", "Small line above", "Headline", "Line under the headline"]);
    expect(lastBlock().querySelector(".nl-img-tools")).toBeTruthy();
    add("Story, paper look");
    (Array.from(lastBlock().querySelectorAll(".nl-variants .admin-seg")) as HTMLElement[])[3].click();
    expect(labelsOf(lastBlock())).not.toContain("Photo");
    expect(labelsOf(lastBlock())).toContain("Handwritten line above");
  });

  it("offers each gift tag a colour, and each bag item a painting, from a list", async () => {
    await openComposer();
    add("Gift tags");
    const colour = lastBlock().querySelector("select[data-nl-choice='colour']") as HTMLSelectElement;
    expect(Array.from(colour.options).map((o) => o.textContent)).toEqual(["Paper", "Crimson", "Holly green", "Tan"]);
    colour.value = "tan";
    colour.dispatchEvent(new Event("change", { bubbles: true }));
    add("What goes in a bag");
    const pic = lastBlock().querySelector("select[data-nl-choice='pic']") as HTMLSelectElement;
    expect(Array.from(pic.options).map((o) => o.value)).toContain("pyjamas");
    expect(pic.options[0].textContent).toBe("No painting");
    const doc = await currentDoc();
    expect((doc.blocks[0].data.items as { colour: string }[])[0].colour).toBe("tan");
  });

  it("lets the partner names be switched off with a tick box that says what it does", async () => {
    await openComposer();
    add("Partner logos");
    const box = lastBlock().querySelector("input[type='checkbox'][data-nl-check='showNames']") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.textContent).toContain("Print the partners' names under the logos");
    box.click();
    const doc = await currentDoc();
    expect(doc.blocks[0].data.showNames).toBe(false);
  });

  it("gives the event card a date picker", async () => {
    await openComposer();
    add("Event card");
    expect(lastBlock().querySelector("input[type='date']")).toBeTruthy();
  });

  it("does not offer a text size step for the festive divider, matching the server", async () => {
    await openComposer();
    add("Festive divider");
    expect(lastBlock().querySelector(".nl-size")).toBeNull();
    add("Handwritten note");
    expect(lastBlock().querySelector(".nl-size")).toBeTruthy();
  });

  it("keeps every field a finger's height and 16px words, in its own stylesheet", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/admin-newsletter-blocks.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(html).toContain('href="/assets/css/admin-newsletter-blocks.css"');
    expect(css).not.toContain("!important");
    expect(css).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
    for (const m of css.matchAll(/([^{}]+)\{/g)) expect(m[1].trim()).toMatch(/^(#view-newsletter|@media)/);
  });
});
