// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";

// TASK-168 (Task 25): jsdom coverage for the newsletter block builder wiring in
// assets/js/admin/app.js — the browser-only IIFE that isn't exercised by the pure unit suite
// otherwise. Mounts admin.html, stubs AdminHelpers + fetch (same harness as admin-app.test.ts /
// TASK-118), signs in, opens the Newsletter tab, and drives the palette/canvas to assert the
// block-model behaviour (add/move/dup/delete), legacy bodyHtml hydration, and that Save builds
// { subject, bodyJson } from the live nlDoc. DB-free.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const tokenFor = (role: string) =>
  signAdminSession({ sub: 3, email: role + "@nbcc", role, now: new Date(), secret: "s" }).token;

let loginToken = tokenFor("editor");

// A legacy newsletter (no bodyJson, only the old bodyHtml column) used to exercise hydration.
const legacyNewsletter = {
  id: 41,
  subject: "July round-up",
  status: "draft",
  sentAt: null,
  recipientCount: null,
  bodyHtml: "<p>Hello from the old editor.</p>",
  bodyJson: null,
};

let newsletterListRows: unknown[] = []; // what GET /api/admin/newsletters (list) returns; per-test
const savedRequests: { url: string; method: string; body: Record<string, unknown> }[] = [];
const previewRequests: { body: Record<string, unknown> }[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = init?.method || "GET";
  const parsedBody = init?.body ? JSON.parse(init.body) : {};

  if (url.includes("/api/admin/login")) return j({ token: loginToken, user: { email: "s@nbcc", role: "editor" } });
  if (url.includes("/api/admin/newsletters/preview")) {
    previewRequests.push({ body: parsedBody });
    return j({ html: "<html><body>preview</body></html>" });
  }
  if (/\/api\/admin\/newsletters\/\d+$/.test(url) && method === "GET") {
    return j(legacyNewsletter); // the only single-newsletter fixture the tests need
  }
  if (/\/api\/admin\/newsletters\/\d+$/.test(url) && method === "PUT") {
    savedRequests.push({ url, method, body: parsedBody });
    return j({ id: 41, subject: parsedBody.subject, status: "draft" });
  }
  if (url === "/api/admin/newsletters" && method === "POST") {
    savedRequests.push({ url, method, body: parsedBody });
    return j({ id: 99, subject: parsedBody.subject, status: "draft" });
  }
  if (url === "/api/admin/newsletters" && method === "GET") {
    return j(newsletterListRows);
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const el = (id: string) => document.getElementById(id) as HTMLElement;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "s@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await flush();
  await flush();
  await flush();
}

async function openNewsletterTab() {
  await signIn();
  (document.querySelector('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
  await flush();
  await flush();
  await flush();
}

function clickPalette(label: string) {
  const btn = Array.prototype.find.call(
    el("nlPalette").querySelectorAll("button"),
    (b: HTMLButtonElement) => b.textContent === "+ " + label,
  ) as HTMLButtonElement;
  expect(btn).toBeTruthy();
  btn.click();
}

describe("newsletter block builder (jsdom, TASK-168 Task 25)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc); // run the IIFE against this DOM
  });

  it("renders the palette once the app loads", async () => {
    await signIn();
    // The palette is built at script-eval time, independent of tab selection.
    expect(el("nlPalette").childElementCount).toBeGreaterThan(0);
    expect(el("nlPalette").textContent).toContain("+ Text");
  });

  it("New newsletter starts an empty block doc and the palette adds a block to the canvas", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    expect(el("nlCanvas").childElementCount).toBe(0);

    clickPalette("Text");

    expect(el("nlCanvas").childElementCount).toBe(1);
    expect(el("nlCanvas").textContent).toContain("Text");
  });

  it("move (up), duplicate (deep copy), and delete reorder/copy/remove canvas blocks", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();

    clickPalette("Heading"); // block 0
    clickPalette("Text"); // block 1

    const titles = () =>
      Array.prototype.map.call(el("nlCanvas").querySelectorAll(".nl-block-title"), (n: HTMLElement) => n.textContent);
    expect(titles()).toEqual(["Heading", "Text"]);

    // Move the second block up -> order swaps.
    const items = () => el("nlCanvas").querySelectorAll(".nl-block");
    (items()[1].querySelector('[data-nl="up"]') as HTMLElement).click();
    expect(titles()).toEqual(["Text", "Heading"]);

    // Duplicate the first block -> a second copy appears, and editing one copy's field does not
    // bleed into the other (proves nlDup deep-copies data rather than sharing a reference).
    (items()[0].querySelector('[data-nl="dup"]') as HTMLElement).click();
    expect(titles()).toEqual(["Text", "Text", "Heading"]);
    const firstTextArea = items()[0].querySelector("textarea") as HTMLTextAreaElement;
    firstTextArea.value = "edited only on the first copy";
    firstTextArea.dispatchEvent(new Event("input", { bubbles: true }));
    const secondTextArea = items()[1].querySelector("textarea") as HTMLTextAreaElement;
    expect(secondTextArea.value).not.toBe("edited only on the first copy");

    // Delete the last block -> canvas shrinks accordingly.
    (items()[2].querySelector('[data-nl="del"]') as HTMLElement).click();
    expect(titles()).toEqual(["Text", "Text"]);
  });

  it("legacy bodyHtml hydrates into a single rawHtml block, labelled via the fallback guard", async () => {
    // Seed the list with one legacy row; loadNewsletters() auto-opens the first row, which
    // exercises the real loadNewsletterInto() hydrate path (no bodyJson -> synthesize rawHtml).
    newsletterListRows = [
      { id: 41, subject: legacyNewsletter.subject, status: "draft", sentAt: null, recipientCount: null },
    ];
    await openNewsletterTab();

    expect((el("newsletterId") as HTMLInputElement).value).toBe("41");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("July round-up");
    // nlBlockDefs has no "rawHtml" entry -> nlRenderCanvas must fall back to { label: "Raw HTML" }
    // instead of throwing on nlBlockDefs[block.type].label.
    expect(el("nlCanvas").childElementCount).toBe(1);
    expect(el("nlCanvas").textContent).toContain("Raw HTML");
  });

  it("Save submits { subject, bodyJson } built from the live nlDoc", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();

    (el("newsletterSubject") as HTMLInputElement).value = "Autumn update";
    clickPalette("Text");
    const textarea = el("nlCanvas").querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Body copy for the autumn update.";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    expect(savedRequests.length).toBe(1);
    const saved = savedRequests[0];
    expect(saved.method).toBe("POST"); // brand-new newsletter -> no id yet -> POST not PUT
    expect(saved.body.subject).toBe("Autumn update");
    const sentDoc = saved.body.bodyJson as { blocks: { type: string; data: Record<string, unknown> }[] };
    expect(sentDoc.blocks).toHaveLength(1);
    expect(sentDoc.blocks[0].type).toBe("text");
    expect(sentDoc.blocks[0].data.text).toBe("Body copy for the autumn update.");
    // Note: the submit handler also calls loadNewsletterInto(res.body.id) right after setting
    // "Saved." (pre-existing behaviour, unchanged here), which can race the message back to ""
    // once that refetch resolves — so we don't assert on newsletterMsg's exact text here.
  });

  it("Save on an existing draft PUTs to its id", async () => {
    newsletterListRows = [
      { id: 41, subject: legacyNewsletter.subject, status: "draft", sentAt: null, recipientCount: null },
    ];
    await openNewsletterTab(); // auto-opens id 41

    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    expect(savedRequests.length).toBe(1);
    expect(savedRequests[0].method).toBe("PUT");
    expect(savedRequests[0].url).toBe("/api/admin/newsletters/41");
  });
});

describe("newsletter live preview debounce (jsdom, TASK-168 Task 25)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
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
    vi.useRealTimers();
  });

  it("debounces the preview POST to ~300ms after an edit, and posts the current bodyJson", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Text"); // schedules (and, after flush, fires) one preview
    await flush();
    await flush();

    vi.useFakeTimers();
    previewRequests.length = 0; // isolate the edit-triggered preview from setup noise

    const textarea = el("nlCanvas").querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "debounced edit";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(200);
    expect(previewRequests.length).toBe(0); // still debouncing at 200ms

    await vi.advanceTimersByTimeAsync(150); // crosses the 300ms mark
    expect(previewRequests.length).toBe(1);
    const doc = previewRequests[0].body.bodyJson as { blocks: { data: Record<string, unknown> }[] };
    expect(doc.blocks[0].data.text).toBe("debounced edit");
  });
});
