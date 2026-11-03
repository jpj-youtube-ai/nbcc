import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
// @ts-expect-error a plain JavaScript tool, with no type declarations
import { BUDGET_USD, costOf, paint, spent } from "../../scripts/elf-paint/openai.mjs";

// NBCC Elf Detective School: the painted dress-up elf (docs/superpowers/plans/2026-11-03-elf-painted-wardrobe.md,
// Task 1). The one place the painting tool talks to OpenAI: what it asks for, what each painting
// costs, and the guard that stops it before Jaimie's £15. It never runs on the site or in CI; these
// tests use a pretend OpenAI and never the network.

const USAGE = { input_tokens_details: { image_tokens: 1536, text_tokens: 70 }, output_tokens_details: { image_tokens: 158 } };

let dir: string;
let ledger: string;
let job: { prompt: string; images: string[]; out: string };

/** A pretend OpenAI that keeps what it was sent and answers with a tiny picture. */
function pretend(status = 200) {
  const seen: FormData[] = [];
  const fake = vi.fn(async (_url: string, init: { body: FormData; headers: Record<string, string> }) => {
    seen.push(init.body);
    if (status !== 200) return new Response(JSON.stringify({ error: { message: "nope" } }), { status });
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#E000E0" } }).png().toBuffer();
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: USAGE }), { status: 200 });
  });
  return { fake, seen };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "elf-paint-"));
  ledger = join(dir, "spend.json");
  const image = join(dir, "master.png");
  writeFileSync(image, await sharp({ create: { width: 4, height: 4, channels: 4, background: "#FF00FF" } }).png().toBuffer());
  writeFileSync(join(dir, "prompt.txt"), "Paint a hat.");
  job = { prompt: "Paint a hat.", images: [image], out: join(dir, "out.png") };
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("what a painting costs", () => {
  it("is priced from the tokens OpenAI reports, at gpt-image-2's rates", () => {
    // 1536 x $8 + 70 x $5 + 158 x $30, all per million.
    expect(costOf(USAGE, "gpt-image-2")).toBeCloseTo(0.01738, 4);
  });

  it("stops at about £15", () => {
    expect(BUDGET_USD).toBe(19);
  });
});

describe("asking for a painting", () => {
  it("asks for gpt-image-2 at low quality on the 1024 by 1536 canvas by default", async () => {
    const { fake, seen } = pretend();
    await paint(job, { fetch: fake, ledger });
    expect(seen[0].get("model")).toBe("gpt-image-2");
    expect(seen[0].get("quality")).toBe("low");
    expect(seen[0].get("size")).toBe("1024x1536");
    expect(existsSync(job.out)).toBe(true);
  });

  it("can ask for high quality for one painting", async () => {
    const { fake, seen } = pretend();
    await paint({ ...job, quality: "high" }, { fetch: fake, ledger });
    expect(seen[0].get("quality")).toBe("high");
  });

  it("counts a painting OpenAI gives no cost for as a high quality one, so the budget never under counts", async () => {
    const fake = vi.fn(async () => {
      const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#E000E0" } }).png().toBuffer();
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 });
    });
    await paint(job, { fetch: fake, ledger });
    expect(spent(ledger)).toBeGreaterThanOrEqual(0.2);
  });

  it("writes what each painting cost to the ledger", async () => {
    const { fake } = pretend();
    await paint(job, { fetch: fake, ledger });
    await paint(job, { fetch: fake, ledger });
    expect(spent(ledger)).toBeCloseTo(2 * costOf(USAGE, "gpt-image-2"), 6);
  });
});

describe("the guards", () => {
  it("refuses to paint once the ledger has passed the budget, without asking OpenAI", async () => {
    writeFileSync(ledger, JSON.stringify([{ at: "2026-11-04T09:00:00Z", out: "x.png", usd: 19.01 }]));
    const { fake } = pretend();
    await expect(paint(job, { fetch: fake, ledger })).rejects.toThrow(/budget/i);
    expect(fake).not.toHaveBeenCalled();
  });

  it("refuses with no key, without asking OpenAI", async () => {
    delete process.env.OPENAI_API_KEY;
    const { fake } = pretend();
    await expect(paint(job, { fetch: fake, ledger })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fake).not.toHaveBeenCalled();
  });

  it("never puts the key in an error, even when OpenAI refuses", async () => {
    const { fake } = pretend(400);
    const err = await paint(job, { fetch: fake, ledger }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain("sk-test");
    expect(existsSync(ledger) ? readFileSync(ledger, "utf8") : "").not.toContain("sk-test");
  });
});
