import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

// NBCC Elf Detective School: the private preview link (Jaimie, 3 November 2026). With the school
// switched off, a browser holding the link's code sees the real pages, each marked as a preview,
// never listed and never cached where someone else could be handed it.

const TOKEN = "c".repeat(64);
const HASH = createHash("sha256").update(`elf:${TOKEN}`).digest("hex");

vi.mock("../../src/db/elf", async (orig) => ({
  ...(await orig<typeof import("../../src/db/elf")>()),
  getElfSettings: async () => ({ schoolOn: false, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: HASH }),
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
// What every page of the site gains in its banner and footer as it goes out (src/routes/site.ts):
// here it leaves a mark, and notes the cookie it was handed.
const dressed = vi.hoisted(() => ({ cookies: [] as (string | undefined)[] }));
vi.mock("../../src/routes/site", () => ({
  decorateSitePage: async (html: string, cookie: string | undefined) => {
    dressed.cookies.push(cookie);
    return html.replace("</footer>", "<!-- dressed --></footer>");
  },
}));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
// A page that will not draw, when a test asks for one (TASK-615: the route answers 500, never a
// promise left to reject).
const drawing = vi.hoisted(() => {
  const state = { fail: false };
  const breakable =
    <A extends unknown[]>(draw: (...a: A) => string) =>
    (...a: A): string => {
      if (state.fail) throw new Error("a page that will not draw");
      return draw(...a);
    };
  return { state, breakable };
});
vi.mock("../../src/elf/pages/rules", async (orig) => {
  const real = await orig<typeof import("../../src/elf/pages/rules")>();
  return { ...real, renderRulesPage: drawing.breakable(real.renderRulesPage) };
});
vi.mock("../../src/elf/pages/sign-in", async (orig) => {
  const real = await orig<typeof import("../../src/elf/pages/sign-in")>();
  return { ...real, renderSignInPage: drawing.breakable(real.renderSignInPage), renderWelcomePage: drawing.breakable(real.renderWelcomePage) };
});
vi.mock("../../src/elf/pages/join", async (orig) => {
  const real = await orig<typeof import("../../src/elf/pages/join")>();
  return { ...real, renderJoinPage: drawing.breakable(real.renderJoinPage) };
});
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter } from "../../src/routes/elf";

type Layer = { route?: { path: string; stack: { handle: (req: unknown, res: unknown, next: () => void) => unknown }[] } };

async function get(path: string, cookie?: string, body: Record<string, unknown> = {}) {
  const route = (elfRouter.stack as Layer[]).find((l) => l.route?.path === path)!.route!;
  const out = { status: 200, body: "", headers: {} as Record<string, string> };
  const res: Record<string, unknown> = {
    locals: {},
    status(s: number) {
      out.status = s;
      return res;
    },
    type() {
      return res;
    },
    send(b: string) {
      out.body = b;
      return res;
    },
    json() {
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k] = v;
      return res;
    },
    cookie() {
      return res;
    },
    redirect(s: number) {
      out.status = s;
      return res;
    },
  };
  for (const layer of route.stack) {
    let next = false;
    await layer.handle({ headers: cookie ? { cookie } : {}, body, query: {}, params: {} }, res, () => (next = true));
    if (!next) break;
  }
  return out;
}

describe("the private preview", () => {
  it("shows the calendar to a browser with the code, marked as a private preview, private and unlisted", async () => {
    const r = await get("/elf", `nbcc_elf_preview=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('class="elf-preview-strip"');
    expect(r.body.indexOf("elf-preview-strip")).toBeLessThan(r.body.indexOf("<main"));
    expect(r.headers["Cache-Control"]).toBe("private, no-store");
    expect(r.headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  // TASK-615: the page wears the site's banner, with Elf Detective School's own strip under it. The
  // preview's notice is a word to staff about the whole page, so it goes straight under the banner.
  it("says so straight under the site's banner, above Elf Detective School's strip", async () => {
    const r = await get("/elf/rules", `nbcc_elf_preview=${TOKEN}`);
    expect(r.status).toBe(200);
    const banner = r.body.indexOf("</header>");
    const notice = r.body.indexOf('<p class="elf-preview-strip"');
    const strip = r.body.indexOf('<nav class="elf-bar"');
    expect(banner).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(banner);
    expect(strip).toBeGreaterThan(notice);
    expect(r.body.slice(banner + "</header>".length, notice).trim()).toBe("");
  });

  // TASK-615: an Elf Detective School page goes out with what every page of the site gains in its
  // banner and footer, read with the visitor's cookie, as the site's own pages do.
  it("goes out with what every page of the site gains as it goes out", async () => {
    dressed.cookies.length = 0;
    const cookie = `nbcc_elf_preview=${TOKEN}`;
    for (const path of ["/elf", "/elf/rules", "/elf/join", "/elf/sign-in"]) {
      const r = await get(path, cookie);
      expect(r.status, path).toBe(200);
      expect(r.body, path).toContain("<!-- dressed --></footer>");
    }
    expect(dressed.cookies).toEqual([cookie, cookie, cookie, cookie]);
  });

  // TASK-615: these pages now wait for the menu's extras before they go out, so a page that fails to
  // draw must still be an answer: a plain 500, never cached, rather than a rejected promise that
  // would take the whole server down.
  it("answers 500, never a promise left to reject, when a page will not draw", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    drawing.state.fail = true;
    try {
      for (const path of ["/elf/rules", "/elf/sign-in", "/elf/join", "/elf/welcome"]) {
        const r = await get(path, `nbcc_elf_preview=${TOKEN}`);
        expect(r.status, path).toBe(500);
        expect(r.body, path).toBe("Something went wrong just now. Please try again in a few minutes.");
        expect(r.headers["Cache-Control"], path).toBe("no-store");
      }
      expect(logged).toHaveBeenCalledTimes(4);
    } finally {
      drawing.state.fail = false;
      logged.mockRestore();
    }
  });

  it("is not found without the code, or with a wrong one", async () => {
    expect((await get("/elf")).status).toBe(404);
    expect((await get("/elf", `nbcc_elf_preview=${"d".repeat(64)}`)).status).toBe(404);
  });

  // TASK-613: the preview's sign up asks for a mobile number like every other way of enrolling.
  it("refuses a sign up through the preview without a mobile number, in the form's own words", async () => {
    const form = { grownUpName: "Sam Example", email: "sam@example.com", "detective-1-first": "Ivy", "detective-1-surname": "Snowsleuth", entry: "5", agreed: "on" };
    const r = await get("/api/elf/join", `nbcc_elf_preview=${TOKEN}`, form);
    expect(r.status).toBe(400);
    expect(r.body).toContain("<li>Please type a UK mobile number, like 07700 900 123.</li>");
    expect(r.body).toContain('class="elf-preview-strip"');
  });
});
