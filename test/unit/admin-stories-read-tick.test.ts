// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-NNN: the Read tick on Admin > Stories, in the admin's jsdom harness (admin.html's <body>, a
// fake fetch, app.js evaluated against it). "Read" is the status Reviewed, so a tick sends a status
// to the PATCH the screen already had, with the status its screen showed (ifStatus), so it can never
// undo what somebody else did in the meantime. Every story here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
type Story = Record<string, unknown> & { id: number; status: string };
let perms: PermissionMap = {};
let calls: Call[] = []; // every request, noted as it is made
// What a PATCH answers: "ok" behaves as the server does (it saves, unless the story is no longer
// what ifStatus says, which is a 409 with the story as it is now); a number is that status with
// nothing saved; "down" is a request that never arrives.
let patchAnswer: "ok" | "down" | number = "ok";
let stories: Story[] = [];
// A PATCH waits here while a test looks at the screen in between the press and the answer.
let gate: Promise<void> | null = null;
let openGate: () => void = () => undefined;
const holdPatches = () => {
  gate = new Promise<void>((r) => {
    openGate = r;
  });
};

const story = (id: number, status: string): Story => ({
  id, created_at: "2026-06-01T00:00:00Z", consent_captured_at: "2026-06-01T00:00:00Z",
  submitter_role: "family_carer", use_scope: "internal_only", consent_share_first_name: false,
  consent_share_town: false, third_party_consent: false, status, short_quote: null,
});
const detail = (id: number, status: string) => ({
  ...story(id, status), story_text: "A bag of presents arrived on Christmas Eve.", contact_for_more: false,
  submitter_first_name: "Ada", submitter_email: null, submitter_phone: null, submitter_town: "Exampleton",
  age_band: null, gender: null, recipient_type: null, heard_about: null, confirmed_over_16: true,
  admin_tags: [], admin_notes: null, archived_at: null,
});
const inDb = (id: number) => stories.find((s) => s.id === id) as Story;

function respond(method: string, path: string, body?: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/stories") return j({ results: stories.map((s) => ({ ...s })) });
  const one = path.match(/^\/api\/admin\/stories\/(\d+)$/);
  if (one) {
    const id = Number(one[1]);
    const found = inDb(id);
    if (method === "PATCH") {
      if (patchAnswer === "down") throw new TypeError("Failed to fetch");
      if (patchAnswer !== "ok") return j({ error: "No" }, patchAnswer);
      if (!found) return j({ error: "Story not found" }, 404);
      const sent = JSON.parse(body || "{}") as { status?: string; ifStatus?: string };
      if (sent.ifStatus && found.status !== sent.ifStatus) {
        return j({ error: "Story has changed", story: detail(id, found.status) }, 409);
      }
      if (sent.status) found.status = sent.status;
      return j(detail(id, found.status));
    }
    return found ? j(detail(id, found.status)) : j({ error: "Story not found" }, 404);
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const tick = (id: number) => document.querySelector(`#storiesTable [data-story-read="${id}"]`) as HTMLInputElement;
const rowOf = (id: number) => tick(id).closest("tr") as HTMLElement;
const statusOf = (id: number) => (rowOf(id).querySelector("[data-story-status]") as HTMLElement).textContent;
const noteOf = (id: number) => (rowOf(id).querySelector("[data-story-note]") as HTMLElement).textContent;
const viewOf = (id: number) => rowOf(id).querySelector("[data-story]") as HTMLElement;
const statusPill = (id: number) => rowOf(id).querySelector("[data-story-status]") as HTMLElement;
// The "Not saved" pill that takes the status pill's place when a save fails.
const unsavedOf = (id: number) => rowOf(id).querySelector("[data-story-unsaved]") as HTMLElement;
const saysNotSaved = (id: number) => !unsavedOf(id).hidden && statusPill(id).hidden;
const patches = () => calls.filter((c) => c.method === "PATCH");

async function openStories() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
  await settle();
}
// A real press: a locked box ignores it, exactly as it does for a person.
async function press(box: HTMLElement) {
  box.click();
  await settle();
}

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  patchAnswer = "ok";
  gate = null;
  stories = [story(4, "new"), story(3, "reviewed"), story(2, "used"), story(1, "withdrawn")];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    calls.push({ method, path, body: init?.body });
    const answer = () => {
      try {
        return Promise.resolve(respond(method, path, init?.body));
      } catch (err) {
        return Promise.reject(err);
      }
    };
    return method === "PATCH" && gate ? gate.then(answer) : answer();
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Read column on the Stories list", () => {
  it("has a tick for every story, under a Read heading that comes first", async () => {
    await openStories();
    const headings = Array.from(document.querySelectorAll("#storiesTable th")).map((th) => th.textContent);
    expect(headings[0]).toBe("Read");
    expect(document.querySelectorAll("#storiesTable [data-story-read]")).toHaveLength(4);
  });

  it("is not ticked for New, ticked for Reviewed, and ticked and locked for Used and Withdrawn", async () => {
    await openStories();
    expect([tick(4).checked, tick(4).disabled]).toEqual([false, false]);
    expect([tick(3).checked, tick(3).disabled]).toEqual([true, false]);
    expect([tick(2).checked, tick(2).disabled]).toEqual([true, true]);
    expect([tick(1).checked, tick(1).disabled]).toEqual([true, true]);
  });

  it("names each tick for a screen reader by its story", async () => {
    await openStories();
    expect(tick(4).getAttribute("aria-label")).toBe("Story 4 read");
  });

  it("says why a locked tick is locked, and a tick that can be pressed says nothing", async () => {
    await openStories();
    const label = (id: number) => tick(id).closest("label") as HTMLElement;
    expect(label(2).title).toBe("Used stories count as read.");
    expect(label(1).title).toBe("Withdrawn stories count as read.");
    // On the box as well as its label: a screen reader reads a box's title as its description.
    expect([tick(2).title, tick(1).title]).toEqual(["Used stories count as read.", "Withdrawn stories count as read."]);
    expect([tick(4).hasAttribute("title"), tick(3).hasAttribute("title")]).toEqual([false, false]);
    expect([label(2).classList.contains("is-locked"), label(1).classList.contains("is-locked")]).toEqual([true, true]);
    expect([label(4).hasAttribute("title"), label(3).hasAttribute("title")]).toEqual([false, false]);
    expect([label(4).classList.contains("is-locked"), label(3).classList.contains("is-locked")]).toEqual([false, false]);
  });

  it("does not open the story when its tick is pressed", async () => {
    await openStories();
    await press(tick(4));
    expect(el("view-story").hidden).toBe(true);
  });

  it("has no line above the list for what could not be saved: that is said in the story's own row", async () => {
    await openStories();
    expect(el("storiesListStatus")).toBeNull();
    expect(document.querySelectorAll("#storiesTable [data-story-note]")).toHaveLength(4);
    expect(noteOf(4)).toBe("");
    expect(document.querySelectorAll("#storiesTable [data-story-unsaved]")).toHaveLength(4);
    expect([saysNotSaved(4), saysNotSaved(3), saysNotSaved(2), saysNotSaved(1)]).toEqual([false, false, false, false]);
    expect(statusPill(4).hidden).toBe(false);
  });
});

describe("ticking a story", () => {
  it("makes a New story Reviewed, in place, and the tick can come straight back off", async () => {
    await openStories();
    await press(tick(4));
    expect(patches()).toEqual([
      { method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"reviewed","ifStatus":"new"}' },
    ]);
    expect(tick(4).checked).toBe(true);
    expect(tick(4).disabled).toBe(false);
    expect(statusOf(4)).toBe("Reviewed");
    await press(tick(4));
    expect(patches()[1]).toEqual({
      method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"new","ifStatus":"reviewed"}',
    });
    expect(tick(4).checked).toBe(false);
    expect(statusOf(4)).toBe("New");
    expect(noteOf(4)).toBe("");
  });

  it("does not draw the list again, so nothing jumps", async () => {
    await openStories();
    const row = rowOf(4);
    await press(tick(4));
    expect(rowOf(4)).toBe(row);
    expect(calls.filter((c) => c.method === "GET" && c.path === "/api/admin/stories")).toHaveLength(1);
  });

  // A sentence under the status made the row taller, so every row beneath it moved: on a quick
  // run down the list a press could land on the story above the one it was aimed at. A failed
  // save is now two words in a pill, in the status pill's place, so the row keeps its height.
  it("puts the tick back and says Not saved in the status's place when the save fails, adding no line to the row", async () => {
    patchAnswer = 500;
    await openStories();
    await press(tick(4));
    expect(tick(4).checked).toBe(false);
    expect(tick(4).disabled).toBe(false);
    expect(saysNotSaved(4)).toBe(true);
    // Read aloud whole, with the story's number; seen as two words; the sentence on hover.
    expect(unsavedOf(4).textContent).toBe("Story 4: Not saved. Please try again.");
    expect(Array.from(unsavedOf(4).childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent)).toEqual(["Not saved"]);
    expect(unsavedOf(4).title).toBe("Could not save. Please try again.");
    expect(noteOf(4)).toBe("");
    // The status underneath is unchanged, and no other row says anything.
    expect(statusOf(4)).toBe("New");
    expect(saysNotSaved(3)).toBe(false);
  });

  it("says the same when the request never arrives", async () => {
    patchAnswer = "down";
    await openStories();
    await press(tick(3));
    expect(tick(3).checked).toBe(true);
    expect(statusOf(3)).toBe("Reviewed");
    expect(saysNotSaved(3)).toBe(true);
    expect(noteOf(3)).toBe("");
  });

  it("shows the status again on the next try", async () => {
    patchAnswer = 500;
    await openStories();
    await press(tick(4));
    expect(saysNotSaved(4)).toBe(true);
    patchAnswer = "ok";
    await press(tick(4));
    expect(saysNotSaved(4)).toBe(false);
    expect(statusPill(4).hidden).toBe(false);
    expect(statusOf(4)).toBe("Reviewed");
  });

  it("shows the status again, not Not saved, when the next answer is that somebody else changed the story", async () => {
    patchAnswer = 500;
    await openStories();
    await press(tick(4));
    expect(saysNotSaved(4)).toBe(true);
    patchAnswer = "ok";
    inDb(4).status = "used";
    await press(tick(4));
    expect(saysNotSaved(4)).toBe(false);
    expect(statusOf(4)).toBe("Used");
    expect(noteOf(4)).toBe("Someone else changed this story. It is now Used.");
  });

  // Disabling the box for the wait would drop the keyboard's place in the list (a disabled box
  // cannot hold it), so it stays as it is and a second press in that time is simply put back.
  it("keeps the keyboard on the tick while it saves, and a second press in that time is put back, not sent", async () => {
    await openStories();
    holdPatches();
    const box = tick(4);
    box.focus();
    box.click();
    await settle();
    expect(box.disabled).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("aria-busy")).toBe("true");
    box.click();
    await settle();
    expect(box.checked).toBe(true);
    expect(patches()).toHaveLength(1);
    openGate();
    await settle();
    expect(box.checked).toBe(true);
    expect(box.hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(statusOf(4)).toBe("Reviewed");
    expect(patches()).toHaveLength(1);
  });

  // The reason ifStatus exists. Withdrawn records that consent was taken back: a list that was
  // opened before that happened must not be able to put the story back to Reviewed.
  it("does not undo a status somebody else set since the list was opened: the row shows what the story is now", async () => {
    await openStories();
    inDb(4).status = "withdrawn";
    await press(tick(4));
    expect(patches()).toHaveLength(1);
    expect(inDb(4).status).toBe("withdrawn");
    expect(statusOf(4)).toBe("Withdrawn");
    expect([tick(4).checked, tick(4).disabled]).toEqual([true, true]);
    expect((tick(4).closest("label") as HTMLElement).title).toBe("Withdrawn stories count as read.");
    expect(tick(4).title).toBe("Withdrawn stories count as read.");
    expect(noteOf(4)).toBe("Someone else changed this story. It is now Withdrawn.");
    expect(saysNotSaved(4)).toBe(false);
  });

  it("says the same when it is the untick that somebody else got ahead of", async () => {
    await openStories();
    inDb(3).status = "used";
    await press(tick(3));
    expect(inDb(3).status).toBe("used");
    expect(statusOf(3)).toBe("Used");
    expect([tick(3).checked, tick(3).disabled]).toEqual([true, true]);
    expect(noteOf(3)).toBe("Someone else changed this story. It is now Used.");
  });

  it("says nothing when somebody else had already made it what was asked for", async () => {
    await openStories();
    inDb(4).status = "reviewed";
    await press(tick(4));
    expect(statusOf(4)).toBe("Reviewed");
    expect([tick(4).checked, tick(4).disabled]).toEqual([true, false]);
    expect(noteOf(4)).toBe("");
  });

  it("moves the keyboard to the row's View when the tick it was on becomes locked, without moving the page", async () => {
    await openStories();
    inDb(4).status = "withdrawn";
    tick(4).focus();
    const focus = vi.spyOn(viewOf(4), "focus");
    await press(tick(4));
    expect(tick(4).disabled).toBe(true);
    expect(document.activeElement).toBe(viewOf(4));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("says a story is no longer here when it has been erased, and locks its tick", async () => {
    patchAnswer = 404;
    await openStories();
    await press(tick(4));
    expect([tick(4).checked, tick(4).disabled]).toEqual([false, true]);
    expect(statusOf(4)).toBe("New");
    expect(noteOf(4)).toBe("This story is no longer here.");
    expect(tick(4).title).toBe("This story is no longer here.");
    expect(saysNotSaved(4)).toBe(false);
  });

  it("says so when this person may no longer change stories, and locks the tick", async () => {
    patchAnswer = 403;
    await openStories();
    await press(tick(3));
    expect([tick(3).checked, tick(3).disabled]).toEqual([true, true]);
    expect(noteOf(3)).toBe("You can no longer change stories.");
  });

  it("goes back to signing in, with nothing said in the row, when the session has ended", async () => {
    patchAnswer = 401;
    await openStories();
    await press(tick(4));
    expect(el("loginView").hidden).toBe(false);
    expect(el("appView").hidden).toBe(true);
    // A session that has ended is not a save that failed: the sign in screen says what is needed.
    expect(saysNotSaved(4)).toBe(false);
    expect(noteOf(4)).toBe("");
  });

  it("lands its answer on the row that is on screen when the list was drawn again in the meantime", async () => {
    await openStories();
    holdPatches();
    const old = tick(4);
    old.click();
    await settle();
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await settle();
    expect(tick(4)).not.toBe(old);
    expect(tick(4).checked).toBe(false);
    openGate();
    await settle();
    expect(tick(4).checked).toBe(true);
    expect(statusOf(4)).toBe("Reviewed");
    expect(tick(4).hasAttribute("aria-busy")).toBe(false);
  });

  // A save that failed knows nothing about what the story is now. It must not paint what the old
  // row showed over a row the list has only just loaded.
  it("leaves a row drawn again since as the list loaded it when the save then fails", async () => {
    await openStories();
    holdPatches();
    tick(4).click();
    await settle();
    inDb(4).status = "used";
    (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
    await settle();
    patchAnswer = 500;
    openGate();
    await settle();
    expect(statusOf(4)).toBe("Used");
    expect([tick(4).checked, tick(4).disabled]).toEqual([true, true]);
    // Nor is it told "Not saved": that press was on a list that is no longer on screen, and this
    // row already shows what the story is.
    expect(saysNotSaved(4)).toBe(false);
    expect(noteOf(4)).toBe("");
  });

  it("is locked for someone who can only view Stories, says why, and a press sends nothing", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await openStories();
    expect([tick(4).disabled, tick(3).disabled]).toEqual([true, true]);
    expect((tick(4).closest("label") as HTMLElement).title).toBe("You can view stories but not change them.");
    expect(tick(4).title).toBe("You can view stories but not change them.");
    await press(tick(4));
    await press(tick(3));
    expect([tick(4).checked, tick(3).checked]).toEqual([false, true]);
    expect(patches()).toEqual([]);
  });
});

describe("an open story", () => {
  async function view(id: number) {
    viewOf(id).click();
    await settle();
  }
  async function open(id: number) {
    await openStories();
    await view(id);
  }
  const statusLine = () => el("storyStatusNow").textContent;
  const readNote = () => el("storyReadNote").textContent;

  it("has Mark as read under the story's words while it is New, and it makes the story Reviewed", async () => {
    await open(4);
    const btn = el("storyReadBtn");
    expect(btn.textContent).toBe("Mark as read");
    expect(el("storyUnreadBtn")).toBeNull();
    // Under the words: it comes after the story's text in the page.
    const words = document.querySelector("#storyDetail .admin-story-text") as HTMLElement;
    expect(words.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    btn.click();
    await settle();
    expect(patches()).toEqual([
      { method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"reviewed","ifStatus":"new"}' },
    ]);
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyDetail").textContent).toContain("Marked as read.");
    expect(el("storyUnreadBtn").textContent).toBe("Mark as new");
    expect(statusLine()).toBe("Reviewed");
  });

  it("has Mark as new while it is Reviewed, and it makes the story New again", async () => {
    await open(3);
    expect(el("storyReadBtn")).toBeNull();
    expect(statusLine()).toBe("Reviewed");
    el("storyUnreadBtn").click();
    await settle();
    expect(patches()).toEqual([
      { method: "PATCH", path: "/api/admin/stories/3", body: '{"status":"new","ifStatus":"reviewed"}' },
    ]);
    expect(el("storyReadBtn").textContent).toBe("Mark as read");
    expect(statusLine()).toBe("New");
  });

  it("can be marked as read and as new again, each time from what the story now is", async () => {
    await open(4);
    el("storyReadBtn").click();
    await settle();
    el("storyUnreadBtn").click();
    await settle();
    expect(patches().map((p) => p.body)).toEqual([
      '{"status":"reviewed","ifStatus":"new"}',
      '{"status":"new","ifStatus":"reviewed"}',
    ]);
    expect(inDb(4).status).toBe("new");
  });

  it("keeps the keyboard on the button that took its place", async () => {
    await open(4);
    el("storyReadBtn").focus();
    el("storyReadBtn").click();
    await settle();
    expect(document.activeElement).toBe(el("storyUnreadBtn"));
    el("storyUnreadBtn").click();
    await settle();
    expect(document.activeElement).toBe(el("storyReadBtn"));
  });

  // Someone who pressed the button and then scrolled down to the form must not be pulled back up
  // when the answer arrives.
  it("moves the keyboard without moving the page", async () => {
    await open(4);
    el("storyReadBtn").focus(); // as a real press leaves it
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    el("storyReadBtn").click();
    await settle();
    expect(document.activeElement).toBe(el("storyUnreadBtn"));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  // The whole story used to be drawn again, which threw away anything typed in Tags or Notes and
  // not yet saved. Only what the status changes is drawn again now, so the form is never touched.
  it("keeps what was typed in Tags and Notes and not yet saved", async () => {
    await open(4);
    const tags = el("edit-storyTags") as HTMLInputElement;
    const notes = el("edit-storyNotes") as HTMLTextAreaElement;
    tags.value = "christmas, thank you";
    notes.value = "Ring back about the photo.";
    el("storyReadBtn").click();
    await settle();
    expect(el("edit-storyTags")).toBe(tags);
    expect(el("edit-storyNotes")).toBe(notes);
    expect(tags.value).toBe("christmas, thank you");
    expect(notes.value).toBe("Ring back about the photo.");
  });

  it("leaves the keyboard where it is when the person has moved on to the notes", async () => {
    await open(4);
    holdPatches();
    el("storyReadBtn").click();
    await settle();
    el("edit-storyNotes").focus();
    openGate();
    await settle();
    expect(el("storyUnreadBtn")).not.toBeNull();
    expect(document.activeElement).toBe(el("edit-storyNotes"));
  });

  // Save changes sends the form's Status with the tags and notes. Left showing New, it would
  // quietly make the story New again the next time a note was saved.
  it("moves the form's Status along with it, so Save changes does not put the story back", async () => {
    await open(4);
    const pick = el("edit-storyStatus") as HTMLSelectElement;
    expect(pick.value).toBe("new");
    el("storyReadBtn").click();
    await settle();
    expect(pick.value).toBe("reviewed");
    el("storyEditForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(JSON.parse(patches()[1].body || "{}").status).toBe("reviewed");
  });

  it("leaves a Status the person had picked in the form and not yet saved", async () => {
    await open(4);
    const pick = el("edit-storyStatus") as HTMLSelectElement;
    pick.value = "used";
    el("storyReadBtn").click();
    await settle();
    expect(pick.value).toBe("used");
    expect(statusLine()).toBe("Reviewed");
  });

  it("says so right under the button when it could not be saved, and keeps the button", async () => {
    await open(4);
    patchAnswer = 500;
    el("storyReadBtn").click();
    await settle();
    expect(readNote()).toBe("Could not save. Please try again.");
    expect(el("storyReadBtn")).not.toBeNull();
    expect(statusLine()).toBe("New");
    // Right under the button, not at the foot of the page past the whole form.
    const bar = document.querySelector("#storyDetail .admin-read-bar") as HTMLElement;
    expect(bar.nextElementSibling).toBe(el("storyReadNote"));
    expect(el("storyActionStatus").textContent).toBe("");
    patchAnswer = "ok";
    el("storyReadBtn").click();
    await settle();
    expect(readNote()).toBe("");
    expect(statusLine()).toBe("Reviewed");
  });

  it("says the same when the request never arrives, and keeps the button for another try", async () => {
    await open(4);
    patchAnswer = "down";
    el("storyReadBtn").click();
    await settle();
    expect(readNote()).toBe("Could not save. Please try again.");
    expect(el("storyReadBtn")).not.toBeNull();
    expect(statusLine()).toBe("New");
  });

  // Pressing again could only say the same thing, so the button goes, as the list's tick locks.
  it.each([
    [404, "This story is no longer here."],
    [403, "You can no longer change stories."],
  ])("says so and takes the button away when the answer is %s", async (answer, said) => {
    await open(4);
    patchAnswer = answer;
    el("storyReadBtn").focus();
    el("storyReadBtn").click();
    await settle();
    expect(readNote()).toBe(said);
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
    expect(statusLine()).toBe("New");
    expect(document.activeElement).toBe(el("storyReadNote"));
  });

  it("does not undo a status somebody else set while the story was open: it shows what the story is now", async () => {
    await open(4);
    inDb(4).status = "withdrawn";
    el("storyReadBtn").focus();
    el("storyReadBtn").click();
    await settle();
    expect(inDb(4).status).toBe("withdrawn");
    expect(statusLine()).toBe("Withdrawn");
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
    expect(readNote()).toBe("Someone else changed this story. It is now Withdrawn.");
    // The button that was pressed is gone, so the keyboard goes to the words that say why.
    expect(document.activeElement).toBe(el("storyReadNote"));
    expect((el("edit-storyStatus") as HTMLSelectElement).value).toBe("withdrawn");
  });

  it("says nothing when somebody else had already marked it as read", async () => {
    await open(4);
    inDb(4).status = "reviewed";
    el("storyReadBtn").click();
    await settle();
    expect(statusLine()).toBe("Reviewed");
    expect(el("storyUnreadBtn")).not.toBeNull();
    expect(readNote()).toBe("");
  });

  it("sends one request for a double press", async () => {
    await open(4);
    holdPatches();
    const btn = el("storyReadBtn");
    btn.click();
    btn.click();
    await settle();
    expect(patches()).toHaveLength(1);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    openGate();
    await settle();
    expect(patches()).toHaveLength(1);
    expect(statusLine()).toBe("Reviewed");
  });

  it("ignores an answer that arrives after a different story was opened", async () => {
    await open(4);
    holdPatches();
    el("storyReadBtn").click();
    await settle();
    el("storyBack").click();
    await settle();
    await view(2);
    expect(statusLine()).toBe("Used");
    openGate();
    await settle();
    expect(statusLine()).toBe("Used");
    expect(el("storyUnreadBtn")).toBeNull();
    expect(el("storyDetail").textContent).not.toContain("Marked as read.");
    expect(inDb(4).status).toBe("reviewed");
  });

  it.each([2, 1])("has neither button for a Used or Withdrawn story (story %i)", async (id) => {
    await open(id);
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
  });

  it("has neither button for someone who can only view Stories", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await open(4);
    expect(el("storyDetail").textContent).toContain("A bag of presents arrived on Christmas Eve.");
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
    expect(statusLine()).toBe("New");
  });

  // One loud button a screen: Save changes is the form's. These are the admin's own small button
  // and its text link, so the undo is the quietest thing in the bar.
  it("uses the admin's small button to mark as read, and a plain link to undo it", async () => {
    await open(4);
    expect(el("storyReadBtn").className).toBe("admin-btn");
    el("storyReadBtn").click();
    await settle();
    expect(el("storyUnreadBtn").className).toBe("admin-link");
  });
});

describe("its styles", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(selector + "{");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  // In rem, not px: the heading's word grows with someone's larger text, and so must its column.
  it("gives the Read column a fixed, narrow width, so the other columns keep their room", () => {
    expect(rule(".stories-table th:first-child,.stories-table td:first-child")).toMatch(/[;{]width:\s*[\d.]+rem/);
  });

  it("makes the tick a target a finger can hit, 44px each way", () => {
    expect(rule(".admin-read-tick")).toMatch(/[;{]width:\s*44px/);
    expect(rule(".admin-read-tick")).toMatch(/min-height:\s*44px/);
  });

  // .admin-body input[type="checkbox"] resets every tick box's width to the browser's own (13px),
  // and outranks a plain class. Measured in Chrome: 13px until the rule named the same things.
  it("sizes the box with a rule that outranks the admin's tick box reset", () => {
    const box = rule('.admin-body .admin-read-tick input[type="checkbox"]');
    expect(box).toMatch(/width:\s*20px/);
    expect(box).toMatch(/height:\s*20px/);
  });

  it("shows where the keyboard is on the tick", () => {
    expect(rule(".admin-read-tick input:focus-visible")).toContain("outline:");
  });

  it("does not offer a hand over a tick that is locked", () => {
    expect(rule(".admin-read-tick.is-locked")).toMatch(/cursor:\s*default/);
  });

  // aria-busy alone shows nothing. On a slow connection the box dims and the pointer says wait,
  // which is also why a second press seems to do nothing. After a pause, so a save that answers
  // at once never flickers.
  it("shows that a save is on its way, on the tick and on the open story's button, only once it has taken a moment", () => {
    const box = rule('.admin-body .admin-read-tick input[type="checkbox"][aria-busy="true"]');
    expect(box).toMatch(/opacity:\s*\.\d+/);
    expect(box).toMatch(/cursor:\s*progress/);
    expect(box).toMatch(/transition:\s*opacity [\d.]+s linear \.[3-9]\d*s/);
    const btn = rule('.admin-read-bar [aria-busy="true"]');
    expect(btn).toMatch(/opacity:\s*\.\d+/);
    expect(btn).toMatch(/cursor:\s*progress/);
  });

  // An author's display on a class beats the browser's own rule for [hidden], so a pill would
  // stay on show. The two pills in a row's status take turns; both showing would add a line.
  it("hides a pill that is marked hidden, and keeps Not saved to one line", () => {
    expect(rule(".admin-pill[hidden]")).toMatch(/display:\s*none/);
    const unsaved = rule(".admin-read-unsaved");
    expect(unsaved).toMatch(/white-space:\s*nowrap/);
    // Maroon on the failed pills' tint: 7.8 to 1. The crimson those pills use is 4.2 to 1.
    expect(unsaved).toMatch(/color:\s*var\(--maroon\)/);
    // Except on a phone, where the column is narrower than the pill and one line would run over
    // the next column's words.
    expect(css).toMatch(/@media \(max-width:700px\)\{\.admin-read-unsaved\{white-space:normal\}\}/);
  });

  // Measured in Chrome: a line above the list pushed every row down 35px the moment a save failed,
  // so a second press landed on the tick of the story above. The note sits in the story's own row
  // now, under its status: cells are top aligned, so the tick that was pressed does not move, and
  // an empty note takes no room at all.
  it("says what somebody else changed in the story's own row, in a note that takes no room while empty", () => {
    expect(css).not.toContain("#storiesListStatus");
    expect(html).not.toContain("storiesListStatus");
    const note = rule(".admin-read-note");
    expect(note).toMatch(/display:\s*block/);
    expect(note).toMatch(/[;{]margin:\s*0/);
    expect(note).toMatch(/color:\s*var\(--crimson\)/);
    expect(rule(".admin-read-note:not(:empty)")).toMatch(/margin-top:/);
  });

  // An open story's own status line (.admin-action-status) is body sized and bold. What could not
  // be saved matters more than "Saved.", so it is not said smaller than that.
  it("says it at the open story's own size there, and keeps its distance from the words when there is no button", () => {
    const note = rule("#storyReadBar .admin-read-note");
    expect(note).toMatch(/font-size:\s*inherit/);
    expect(note).toMatch(/font-weight:\s*600/);
    expect(rule("#storyReadBar .admin-read-note:first-child:not(:empty)")).toMatch(/margin-top:\s*16px/);
  });

  it("lets the open story's bar wrap on a narrow screen, with 44px targets", () => {
    expect(rule(".admin-read-bar")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".admin-read-bar .admin-btn,.admin-read-bar .admin-link")).toMatch(/min-height:\s*44px/);
  });
});
