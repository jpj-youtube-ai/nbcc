// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WHO_WE_ARE, LINK_DAYS } from "../../src/mailing-list/model";
import { ALL_PAGES, RESERVED_PREFIXES } from "../../src/site/pages";

// Joining the mailing list: the page at /newsletter (newsletter.html) and its script
// (assets/js/newsletter-signup.js), and everything a new public page needs so it is really served:
// the clean address, the Docker image, the site map. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const HTML = read("newsletter.html");
const require_ = createRequire(import.meta.url);
const { initNewsletterSignup } = require_(resolve(ROOT, "assets/js/newsletter-signup.js")) as {
  initNewsletterSignup: (doc: Document, win: unknown) => unknown;
};

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
const submit = () => $<HTMLFormElement>("#nlForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const answer = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

type Fetch = ReturnType<typeof vi.fn>;
/** A window whose fetch answers the site key question and then the sign up. */
function start(opts: { siteKey?: string | null; signup?: () => Promise<unknown> } = {}) {
  const fetch: Fetch = vi.fn(async (url: string) => {
    if (url === "/api/newsletter/captcha") return answer(200, { siteKey: opts.siteKey ?? null });
    return opts.signup ? opts.signup() : answer(200, { status: "check_email" });
  });
  const win = { fetch, setTimeout: (fn: () => void) => fn() } as unknown as Record<string, unknown>;
  initNewsletterSignup(document, win);
  return { fetch, win };
}
const posts = (fetch: Fetch) => fetch.mock.calls.filter((c) => c[0] === "/api/newsletter/signup");

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
    expect($(".nl-who").textContent).toContain(WHO_WE_ARE);
    expect(WHO_WE_ARE).toContain("volunteer led charity");
  });

  it("asks only for a first name and an email, each with its own label, both required", () => {
    const form = $<HTMLFormElement>("#nlForm");
    const asked = [...form.querySelectorAll("input")].filter((i) => i.type !== "hidden" && i.name !== "company");
    expect(asked.map((i) => i.name)).toEqual(["firstName", "email"]);
    for (const input of asked) {
      expect(form.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
      expect(input.required).toBe(true);
      expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-error`);
      expect(document.getElementById(`${input.id}-error`)).not.toBeNull();
    }
    expect($("#nlFirstName").getAttribute("autocomplete")).toBe("given-name");
    expect($("#nlEmail").type).toBe("email");
    expect($("label[for=nlFirstName]").textContent).toContain("First name");
    expect($("label[for=nlEmail]").textContent).toContain("Email");
  });

  it("has no tick boxes at all: pressing the button is the consent, and the words by it say so", () => {
    expect(document.querySelectorAll("input[type=checkbox], input[type=radio]")).toHaveLength(0);
    const button = $<HTMLButtonElement>("#nlSubmit");
    expect(button.textContent).toBe("Join our mailing list");
    const words = document.getElementById(button.getAttribute("aria-describedby") as string)?.textContent ?? "";
    expect(words).toContain("By pressing the button you are asking NBCC to email you our news a few times a year.");
    expect(words).toContain("a link to confirm");
  });

  it("links to the privacy notice and says they can unsubscribe", () => {
    const privacy = $<HTMLAnchorElement>("#nlForm a[href='/privacy']");
    expect(privacy.textContent).toBe("Privacy notice");
    expect($("#nlForm").textContent).toContain("every email has an unsubscribe link");
  });

  it("has a hidden box only a robot fills, and a place for the spam check", () => {
    expect($("#nlCompany").closest("[hidden]")).not.toBeNull();
    expect($("#nlCompany").tabIndex).toBe(-1);
    expect($<HTMLElement>("#nlCaptcha").hidden).toBe(true);
    expect($("#nlCaptchaToken").type).toBe("hidden");
  });

  it("says what to do without JavaScript", () => {
    expect(HTML).toMatch(/<noscript>[\s\S]*info@nbcc\.scot[\s\S]*<\/noscript>/);
  });

  it("keeps the check your email message ready, hidden until the form is sent", () => {
    const done = $<HTMLElement>("#nlDone");
    expect(done.hidden).toBe(true);
    expect(done.querySelector("h2")?.textContent).toBe("Check your email");
    expect(done.textContent).toContain(`The link works for ${LINK_DAYS} days.`);
    expect(done.textContent).toContain("junk folder");
  });

  it("loads its scripts without holding up the page, from the site's own address", () => {
    const scripts = [...HTML.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.some((s) => s.includes('src="/assets/js/newsletter-signup.js"'))).toBe(true);
    for (const s of scripts) expect(s).toMatch(/\bdefer\b/);
    expect(HTML).not.toContain("challenges.cloudflare.com");
    // Every asset from the root, so the pages at /newsletter/confirm find them too.
    for (const m of HTML.matchAll(/(?:href|src)="(assets\/[^"]+)"/g)) expect(m[1], "a relative asset path").toBe("");
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

  it("uses plain words: no long dashes or curly quotes in what is new on the page", () => {
    const main = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
    expect(main).not.toMatch(/[–—‘’“”]|&mdash;|&ndash;|&rsquo;/);
  });

  it("has markers the server swaps for the pages the emailed link opens", () => {
    for (const name of ["intro", "page"]) {
      expect(HTML).toContain(`<!-- newsletter:${name} -->`);
      expect(HTML).toContain(`<!-- /newsletter:${name} -->`);
    }
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
  it("shows what is missing beside each box, and sends nothing", async () => {
    const { fetch } = start();
    await flush();
    submit();
    await flush();
    expect(posts(fetch)).toHaveLength(0);
    for (const id of ["nlFirstName", "nlEmail"]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.getAttribute("aria-invalid"), id).toBe("true");
      expect(input.closest(".field")?.classList.contains("invalid"), id).toBe(true);
      expect((document.getElementById(`${id}-error`) as HTMLElement).hidden, id).toBe(false);
    }
    expect($("#nlFirstName-error").textContent).toBe("Please enter your first name.");
    expect($("#nlEmail-error").textContent).toBe("Please enter a valid email address.");
    expect(document.activeElement).toBe($("#nlFirstName"));
  });

  it("an address that is not an address is caught before anything is sent", async () => {
    const { fetch } = start();
    type("nlFirstName", "Sam");
    type("nlEmail", "sam at example");
    submit();
    await flush();
    expect(posts(fetch)).toHaveLength(0);
    expect($("#nlEmail").getAttribute("aria-invalid")).toBe("true");
    expect($("#nlFirstName").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("an error goes away as soon as the box is put right", async () => {
    start();
    submit();
    type("nlFirstName", "Sam");
    expect($("#nlFirstName").getAttribute("aria-invalid")).not.toBe("true");
    expect($<HTMLElement>("#nlFirstName-error").hidden).toBe(true);
  });

  it("never uses an alert box", async () => {
    const alert = vi.fn();
    const fetch = vi.fn(async () => answer(200, { siteKey: null }));
    initNewsletterSignup(document, { fetch, alert, setTimeout: (fn: () => void) => fn() });
    submit();
    await flush();
    expect(alert).not.toHaveBeenCalled();
    expect(read("assets/js/newsletter-signup.js")).not.toMatch(/\balert\(/);
  });

  it("sends the first name and email as JSON, then shows Check your email in place of the form", async () => {
    const { fetch } = start();
    type("nlFirstName", " Sam ");
    type("nlEmail", " sam@example.com ");
    submit();
    await flush();
    const sent = posts(fetch);
    expect(sent).toHaveLength(1);
    expect(sent[0][1].method).toBe("POST");
    expect(sent[0][1].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(sent[0][1].body)).toEqual({ firstName: "Sam", email: "sam@example.com", company: "", captchaToken: "" });
    expect($<HTMLElement>("#nlForm").hidden).toBe(true);
    expect($<HTMLElement>("#nlDone").hidden).toBe(false);
    expect(document.activeElement).toBe($("#nlDone"));
  });

  it("the message never repeats the address back, so it is the same for everyone", async () => {
    start();
    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    await flush();
    expect($("#nlDone").textContent).not.toContain("sam@example.com");
  });

  it("a second press while it is sending sends nothing more", async () => {
    let release: (v: unknown) => void = () => undefined;
    const { fetch } = start({ signup: () => new Promise((r) => (release = r)) });
    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    submit();
    await flush();
    expect(posts(fetch)).toHaveLength(1);
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(true);
    release(answer(200, { status: "check_email" }));
    await flush();
    expect($<HTMLElement>("#nlDone").hidden).toBe(false);
  });

  it("shows the server's word on each box when it finds something wrong", async () => {
    start({ signup: async () => answer(400, { error: "Please check the boxes marked below.", fields: { email: "Please enter a valid email address." } }) });
    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    await flush();
    expect($("#nlEmail").getAttribute("aria-invalid")).toBe("true");
    expect($<HTMLElement>("#nlEmail-error").hidden).toBe(false);
    expect($<HTMLElement>("#nlForm").hidden).toBe(false);
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(false);
  });

  it.each([
    [429, { error: "Too many tries. Please wait a few minutes and try again." }, "Too many tries. Please wait a few minutes and try again."],
    [503, { error: "Joining the mailing list is not available just now. Please try again in a little while." }, "Joining the mailing list is not available just now. Please try again in a little while."],
    [500, {}, "Something went wrong and we could not take your details. Please try again in a few minutes."],
    [400, { error: "captcha" }, "The check that you're not a robot did not go through. Please try it again, then press Join our mailing list."],
  ])("says what happened on the page when the server answers %i", async (status, data, words) => {
    start({ signup: async () => answer(status as number, data) });
    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    await flush();
    const said = $<HTMLElement>("#nlStatus");
    expect(said.textContent).toBe(words);
    expect(said.className).toBe("form-status is-error");
    expect($<HTMLElement>("#nlForm").hidden).toBe(false);
    expect($<HTMLButtonElement>("#nlSubmit").disabled).toBe(false);
  });

  it("says so when the request could not be made at all", async () => {
    start({
      signup: async () => {
        throw new Error("offline");
      },
    });
    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    await flush();
    expect($("#nlStatus").textContent).toBe("Something went wrong and we could not take your details. Please try again in a few minutes.");
  });
});

describe("the spam check on the page", () => {
  it("loads nothing from Cloudflare when the check is off", async () => {
    start({ siteKey: null });
    await flush();
    $("#nlFirstName").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("loads Cloudflare's script only once the visitor starts on the form", async () => {
    start({ siteKey: "site-key-1" });
    await flush();
    expect(document.head.querySelector("script")).toBeNull();
    $("#nlFirstName").dispatchEvent(new Event("focusin", { bubbles: true }));
    const script = document.head.querySelector("script") as HTMLScriptElement;
    expect(script.src).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    $("#nlEmail").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
  });

  it("draws the box, sends its pass with the form, and holds the form while there is no pass", async () => {
    const { fetch, win } = start({ siteKey: "site-key-1" });
    await flush();
    $("#nlFirstName").dispatchEvent(new Event("focusin", { bubbles: true }));
    let onPass: (t: string) => void = () => undefined;
    const render = vi.fn((_box: unknown, o: { callback: (t: string) => void; sitekey: string }) => {
      onPass = o.callback;
      return "w1";
    });
    win.turnstile = { render, reset: vi.fn() };
    (win.nbccNewsletterTurnstileReady as () => void)();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][1].sitekey).toBe("site-key-1");
    expect($<HTMLElement>("#nlCaptcha").hidden).toBe(false);

    type("nlFirstName", "Sam");
    type("nlEmail", "sam@example.com");
    submit();
    await flush();
    expect(posts(fetch)).toHaveLength(0);
    expect($("#nlStatus").textContent).toBe("One moment, we're still checking you're not a robot. Please press Join our mailing list again in a few seconds.");

    onPass("pass-1");
    submit();
    await flush();
    expect(JSON.parse(posts(fetch)[0][1].body).captchaToken).toBe("pass-1");
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

  it("the pages the emailed link opens are served before the site's catch all, and the API is mounted", () => {
    const site = read("src/routes/site.ts");
    expect(site).toContain("addNewsletterSignupPageRoutes(router, siteRoot, { decorate: decorateNav });");
    expect(site.indexOf("addNewsletterSignupPageRoutes(router")).toBeLessThan(site.indexOf("for (const rule of rules)"));
    const app = read("src/app.ts");
    expect(app).toContain("app.use(newsletterSignupRouter);");
    expect(app.indexOf("app.use(newsletterSignupRouter);")).toBeLessThan(app.indexOf("app.use(createSiteRouter("));
    expect(app.indexOf("app.use(express.json());")).toBeLessThan(app.indexOf("app.use(newsletterSignupRouter);"));
  });

  it("requests nobody confirms are deleted by the daily task that already runs", () => {
    const daily = read("src/scripts/send-reminders.ts");
    expect(daily).toContain("purgeSignupRequests(new Date())");
  });
});
