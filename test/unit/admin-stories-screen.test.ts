// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Admin > Stories in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-content.md):
// tiles with counts that filter, the quote and what the sender agreed to on each story, consent over
// a year old marked, the erased stories, and one story with its words first and every big action
// asked in the page. Run in the admin's jsdom harness. Every story here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Story = Record<string, unknown> & { id: number; status: string };
type Call = { method: string; path: string; query: string; body?: string };
let perms: PermissionMap = {};
let calls: Call[] = [];
let live: Story[] = [];
let archived: Story[] = [];
let erasures: unknown = { results: [] };
let erasuresFail = false;
let deleteAnswer = 200;

const DAY = 86400000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const story = (id: number, status: string, o: Record<string, unknown> = {}): Story => ({
  id, created_at: ago(3), consent_captured_at: ago(3), submitter_role: "family_carer", use_scope: "public",
  consent_share_first_name: true, consent_share_town: false, third_party_consent: false, status, short_quote: null, ...o,
});
const detail = (s: Story) => ({
  story_text: "The words of story " + s.id + ". A bag of presents arrived on Christmas Eve.", contact_for_more: false,
  submitter_first_name: "Ada", submitter_email: "ada@example.com", submitter_phone: "01632 960001", submitter_town: "Exampleton",
  age_band: "25_44", gender: null, recipient_type: "child", heard_about: null, confirmed_over_16: true,
  admin_tags: [], admin_notes: null, archived_at: null, ...s,
});
const find = (id: number) => live.concat(archived).find((s) => s.id === id);

function respond(method: string, path: string, query: string, body?: string) {
  const j = (payload: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""), headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/stories") return j({ results: (query.includes("view=archived") ? archived : live).map((s) => ({ ...s })) });
  if (path === "/api/admin/erasures") return erasuresFail ? j({ error: "down" }, 500) : j(erasures);
  const one = path.match(/^\/api\/admin\/stories\/(\d+)(\/archive|\/restore)?$/);
  if (one) {
    const s = find(Number(one[1]));
    if (!s) return j({ error: "Story not found" }, 404);
    if (one[2]) return j({ ok: true });
    if (method === "DELETE") return deleteAnswer === 200 ? j({ deleted: true }) : j({ error: "Archive the story first. Erasing is permanent." }, deleteAnswer);
    if (method === "PATCH") {
      const sent = JSON.parse(body || "{}");
      if (sent.status) s.status = sent.status;
      return j(detail(s));
    }
    return j(detail(s));
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const all = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const listed = () => all("#storiesTable [data-story-read]").map((b) => Number(b.getAttribute("data-story-read")));
const tile = (sel: string) => q("#view-stories " + sel);
const count = (sel: string) => (tile(sel).querySelector(".ak-tile__n") as HTMLElement).textContent;
const rowOf = (id: number) => (q(`#storiesTable [data-story-read="${id}"]`).closest("tr") as HTMLElement);
const storyGets = () => calls.filter((c) => c.method === "GET" && c.path === "/api/admin/stories");

async function press(t: HTMLElement) {
  t.click();
  await settle();
}
async function openStories() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  await press(q('.admin-nav-link[data-view="stories"]'));
}
async function openStory(id: number) {
  await openStories();
  await press(rowOf(id).querySelector("[data-story]") as HTMLElement);
}

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  erasuresFail = false;
  deleteAnswer = 200;
  erasures = { results: [] };
  live = [
    story(6, "new", { short_quote: "It was that somebody had thought about us." }),
    story(5, "new", { use_scope: "internal_only" }),
    story(4, "reviewed", { consent_captured_at: ago(400) }),
    story(3, "used"),
    story(2, "withdrawn"),
  ];
  archived = [story(1, "reviewed", { archived_at: ago(10) })];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = kit;
  window.confirm = () => true;
  window.prompt = () => "a reason";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const [path, query = ""] = String(url).split("?");
    calls.push({ method, path, query, body: init?.body });
    return Promise.resolve(respond(method, path, query, init?.body));
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Stories list", () => {
  it("is in the kit's look and opens with a plain sentence saying what it is for", () => {
    expect(el("view-stories").classList.contains("ak")).toBe(true);
    expect(el("view-story").classList.contains("ak")).toBe(true);
    expect(q("#view-stories .admin-view-intro").textContent).toContain("what its sender agreed to");
  });

  it("counts the stories on tiles: To read, Read, Used, Withdrawn and Archived", async () => {
    await openStories();
    expect(count('[data-status=""]')).toBe("5");
    expect(count('[data-status="new"]')).toBe("2");
    expect(count('[data-status="reviewed"]')).toBe("1");
    expect(count('[data-status="used"]')).toBe("1");
    expect(count('[data-status="withdrawn"]')).toBe("1");
    expect(count('[data-view="archived"]')).toBe("1");
    expect(tile('[data-status="new"]').textContent).toContain("To read");
    expect(tile('[data-status="reviewed"]').textContent).toContain("Read");
  });

  it("filters the live stories in the browser when a tile is pressed", async () => {
    await openStories();
    const before = storyGets().length;
    await press(tile('[data-status="new"]'));
    expect(listed()).toEqual([6, 5]);
    expect(tile('[data-status="new"]').getAttribute("aria-pressed")).toBe("true");
    await press(tile('[data-status="used"]'));
    expect(listed()).toEqual([3]);
    expect(storyGets().length).toBe(before);
  });

  it("lists the archived stories under the Archived tile, and back to the live ones from another tile", async () => {
    await openStories();
    await press(tile('[data-view="archived"]'));
    expect(listed()).toEqual([1]);
    expect(storyGets().some((c) => c.query.includes("view=archived"))).toBe(true);
    await press(tile('[data-status=""]'));
    expect(listed()).toEqual([6, 5, 4, 3, 2]);
  });

  it("moves the counts when a story is ticked as read", async () => {
    await openStories();
    await press(q('#storiesTable [data-story-read="6"]'));
    expect(count('[data-status="new"]')).toBe("1");
    expect(count('[data-status="reviewed"]')).toBe("2");
  });

  it("shows the line they chose to be quoted on the story", async () => {
    await openStories();
    expect(rowOf(6).textContent).toContain("It was that somebody had thought about us.");
  });

  it("says what each sender agreed to, as one sentence", async () => {
    await openStories();
    expect(rowOf(6).textContent).toContain("May be used in public, with their first name, not their town.");
    expect(rowOf(5).textContent).toContain("Private to NBCC: never to be published.");
  });

  it("marks consent given over a year ago: check before using", async () => {
    await openStories();
    expect(rowOf(4).textContent).toContain("Check before using");
    expect(rowOf(6).textContent).not.toContain("Check before using");
  });

  it("lists the erased stories when their fold is opened: kind, number, when, who, why", async () => {
    erasures = { results: [
      { id: 2, recordKind: "story", recordId: 27, erasedAt: "2026-11-02T10:00:00Z", erasedBy: "rowan@example.com", reason: "She asked us to remove it." },
      { id: 1, recordKind: "contact_enquiry", recordId: 9, erasedAt: "2026-10-01T10:00:00Z", erasedBy: "ash@example.com", reason: "<b>Spam</b>" },
    ] };
    await openStories();
    const fold = el("storiesErased") as HTMLDetailsElement;
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));
    await settle();
    const text = el("storiesErasedList").textContent || "";
    expect(text).toContain("Story 27");
    expect(text).toContain("Contact form message 9");
    expect(text).toContain("2 November 2026");
    expect(text).toContain("rowan@example.com");
    expect(text).toContain("She asked us to remove it.");
    expect(text).toContain("<b>Spam</b>");
    expect(el("storiesErasedList").querySelector("b")).toBeNull();
  });

  it("says so in the fold when the erased stories cannot be read, and when there are none", async () => {
    erasuresFail = true;
    await openStories();
    const fold = el("storiesErased") as HTMLDetailsElement;
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));
    await settle();
    expect(el("storiesErasedList").textContent).toContain("Could not load the erased stories. Please try again.");
    erasuresFail = false;
    fold.dispatchEvent(new Event("toggle"));
    await settle();
    expect(el("storiesErasedList").textContent).toContain("No story has been erased.");
  });

  it("shows the storage check only to someone who may run it", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await openStories();
    expect(el("storiesDiagnostics").hidden).toBe(true);
  });
});

describe("one story", () => {
  it("is still a screen of its own, with the words first and then what they agreed to", async () => {
    await openStory(6);
    expect(el("view-story").hidden).toBe(false);
    const words = q("#storyDetail .admin-story-text");
    const agreed = el("storyAgreed");
    expect(words.compareDocumentPosition(agreed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agreed.textContent).toContain("Their first name may be used.");
    expect(agreed.textContent).toContain("Do not use their town.");
  });

  it("folds the rest away as About the sender", async () => {
    await openStory(6);
    const about = el("storyAbout") as HTMLDetailsElement;
    expect(about.tagName).toBe("DETAILS");
    expect(about.open).toBe(false);
    expect(about.querySelector("summary")?.textContent).toBe("About the sender");
    expect(about.textContent).toContain("Exampleton");
  });

  it("copies the story and the quote, with what they agreed to beside the buttons", async () => {
    const copy = vi.spyOn(kit, "copyText").mockResolvedValue(true);
    await openStory(6);
    const box = el("storyCopy");
    expect(box.textContent).toContain("May be used in public, with their first name, not their town.");
    await press(el("storyCopyText"));
    expect(copy).toHaveBeenCalledWith("The words of story 6. A bag of presents arrived on Christmas Eve.");
    expect(el("storyCopyStatus").textContent).toContain("Copied");
    expect(el("storyCopyStatus").classList.contains("is-ok")).toBe(true);
    await press(el("storyCopyQuote"));
    expect(copy).toHaveBeenLastCalledWith("It was that somebody had thought about us.");
    copy.mockRestore();
  });

  it("says so beside the button when the words could not be copied, and offers no quote to copy when there is none", async () => {
    const copy = vi.spyOn(kit, "copyText").mockResolvedValue(false);
    await openStory(5);
    expect(el("storyCopyQuote")).toBeNull();
    await press(el("storyCopyText"));
    expect(el("storyCopyStatus").classList.contains("is-error")).toBe(true);
    copy.mockRestore();
  });

  it("makes the email and phone links to tap only when they said they may be contacted", async () => {
    await openStory(6);
    expect(document.querySelector('#storyDetail a[href^="mailto:"]')).toBeNull();
    expect(document.querySelector('#storyDetail a[href^="tel:"]')).toBeNull();
    expect(el("storyAbout").textContent).toContain("ada@example.com");
    live[0].contact_for_more = true;
    await press(el("storyBack"));
    await press(rowOf(6).querySelector("[data-story]") as HTMLElement);
    expect(q('#storyDetail a[href="mailto:ada@example.com"]')).not.toBeNull();
    expect(q('#storyDetail a[href="tel:01632960001"]')).not.toBeNull();
  });

  it("says under Withdraw, Archive and Erase what each does, and whether it can be undone", async () => {
    await openStory(6);
    const says = (id: string) => (el(id).parentElement as HTMLElement).querySelector(".ak-says")?.textContent || "";
    expect(says("withdrawStoryBtn")).toContain("can be changed back");
    expect(says("archiveStoryBtn")).toContain("bring it back");
  });

  it("asks in the page before withdrawing, and No sends nothing", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await openStory(6);
    await press(el("withdrawStoryBtn"));
    expect(el("storyWithdrawAsk").hidden).toBe(false);
    await press(el("storyWithdrawNo"));
    expect(el("storyWithdrawAsk").hidden).toBe(true);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("withdraws on Yes and says so next to the button", async () => {
    await openStory(6);
    await press(el("withdrawStoryBtn"));
    await press(el("storyWithdrawYes"));
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual(['{"status":"withdrawn"}']);
    expect(el("storyStatusNow").textContent).toBe("Withdrawn");
    expect(el("storyPutAwayStatus").textContent).toBe("Story withdrawn.");
    expect(el("storyPutAwayStatus").classList.contains("is-ok")).toBe(true);
  });

  it("says Saved under Save changes, not at the foot of the page", async () => {
    await openStory(6);
    el("storyEditForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(el("storyFormStatus").textContent).toBe("Saved.");
    expect(el("storyFormStatus").closest("#storyEditForm")).not.toBeNull();
  });

  it("asks for the reason to erase on the page, with no browser box, and refuses an empty one", async () => {
    const prompt = vi.spyOn(window, "prompt");
    await openStories();
    await press(tile('[data-view="archived"]'));
    await press(rowOf(1).querySelector("[data-story]") as HTMLElement);
    expect((el("eraseStoryBtn").parentElement as HTMLElement).querySelector(".ak-says")?.textContent).toContain("cannot be undone");
    await press(el("eraseStoryBtn"));
    expect(el("storyEraseAsk").hidden).toBe(false);
    await press(el("storyEraseYes"));
    expect(el("storyPutAwayStatus").textContent).toBe("A reason is needed to erase a story.");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    (el("storyEraseReason") as HTMLTextAreaElement).value = "  She asked us to.  ";
    await press(el("storyEraseYes"));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.body)).toEqual(['{"reason":"She asked us to."}']);
    expect(prompt).not.toHaveBeenCalled();
    expect(el("view-stories").hidden).toBe(false);
  });

  it("says the server's sentence beside the button when an erase is refused", async () => {
    deleteAnswer = 409;
    await openStories();
    await press(tile('[data-view="archived"]'));
    await press(rowOf(1).querySelector("[data-story]") as HTMLElement);
    await press(el("eraseStoryBtn"));
    (el("storyEraseReason") as HTMLTextAreaElement).value = "Asked.";
    await press(el("storyEraseYes"));
    expect(el("storyPutAwayStatus").textContent).toBe("Archive the story first. Erasing is permanent.");
    expect(el("storyPutAwayStatus").classList.contains("is-error")).toBe(true);
  });

  it("goes to the next and previous story in the list as it was filtered", async () => {
    await openStories();
    await press(tile('[data-status="new"]'));
    await press(rowOf(6).querySelector("[data-story]") as HTMLElement);
    expect((el("storyPrev") as HTMLButtonElement).disabled).toBe(true);
    await press(el("storyNext"));
    expect(q("#storyDetail .admin-story-text").textContent).toContain("story 5");
    expect((el("storyNext") as HTMLButtonElement).disabled).toBe(true);
    await press(el("storyPrev"));
    expect(q("#storyDetail .admin-story-text").textContent).toContain("story 6");
  });
});
