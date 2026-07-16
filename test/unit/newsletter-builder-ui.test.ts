// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { roleToPermissions } from "../../src/admin/permissions";

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

// What GET /api/admin/newsletters/:id returns. Defaults to the legacy (bodyHtml-only) fixture above so
// the hydration tests are unchanged; a test wanting a block document (e.g. to open a SIZEABLE block in
// read mode) swaps it in. Reset in beforeEach.
let singleNewsletter: unknown = legacyNewsletter;

let newsletterListRows: unknown[] = []; // what GET /api/admin/newsletters (list) returns; per-test

// TASK-249: the shared saved-template library fixtures; set per-test.
let templateRows: unknown[] = [];
let templateSaveStatus = 201; // flip to 409 to exercise the name-already-taken path
const templateSaves: { body: Record<string, unknown> }[] = [];
const templateDeletes: string[] = [];
const deleteRequests: string[] = []; // TASK-252: DELETE /api/admin/newsletters/:id calls
const templateDoc = { blocks: [{ type: "text", variant: 0, data: { text: "From the template" }, size: 1 }] };
const savedRequests: { url: string; method: string; body: Record<string, unknown> }[] = [];
const previewRequests: { body: Record<string, unknown> }[] = [];
const sendRequests: { url: string }[] = []; // POST /:id/send calls (the actual blast)
const subscriberRequests: { body: Record<string, unknown> }[] = []; // POST .../subscribers
const testSendRequests: { body: Record<string, unknown> }[] = []; // POST .../test-send
const recipientsFixture = { count: 2, emails: ["ann@bdd.example", "ben@bdd.example"] };

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
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
  if (url.includes("/api/admin/me")) {
    // Admin Phase 2 (TASK-186): app.js calls GET /api/admin/me on init to filter the nav and gate
    // write controls (e.g. the newsletterSend button) via canEdit(section). Decode the bearer
    // token's role so this mock matches the server's effectivePermissions with no stored overrides.
    const auth = init?.headers?.Authorization || "";
    const claims = helpers.parseClaims(auth.replace(/^Bearer\s+/, "")) as { role?: string; email?: string } | null;
    const role = claims?.role || "viewer";
    return j({ email: claims?.email || "", permissions: roleToPermissions(role) });
  }
  if (url.includes("/api/admin/newsletters/preview")) {
    previewRequests.push({ body: parsedBody });
    return j({ html: "<html><body>preview</body></html>" });
  }
  if (url.includes("/api/admin/newsletters/recipients") && method === "GET") {
    return j(recipientsFixture);
  }
  if (/\/api\/admin\/newsletters\/\d+\/send$/.test(url) && method === "POST") {
    sendRequests.push({ url });
    return j({ status: "sent", recipientCount: recipientsFixture.count });
  }
  if (url.includes("/api/admin/newsletters/test-send") && method === "POST") {
    testSendRequests.push({ body: parsedBody });
    return j({ sentTo: "s@nbcc" });
  }
  if (url.includes("/api/admin/newsletters/subscribers") && method === "POST") {
    subscriberRequests.push({ body: parsedBody });
    return j({ email: String(parsedBody.email || "").toLowerCase(), status: "added" }, 201);
  }
  if (/\/api\/admin\/newsletters\/\d+$/.test(url) && method === "GET") {
    return j(singleNewsletter); // legacy bodyHtml by default; a test may swap in a block document
  }
  // TASK-252: delete. The server decides delete-vs-redact from the newsletter's own status; the stub
  // echoes back which happened, because the UI's message depends on it.
  if (/\/api\/admin\/newsletters\/\d+$/.test(url) && method === "DELETE") {
    deleteRequests.push(url);
    const id = Number((url.match(/(\d+)$/) || [])[1]);
    return j({ status: id === 42 ? "redacted" : "deleted", id });
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
  // TASK-249: the shared saved-template library.
  if (url === "/api/admin/newsletter-templates" && method === "GET") {
    return j(templateRows);
  }
  if (url === "/api/admin/newsletter-templates" && method === "POST") {
    templateSaves.push({ body: parsedBody });
    if (templateSaveStatus !== 201) return j({ error: "A template with that name already exists" }, templateSaveStatus);
    return j({ id: 5, name: parsedBody.name, createdAt: "2026-07-16T00:00:00.000Z" }, 201);
  }
  if (/\/api\/admin\/newsletter-templates\/\d+$/.test(url) && method === "GET") {
    return j({ id: 5, name: "Christmas Appeal", createdAt: "2026-07-16T00:00:00.000Z", bodyJson: templateDoc });
  }
  if (/\/api\/admin\/newsletter-templates\/\d+$/.test(url) && method === "DELETE") {
    templateDeletes.push(url);
    return j({}, 204);
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
    (b: HTMLButtonElement) => (b.textContent || "").trim() === label,
  ) as HTMLButtonElement;
  expect(btn).toBeTruthy();
  btn.click();
}

// The canvas renders an empty-state placeholder when there are no blocks; count real block cards.
const blockCount = () => el("nlCanvas").querySelectorAll(".nl-block").length;

describe("newsletter block builder (jsdom, TASK-168 Task 25)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    singleNewsletter = legacyNewsletter;
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc); // run the IIFE against this DOM
  });

  it("renders the palette once the app loads", async () => {
    await signIn();
    // The palette is built at script-eval time, independent of tab selection.
    expect(el("nlPalette").childElementCount).toBeGreaterThan(0);
    expect(el("nlPalette").textContent).toContain("Text");
  });

  it("Start from template loads a showcase newsletter covering every block type", async () => {
    await openNewsletterTab();
    (el("newsletterTemplate") as HTMLElement).click();

    // Every block type has a distinct card title; the template should include all 13.
    const titles = Array.prototype.map.call(
      el("nlCanvas").querySelectorAll(".nl-block-title"),
      (n: HTMLElement) => n.textContent,
    ) as string[];
    for (const label of [
      "Masthead", "Greeting", "Text", "Heading", "Image", "Story", "Spotlight",
      "Impact stats", "Ways to help", "Events", "Donation CTA", "Button", "Divider",
    ]) {
      expect(titles).toContain(label);
    }
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Winter Update");
    expect((el("newsletterId") as HTMLInputElement).value).toBe(""); // unsaved — Save creates a new one
  });

  it("New newsletter starts an empty block doc and the palette adds a block to the canvas", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    expect(blockCount()).toBe(0); // no block cards yet…
    expect(el("nlCanvas").textContent).toContain("No blocks yet"); // …just the empty-state prompt

    clickPalette("Text");

    expect(blockCount()).toBe(1);
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

  // Send-confirmation dialog: an Admin opening a saved draft sees the Send button; clicking it opens
  // a centered confirm dialog that lists the recipients and only sends after "Yes, send".
  async function openDraftAsAdmin() {
    loginToken = tokenFor("admin");
    newsletterListRows = [
      { id: 41, subject: legacyNewsletter.subject, status: "draft", sentAt: null, recipientCount: null },
    ];
    await openNewsletterTab(); // auto-opens id 41; Send button is revealed for an admin on a draft
    await flush();
  }
  const overlay = () => document.querySelector(".nl-modal-overlay");

  it("clicking Send opens a confirmation dialog that lists recipients and does not send yet", async () => {
    await openDraftAsAdmin();
    expect((el("newsletterSend") as HTMLElement).hidden).toBe(false);

    el("newsletterSend").click();
    await flush(); // let the recipients fetch resolve

    const modal = overlay();
    expect(modal).toBeTruthy();
    expect(modal!.textContent).toContain("Are you sure you want to send this newsletter?");
    expect(modal!.querySelector(".nl-modal-count")!.textContent).toContain("2 consenting subscribers");
    const tip = modal!.querySelector(".nl-tooltip")!;
    expect(tip.textContent).toContain("ann@bdd.example");
    expect(tip.textContent).toContain("ben@bdd.example");
    // Crucially, opening the dialog must NOT send.
    expect(sendRequests.length).toBe(0);
  });

  it("Cancel dismisses the dialog without sending", async () => {
    await openDraftAsAdmin();
    el("newsletterSend").click();
    await flush();

    (overlay()!.querySelector(".nl-modal-cancel") as HTMLElement).click();
    expect(overlay()).toBeNull();
    expect(sendRequests.length).toBe(0);
  });

  it("Yes, send posts the send and closes the dialog", async () => {
    await openDraftAsAdmin();
    el("newsletterSend").click();
    await flush();

    (overlay()!.querySelector(".nl-modal-confirm") as HTMLElement).click();
    await flush();
    await flush();

    expect(sendRequests.length).toBe(1);
    expect(sendRequests[0].url).toBe("/api/admin/newsletters/41/send");
    expect(overlay()).toBeNull(); // dialog closes after the send resolves
  });

  it("a Viewer sees the builder in read mode: no add/remove, and fields are disabled", async () => {
    loginToken = tokenFor("viewer");
    newsletterListRows = [
      { id: 41, subject: legacyNewsletter.subject, status: "draft", sentAt: null, recipientCount: null },
    ];
    await openNewsletterTab(); // auto-opens id 41 as a viewer
    await flush();

    // Palette: no "add block" chips, just a read-only note.
    expect(el("nlPalette").querySelectorAll(".nl-add").length).toBe(0);
    expect(el("nlPalette").textContent).toMatch(/read-only/i);
    // Save/New are hidden/disabled; the block card carries no move/dup/delete controls.
    expect((el("newsletterSave") as HTMLElement).hidden).toBe(true);
    expect((el("newsletterNew") as HTMLButtonElement).disabled).toBe(true);
    expect(el("nlCanvas").querySelectorAll(".nl-block").length).toBe(1);
    expect(el("nlCanvas").querySelector(".nl-block-ctrls")).toBeNull();
    // Field inputs are disabled — a viewer can look but not edit.
    const field = el("nlCanvas").querySelector("textarea, input") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    // The manual add-subscriber card and the test-send button are edit actions → hidden for a viewer.
    expect((el("nlSubscriberCard") as HTMLElement).hidden).toBe(true);
    expect((el("newsletterTest") as HTMLElement).hidden).toBe(true);
  });

  it("an Editor can manually add a subscriber via the form", async () => {
    loginToken = tokenFor("editor");
    await openNewsletterTab();
    await flush();

    expect((el("nlSubscriberCard") as HTMLElement).hidden).toBe(false);
    (el("subEmail") as HTMLInputElement).value = "doorstep@example.com";
    (el("subName") as HTMLInputElement).value = "Doorstep Donor";
    (el("subscriberForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    expect(subscriberRequests.length).toBe(1);
    expect(subscriberRequests[0].body).toEqual({ email: "doorstep@example.com", name: "Doorstep Donor" });
    expect(el("subMsg").textContent).toContain("doorstep@example.com");
    expect((el("subEmail") as HTMLInputElement).value).toBe(""); // cleared on success
  });

  it("Send test to me posts the current builder doc and reports the address", async () => {
    loginToken = tokenFor("editor");
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterSubject") as HTMLInputElement).value = "Test subject";
    clickPalette("Text");

    (el("newsletterTest") as HTMLElement).click();
    await flush();
    await flush();

    expect(testSendRequests.length).toBe(1);
    expect(testSendRequests[0].body.subject).toBe("Test subject");
    expect((testSendRequests[0].body.bodyJson as { blocks: unknown[] }).blocks.length).toBe(1);
    expect(el("newsletterMsg").textContent).toContain("Test sent to s@nbcc");
  });
});

describe("newsletter live preview debounce (jsdom, TASK-168 Task 25)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
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

// TASK-248: the per-block text size control (A- / A+). The pure ladder maths lives server-side and is
// tested in newsletter-blocks.test.ts; what MUST be proven HERE is the wiring across the boundary —
// that the button reaches the saved bodyJson. A control that renders but never lands is the exact
// class of bug this codebase keeps producing (each side of a boundary tested, never the hop between),
// so that is the assertion that earns its keep. The client's own exclusion list is kept honest by
// nlCanSize being asserted against a masthead below; the server ignores a step on those types anyway,
// so the worst case of drift is a dead button, never a wrong render.
describe("per-block text size control (TASK-248)", () => {
  const sizeCtrl = () => el("nlCanvas").querySelector(".nl-size");
  const sizeBtns = () =>
    Array.prototype.slice.call((sizeCtrl() as HTMLElement).querySelectorAll("button")) as HTMLButtonElement[];

  it("offers A-/A+ on a text block", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Text");
    expect(sizeCtrl()).toBeTruthy();
    expect(sizeBtns()).toHaveLength(2);
  });

  it("carries the chosen step into the saved bodyJson (the control actually lands)", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterSubject") as HTMLInputElement).value = "Sized";
    clickPalette("Text");

    sizeBtns()[1].click(); // A+
    sizeBtns()[1].click(); // A+ again -> +2

    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    const sentDoc = savedRequests[0].body.bodyJson as { blocks: { size?: number }[] };
    expect(sentDoc.blocks[0].size).toBe(2);
  });

  it("clamps in the UI: A+ disables at +2 and A- disables at -2", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Text");

    sizeBtns()[1].click();
    sizeBtns()[1].click();
    expect(sizeBtns()[1].disabled).toBe(true); // at the top of the range
    expect(sizeBtns()[0].disabled).toBe(false);

    for (let i = 0; i < 4; i++) sizeBtns()[0].click(); // +2 -> -2
    expect(sizeBtns()[0].disabled).toBe(true); // at the bottom
    expect(sizeBtns()[1].disabled).toBe(false);
  });

  it("hides the control for the block types the server will not size", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Masthead"); // in NO_SIZE_STEP: the brand signature, sized by its variants
    expect(sizeCtrl()).toBeNull();
  });

  it("is read-only safe: a Viewer sees the step but cannot change it", async () => {
    // Open a draft that really does carry a sizeable block — the default fixture is a legacy rawHtml
    // doc, which is excluded from sizing, so this test would prove nothing against it.
    loginToken = tokenFor("viewer");
    singleNewsletter = {
      id: 41,
      subject: "Sized draft",
      status: "draft",
      sentAt: null,
      recipientCount: null,
      bodyHtml: null,
      bodyJson: { blocks: [{ type: "text", variant: 0, data: { text: "Body" }, size: 1 }] },
    };
    newsletterListRows = [{ id: 41, subject: "Sized draft", status: "draft", sentAt: null, recipientCount: null }];
    await openNewsletterTab(); // auto-opens id 41 as a viewer
    await flush();

    const ctrl = el("nlCanvas").querySelector(".nl-size");
    expect(ctrl, "a viewer should still SEE the control (read mode shows state)").toBeTruthy();
    const btns = Array.prototype.slice.call((ctrl as HTMLElement).querySelectorAll("button")) as HTMLButtonElement[];
    expect(btns).toHaveLength(2);
    btns.forEach((b) => expect(b.disabled).toBe(true));
  });
});

// TASK-249: the SHARED saved-template library. The name rules, query shapes and 409 live in
// newsletter-templates.test.ts; the round trip lives in the BDD scenario. What earns its keep HERE is
// the wiring: that the library actually loads when the tab opens (it is called from a different scope
// than it is declared in — a ReferenceError there would silently kill the whole tab), that saving
// posts the LIVE document rather than a stale copy, that starting from one replaces the canvas, and
// that a name clash reads as a sentence rather than an error dump.
describe("shared saved-template library (TASK-249)", () => {
  beforeEach(() => {
    // Full mount: this is a TOP-LEVEL describe, so it inherits nothing from the block-builder suite
    // above — it must stand up its own DOM, helpers and fetch stub, like the debounce suite does.
    loginToken = tokenFor("editor");
    singleNewsletter = legacyNewsletter;
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    templateRows = [];
    templateSaveStatus = 201;
    templateSaves.length = 0;
    templateDeletes.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc); // run the IIFE against this DOM
  });

  it("loads the library when the tab opens, and hides the picker while it is empty", async () => {
    // Guards the scope hazard: nlRefreshTemplates is called from the tab-open flow. If it were not
    // visible there this throws, and the newsletter tab dies on open.
    templateRows = [];
    await openNewsletterTab();
    await flush();
    expect(el("nlTemplates").hidden).toBe(true); // an empty picker is noise on a fresh install
  });

  it("shows the picker once the shared library has something in it", async () => {
    templateRows = [{ id: 5, name: "Christmas Appeal", createdAt: "2026-07-16T00:00:00.000Z" }];
    await openNewsletterTab();
    await flush();
    expect(el("nlTemplates").hidden).toBe(false);
    expect(el("newsletterTemplatePick").textContent).toContain("Christmas Appeal");
  });

  it("saves the LIVE document under the given name (not a stale copy)", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterSubject") as HTMLInputElement).value = "Autumn update";
    clickPalette("Text");

    (el("newsletterTemplateSave") as HTMLElement).click();
    // The name defaults to the subject — almost always what you'd type anyway.
    expect((el("newsletterTemplateName") as HTMLInputElement).value).toBe("Autumn update");
    (el("newsletterTemplateName") as HTMLInputElement).value = "Autumn shell";
    (el("newsletterTemplateSaveConfirm") as HTMLElement).click();
    await flush();
    await flush();

    expect(templateSaves).toHaveLength(1);
    expect(templateSaves[0].body.name).toBe("Autumn shell");
    const sent = templateSaves[0].body.bodyJson as { blocks: unknown[] };
    expect(sent.blocks).toHaveLength(1); // the block just added, i.e. the live doc
  });

  it("refuses to save an empty document rather than filling the library with junk", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterTemplateSave") as HTMLElement).click();
    expect(templateSaves).toHaveLength(0);
    expect(el("nlTemplateMsg").textContent).toMatch(/blocks first/i);
  });

  it("explains a name clash in a sentence instead of dumping the error", async () => {
    templateSaveStatus = 409;
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Text");
    (el("newsletterTemplateSave") as HTMLElement).click();
    (el("newsletterTemplateName") as HTMLInputElement).value = "Taken";
    (el("newsletterTemplateSaveConfirm") as HTMLElement).click();
    await flush();
    await flush();
    expect(el("nlTemplateMsg").textContent).toMatch(/already taken/i);
  });

  it("starting from a template loads its blocks as a NEW newsletter, never an edit of the template", async () => {
    templateRows = [{ id: 5, name: "Christmas Appeal", createdAt: "2026-07-16T00:00:00.000Z" }];
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    await flush();

    (el("newsletterTemplateUse") as HTMLElement).click();
    await flush();
    await flush();

    // The canvas now holds the template's block…
    expect(el("nlCanvas").querySelectorAll(".nl-block").length).toBe(1);
    // …and it is a NEW newsletter: no id, so Save creates rather than overwriting anything.
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
  });

  it("deleting asks first, because a shared library loses it for everyone", async () => {
    templateRows = [{ id: 5, name: "Christmas Appeal", createdAt: "2026-07-16T00:00:00.000Z" }];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openNewsletterTab();
    await flush();

    (el("newsletterTemplateDelete") as HTMLElement).click();
    await flush();
    expect(confirmSpy).toHaveBeenCalled();
    expect(templateDeletes).toHaveLength(0); // declined -> nothing removed

    confirmSpy.mockReturnValue(true);
    (el("newsletterTemplateDelete") as HTMLElement).click();
    await flush();
    await flush();
    expect(templateDeletes).toHaveLength(1);
    confirmSpy.mockRestore();
  });
});

// TASK-251: the sign-off block's builder wiring. The rendering is proven server-side in
// newsletter-blocks.test.ts; what matters HERE is that the picker really is built from the SAME list
// the thank-you letter uses (that is the requirement — "the same list of names"), and that the choice
// reaches the saved document.
describe("sign-off block wiring (TASK-251)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    singleNewsletter = legacyNewsletter;
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    templateRows = [];
    templateSaveStatus = 201;
    templateSaves.length = 0;
    templateDeletes.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });

  const signerSelect = () => el("nlCanvas").querySelector("select") as HTMLSelectElement;

  it("is offered in the palette and adds with the sign-off already written", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Sign-off");
    expect(el("nlCanvas").textContent).toContain("Sign-off");
    // Prefilled with the wording NBCC actually signs off with — not an empty shell to retype.
    const inputs = Array.from(el("nlCanvas").querySelectorAll("input")) as HTMLInputElement[];
    const values = inputs.map((i) => i.value);
    expect(values).toContain("With love and gratitude,");
    expect(values).toContain("On behalf of everyone at NBCC");
    expect(values).toContain("info@nbcc.scot");
  });

  it("builds the signer picker from the SAME list the thank-you letter uses", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Sign-off");
    const opts = Array.from(signerSelect().options).map((o) => o.value);
    // The requirement: one list. Not a copy that drifts when someone joins or leaves.
    expect(opts).toEqual(helpers.SIGNERS.map((s: { name: string }) => s.name));
  });

  it("carries the chosen signer into the saved document", async () => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    (el("newsletterSubject") as HTMLInputElement).value = "Signed";
    clickPalette("Sign-off");

    const sel = signerSelect();
    sel.value = helpers.SIGNERS[2].name; // pick someone other than the default
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();

    const sent = savedRequests[0].body.bodyJson as { blocks: { type: string; data: { name: string } }[] };
    const block = sent.blocks.find((b) => b.type === "signoff")!;
    expect(block.data.name).toBe(helpers.SIGNERS[2].name);
  });

  it("keeps a signer who has since left the list, rather than silently re-signing an old newsletter", async () => {
    // An old draft signed by someone no longer in SIGNERS must still say who signed it.
    singleNewsletter = {
      id: 41, subject: "Old", status: "draft", sentAt: null, recipientCount: null, bodyHtml: null,
      bodyJson: { blocks: [{ type: "signoff", variant: 0, data: { closing: "Thanks,", name: "Someone Who Left", role: "", email: "" } }] },
    };
    newsletterListRows = [{ id: 41, subject: "Old", status: "draft", sentAt: null, recipientCount: null }];
    await openNewsletterTab();
    await flush();

    const sel = signerSelect();
    expect(sel.value).toBe("Someone Who Left");
    expect(Array.from(sel.options).map((o) => o.value)).toContain("Someone Who Left");
  });
});

// TASK-252: the delete control. The SQL contract is proven in newsletter-delete.test.ts and the round
// trip in the BDD scenario; what matters HERE is that the UI never misleads. A sent newsletter is only
// REDACTED — its record survives — so calling that button "Delete" would tell the admin the newsletter
// is gone when it deliberately is not. These pin the wording and the admin-only gate.
describe("delete a newsletter (TASK-252)", () => {
  const mount = (role: string) => {
    loginToken = tokenFor(role);
    singleNewsletter = legacyNewsletter;
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    templateRows = [];
    deleteRequests.length = 0;
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  };
  const draftRow = { id: 41, subject: "A draft", status: "draft", sentAt: null, recipientCount: null, redactedAt: null };
  const sentRow = { id: 42, subject: "Sent one", status: "sent", sentAt: "2026-07-01T10:00:00.000Z", recipientCount: 120, redactedAt: null };
  const btn = (id: number) => el("newsletterList").querySelector(`[data-delete-newsletter="${id}"]`) as HTMLButtonElement;

  it("says 'Delete content' on a SENT newsletter — never plain 'Delete', which would be a lie", async () => {
    newsletterListRows = [sentRow];
    mount("admin");
    await openNewsletterTab();
    await flush();
    expect(btn(42)).toBeTruthy();
    // The record of the send survives. The label has to say so.
    expect(btn(42).textContent).toBe("Delete content");
  });

  it("says plain 'Delete' on a draft, which really does go", async () => {
    newsletterListRows = [draftRow];
    mount("admin");
    await openNewsletterTab();
    await flush();
    expect(btn(41).textContent).toBe("Delete");
  });

  it("is offered to an admin only — an editor can write newsletters but not unsend them", async () => {
    newsletterListRows = [draftRow, sentRow];
    mount("editor");
    await openNewsletterTab();
    await flush();
    expect(el("newsletterList").querySelectorAll("[data-delete-newsletter]").length).toBe(0);
  });

  it("offers nothing on an already-redacted newsletter — its content is already gone", async () => {
    newsletterListRows = [{ ...sentRow, redactedAt: "2026-07-16T09:00:00.000Z" }];
    mount("admin");
    await openNewsletterTab();
    await flush();
    expect(btn(42)).toBeNull();
    expect(el("newsletterList").textContent).toContain("Content deleted");
  });

  it("asks first, and tells the truth about what survives", async () => {
    newsletterListRows = [sentRow];
    mount("admin");
    await openNewsletterTab();
    await flush();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    btn(42).click();
    await flush();
    expect(deleteRequests).toHaveLength(0); // declined -> nothing happens
    // The admin must know the record is KEPT before deciding, not discover it after.
    const asked = String(confirmSpy.mock.calls[0][0]);
    expect(asked).toMatch(/record/i);
    expect(asked).toMatch(/cannot be undone/i);

    confirmSpy.mockReturnValue(true);
    btn(42).click();
    await flush();
    await flush();
    expect(deleteRequests).toEqual(["/api/admin/newsletters/42"]);
    confirmSpy.mockRestore();
  });
});

// TASK-253: the B / I buttons. They wrap the SELECTION in the plain-text markers the server renders
// (**bold**, *italic*), so the block's data stays a plain string and nothing else in the model has to
// change. What earns its keep here: the buttons act on the selection, they toggle rather than stack
// markers, the change reaches the saved document, and — the fiddly one — hitting I on already-bold
// text must not strip half of the `**` and silently turn it italic.
describe("bold / italic buttons (TASK-253)", () => {
  beforeEach(() => {
    loginToken = tokenFor("editor");
    singleNewsletter = legacyNewsletter;
    newsletterListRows = [];
    savedRequests.length = 0;
    previewRequests.length = 0;
    sendRequests.length = 0;
    subscriberRequests.length = 0;
    testSendRequests.length = 0;
    templateRows = [];
    window.sessionStorage.clear();
    document.body.innerHTML = bodyHtml;
    (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: unknown, init?: unknown) =>
      Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> })),
    );
    // eslint-disable-next-line no-eval
    (0, eval)(appSrc);
  });

  const area = () => el("nlCanvas").querySelector("textarea") as HTMLTextAreaElement;
  const emph = (label: string) =>
    Array.prototype.find.call(
      el("nlCanvas").querySelectorAll(".nl-emph"),
      (b: HTMLButtonElement) => b.textContent === label,
    ) as HTMLButtonElement;
  const addText = async (value: string) => {
    await openNewsletterTab();
    (el("newsletterNew") as HTMLElement).click();
    clickPalette("Text");
    const t = area();
    t.value = value;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    return t;
  };
  const select = (t: HTMLTextAreaElement, word: string) => {
    const i = t.value.indexOf(word);
    t.setSelectionRange(i, i + word.length);
  };

  it("offers B and I on a prose field", async () => {
    await addText("Give generously");
    expect(emph("B")).toBeTruthy();
    expect(emph("I")).toBeTruthy();
  });

  it("wraps the selected word, not the whole paragraph", async () => {
    const t = await addText("Give generously today");
    select(t, "generously");
    emph("B").click();
    expect(t.value).toBe("Give **generously** today");
  });

  it("italicises the selection", async () => {
    const t = await addText("Give generously today");
    select(t, "generously");
    emph("I").click();
    expect(t.value).toBe("Give *generously* today");
  });

  it("toggles off rather than stacking markers when you click twice", async () => {
    const t = await addText("Give generously today");
    select(t, "generously");
    emph("B").click();
    expect(t.value).toBe("Give **generously** today");
    select(t, "generously"); // the word itself is still what's selected
    emph("B").click();
    expect(t.value).toBe("Give generously today"); // not ****generously****
  });

  it("does NOT turn bold into italic when you hit I on already-bold text", async () => {
    // The fiddly one: `**x**` ends with a `*`, so a naive toggle would strip one and leave `*x*`.
    const t = await addText("Give generously today");
    select(t, "generously");
    emph("B").click();
    select(t, "generously");
    emph("I").click();
    // Bold survives; the italic wraps INSIDE it.
    expect(t.value).toBe("Give ***generously*** today");
    expect(t.value).not.toBe("Give *generously* today");
  });

  it("does nothing when nothing is selected — no stray markers in your copy", async () => {
    const t = await addText("Give generously today");
    t.setSelectionRange(4, 4); // a caret, not a selection
    emph("B").click();
    expect(t.value).toBe("Give generously today");
  });

  it("carries the markers into the saved document", async () => {
    const t = await addText("Give generously today");
    (el("newsletterSubject") as HTMLInputElement).value = "Emphasised";
    select(t, "generously");
    emph("B").click();

    (el("newsletterForm") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    await flush();
    const sent = savedRequests[0].body.bodyJson as { blocks: { data: { text: string } }[] };
    expect(sent.blocks[0].data.text).toBe("Give **generously** today");
  });

  it("is withheld in read mode — emphasis is an edit", async () => {
    loginToken = tokenFor("viewer");
    singleNewsletter = {
      id: 41, subject: "Sized draft", status: "draft", sentAt: null, recipientCount: null, bodyHtml: null,
      bodyJson: { blocks: [{ type: "text", variant: 0, data: { text: "Body" } }] },
    };
    newsletterListRows = [{ id: 41, subject: "Sized draft", status: "draft", sentAt: null, recipientCount: null }];
    await openNewsletterTab();
    await flush();
    const buttons = el("nlCanvas").querySelectorAll(".nl-emph");
    Array.prototype.forEach.call(buttons, (b: HTMLButtonElement) => expect(b.disabled).toBe(true));
  });
});
