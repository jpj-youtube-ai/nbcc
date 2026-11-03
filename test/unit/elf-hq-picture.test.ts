import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: each detective's elf on Detective HQ, as a picture for their own family
// only. It is a PNG stacked from the painted layers (an SVG in an <img> cannot load them), private
// and never cached, and a busy picture maker says "try again in a moment" rather than failing.
// Every family is invented.

const { elfPng } = vi.hoisted(() => ({ elfPng: vi.fn() }));

vi.mock("../../src/db/elf", async (orig) => ({
  ...(await orig<typeof import("../../src/db/elf")>()),
  getElfSettings: async () => ({ schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null }),
  findElfSession: async () => ({ familyId: 3 }),
  familyWithDetectives: async (id: number) =>
    id === 3 ? { id: 3, grownUpName: "Sam Example", email: "sam.example@example.com", detectives: [{ id: 100, firstName: "Ruby", surname: "Tinselfoot", look: null }] } : null,
}));
vi.mock("../../src/elf/elf-png", () => ({ elfPng }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter } from "../../src/routes/elf";
import { ELF_SESSION_COOKIE } from "../../src/elf/session";

type Layer = { route?: { path: string; stack: { handle: (req: unknown, res: unknown, next: () => void) => unknown }[] } };

async function get(file: string) {
  const route = (elfRouter.stack as Layer[]).find((l) => l.route?.path === "/elf/hq/elf/:file")!.route!;
  const out = { status: 200, body: null as unknown, type: "", headers: {} as Record<string, string> };
  const res: Record<string, unknown> = {
    locals: {},
    status(s: number) {
      out.status = s;
      return res;
    },
    type(t: string) {
      out.type = t;
      return res;
    },
    send(b: unknown) {
      out.body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k] = v;
      return res;
    },
  };
  for (const layer of route.stack) {
    let next = false;
    await layer.handle({ headers: { cookie: `${ELF_SESSION_COOKIE}=${"a".repeat(64)}` }, params: { file }, query: {}, body: {} }, res, () => (next = true));
    if (!next) break;
  }
  return out;
}

beforeEach(() => {
  elfPng.mockReset();
  elfPng.mockResolvedValue(Buffer.from("png"));
});

describe("a detective's elf on Detective HQ", () => {
  it("is a PNG of their own elf, private and never cached", async () => {
    const r = await get("100.png");
    expect(r.status).toBe(200);
    expect(r.type).toBe("image/png");
    expect(r.body).toEqual(Buffer.from("png"));
    expect(r.headers["Cache-Control"]).toBe("private, no-store");
    expect(elfPng).toHaveBeenCalledWith(null, expect.anything(), 240, "clear");
  });

  it("is not found for another family's detective, or any other name", async () => {
    expect((await get("101.png")).status).toBe(404);
    expect((await get("100.svg")).status).toBe(404);
    expect((await get("../100.png")).status).toBe(404);
  });

  it("asks the browser to try again in a moment when the picture maker is busy", async () => {
    elfPng.mockResolvedValue(null);
    const r = await get("100.png");
    expect(r.status).toBe(503);
    expect(r.headers["Retry-After"]).toBe("2");
  });
});
