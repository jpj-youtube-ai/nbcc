// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
// Only the endpoint's own rules are read here (subscribeSchema): what is behind it is not loaded.
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
import { subscribeSchema } from "../../src/routes/subscribe";
import { ALL_PAGES, RESERVED_PREFIXES } from "../../src/site/pages";

// Joining the mailing list: the page at /newsletter (newsletter.html) and its script
// (assets/js/newsletter-signup.js). It is the footer's "Keep in touch" form given a page of its own:
// the same boxes, the same unticked consent, the same hidden box for robots, sent to the same
// existing POST /api/subscribe, which joins them at once. Nothing on the server is new or changed.
// Also everything a new public page needs so it is really served: the clean address, the Docker
// image, the site map. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const HTML = read("newsletter.html");
const require_ = createRequire(import.meta.url);
const { initNewsletterSignup } = require_(resolve(ROOT, "assets/js/newsletter-signup.js")) as {
  initNewsletterSignup: (doc: Document, win: unknown) => unknown;
};

const WHO_WE_ARE =
  "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, with school clothing and crisis support whenever it is needed, and every December a full red bag for those who would otherwise wake up on Christmas morning with nothing to open.";
const CONSENT = "Yes, I'd like to hear from NBCC by email. We'll never share your details, and every email has an unsubscribe link.";

const body = () => HTML.slice(HTML.indexOf("<body>") + 6, HTML.indexOf("</body>"));
const $ = <T extends Element = HTMLInputElement>(sel: string) => document.querySelector(sel) as T;
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const type = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (on = true) => {
  const box = $("#nlConsent");
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
};
const fill = () => {
  type("nlFirstName", " Sam ");
  type("nlSurname", " Example ");
  type("nlEmail", " sam@example.com ");
  tick();
};
const submit = () => $<HTMLFormElement>("#nlForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const answer = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function start(signup: () => Promise<unknown> = async () => answer(201, { ok: true, outcome: "added" })) {
  const fetch = vi.fn((...call: [string, { method: string; headers: Record<string, string>; body: string }?]) => {
    void call;
    return signup();
  });
  const alert = vi.fn();
  initNewsletterSignup(document, { fetch, alert });
  return { fetch, alert };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = body();
});

describe("the page at /newsletter", () => {
  it("is a public page with its own title, description and one address", () => {
    expect(HTML).toContain("<title>Join our mailing list | Night Before Christmas Campaign</title>");
    expect(HTML).toContain('<link rel="canonical" href="https://nbcc.scot/newsletter" />');
    expect(HTML).toMatch(/<meta name="description" content="[^"]{50,170}" \/>/);
    expect(HTML).toContain('<meta property="og:url" content="https://nbcc.scot/newsletter" />');
    expect(HTML).not.toMatch(/<meta name="robots"/);
  });

  it("has one heading, and says what they will get and that they can unsubscribe", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect($("h1").textContent).toBe("Keep in touch with NBCC.");
    const lede = $(".lede").textContent ?? "";
    expect(lede).toContain("occasional news about the difference your support makes and what is coming up across South West Scotland");
    expect(lede).toContain("a few emails a year");
    expect(lede).toContain("unsubscribe at any time");
  });

  it("tells a newcomer who NBCC is, in the charity's own words, word for word", () => {
    expect($(".nl-who p").textContent).toBe(WHO_WE_ARE);
  });

  it("asks for exactly what the footer form asks for, each with a label you can see", () => {
    const form = $<HTMLFormElement>("#nlForm");
    const asked = [...form.querySelectorAll("input")].filter((i) => i.name !== "website" && i.type !== "checkbox");
    expect(asked.map((i) => [i.name, i.type, i.required, i.getAttribute("autocomplete")])).toEqual([
      ["firstName", "text", true, "given-name"],
      ["surname", "text", true, "family-name"],
      ["email", "email", true, "email"],
      ["phone", "tel", false, "tel"],
    ]);
    for (const input of asked) {
      const label = form.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent?.trim(), input.id).toBeTruthy();
      expect(input.getAttribute("placeholder"), input.id).toBeNull();
    }
    expect($("label[for=nlFirstName]").textContent).toContain("First name");
    expect($("label[for=nlSurname]").textContent).toContain("Surname");
    expect($("label[for=nlEmail]").textContent).toContain("Email");
    expect($("label[for=nlPhone]").textContent).toBe("Mobile (optional)");
  });

  it("neither sign up form promises texts: the mobile box only says it is optional", () => {
    const main = read("assets/js/main.js");
    expect(HTML).not.toMatch(/for texts/i);
    expect(main).not.toMatch(/for texts/i);
    expect(main).toContain('placeholder="Mobile (optional)" autocomplete="tel" aria-label="Mobile number, optional"');
  });

  it("each required box has its own message beside it", () => {
    for (const id of ["nlFirstName", "nlSurname", "nlEmail"]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.getAttribute("aria-required")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(`${id}-error`);
      expect((document.getElementById(`${id}-error`) as HTMLElement).hidden).toBe(true);
    }
  });

  it("has the footer form's consent tick box, word for word, and never ticked for them", () => {
    const box = $("#nlConsent");
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect(box.hasAttribute("checked")).toBe(false);
    expect($("label[for=nlConsent]").textContent?.trim()).toBe(CONSENT);
    expect(read("assets/js/main.js")).toContain(CONSENT);
    expect(document.querySelectorAll("input[type=checkbox], input[type=radio]")).toHaveLength(1);
  });

  it("has the hidden box only a robot fills, as the footer form does", () => {
    const pot = $("#nlWebsite");
    expect(pot.name).toBe("website");
    expect(pot.tabIndex).toBe(-1);
    expect(pot.getAttribute("autocomplete")).toBe("off");
    expect(pot.closest("[hidden]")).not.toBeNull();
  });

  it("has one button, and a link to the privacy notice", () => {
    expect($<HTMLButtonElement>("#nlSubmit").textContent).toBe("Join our mailing list");
    expect(document.querySelectorAll("#nlForm button")).toHaveLength(1);
    expect($<HTMLAnchorElement>("#nlForm a[href='/privacy']").textContent).toBe("Privacy notice");
  });

  it("says what to do without JavaScript", () => {
    expect(HTML).toMatch(/<noscript>[\s\S]*This form needs JavaScript switched on\.[\s\S]*info@nbcc\.scot[\s\S]*<\/noscript>/);
  });

  it("keeps the signed up message ready, hidden until the form is sent", () => {
    const done = $<HTMLElement>("#nlDone");
    expect(done.hidden).toBe(true);
    expect(done.querySelector("h2")?.textContent).toBe("You're signed up");
    expect(done.textContent).toContain("Thank you. Look out for us in your inbox.");
    expect(done.textContent).toContain("unsubscribe");
  });

  it("uses no spam check from anyone else, and no confirm step", () => {
    expect(HTML).not.toMatch(/cloudflare|turnstile|captcha/i);
    expect(read("assets/js/newsletter-signup.js")).not.toMatch(/cloudflare|turnstile|captcha/i);
    expect(HTML).not.toMatch(/Check your email|newsletter\/confirm|One more step/i);
  });

  it("loads its scripts without holding up the page, from the site's own address", () => {
    const scripts = [...HTML.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.some((s) => s.includes('src="/assets/js/newsletter-signup.js"'))).toBe(true);
    for (const s of scripts) expect(s).toMatch(/\bdefer\b/);
    expect(HTML).not.toMatch(/(?:href|src)="https?:\/\/(?!nbcc\.scot|www\.instagram|www\.facebook|x\.com|www\.oscr)/);
  });

  it("has the same header and footer as the contact page", () => {
    const contact = read("contact.html");
    const footer = (h: string) => h.slice(h.indexOf('<footer class="site-footer"'), h.indexOf("</footer>"));
    const header = (h: string) => h.slice(h.indexOf('<header class="nav"'), h.indexOf("</header>")).replace(' class="active" aria-current="page"', "");
    expect(footer(HTML)).toBe(footer(contact));
    expect(header(HTML)).toBe(header(contact));
  });

  it("is not in the main menu", () => {
    expect($("#navLinks").innerHTML).not.toContain("/newsletter");
  });

  it("does not gain the footer's short sign up form as well: this page is the sign up", () => {
    const main = require_(resolve(ROOT, "assets/js/main.js")) as { initFooterSignup: (doc: Document, win: unknown) => void };
    main.initFooterSignup(document, { fetch: vi.fn() });
    expect(document.getElementById("footSignupForm")).toBeNull();
    expect(document.querySelectorAll("form")).toHaveLength(1);
  });

  it("the footer form is still added on every other page", () => {
    document.body.innerHTML = read("contact.html").replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "");
    const main = require_(resolve(ROOT, "assets/js/main.js")) as { initFooterSignup: (doc: Document, win: unknown) => void };
    main.initFooterSignup(document, { fetch: vi.fn() });
    expect(document.getElementById("footSignupForm")).not.toBeNull();
  });

  it("uses plain words: no long dashes or curly quotes in what is new on the page", () => {
    const main = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
    expect(main).not.toMatch(/[–—‘’“”]|&mdash;|&ndash;|&rsquo;/);
  });
});

describe("its styles", () => {
  const css = read("assets/css/newsletter.css");

  it("are the page's own small stylesheet, in the site's tokens, with no new colours", () => {
    expect(HTML).toContain('<link rel="stylesheet" href="/assets/css/newsletter.css" />');
    expect(css.length).toBeLessThan(2500);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it("never put a scrollbar inside a box", () => {
    expect(css).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    expect(css).not.toMatch(/max-height/);
  });
});

describe("sending the form", () => {
  it("shows what is missing beside each box and the tick box, and sends nothing", async () => {
    const { fetch } = start();
    submit();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    for (const [id, words] of [
      ["nlFirstName", "Please enter your first name."],
      ["nlSurname", "Please enter your surname."],
      ["nlEmail", "Please enter a valid email address."],
    ]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.getAttribute("aria-invalid"), id).toBe("true");
      expect(input.closest(".field")?.classList.contains("invalid"), id).toBe(true);
      const err = document.getElementById(`${id}-error`) as HTMLElement;
      expect(err.hidden, id).toBe(false);
      expect(err.textContent).toBe(words);
    }
    const consent = $<HTMLElement>("#nlConsent-error");
    expect(consent.hidden).toBe(false);
    expect(consent.textContent).toBe("Please tick the box to confirm you'd like to hear from us.");
    expect($("#nlConsent").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe($("#nlFirstName"));
  });

  it("the mobile number may be left empty", async () => {
    const { fetch } = start();
    fill();
    submit();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect($("#nlPhone").getAttribute("aria-invalid")).toBeNull();
  });

  it("nothing is sent until the box is ticked: typing an address is not consent", async () => {
    const { fetch } = start();
    fill();
    tick(false);
    submit();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect($<HTMLElement>("#nlConsent-error").hidden).toBe(false);
    expect(document.activeElement).toBe($("#nlConsent"));
  });

  it("an address that is not an address is caught before anything is sent", async () => {
    const { fetch } = start();
    fill();
    type("nlEmail", "sam at example");
    submit();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect($("#nlEmail").getAttribute("aria-invalid")).toBe("true");
    expect($("#nlFirstName").getAttribute("aria-invalid")).toBeNull();
  });

  it("an error goes away as soon as it is put right", () => {
    start();
    submit();
    type("nlFirstName", "Sam");
    expect($("#nlFirstName").getAttribute("aria-invalid")).toBeNull();
    expect($<HTMLElement>("#nlFirstName-error").hidden).toBe(true);
    tick();
    expect($<HTMLElement>("#nlConsent-error").hidden).toBe(true);
  });

  it("never uses an alert box", async () => {
    const { alert } = start();
    submit();
    await flush();
    expect(alert).not.toHaveBeenCalled();
    expect(read("assets/js/newsletter-signup.js")).not.toMatch(/\balert\(/);
  });

  it("sends exactly what the footer form sends, to the same place", async () => {
    const { fetch } = start();
    fill();
    type("nlPhone", " 07700 900123 ");
    submit();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("/api/subscribe");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({ firstName: "Sam", surname: "Example", email: "sam@example.com", phone: "07700 900123", consent: true });
    // The existing endpoint's own rules accept it as it is.
    expect(subscribeSchema.safeParse(sent).success).toBe(true);
  });

  it("leaves the mobile number out when none is given, as the footer form does", async () => {
    const { fetch } = start();
    fill();
    submit();
    await flush();
    const sent = JSON.parse((fetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(sent).toEqual({ firstName: "Sam", surname: "Example", email: "sam@example.com", consent: true });
    expect(subscribeSchema.safeParse(sent).success).toBe(true);
  });

  it("sends the hidden box when a robot fills it, so the server can quietly drop it", async () => {
    const { fetch } = start();
    fill();
    type("nlWebsite", "https://robots.example");
    submit();
    await flush();
    expect(JSON.parse((fetch.mock.calls[0] as [string, { body: string }])[1].body).website).toBe("https://robots.example");
  });

  it.each([201, 200])("shows You're signed up in place of the form when the server answers %i", async (status) => {
    start(async () => answer(status, { ok: true }));
    fill();
    submit();
    await flush();
    expect($<HTMLElement>("#nlForm").hidden).toBe(true);
    expect($<HTMLElement>("#nlDone").hidden).toBe(false);
    // A screen reader hears "You're signed up": the heading takes the focus.
    expect(document.activeElement).toBe($("#nlDone h2"));
    expect($("#nlDone").getAttribute("aria-labelledby")).toBe($("#nlDone h2").id);
  });

  it("a second press while it is sending sends nothing more", async () => {
    let release: (v: unknown) => void = () => undefined;
    const { fetch } = start(() => new Promise((r) => (release = r)));
    fill();
    submit();
    submit();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(true);
    release(answer(201, { ok: true }));
    await flush();
    expect($<HTMLElement>("#nlDone").hidden).toBe(false);
  });

  it.each([
    [400, { error: "Please give your name and a valid email address" }, "Please give your name and a valid email address"],
    [429, { error: "Too many attempts. Please try again shortly." }, "Too many attempts. Please try again shortly."],
    [500, {}, "Something went wrong and we could not sign you up. Please try again in a few minutes."],
    // Only a refusal (400, 429) is said in the server's words: anything else gets the page's own.
    [500, { error: "Something went wrong — please try again later" }, "Something went wrong and we could not sign you up. Please try again in a few minutes."],
    [503, { error: "upstream said something odd" }, "Something went wrong and we could not sign you up. Please try again in a few minutes."],
  ])("says the server's own words on the page when it answers %i, and the form can be sent again", async (status, data, words) => {
    start(async () => answer(status as number, data));
    fill();
    submit();
    await flush();
    const said = $<HTMLElement>("#nlStatus");
    expect(said.textContent).toBe(words);
    expect(said.className).toBe("form-status is-error");
    expect($<HTMLElement>("#nlForm").hidden).toBe(false);
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(false);
  });

  it("an error is put where a screen reader will hear it: the message takes the focus", async () => {
    start(async () => answer(429, { error: "Too many attempts. Please try again shortly." }));
    fill();
    submit();
    await flush();
    expect($("#nlStatus").getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe($("#nlStatus"));
  });

  it("the message area is always on the page, so Sending is announced too", () => {
    const css = read("assets/css/newsletter.css");
    expect(css).toContain(".nl-form .form-status{display:block}");
    expect(css).not.toMatch(/.form-status:empty{display:none}/);
    expect($("#nlStatus").getAttribute("role")).toBe("status");
    expect($("#nlStatus").getAttribute("aria-live")).toBe("polite");
  });

  it("in a browser that cannot send it, the form is never posted raw: it says to email us instead", () => {
    initNewsletterSignup(document, {});
    fill();
    const ev = new Event("submit", { bubbles: true, cancelable: true });
    $<HTMLFormElement>("#nlForm").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const said = $<HTMLElement>("#nlStatus");
    expect(said.textContent).toBe("This form could not be sent from your browser. Please email us at info@nbcc.scot and ask to join instead.");
    expect(said.className).toBe("form-status is-error");
    expect($<HTMLElement>("#nlDone").hidden).toBe(true);
  });

  it("says so when the request could not be made at all", async () => {
    start(async () => {
      throw new Error("offline");
    });
    fill();
    submit();
    await flush();
    expect($("#nlStatus").textContent).toBe("Something went wrong and we could not sign you up. Please try again in a few minutes.");
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(false);
  });
});

describe("what a new public page needs to be really served", () => {
  it("has its clean address, and the raw file redirects to it", () => {
    const redirects = read("_redirects");
    expect(redirects).toMatch(/^\/newsletter\s+\/newsletter\.html\s+200$/m);
    expect(redirects).toMatch(/^\/newsletter\.html\s+\/newsletter\s+301!$/m);
  });

  it("is in the Docker image", () => {
    const copy = read("Dockerfile")
      .split("\n")
      .find((l) => l.startsWith("COPY ") && /\b_redirects\b/.test(l)) as string;
    expect(copy).toContain(" newsletter.html ");
  });

  it("is on the site map, listed for search engines, and no spare address can shadow it", () => {
    const page = ALL_PAGES.find((p) => p.path === "/newsletter");
    expect(page).toEqual({ path: "/newsletter", title: "Join our mailing list", listedByDefault: true });
    expect(RESERVED_PREFIXES).toContain("/newsletter");
  });
});

describe("nothing on the server was added for it", () => {
  it("has no route, table, email or daily pass of its own", () => {
    expect(readdirSync(resolve(ROOT, "migrations")).filter((f) => /newsletter-signup/.test(f))).toEqual([]);
    expect(readdirSync(resolve(ROOT, "src/routes")).filter((f) => /newsletter-signup/.test(f))).toEqual([]);
    expect(read("src/app.ts")).not.toContain("newsletterSignup");
    expect(read("src/clients/email.ts")).not.toContain("newsletterSignupConfirm");
  });
});
