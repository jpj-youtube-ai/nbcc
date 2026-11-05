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
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter } from "../../src/routes/elf";

type Layer = { route?: { path: string; stack: { handle: (req: unknown, res: unknown, next: () => void) => unknown }[] } };

async function get(path: string, cookie?: string) {
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
    await layer.handle({ headers: cookie ? { cookie } : {}, body: {}, query: {}, params: {} }, res, () => (next = true));
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

  it("is not found without the code, or with a wrong one", async () => {
    expect((await get("/elf")).status).toBe(404);
    expect((await get("/elf", `nbcc_elf_preview=${"d".repeat(64)}`)).status).toBe(404);
  });
});
