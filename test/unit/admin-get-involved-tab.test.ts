// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Admin > Get involved: the old Events and Fundraising tabs as one tab with five sections (Sign ups,
// Our events, Tickets and pledges, Emails, Settings). A move, not a rewrite: every card keeps its
// ids and its code, so these tests are about where things are, who sees which section, that every
// old way in still lands in the right place, and that a section only fetches when it is shown.
// The whole admin page in jsdom, with a fake fetch for the API. Every name and amount is invented.

// Each test loads the whole admin page afresh in jsdom, which is slow under a full parallel run.
vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const html = read("admin.html");
const appSrc = read("assets/js/admin/app.js");
const cardSrcs = ["event-tickets.js", "pledges.js", "all-emails.js"].map((f) => read("assets/js/admin/" + f));
const css = read("assets/css/admin.css");
const siteCss = read("assets/css/styles.css");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "page-" + id, path: "raising", kind: "santa_dash", kindLabel: "A Santa dash", title: "Page " + id,
    description: "Invented.", eventDate: "2026-12-05", startTime: "10:30", venue: "The Bandstand", town: "Testtown",
    targetPence: 25000, public: true, status: "approved", name: "Robin Example", email: "robin@example.com",
    phone: "", socialLink: null, socialOk: false, wants: {}, postAddress: "", newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-09-20T10:00:00.000Z", approvedAt: null, approvedBy: null,
    updatedAt: "2026-09-20T10:00:00.000Z", updatedBy: null, pageUrl: null,
    meter: { raisedPence: 0, targetPence: 25000, percent: 0 }, editWaiting: false,
    ...over,
  };
}
// One of each kind, a team member, and someone who has left their team.
const ONE_OF_EACH = () => [
  fundraiser(1, { title: "Santa dash round the park", status: "new" }),
  fundraiser(2, { title: "The Example Striders", isTeam: true }),
  fundraiser(3, { title: "Sam runs with the Striders", teamId: 2, status: "new" }),
  fundraiser(4, { title: "Quiz night at the hall", path: "event" }),
  fundraiser(5, { title: "In memory of Alex Example", inMemory: true, memoryName: "Alex Example" }),
  fundraiser(6, { title: "Jo, once of the Striders", teamId: 2, teamLeftAt: "2026-09-25T10:00:00.000Z" }),
];

let records: Rec[] = [];
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let calls: { method: string; path: string; body: unknown }[] = [];
let whatsNewAreas: unknown[] = [];
let overview: unknown = { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], numbers: [], comingUp: [], failed: [] };
let eventsPageOn = false;
let confirmed: string[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: whatsNewAreas });
  if (path === "/api/admin/whats-new/seen") return j({ area: body.area, seenAt: "2026-10-06T08:00:00.000Z" });
  if (path === "/api/admin/overview") return j(overview);
  if (path === "/api/admin/events/settings") {
    eventsPageOn = body.pageOn;
    return j({ pageOn: eventsPageOn, updatedAt: "2026-10-02T09:00:00.000Z", updatedBy: "admin:fern@example.com" });
  }
  if (path === "/api/admin/events/preview") return j({ card: "<p>card</p>", page: "<p>page</p>", problems: [], onPage: true });
  if (path === "/api/admin/events") return j({ pageOn: eventsPageOn, updatedAt: null, updatedBy: null, today: "2026-10-04", events: [] });
  if (path === "/api/admin/ball-report") {
    return j({
      reportOn: true, recipients: [{ name: "Pat Example", email: "pat@example.com" }], nextSend: null,
      lastFailure: null, lastScheduled: null, lastTest: null, preview: null,
    });
  }
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers") return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f })) });
  if (path === "/api/admin/fundraising/emails/summary") return j({ total: 3, waiting: 0 });
  if (path === "/api/admin/fundraising/emails") return j({ groups: [], approvalsUnavailable: false });
  if (path === "/api/admin/fundraising/pledges") return j({ pledges: [], fundraisers: [], totals: {} });
  if (path === "/api/admin/event-tickets") return j({ events: [] });
  const one = path.match(/^\/api\/admin\/fundraisers\/(\d+)$/);
  if (one) return j({ fundraiser: records.find((r) => r.id === Number(one[1])), meter: {}, edits: [], cash: [], wall: [] });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const navLink = () => q('.admin-nav-link[data-view="get-involved"]') as HTMLElement;
const SECTIONS = ["signups", "events", "tickets", "emails", "settings"] as const;
type Section = (typeof SECTIONS)[number];
const sectionBtn = (s: Section) => q(`#giSections [data-gi-section="${s}"]`) as HTMLElement;
const parts = (s: Section) => qa(`#view-get-involved [data-gi-part="${s}"]`);
// A part shows when neither it nor anything round it is hidden.
const showing = (node: Element | null) => {
  for (let n: Element | null = node; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false;
  return !!node;
};
const shownSections = () => SECTIONS.filter((s) => parts(s).some(showing));
const offered = () => qa("#giSections [data-gi-section]").filter((b) => !b.hidden).map((b) => b.getAttribute("data-gi-section"));
const pressed = () => qa('#giSections [data-gi-section][aria-pressed="true"]').map((b) => b.getAttribute("data-gi-section"));
const got = (path: string) => calls.filter((c) => c.method === "GET" && c.path === path).length;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
async function openTab() {
  await signIn();
  navLink().click();
  await settle();
}
async function go(s: Section) {
  sectionBtn(s).click();
  await settle();
}
function only(sections: Partial<Record<"events" | "fundraising", "view" | "edit">>, as: "admin" | "editor" | "viewer" = "editor") {
  role = as;
  const none = Object.fromEntries(Object.keys(effectivePermissions({ role: "admin", permissions: null })).map((k) => [k, "none"]));
  perms = { ...none, overview: "view", ...sections } as PermissionMap;
}
// Starts the page: the admin's own script, then the three card scripts, as admin.html loads them.
function boot(withCards = true) {
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
  // eslint-disable-next-line no-eval
  if (withCards) cardSrcs.forEach((src) => (0, eval)(src));
}

const realScrollIntoView = Element.prototype.scrollIntoView;
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeEach(() => {
  // jsdom does no layout, so nothing has an offsetParent, and the admin takes that to mean a menu
  // entry is not on screen. Here an entry is on screen unless it is hidden.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hidden ? null : document.body;
    },
  });
  records = ONE_OF_EACH();
  perms = effectivePermissions({ role: "admin", permissions: null });
  role = "admin";
  calls = [];
  whatsNewAreas = [];
  overview = { updatedAt: "2026-10-03T08:41:00.000Z", needs: [], numbers: [], comingUp: [], failed: [] };
  eventsPageOn = false;
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return true;
  };
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  Element.prototype.scrollIntoView = function () {} as Element["scrollIntoView"];
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
});
afterEach(() => {
  if (realOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", realOffsetParent);
  if (realScrollIntoView) Element.prototype.scrollIntoView = realScrollIntoView;
  else delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("the menu: one Get involved entry", () => {
  beforeEach(() => boot(false));

  it("has Get involved where Events and Fundraising were, and the Festive Ball as it was", () => {
    const labels = qa(".admin-nav-link").map((b) => text(b));
    expect(labels.filter((l) => l === "Get involved")).toHaveLength(1);
    expect(labels).not.toContain("Events");
    expect(labels).not.toContain("Fundraising");
    expect(q('.admin-nav-link[data-view="events"]')).toBeNull();
    expect(q('.admin-nav-link[data-view="fundraising"]')).toBeNull();
    const at = labels.indexOf("Get involved");
    expect(labels[at - 1]).toBe("Partners");
    expect(labels[at + 1]).toBe("Festive Ball");
    expect(q('.admin-nav-link[data-view="ball"]')).not.toBeNull();
    expect(el("view-ball")).not.toBeNull();
  });

  it("opens the tab under the heading Get involved", async () => {
    await openTab();
    expect(el("view-get-involved").hidden).toBe(false);
    expect(text(q("#view-get-involved h2"))).toBe("Get involved");
    expect(navLink().classList.contains("is-active")).toBe(true);
    expect(el("view-overview").hidden).toBe(true);
  });
});

describe("the five sections", () => {
  beforeEach(() => boot(false));

  it("offers them in order, as real buttons in the admin's segmented look", () => {
    const row = el("giSections");
    expect(row.classList.contains("admin-segmented")).toBe(true);
    expect(row.getAttribute("role")).toBe("group");
    expect(row.getAttribute("aria-label")).toBeTruthy();
    const buttons = qa("#giSections [data-gi-section]");
    expect(buttons.map((b) => text(b))).toEqual(["Sign ups", "Our events", "Tickets and pledges", "Emails", "Settings"]);
    expect(buttons.map((b) => b.getAttribute("data-gi-section"))).toEqual([...SECTIONS]);
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.classList.contains("admin-seg")).toBe(true);
    }
  });

  it("opens on Sign ups, and shows one section at a time", async () => {
    await openTab();
    expect(shownSections()).toEqual(["signups"]);
    expect(pressed()).toEqual(["signups"]);
    for (const s of SECTIONS) {
      await go(s);
      expect(shownSections(), s).toEqual([s]);
      expect(pressed(), s).toEqual([s]);
      expect(sectionBtn(s).classList.contains("is-active")).toBe(true);
    }
  });

  it("has every card in its section, with its own id", () => {
    const inPart = (id: string) => el(id).closest("[data-gi-part]")?.getAttribute("data-gi-part");
    const want: Record<Section, string[]> = {
      signups: ["frKindFilter", "frFilter", "frList"],
      events: ["evReport", "evList", "evAdd", "evEditor", "evPagePreviewBox"],
      tickets: ["etAdmin", "frPledges"],
      emails: ["frInvite", "frTouch", "frAllEmails"],
      settings: ["evSwitch", "evSwitchStatus", "frSwitch", "frSwitchStatus", "frCats", "frImpact", "frSummary"],
    };
    for (const s of SECTIONS) for (const id of want[s]) expect(inPart(id), id).toBe(s);
    // Each card once, and the order they are read in.
    const order = (s: Section) => qa(`[data-gi-part="${s}"] > [id]`).map((n) => n.id);
    expect(order("tickets")).toEqual(["etAdmin", "frPledges"]);
    expect(order("emails")).toEqual(["frInvite", "frTouch", "frAllEmails"]);
    expect(order("settings").filter((id) => !/Status$/.test(id))).toEqual(["evSwitch", "frSwitch", "frCats", "frImpact", "frSummary"]);
    for (const id of Object.values(want).flat()) expect(qa(`[id="${id}"]`), id).toHaveLength(1);
  });

  it("keeps the old tabs' boxes, so their styles and scripts still find them", () => {
    // Everything of NBCC's own events sits in #view-events, and everything of fundraising in
    // #view-fundraising, inside the one tab: assets/css/admin.css and the card scripts look there.
    for (const id of ["evSwitch", "evReport", "evList", "evEditor", "evPagePreviewBox"]) {
      expect(el(id).closest("#view-events"), id).not.toBeNull();
    }
    for (const id of ["frSwitch", "frInvite", "frSummary", "frCats", "frImpact", "frTouch", "etAdmin", "frPledges", "frAllEmails", "frFilter", "frList"]) {
      expect(el(id).closest("#view-fundraising"), id).not.toBeNull();
    }
    expect(el("view-events").closest("#view-get-involved")).not.toBeNull();
    expect(el("view-fundraising").closest("#view-get-involved")).not.toBeNull();
    // One screen, not three: only the tab itself is a view the menu switches between.
    expect(el("view-events").classList.contains("admin-view")).toBe(false);
    expect(el("view-fundraising").classList.contains("admin-view")).toBe(false);
  });

  it("starts each section with one short line saying what it is for", async () => {
    await openTab();
    for (const s of SECTIONS) {
      await go(s);
      const lines = qa("#view-get-involved [data-gi-intro]").filter(showing);
      expect(lines.map((l) => l.getAttribute("data-gi-intro")), s).toEqual([s]);
      expect(text(lines[0]).length, s).toBeGreaterThan(20);
      expect(text(lines[0]), s).not.toMatch(/—|–/);
    }
  });

  it("moves between the sections with the arrow keys, Home and End", async () => {
    await openTab();
    const press = async (key: string) => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await settle();
    };
    sectionBtn("signups").focus();
    await press("ArrowRight");
    expect(document.activeElement).toBe(sectionBtn("events"));
    expect(shownSections()).toEqual(["events"]);
    await press("ArrowLeft");
    expect(document.activeElement).toBe(sectionBtn("signups"));
    await press("ArrowLeft"); // round to the end
    expect(document.activeElement).toBe(sectionBtn("settings"));
    expect(shownSections()).toEqual(["settings"]);
    await press("Home");
    expect(shownSections()).toEqual(["signups"]);
    await press("End");
    expect(shownSections()).toEqual(["settings"]);
  });

  // One status line serves the page switch and the events under it ("Deleted." is said on it).
  // The two are in different sections now, so it goes with whichever is on screen.
  it("keeps the events' status line on screen: above the list in Our events, under the switch in Settings", async () => {
    await openTab();
    await go("events");
    const line = el("evSwitchStatus");
    expect(line.closest("[data-gi-part]")?.getAttribute("data-gi-part")).toBe("events");
    expect(showing(line)).toBe(true);
    expect(line.compareDocumentPosition(el("evList")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    line.textContent = "Deleted.";
    line.className = "ty-status is-ok";
    await go("settings");
    // What it said about an event is not left under the page switch.
    expect(line.textContent).toBe("");
    expect(line.className).toBe("ty-status");
    expect(el("evSwitchStatus")).toBe(line);
    expect(line.closest("[data-gi-part]")?.getAttribute("data-gi-part")).toBe("settings");
    expect(showing(line)).toBe(true);
    expect(el("evSwitch").compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.getAttribute("role")).toBe("status");
  });

  it("comes back to the section you were on after a refresh", async () => {
    await openTab();
    await go("tickets");
    // A refresh: the page and its script start again, the browser tab's storage stays.
    document.body.innerHTML = bodyHtml;
    boot(false);
    await settle();
    expect(el("view-get-involved").hidden).toBe(false);
    expect(shownSections()).toEqual(["tickets"]);
  });

  it("wraps the section buttons on a phone, with a visible focus ring and nothing scrolling sideways", () => {
    const flat = css.replace(/\s+/g, " ");
    const rule = (sel: string) => {
      const at = flat.indexOf(sel + " {") >= 0 ? flat.indexOf(sel + " {") : flat.indexOf(sel + "{");
      expect(at, sel).toBeGreaterThanOrEqual(0);
      return flat.slice(at, flat.indexOf("}", at)).replace(/\s/g, "");
    };
    expect(rule("#giSections")).toContain("flex-wrap:wrap");
    expect(rule("#giSections")).not.toContain("overflow");
    expect(rule("#giSections .admin-seg:focus-visible")).toContain("outline:3pxsolid");
    // No scrollbar inside any part of the tab.
    const mine = flat.split("}").filter((r) => /#view-get-involved|#giSections|\.fr-kind|#frKindFilter/.test(r));
    expect(mine.length).toBeGreaterThan(3);
    for (const r of mine) expect(r).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });
});

describe("Sign ups: a large pill for each kind", () => {
  beforeEach(() => boot(false));
  const pill = (id: number) => q(`#frList tr[data-frtoggle="${id}"] .fr-kind`);

  it("says what kind each sign up is, in words", async () => {
    await openTab();
    expect(text(pill(1))).toBe("Raising money");
    expect(text(pill(2))).toBe("A team");
    expect(text(pill(4))).toBe("Hosting an event");
    expect(text(pill(5))).toBe("In memory");
    expect(qa("#frList .fr-kind")).toHaveLength(6);
  });

  it("shows A team on a team member's own page too, until they leave the team", async () => {
    await openTab();
    expect(text(pill(3))).toBe("A team");
    expect(text(pill(6))).toBe("Raising money");
  });

  it("gives each kind its own colour class", async () => {
    await openTab();
    expect(pill(1)!.getAttribute("data-kind")).toBe("raising");
    expect(pill(2)!.getAttribute("data-kind")).toBe("team");
    expect(pill(3)!.getAttribute("data-kind")).toBe("team");
    expect(pill(4)!.getAttribute("data-kind")).toBe("event");
    expect(pill(5)!.getAttribute("data-kind")).toBe("memory");
    for (const k of ["raising", "team", "event", "memory"]) expect(css).toContain(`.fr-kind[data-kind="${k}"]`);
  });

  // The large pill says the kind, so nothing smaller on the row says it again or contradicts it.
  it("does not say the kind twice: no small Team or In memory pill, and no kind in the line under the title", async () => {
    await openTab();
    expect(qa("#frList .fr-team-pill, #frList .fr-memory-pill")).toEqual([]);
    const sub = (id: number) => text(q(`#frList tr[data-frtoggle="${id}"] .fr-sub`));
    expect(sub(1)).toBe("Robin Example · 05/12/2026");
    for (const id of [2, 3, 4, 5]) {
      expect(sub(id), String(id)).not.toMatch(/Raising money|Holding an event|Hosting an event/);
      expect(sub(id), String(id)).toContain("Robin Example");
    }
    expect(text(el("frList"))).not.toContain("Holding an event");
  });

  it("still says which team a member is on", async () => {
    await openTab();
    expect(text(q('#frList tr[data-frtoggle="3"] .fr-joining-pill'))).toMatch(/^Joining /);
  });

  it("keeps the pill on the row while its sign up is open", async () => {
    await openTab();
    (q('#frList tr[data-frtoggle="5"]') as HTMLElement).click();
    await settle();
    expect(text(pill(5))).toBe("In memory");
    expect(q("#frList [data-frdetail]")).not.toBeNull();
  });

  // The colours come from the site's own tokens; each pill's words must be readable on it.
  it("meets WCAG AA contrast for every pill, from the site's own colours", () => {
    const token = (name: string) => {
      const m = siteCss.match(new RegExp("--" + name + ":\\s*(#[0-9A-Fa-f]{6})"));
      expect(m, name).not.toBeNull();
      return m![1];
    };
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const mix = (a: string, pct: number, b: string) => rgb(a).map((v, i) => Math.round(v * pct + rgb(b)[i] * (1 - pct)));
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg: number[], bg: number[]) => {
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const flat = css.replace(/\s+/g, " ");
    const decl = (kind: string) => {
      const sel = `.fr-kind[data-kind="${kind}"]`;
      const at = flat.indexOf(sel);
      return flat.slice(at, flat.indexOf("}", at));
    };
    const colour = (value: string) => {
      const v = value.trim();
      const one = v.match(/^var\(--([a-z-]+)\)$/);
      if (one) return rgb(token(one[1]));
      const m = v.match(/^color-mix\(in srgb, ?var\(--([a-z-]+)\) (\d+)%, ?var\(--([a-z-]+)\)\)$/);
      expect(m, v).not.toBeNull();
      return mix(token(m![1]), Number(m![2]) / 100, token(m![3]));
    };
    const ratios: Record<string, number> = {};
    for (const kind of ["raising", "team", "event", "memory"]) {
      const d = decl(kind);
      const bg = d.match(/background:\s*([^;]+);/);
      const fg = d.match(/(?:^|[;{ ])color:\s*([^;]+);/);
      expect(bg && fg, kind).toBeTruthy();
      ratios[kind] = ratio(colour(fg![1]), colour(bg![1]));
      expect(ratios[kind], kind).toBeGreaterThanOrEqual(4.5);
    }
    // In memory is the quietest: the least contrast of the four, though still past AA.
    expect(ratios.memory).toBeLessThan(Math.min(ratios.raising, ratios.team, ratios.event));
  });
});

describe("Sign ups: the kind filter", () => {
  beforeEach(() => boot(false));
  const kind = (k: string) => q(`#frKindFilter [data-frkind="${k}"]`) as HTMLElement;
  const titles = () => qa("#frList tr[data-frtoggle] .fr-title").map((t) => text(t));
  const count = (k: string) => text(q(`[data-frkindcount="${k}"]`));

  it("has All and the four kinds above the list, in the pills' own words, each with its count", async () => {
    await openTab();
    expect(qa("#frKindFilter [data-frkind]").map((b) => text(b))).toEqual([
      "All (6)", "Raising money (2)", "A team (2)", "Hosting an event (1)", "In memory (1)",
    ]);
    expect([count("all"), count("raising"), count("team"), count("event"), count("memory")]).toEqual(["6", "2", "2", "1", "1"]);
    const box = el("frKindFilter");
    expect(box.getAttribute("role")).toBe("group");
    expect(box.getAttribute("aria-label")).toBeTruthy();
    // Above the list, in the same part.
    expect(box.compareDocumentPosition(el("frList")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists only that kind, and says which is pressed", async () => {
    await openTab();
    kind("memory").click();
    expect(titles()).toEqual(["In memory of Alex Example"]);
    expect(kind("memory").getAttribute("aria-pressed")).toBe("true");
    expect(kind("memory").classList.contains("is-active")).toBe(true);
    expect(kind("").getAttribute("aria-pressed")).toBe("false");
    kind("team").click();
    expect(titles()).toEqual(["The Example Striders", "Sam runs with the Striders"]);
    kind("event").click();
    expect(titles()).toEqual(["Quiz night at the hall"]);
    kind("raising").click();
    expect(titles()).toEqual(["Santa dash round the park", "Jo, once of the Striders"]);
    kind("").click();
    expect(titles()).toHaveLength(6);
  });

  it("works alongside the status filter, which keeps its own counts", async () => {
    await openTab();
    expect(text(q('[data-frcount="all"]'))).toBe("6");
    expect(text(q('[data-frcount="new"]'))).toBe("2");
    (q('#frFilter [data-frfilter="new"]') as HTMLElement).click();
    expect(titles()).toEqual(["Santa dash round the park", "Sam runs with the Striders"]);
    kind("team").click();
    expect(titles()).toEqual(["Sam runs with the Striders"]);
    expect((q('#frFilter [data-frfilter="new"]') as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    kind("memory").click();
    expect(titles()).toEqual([]);
    expect(text(q("#frList .fr-empty"))).toBeTruthy();
    (q('#frFilter [data-frfilter=""]') as HTMLElement).click();
    expect(titles()).toEqual(["In memory of Alex Example"]);
    // The counts are of every sign up, whichever filters are pressed.
    expect(count("team")).toBe("2");
    expect(text(q('[data-frcount="new"]'))).toBe("2");
  });

  it("is remembered for the visit only: through a refresh, not past signing out", async () => {
    await openTab();
    kind("event").click();
    document.body.innerHTML = bodyHtml;
    boot(false);
    await settle();
    expect(titles()).toEqual(["Quiz night at the hall"]);
    expect(kind("event").getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.length).toBe(0);

    el("logoutBtn").click();
    await settle();
    await openTab();
    expect(kind("").getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toHaveLength(6);
  });
});

describe("who sees which section", () => {
  beforeEach(() => boot(true));

  it("an admin sees all five, and both website switches in Settings", async () => {
    await openTab();
    expect(offered()).toEqual([...SECTIONS]);
    await go("settings");
    expect(showing(el("evSwitch"))).toBe(true);
    expect(showing(el("frSwitch"))).toBe(true);
    expect(el("evSwitchBtn").hidden).toBe(false);
    expect(el("frSwitchBtn").hidden).toBe(false);
  });

  it("someone with only Events sees Our events and the page switch, and nothing of fundraising", async () => {
    only({ events: "edit" });
    await openTab();
    expect(navLink().hidden).toBe(false);
    expect(offered()).toEqual(["events", "settings"]);
    expect(shownSections()).toEqual(["events"]);
    expect(el("view-fundraising").hidden).toBe(true);
    await go("settings");
    expect(showing(el("evSwitch"))).toBe(true);
    expect(showing(el("frSwitch"))).toBe(false);
    expect(showing(el("frCats"))).toBe(false);
    // The line over it is about what they can see: nothing about fundraising pages.
    const lines = qa("#view-get-involved [data-gi-intro]").filter(showing);
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe("Whether the Get involved page is on the website.");
    // Not an admin: they see the switch's state, as they did, and cannot flip it.
    expect(el("evSwitchBtn").hidden).toBe(true);
    expect(el("evSwitchNote").hidden).toBe(false);
    // Nothing of fundraising was asked for: the server would refuse it.
    const asked = calls.map((c) => c.path).filter((p) => /fundrais|pledge|event-tickets/.test(p));
    expect(asked).toEqual([]);
  });

  it("someone who may only look at Events cannot add or change one", async () => {
    only({ events: "view" }, "viewer");
    await openTab();
    expect(offered()).toEqual(["events", "settings"]);
    expect(el("evAdd").hidden).toBe(true);
    expect(qa("#evReport [data-reportwrite]").every((n) => n.hidden)).toBe(true);
  });

  it("someone with only Fundraising sees the fundraising sections, and not Our events", async () => {
    only({ fundraising: "edit" });
    await openTab();
    expect(navLink().hidden).toBe(false);
    expect(offered()).toEqual(["signups", "tickets", "emails", "settings"]);
    expect(shownSections()).toEqual(["signups"]);
    expect(el("view-events").hidden).toBe(true);
    for (const s of ["tickets", "emails", "settings"] as const) await go(s);
    expect(qa("#view-get-involved [data-gi-intro]").filter(showing).map((l) => text(l))).toEqual([
      "What is switched on, and the lists and examples the fundraising pages use.",
    ]);
    expect(showing(el("frSwitch"))).toBe(true);
    expect(showing(el("evSwitch"))).toBe(false);
    expect(el("frSwitchBtn").hidden).toBe(true); // the switch is an admin's
    expect(got("/api/admin/events")).toBe(0);
    expect(got("/api/admin/ball-report")).toBe(0);
  });

  it("someone who may only look at Fundraising gets no controls that change anything", async () => {
    only({ fundraising: "view" }, "viewer");
    await openTab();
    expect(offered()).toEqual(["signups", "tickets", "emails", "settings"]);
    await go("emails");
    expect(el("frInvite").hidden).toBe(true); // inviting needs edit
    await go("settings");
    expect(el("frSwitchBtn").hidden).toBe(true);
    expect(el("frSummary").hidden).toBe(true); // the weekly summary is an admin's
  });

  it("someone with neither does not see the tab", async () => {
    only({});
    await signIn();
    expect(navLink().hidden).toBe(true);
    expect(el("view-get-involved").hidden).toBe(true);
  });

  it("does not reopen on a section this person can no longer see", async () => {
    await openTab();
    await go("signups");
    el("logoutBtn").click();
    await settle();
    window.sessionStorage.setItem("nbccAdminGiSection", "signups");
    only({ events: "edit" });
    await openTab();
    expect(shownSections()).toEqual(["events"]);
  });
});

describe("every old way in still lands in the right place", () => {
  beforeEach(() => boot(true));
  const ovButtons = () => qa("#view-overview [data-ov-view]");

  it("an Overview button for fundraising opens Get involved at Sign ups", async () => {
    overview = {
      updatedAt: "2026-10-03T08:41:00.000Z", numbers: [], comingUp: [], failed: [],
      needs: [{ level: 2, text: "2 new sign ups to check", view: "fundraising", button: "Fundraising" }],
    };
    await signIn();
    const b = ovButtons()[0];
    expect(text(b)).toBe("Get involved");
    b.click();
    await settle();
    expect(el("view-get-involved").hidden).toBe(false);
    expect(shownSections()).toEqual(["signups"]);
    expect(navLink().classList.contains("is-active")).toBe(true);
  });

  it("an Overview button for fundraising shows every kind, whatever the kind filter was left on", async () => {
    overview = {
      updatedAt: "2026-10-03T08:41:00.000Z", numbers: [], comingUp: [], failed: [],
      needs: [{ level: 2, text: "2 new sign ups to check", view: "fundraising", button: "Fundraising" }],
    };
    await openTab();
    (q('#frKindFilter [data-frkind="memory"]') as HTMLElement).click();
    expect(qa("#frList tr[data-frtoggle]")).toHaveLength(1);
    (q('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    // By the menu, the filter is as it was left.
    navLink().click();
    await settle();
    expect(qa("#frList tr[data-frtoggle]")).toHaveLength(1);
    (q('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    ovButtons()[0].click();
    await settle();
    expect(qa("#frList tr[data-frtoggle]")).toHaveLength(6);
    expect((q('#frKindFilter [data-frkind=""]') as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    expect(window.sessionStorage.getItem("nbccAdminFrKind")).toBeNull();
  });

  it("an Overview button for an event, or the Ball ticket report, opens Get involved at Our events", async () => {
    overview = {
      updatedAt: "2026-10-03T08:41:00.000Z", needs: [], numbers: [], failed: [],
      comingUp: [{ day: "2026-10-05", label: "Monday 5 October", items: [{ time: "08:00", text: "The Festive Ball ticket report goes out", view: "events", button: "Events" }] }],
    };
    await signIn();
    const b = ovButtons()[0];
    expect(text(b)).toBe("Get involved");
    b.click();
    await settle();
    expect(shownSections()).toEqual(["events"]);
    expect(showing(el("evReport"))).toBe(true);
  });

  it("leaves the Overview's other buttons as the server names them", async () => {
    overview = {
      updatedAt: "2026-10-03T08:41:00.000Z", numbers: [], comingUp: [], failed: [],
      needs: [{ level: 1, text: "A claim is ready", view: "claims", button: "Claims" }, { level: 2, text: "Ball", view: "ball", button: "Festive Ball" }],
    };
    await signIn();
    expect(ovButtons().map((b) => text(b))).toEqual(["Claims", "Festive Ball"]);
    ovButtons()[1].click();
    await settle();
    expect(el("view-ball").hidden).toBe(false);
  });

  it("a browser tab last left on Events or Fundraising reopens in the right section", async () => {
    window.sessionStorage.setItem("nbccAdminView", "events");
    await signIn();
    expect(el("view-get-involved").hidden).toBe(false);
    expect(shownSections()).toEqual(["events"]);

    el("logoutBtn").click();
    await settle();
    window.sessionStorage.setItem("nbccAdminView", "fundraising");
    window.sessionStorage.removeItem("nbccAdminGiSection");
    await signIn();
    expect(el("view-get-involved").hidden).toBe(false);
    expect(shownSections()).toEqual(["signups"]);
  });

  it("an old view name is not restored for someone who cannot see that part", async () => {
    only({ events: "view" }, "viewer");
    window.sessionStorage.setItem("nbccAdminView", "fundraising");
    await signIn();
    expect(el("view-overview").hidden).toBe(false);
    expect(el("view-get-involved").hidden).toBe(true);
  });

  it("“Read and approve these in All emails” on Automatic emails opens All emails where it is", async () => {
    await openTab();
    await go("emails");
    (q('#frTouch [data-allemails-open="touch"]') as HTMLElement).click();
    await settle();
    expect(shownSections()).toEqual(["emails"]);
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
  });

  it("“Read and approve these in All emails” on Sponsor pledges moves to Emails and opens All emails", async () => {
    await openTab();
    await go("tickets");
    (q('#frPledges [data-allemails-open="pledges"]') as HTMLElement).click();
    await settle();
    expect(shownSections()).toEqual(["emails"]);
    expect(pressed()).toEqual(["emails"]);
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
    expect(got("/api/admin/fundraising/emails")).toBe(1);
  });

  it("“Approve it in All emails” under Invite someone opens All emails", async () => {
    await openTab();
    await go("emails");
    el("frInviteHeldLink").click();
    await settle();
    expect(shownSections()).toEqual(["emails"]);
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
  });

  it("an All emails link inside an open sign up (“Read its automatic emails”) moves from Sign ups to Emails", async () => {
    await openTab();
    // The link as a sign up's panel draws it: any [data-allemails-open] inside the list.
    const link = document.createElement("button");
    link.type = "button";
    link.setAttribute("data-allemails-open", "touch");
    link.setAttribute("data-allemails-fundraiser", "1");
    el("frList").appendChild(link);
    link.click();
    await settle();
    expect(shownSections()).toEqual(["emails"]);
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
  });

  it("the sign up panel still draws that link with the mark the Emails section listens for", () => {
    expect(appSrc).toMatch(/data-allemails-open="touch"[^>]*data-allemails-fundraiser=/);
  });

  it("carries the New pill of either old tab on the one menu entry, and clears it by section", async () => {
    whatsNewAreas = [
      { area: "fundraising", new: true, since: "2026-09-01T00:00:00.000Z" },
      { area: "events", new: true, since: "2026-09-01T00:00:00.000Z" },
    ];
    await signIn();
    expect(navLink().querySelector(".admin-new-pill")).not.toBeNull();
    const seen = () => calls.filter((c) => c.path === "/api/admin/whats-new/seen").map((c) => (c.body as { area: string }).area);
    navLink().click();
    await settle();
    // Sign ups is the old Fundraising tab's list: opening it is the visit that tab recorded.
    expect(seen()).toEqual(["fundraising"]);
    await go("events");
    expect(seen()).toEqual(["fundraising", "events"]);
    // Coming back to a section is not a new visit: only opening the tab afresh is, as it was.
    await go("signups");
    await go("emails");
    await go("signups");
    expect(seen()).toEqual(["fundraising", "events"]);
    // Only the two areas the server knows are ever sent.
    expect(seen().every((a) => a === "fundraising" || a === "events")).toBe(true);
  });

  it("marks a sign up that arrived since the last visit as New, as the Fundraising tab did", async () => {
    whatsNewAreas = [{ area: "fundraising", new: true, since: "2026-09-19T00:00:00.000Z" }];
    await openTab();
    expect(q('#frList tr[data-frtoggle="1"] .admin-new-pill')).not.toBeNull();
    // Looking at another section and coming back does not take the row's pill away.
    await go("emails");
    await go("signups");
    expect(q('#frList tr[data-frtoggle="1"] .admin-new-pill')).not.toBeNull();
    // Nor does following a link to All emails from the list and coming back.
    const link = document.createElement("button");
    link.setAttribute("data-allemails-open", "touch");
    el("frList").appendChild(link);
    link.click();
    await settle();
    expect(shownSections()).toEqual(["emails"]);
    await go("signups");
    expect(q('#frList tr[data-frtoggle="1"] .admin-new-pill')).not.toBeNull();
  });
});

describe("a section only fetches when it is shown", () => {
  beforeEach(() => boot(true));
  const LATER = [
    "/api/admin/events", "/api/admin/ball-report", "/api/admin/event-tickets", "/api/admin/fundraising/pledges",
    "/api/admin/fundraising/emails/summary", "/api/admin/fundraising/summary", "/api/admin/impact-examples",
  ];

  it("asks for nothing of the tab before it is opened", async () => {
    await signIn();
    const asked = calls.map((c) => c.path).filter((p) => /fundrais|pledge|event|ball-report|impact/.test(p));
    expect(asked).toEqual([]);
  });

  it("opening the tab loads Sign ups and none of the other sections", async () => {
    await openTab();
    expect(got("/api/admin/fundraisers")).toBe(1);
    for (const p of LATER) expect(got(p), p).toBe(0);
  });

  it("Our events loads the events and the Ball ticket report when it is first shown", async () => {
    await openTab();
    await go("events");
    expect(got("/api/admin/events")).toBe(1);
    expect(got("/api/admin/ball-report")).toBe(1);
    expect(got("/api/admin/event-tickets")).toBe(0);
    expect(got("/api/admin/fundraising/pledges")).toBe(0);
    expect(got("/api/admin/fundraising/emails/summary")).toBe(0);
  });

  it("Tickets and pledges loads its two cards when it is first shown", async () => {
    await openTab();
    await go("tickets");
    expect(got("/api/admin/event-tickets")).toBe(1);
    expect(got("/api/admin/fundraising/pledges")).toBe(1);
    expect(got("/api/admin/fundraising/emails/summary")).toBe(0);
    expect(got("/api/admin/events")).toBe(0);
  });

  it("Emails loads the invites, the automatic emails and the All emails count when it is first shown", async () => {
    await openTab();
    const before = { team: got("/api/admin/fundraising/team"), touch: got("/api/admin/fundraising/touch") };
    await go("emails");
    expect(got("/api/admin/fundraising/emails/summary")).toBe(1);
    expect(got("/api/admin/fundraising/team")).toBe(before.team + 1);
    expect(got("/api/admin/fundraising/touch")).toBe(before.touch + 1);
    // The sign ups are already here from Sign ups, so they are not asked for again.
    expect(got("/api/admin/fundraisers")).toBe(1);
    // The emails themselves wait for the card to be opened, as before.
    expect(got("/api/admin/fundraising/emails")).toBe(0);
    expect(got("/api/admin/fundraising/pledges")).toBe(0);
  });

  // "Show it for" in All emails offers the real fundraisers. Arriving straight at Emails (a refresh
  // while on it), nothing has loaded them yet, so Emails asks for the list itself.
  it("Emails, opened first after a refresh, loads the sign ups too, for the Show it for list in All emails", async () => {
    records = [fundraiser(7, { title: "Robin's Walk", status: "approved", public: true })];
    window.sessionStorage.setItem("nbccAdminGiSection", "emails");
    let told = 0;
    el("view-fundraising").addEventListener("nbcc:fundraisers-loaded", () => (told += 1));
    await openTab();
    expect(shownSections()).toEqual(["emails"]);
    expect(got("/api/admin/fundraisers")).toBe(1);
    const pages = (window as unknown as { AdminFundraising: { raisingPages: () => { id: number; title: string }[] } }).AdminFundraising.raisingPages();
    expect(pages.map((p) => p.title)).toEqual(["Robin's Walk"]);
    // All emails is told when the list arrives, in case an email is already open.
    expect(told).toBe(1);
    // None of what only Sign ups needs.
    expect(got("/api/admin/fundraising/requests")).toBe(0);
    expect(got("/api/admin/fundraising/packs")).toBe(0);
  });

  it("Settings loads the switches, the categories, the examples and the weekly summary when it is first shown", async () => {
    await openTab();
    await go("settings");
    expect(got("/api/admin/events")).toBe(1);
    expect(got("/api/admin/fundraising/summary")).toBe(1);
    expect(got("/api/admin/impact-examples")).toBe(1);
    expect(got("/api/admin/ball-report")).toBe(0);
    expect(got("/api/admin/fundraising/pledges")).toBe(0);
    // The switch says what the server said.
    expect(text(el("evSwitchState"))).toMatch(/^No\./);
    expect(text(el("frSwitchState"))).toMatch(/^Yes\./);
  });

  it("reads a section afresh when you come back to the tab, as the old tabs did", async () => {
    await openTab();
    await go("tickets");
    (q('.admin-nav-link[data-view="overview"]') as HTMLElement).click();
    await settle();
    navLink().click();
    await settle();
    expect(shownSections()).toEqual(["tickets"]);
    expect(got("/api/admin/fundraising/pledges")).toBe(2);
    expect(got("/api/admin/event-tickets")).toBe(2);
  });
});

// jsdom lays nothing out, so a frame's content has no height of its own: each test gives the card's
// document one, and reads what the admin set the frame to. The real thing is checked in Chromium.
describe("Our events: the card preview keeps its height", () => {
  beforeEach(() => {
    boot(false);
    records = [];
  });
  const frame = () => el("evCardPreview") as HTMLIFrameElement;
  const tall = (px: number) => {
    Object.defineProperty(frame().contentDocument!.body, "scrollHeight", { configurable: true, value: px });
  };
  async function openAnEvent() {
    await openTab();
    await go("events");
    expect(el("evEditor").hidden).toBe(false); // an empty list opens a blank event by itself
    expect(frame().contentDocument?.body).toBeTruthy();
  }

  it("is not fitted while Our events is off screen", async () => {
    await openAnEvent();
    tall(321);
    window.dispatchEvent(new Event("resize"));
    expect(frame().style.height).toBe("321px");
    await go("settings");
    tall(0); // what a hidden frame measures
    window.dispatchEvent(new Event("resize"));
    expect(frame().style.height).toBe("321px");
  });

  it("is fitted again when Our events comes back", async () => {
    await openAnEvent();
    await go("settings");
    frame().style.height = "0px"; // as a preview redrawn while hidden left it
    tall(288);
    await go("events");
    expect(frame().style.height).toBe("288px");
  });
});

describe("the wording that still said Events page", () => {
  beforeEach(() => boot(false));

  it("asks whether the Get involved page is on the website", () => {
    expect(text(q("#evSwitch h3"))).toBe("Is the Get involved page on the website?");
  });

  it("says Our events are NBCC's own events on the Get involved page", () => {
    const line = text(q('[data-gi-intro="events"]'));
    expect(line).toContain("NBCC’s own events");
    expect(line).toContain("Get involved page");
  });

  it("has no “Events page” left on the screen or in what the script says", () => {
    const body = bodyHtml.replace(/<!--[\s\S]*?-->/g, "");
    expect(body).not.toMatch(/Events page/);
    const said = appSrc.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
    expect(said).not.toMatch(/Events page/);
    expect(body).not.toMatch(/Everything on the website.s Events page/);
  });

  it("asks about the Get involved page before switching it, and says so afterwards", async () => {
    await openTab();
    await go("settings");
    el("evSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toMatch(/^Put the Get involved page on the website\?/);
    expect(text(el("evSwitchStatus"))).toBe("The Get involved page is now on the website.");
    expect(calls.filter((c) => c.method === "PATCH" && c.path === "/api/admin/events/settings").map((c) => c.body)).toEqual([{ pageOn: true }]);
    el("evSwitchBtn").click();
    await settle();
    expect(confirmed[1]).toMatch(/^Take the Get involved page off the website\?/);
    expect(text(el("evSwitchStatus"))).toBe("The Get involved page is now off the website.");
  });

  it("does not rename anything about the Festive Ball", () => {
    expect(text(el("evReportHead"))).toBe("Festive Ball ticket report");
    expect(text(q('.admin-nav-link[data-view="ball"]'))).toBe("Festive Ball");
    expect(text(el("ball-heading"))).toBe("Festive Ball");
  });
});

describe("the Festive Ball ticket report, in Our events", () => {
  beforeEach(() => boot(false));

  it("loads and shows as it did, once Our events is shown", async () => {
    await openTab();
    expect(el("evReport").hidden).toBe(true);
    await go("events");
    expect(el("evReport").hidden).toBe(false);
    expect(showing(el("evReport"))).toBe(true);
    expect(text(el("evReportList"))).toContain("Pat Example");
    expect((el("evReportOn") as HTMLInputElement).checked).toBe(true);
  });

  it("opens, takes a new name and saves through the same route", async () => {
    await openTab();
    await go("events");
    el("evReportToggle").click();
    expect(el("evReportBody").hidden).toBe(false);
    expect(el("evReportToggle").getAttribute("aria-expanded")).toBe("true");
    (el("evReportName") as HTMLInputElement).value = "Sam Example";
    (el("evReportEmail") as HTMLInputElement).value = "sam@example.com";
    el("evReportAdd").click();
    expect(text(el("evReportList"))).toContain("Sam Example");
    el("evReportSave").click();
    await settle();
    const saved = calls.filter((c) => c.path === "/api/admin/ball-report" && c.method !== "GET");
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0].body)).toContain("sam@example.com");
  });

  it("sits in the old Events box with every id it had", () => {
    const card = el("evReport");
    expect(card.closest("#view-events")).not.toBeNull();
    expect(card.closest('[data-gi-part="events"]')).not.toBeNull();
    for (const id of [
      "evReportHead", "evReportState", "evReportToggle", "evReportBody", "evReportList", "evReportName", "evReportEmail",
      "evReportAdd", "evReportOn", "evReportSave", "evReportTest", "evReportStatus", "evReportLast", "evReportPreview",
    ]) {
      expect(card.querySelector("#" + id), id).not.toBeNull();
    }
  });
});
