import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dressPage, siteFooter, siteHeader } from "../../src/site/chrome";

// src/site/chrome.ts (TASK-615): the one place a page built in code takes the site's banner, menu
// bar and footer from, and the extras every page gains as it goes out. test/unit/site-chrome-everywhere
// .test.ts checks every page wears them; this checks the module itself. Every address is invented.

const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const HERE = ' class="active" aria-current="page"';
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the banner and menu bar", () => {
  const header = siteHeader();

  it("is the home page's own, taken from the page itself rather than copied", () => {
    expect(header.startsWith('<header class="nav" id="nav" data-region="nav">')).toBe(true);
    expect(header.endsWith("</header>")).toBe(true);
    expect(read("index.html").replace(HERE, "")).toContain(header);
  });

  it("marks no page as the one you are on", () => {
    expect(header).not.toContain("aria-current");
    expect(header).not.toContain('class="active"');
    expect(header).toContain('<a href="/">Home</a>');
  });

  it("keeps the logo, the menu, the Donate button and the burger", () => {
    expect(header).toContain('<a class="brand" href="/">');
    for (const href of ["/", "/about-us", "/donate", "/contact", "/supporters"]) expect(header).toContain(`<li><a href="${href}">`);
    expect(header).toContain('<a class="nav-cta" href="/donate">Donate</a>');
    expect(header).toMatch(/<button class="burger" id="burger"[^>]*aria-controls="navLinks"/);
  });

  it("sends the Donate button to a page's own give form only when asked, and changes nothing else", () => {
    const sleigh = siteHeader({ donateHref: "#give" });
    expect(sleigh).toContain('<a class="nav-cta" href="#give">Donate</a>');
    expect(sleigh.replace('href="#give"', 'href="/donate"')).toBe(header);
  });

  it("never lets the address it is given out of its attribute", () => {
    const odd = siteHeader({ donateHref: '/x"><script>alert(1)</script>' });
    expect(odd).not.toContain("<script>");
    expect(odd).toContain('href="/x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it("has the line endings of a page built in code, whatever the checkout", () => {
    expect(header).not.toContain("\r");
  });
});

describe("the footer", () => {
  it("is the master footer, word for word", () => {
    expect(squash(siteFooter())).toBe(squash(read("partials/footer.html")));
    expect(siteFooter()).not.toContain("\r");
  });
});

describe("a page as it goes out", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gains what the site adds, read with the visitor's cookie", async () => {
    const seen: (string | undefined)[] = [];
    const out = await dressPage("<p>page</p>", "nbcc_x=1", async (html, cookie) => {
      seen.push(cookie);
      return html.replace("page", "page, dressed");
    });
    expect(out).toBe("<p>page, dressed</p>");
    expect(seen).toEqual(["nbcc_x=1"]);
  });

  it("goes out as it is when the extras cannot be read, and says why in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await dressPage("<p>page</p>", undefined, async () => {
      throw new Error("database down");
    });
    expect(out).toBe("<p>page</p>");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0].join(" "))).toContain("database down");
  });

  it("never waits more than a second and a half for them", async () => {
    vi.useFakeTimers();
    let settled = false;
    const out = dressPage("<p>page</p>", undefined, () => new Promise<string>(() => undefined)).then((html) => {
      settled = true;
      return html;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await out).toBe("<p>page</p>");
  });
});

describe("a home page that cannot be read", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("leaves the banner and the footer out rather than taking a page down, and says so", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (orig) => {
      const real = await orig<typeof import("node:fs")>();
      return {
        ...real,
        readFileSync: ((path: unknown, ...rest: unknown[]) => {
          if (String(path).endsWith("index.html")) throw new Error("no such file");
          return (real.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
        }) as typeof real.readFileSync,
      };
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fresh = await import("../../src/site/chrome");
    expect(fresh.siteHeader()).toBe("");
    expect(fresh.siteFooter()).toBe("");
    expect(log).toHaveBeenCalled();
  });
});
