// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { CONTACT_MESSAGE_MAX, contactEnquirySchema } from "../../src/contact/schema";

// The six short pages under /get-involved/: what is on them, what is deliberately left off until
// Jaimie sends the details, and the Tell us forms, which send through the contact form's own path.
// How each page is served is in get-involved-short-pages.test.ts. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const FILES = {
  drop: "get-involved-drop-off-points.html",
  referrals: "get-involved-referrals.html",
  volunteer: "get-involved-volunteer.html",
  business: "get-involved-business.html",
  schools: "get-involved-schools.html",
  groups: "get-involved-groups.html",
} as const;
const ALL = Object.values(FILES);
const TOGETHER = [FILES.business, FILES.schools, FILES.groups];
const docOf = (file: string) => parse(read(file));

/** What a visitor can read: the body's words and the words in its attributes, as copy-rules reads them. */
function visible(file: string): string {
  const doc = docOf(file);
  const head = [doc.title, doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""];
  doc.body.querySelectorAll("script, style, svg").forEach((el) => el.remove());
  const attrs = [...doc.body.querySelectorAll("[alt], [title], [aria-label], [placeholder]")].flatMap((el) =>
    ["alt", "title", "aria-label", "placeholder"].map((a) => el.getAttribute(a) ?? ""),
  );
  return [...head, doc.body.textContent ?? "", ...attrs].join(" ").replace(/\s+/g, " ");
}
const hrefs = (doc: Document) => [...doc.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")!);
const external = (doc: Document) => hrefs(doc).filter((h) => h.startsWith("http"));
const unique = (list: string[]) => [...new Set(list)].sort();

describe.each(ALL)("%s", (file) => {
  const doc = docOf(file);
  const raw = read(file);

  it("has one main heading", () => {
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
  });

  it("has its own title, description and address for search engines", () => {
    const slug = file.replace("get-involved-", "").replace(".html", "");
    expect(doc.title).toMatch(/ \| Night Before Christmas Campaign$/);
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")?.length).toBeGreaterThan(50);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(`https://nbcc.scot/get-involved/${slug}`);
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(`https://nbcc.scot/get-involved/${slug}`);
  });

  it("reuses Get involved's styles, and asks for everything from the top of the site", () => {
    const sheets = [...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));
    expect(sheets).toEqual(["/assets/css/styles.css", "/assets/css/get-involved.css", "/assets/css/short-pages.css"]);
    expect(doc.body.classList.contains("page-hub")).toBe(true);
    for (const el of doc.querySelectorAll("script[src], img[src]")) expect(el.getAttribute("src")).toMatch(/^\/assets\//);
  });

  it("leaves nothing of the prototype behind", () => {
    for (const word of ["tofill", "Photo to come", "tocome", "Prototype", "prototype", "proto-", "/files/", "Check:", "date to add", "formMock"]) {
      expect(raw, word).not.toContain(word);
    }
    expect(doc.querySelector(".slot")).toBeNull();
    expect(raw).not.toContain("onsubmit");
  });

  it("never says families", () => {
    expect(visible(file).toLowerCase()).not.toContain("famil");
  });

  it("has no film", () => {
    expect(doc.querySelector("video")).toBeNull();
    expect(doc.querySelector(".tv")).toBeNull();
    expect(raw).not.toContain("vid-");
    expect(raw).not.toContain("poster-");
    expect(raw).not.toContain("in one minute");
    expect(raw).not.toContain("in three minutes");
  });

  // Nothing about Fill a Red Bag before Stage 2. Task 6 adds the link to the drop-off page.
  it("does not say the word fill, or link to it", () => {
    expect(visible(file)).not.toMatch(/fill/i);
    expect(hrefs(doc).filter((h) => /fill/i.test(h))).toEqual([]);
  });

  it("links to the other new pages by their real addresses, and never to the live site by its full name", () => {
    expect(hrefs(doc).filter((h) => h.includes(".html"))).toEqual([]);
    expect(hrefs(doc).filter((h) => /^https?:\/\/(www\.)?nbcc\.scot/.test(h))).toEqual([]);
  });

  it("opens the sign up sites in a new tab, and says so", () => {
    for (const a of doc.querySelectorAll('main a[href^="http"]')) {
      expect(a.getAttribute("target"), a.outerHTML).toBe("_blank");
      expect(a.getAttribute("rel"), a.outerHTML).toBe("noopener");
      expect(text(a), a.outerHTML).toContain("opens in a new tab");
    }
  });

  it("gives every picture its size and words, and each one is a file of a sensible size", () => {
    const imgs = [...doc.querySelectorAll("main img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const src = img.getAttribute("src")!;
      expect(Number(img.getAttribute("width")), src).toBeGreaterThan(0);
      expect(Number(img.getAttribute("height")), src).toBeGreaterThan(0);
      expect(img.getAttribute("alt")!.length, src).toBeGreaterThan(15);
      expect(existsSync(resolve(ROOT, src.slice(1))), src).toBe(true);
      expect(statSync(resolve(ROOT, src.slice(1))).size, src).toBeLessThan(130_000);
    }
  });

  it("never uses why-packing.jpg, which is a drawing of a camera saying placeholder", () => {
    expect(raw).not.toContain("why-packing");
  });
});

describe("Drop-off points", () => {
  const doc = docOf(FILES.drop);

  it("goes to the live sign up site", () => {
    expect(unique(external(doc))).toEqual(["https://drop.nbcc.scot/", "https://drop.nbcc.scot/sign-in", "https://drop.nbcc.scot/sign-up"]);
  });

  it("has this year's dates", () => {
    expect(text(doc.querySelector(".ticket"))).toBe("This year Monday 2 November to Thursday 17 December");
    expect(text(doc.querySelector(".ph-note"))).toBe("Our list of drop-off points opens on Monday 2 November.");
  });

  it("leaves out what to bring and what we can't take until Jaimie sends them", () => {
    expect(visible(FILES.drop)).not.toContain("What to bring");
    expect(visible(FILES.drop)).not.toContain("What we can");
  });

  it("offers only Donate to someone who can't get to a drop-off point, for now", () => {
    const section = doc.querySelector(".alt-band")!;
    expect(section.querySelector("h2")?.textContent).toBe("Can’t get to a drop-off point?");
    expect([...section.querySelectorAll("a.btn")].map((a) => [text(a), a.getAttribute("href")])).toEqual([["Donate", "/donate"]]);
  });

  it("says how to ring us", () => {
    expect(doc.querySelector('.alt-band a[href="tel:01292811015"]')?.textContent).toBe("01292 811 015");
  });
});

describe("Referrals", () => {
  const doc = docOf(FILES.referrals);

  it("goes to the live referral site", () => {
    expect(unique(external(doc))).toEqual([
      "https://referrals.nbcc.scot/refer/request",
      "https://referrals.nbcc.scot/schools",
      "https://referrals.nbcc.scot/sign-in",
    ]);
  });

  it("leaves out the closing date until Jaimie sends it", () => {
    expect(visible(FILES.referrals)).not.toContain("referrals close");
    expect(doc.querySelector(".ticket")).toBeNull();
  });

  it("is plain that we are not an emergency service, and says who reads the email", () => {
    expect(visible(FILES.referrals)).toContain("We’re not an emergency service.");
    expect(doc.querySelector('a[href="mailto:referrals@nbcc.scot"]')).not.toBeNull();
    expect(doc.querySelector('a[href="tel:01292811015"]')).not.toBeNull();
  });
});

describe("Volunteer", () => {
  const doc = docOf(FILES.volunteer);

  it("goes to the live volunteer site", () => {
    expect(unique(external(doc))).toEqual(["https://vol.nbcc.scot/sign-in", "https://vol.nbcc.scot/sign-up"]);
  });

  it("leaves out the quote card until there is a real volunteer's words", () => {
    expect(doc.querySelector("blockquote")).toBeNull();
    expect(doc.querySelector(".quote-card")).toBeNull();
  });

  it("points a team or group to the pages for them", () => {
    expect(hrefs(doc)).toEqual(expect.arrayContaining(["/get-involved/business", "/get-involved/groups"]));
  });
});

describe("Your business", () => {
  const doc = docOf(FILES.business);

  it("has no payroll giving line, and no tick for it", () => {
    expect(visible(FILES.business)).not.toMatch(/payroll/i);
    expect(read(FILES.business)).not.toMatch(/payroll/i);
  });

  it("points to the drop-off page", () => {
    expect(doc.querySelector('.ledger a[href="/get-involved/drop-off-points"]')).not.toBeNull();
  });

  it("offers these to tick, the same as the lists above", () => {
    const ticks = [...doc.querySelectorAll('input[name="interest"]')].map((i) => i.getAttribute("value"));
    expect(ticks).toEqual([
      "Monthly business supporter",
      "Sponsorship",
      "Charity of the year",
      "Match giving",
      "Staff fundraising",
      "Team volunteering",
      "Collection tins at the till",
      "Gifts in kind",
      "Skills for free",
      "Become a drop-off point",
    ]);
    expect([...doc.querySelectorAll(".ledger li b")].map(text)).toEqual(ticks);
  });
});

describe("Your school", () => {
  const doc = docOf(FILES.schools);

  it("goes to the live referral site", () => {
    expect(unique(external(doc))).toEqual(["https://referrals.nbcc.scot/schools", "https://referrals.nbcc.scot/schools/how-it-works"]);
  });

  it("offers these to tick, the same as the list above", () => {
    const ticks = [...doc.querySelectorAll('input[name="interest"]')].map((i) => i.getAttribute("value"));
    expect(ticks).toEqual([
      "A jumper or dress down day",
      "Be a drop-off point",
      "Visit the Workshop",
      "A talk at assembly",
      "Pupil volunteering",
    ]);
    expect([...doc.querySelectorAll(".ledger li b")].map(text)).toEqual(ticks);
  });

  it("asks for the role too", () => {
    expect(text(doc.querySelector('label[for="tellRole"]'))).toBe("Your role");
  });
});

describe("Your club or group", () => {
  const doc = docOf(FILES.groups);

  it("offers these to tick, the same as the list above", () => {
    const ticks = [...doc.querySelectorAll('input[name="interest"]')].map((i) => i.getAttribute("value"));
    expect(ticks).toEqual([
      "Hold a fundraiser or event",
      "Be a drop-off point",
      "Charity of the year",
      "Volunteer as a group",
      "A talk at your meeting",
      "Scouts, Guides and youth awards",
    ]);
    expect([...doc.querySelectorAll(".ledger li b")].map(text)).toEqual(ticks);
  });
});

// ---- the Tell us forms ----

const { initContactForm, validateForm, clearValidation } = require(resolve(ROOT, "assets/js/main.js"));
const { initContactCaptcha } = require(resolve(ROOT, "assets/js/contact-captcha.js"));
const { initTellUs, tellUsMessage } = require(resolve(ROOT, "assets/js/tell-us.js"));

type Win = Window & { fetch?: unknown; turnstile?: unknown; nbccTurnstileReady?: () => void; NBCCFormValidation?: unknown };
const win = window as unknown as Win;
const flush = () => new Promise((r) => setTimeout(r, 0));
const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as unknown as T;
const submit = () => el<HTMLFormElement>("contactForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const bodyOf = (file: string) => (read(file).match(/<body[^>]*>([\s\S]*)<\/body>/i) ?? ["", ""])[1];
const NAME = "Robin Quill";
const EMAIL = "robin.quill@example.com";

function fillIn() {
  el("firstName").value = NAME;
  el("email").value = EMAIL;
}
const tick = (value: string) => {
  (document.querySelector(`input[name="interest"][value="${value}"]`) as HTMLInputElement).checked = true;
};

/** A page open in a browser, with the server stood in for: it records what was posted. */
function open(file: string, answer: { ok: boolean; siteKey?: string | null } = { ok: true }) {
  document.head.innerHTML = "";
  document.body.innerHTML = bodyOf(file);
  const posted: Record<string, string>[] = [];
  win.fetch = vi.fn((url: string, init?: { body?: string }) => {
    if (url === "/api/contact/captcha") return Promise.resolve({ ok: true, json: async () => ({ siteKey: answer.siteKey ?? null }) });
    posted.push(JSON.parse(init!.body!));
    return Promise.resolve({ ok: answer.ok, json: async () => ({}) });
  });
  win.NBCCFormValidation = { validateForm, clearValidation };
  return posted;
}
/** The three scripts, in the order the page loads them. */
const startScripts = () => {
  initContactForm(document, window);
  initContactCaptcha(document, window);
  initTellUs(document);
};

describe.each(TOGETHER)("the Tell us form on %s", (file) => {
  const doc = docOf(file);
  const form = doc.getElementById("contactForm");

  it("is the section the button at the top jumps to", () => {
    expect(doc.querySelector('.ph a[href="#tell-us"]')).not.toBeNull();
    expect(doc.getElementById("tell-us")?.contains(form)).toBe(true);
  });

  it("posts to the contact path, and loads its scripts in order", () => {
    expect(form?.getAttribute("action")).toBe("/api/contact");
    expect(form?.getAttribute("method")).toBe("post");
    expect([...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"))).toEqual([
      "/assets/js/main.js",
      "/assets/js/pulse.js",
      "/assets/js/contact-captcha.js",
      "/assets/js/tell-us.js",
    ]);
  });

  it("has the contact form's spam check and its trap for robots", () => {
    expect(doc.getElementById("contactCaptcha")?.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("captchaToken")?.getAttribute("type")).toBe("hidden");
    expect(doc.querySelector('input[name="company"]')?.closest("[hidden]")).not.toBeNull();
  });

  // The server silently drops any message with something in `company`. A visible field of that name
  // would look like it worked and lose every enquiry.
  it("has exactly one field called company, the hidden one", () => {
    expect(doc.querySelectorAll('[name="company"]')).toHaveLength(1);
  });

  it("marks only what the server needs as required", () => {
    expect([...doc.querySelectorAll("form [required]")].map((i) => i.id)).toEqual(["firstName", "email"]);
  });

  it("holds no more than the server will take", () => {
    const total = [...doc.querySelectorAll("[data-tell]")].reduce((sum, f) => sum + Number(f.getAttribute("maxlength")), 0);
    const ticks = [...doc.querySelectorAll('input[name="interest"]')].reduce((sum, f) => sum + f.getAttribute("value")!.length + 2, 0);
    expect(total + ticks + 200).toBeLessThan(CONTACT_MESSAGE_MAX);
    expect(doc.getElementById("firstName")?.getAttribute("maxlength")).toBe("100");
    expect(doc.getElementById("email")?.getAttribute("maxlength")).toBe("254");
    expect(doc.getElementById("phone")?.getAttribute("maxlength")).toBe("40");
  });

  it("says what we do with the details, and how to ring instead", () => {
    expect(form?.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(doc.querySelector('.tellus a[href="tel:01292811015"]')).not.toBeNull();
  });

  it("sends a message the server accepts", async () => {
    const posted = open(file);
    startScripts();
    fillIn();
    submit();
    await flush();
    await flush();
    expect(posted).toHaveLength(1);
    expect(contactEnquirySchema.safeParse(posted[0]).success).toBe(true);
    expect(posted[0].firstName).toBe(NAME);
    expect(posted[0].email).toBe(EMAIL);
  });

  it("says thank you in plain words", async () => {
    open(file);
    startScripts();
    fillIn();
    submit();
    await flush();
    await flush();
    expect(el("formStatus").textContent).toBe(`Thank you ${NAME}, your message has reached the NBCC inbox. We will be in touch soon.`);
    expect(el("formStatus").className).toContain("is-success");
  });

  it("flags what is missing, and sends nothing", async () => {
    const posted = open(file);
    startScripts();
    submit();
    await flush();
    expect(posted).toEqual([]);
    expect(el("firstName").getAttribute("aria-invalid")).toBe("true");
    expect(el("email").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps what was typed if the message cannot be sent", async () => {
    open(file, { ok: false });
    startScripts();
    fillIn();
    submit();
    await flush();
    await flush();
    expect(el("formStatus").className).toContain("is-error");
    expect(el("firstName").value).toBe(NAME);
  });
});

describe("what a Tell us form sends", () => {
  it("carries the page, the business, the ticks and anything else, each on its own line", async () => {
    const posted = open(FILES.business);
    startScripts();
    fillIn();
    el("phone").value = "07700 900123";
    el("tellOrg").value = "Example Trading";
    tick("Sponsorship");
    tick("Match giving");
    el<HTMLTextAreaElement>("tellMore").value = "We have a van.";
    submit();
    await flush();
    await flush();
    expect(posted[0].phone).toBe("07700 900123");
    expect(posted[0].message).toBe(
      "Sent from the Your business page.\nBusiness name: Example Trading\nInterested in: Sponsorship, Match giving\nAnything else: We have a van.",
    );
  });

  it("carries the school and the role", async () => {
    const posted = open(FILES.schools);
    startScripts();
    fillIn();
    el("tellOrg").value = "Example Primary";
    el("tellRole").value = "Head teacher";
    tick("Visit the Workshop");
    submit();
    await flush();
    await flush();
    expect(posted[0].message).toBe("Sent from the Your school page.\nSchool: Example Primary\nYour role: Head teacher\nInterested in: Visit the Workshop");
  });

  it("names the page even when nothing else was added", async () => {
    const posted = open(FILES.groups);
    startScripts();
    fillIn();
    submit();
    await flush();
    await flush();
    expect(posted[0].message).toBe("Sent from the Your club or group page.");
  });

  it("works whichever way round the scripts' listeners are set up", async () => {
    const posted = open(FILES.groups);
    initTellUs(document);
    initContactForm(document, window);
    fillIn();
    tick("Volunteer as a group");
    submit();
    await flush();
    await flush();
    expect(posted[0].message).toBe("Sent from the Your club or group page.\nInterested in: Volunteer as a group");
  });

  it("reads the form fresh each time, so a second send carries only what is ticked now", () => {
    open(FILES.business);
    const form = el<HTMLFormElement>("contactForm");
    tick("Sponsorship");
    expect(tellUsMessage(form)).toContain("Sponsorship");
    (document.querySelector('input[value="Sponsorship"]') as HTMLInputElement).checked = false;
    expect(tellUsMessage(form)).not.toContain("Sponsorship");
  });

  it("leaves a page with no Tell us form alone", () => {
    document.body.innerHTML = '<form id="contactForm"><input id="message" /></form>';
    expect(() => initTellUs(document)).not.toThrow();
    el("message").value = "Typed by hand";
    submit();
    expect(el("message").value).toBe("Typed by hand");
  });
});

describe("the spam check on a Tell us form", () => {
  const KEY = "1x00000000000000000000AA";
  const turnstile = { render: vi.fn(() => "w1"), reset: vi.fn(), remove: vi.fn() };
  const options = () => (turnstile.render.mock.calls[0] as unknown as [HTMLElement, Record<string, (t?: string) => void>])[1];

  async function ready(file: string) {
    const posted = open(file, { ok: true, siteKey: KEY });
    startScripts();
    await flush();
    await flush();
    el("firstName").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    win.turnstile = turnstile;
    win.nbccTurnstileReady!();
    return posted;
  }

  beforeEach(() => {
    turnstile.render.mockClear();
    turnstile.reset.mockClear();
    delete win.turnstile;
    delete win.nbccTurnstileReady;
  });

  it("holds Send until there is a pass", async () => {
    const posted = await ready(FILES.schools);
    fillIn();
    submit();
    await flush();
    expect(posted).toEqual([]);
  });

  it("sends the pass and the whole message together", async () => {
    const posted = await ready(FILES.schools);
    options().callback("tok-1");
    fillIn();
    tick("A talk at assembly");
    submit();
    await flush();
    await flush();
    expect(posted[0].captchaToken).toBe("tok-1");
    expect(posted[0].message).toContain("Interested in: A talk at assembly");
  });
});

describe("the contact page keeps working as it did", () => {
  it("does not load the Tell us script", () => {
    expect(read("contact.html")).not.toContain("tell-us.js");
  });
});

describe("the page's stylesheet", () => {
  const css = read("assets/css/short-pages.css");

  it("keeps a phone number on one line", () => {
    expect(css).toMatch(/a\[href\^="tel:"\]\{white-space:nowrap\}/);
  });

  it("never scrolls inside a box", () => {
    expect(css).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
  });

  it("has nothing for the things left out", () => {
    for (const rule of [".tofill", ".tocome", ".slot", ".quote-card", ".proto-", ".tv"]) expect(css, rule).not.toContain(rule);
  });

  // The taped photograph's movement is in get-involved.css, with its less motion rule.
  it("adds no movement of its own, so there is none to switch off for someone who asked for less", () => {
    expect(css).not.toMatch(/\b(transition|animation)\s*:/);
    expect(read("assets/css/get-involved.css")).toContain("@media (prefers-reduced-motion:reduce)");
  });
});
