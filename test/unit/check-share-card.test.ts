import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { checkNames, FRAME_INSIDE, inkRight, main, measureName, nameLineSvg, NAMES_TO_CHECK } from "../../src/scripts/check-share-card";
import { cleanFirstName, detectiveName, FESTIVE_SURNAMES } from "../../src/elf/names";
import { shareCardSvg } from "../../src/elf/print";

// NBCC Elf Detective School, Plan 2c-2, Task 6's fix round: the script pr.yml's image job runs inside the built image
// (node dist/scripts/check-share-card.js) to prove a share card's name ends clear of the card's red frame in the fonts
// the server has. Here: the names it draws, how it decides (with made up measurements, so a name past the frame is
// seen to fail), how it measures, and one real run with this machine's fonts. Every name is invented.

describe("the names the check draws", () => {
  it("are a short name with wide letters, a long ticked name, and the longest the name rules allow", () => {
    expect(NAMES_TO_CHECK.map(detectiveName)).toEqual([
      "Detective W. Snowpaw",
      "Detective Ruby Merrymittens",
      "Detective Maximiliano-Wolfgang Merrymittens",
    ]);
  });

  it("include the longest name the rules allow: a first name of 20 characters that passes them, and the longest surname", () => {
    const longest = NAMES_TO_CHECK[2];
    expect(cleanFirstName(longest.firstName)).toEqual({ ok: true, name: longest.firstName });
    expect([...longest.firstName].length).toBe(20);
    expect(cleanFirstName(`${longest.firstName}x`)).toEqual({ ok: false, reason: "too-long" });
    expect(longest.surname.length).toBe(Math.max(...FESTIVE_SURNAMES.map((s) => s.length)));
    expect(detectiveName(longest).length).toBe(43);
  });
});

describe("deciding whether every name ends clear of the frame", () => {
  const endsAt = (right: number) => async () => right;

  it("passes names whose ink ends inside the frame", async () => {
    const r = await checkNames(endsAt(FRAME_INSIDE - 1));
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => [l.right, l.clear])).toEqual([
      [1172, true],
      [1172, true],
      [1172, true],
    ]);
  });

  it("refuses a name whose ink ends on the frame's inside edge, or past it", async () => {
    expect(FRAME_INSIDE).toBe(1173);
    expect((await checkNames(endsAt(FRAME_INSIDE))).ok).toBe(false);
    expect((await checkNames(endsAt(1199))).ok).toBe(false);
  });

  it("refuses when any one name ends past the frame, and says which", async () => {
    let n = 0;
    const r = await checkNames(async () => (++n === 2 ? 1180 : 1100));
    expect(r.ok).toBe(false);
    expect(r.lines.filter((l) => !l.clear).map((l) => l.name)).toEqual(["Detective Ruby Merrymittens"]);
  });

  it("refuses a name with no ink at all, as a card drawn with no font would have", async () => {
    expect((await checkNames(endsAt(0))).ok).toBe(false);
    expect((await checkNames(endsAt(Number.NaN))).ok).toBe(false);
  });

  it("measures each name's whole card from the real shareCardSvg, with the size the card sets it at", async () => {
    const cards: string[] = [];
    const r = await checkNames(async (card) => {
      cards.push(card);
      return 1000;
    });
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain(">Detective W. Snowpaw</text>");
    expect(r.lines.map((l) => l.size)).toEqual([48, 35, 24]);
  });
});

describe("measuring where a name's ink ends", () => {
  it("finds one past the rightmost column with anything drawn in it, and 0 with nothing", () => {
    const width = 10;
    const height = 2;
    const pixels = Buffer.alloc(width * height * 4);
    expect(inkRight(pixels, width, height)).toBe(0);
    pixels[(1 * width + 6) * 4 + 3] = 255;
    expect(inkRight(pixels, width, height)).toBe(7);
    // The faintest touch counts: a name that only just reaches the frame has reached it.
    pixels[(0 * width + 8) * 4 + 3] = 1;
    expect(inkRight(pixels, width, height)).toBe(9);
  });

  it("takes the name's line alone from a card, with none of its other words or pictures, at the card's size", () => {
    const card = shareCardSvg({ detective: { firstName: "Ruby", surname: "Tinselfoot", approved: true }, rank: "Graduate", doorsDone: 24, year: 2026 }, "");
    const line = nameLineSvg(card) ?? "";
    expect(line).toContain(">Detective Ruby Tinselfoot</text>");
    expect(line).not.toMatch(/Graduate<|Class of|doors done|<image|<rect/);
    expect(line).toMatch(/^<svg [^>]*width="1200" height="630"/);
    expect(nameLineSvg("<svg></svg>")).toBeNull();
  });

  // With this machine's fonts: Georgia on Windows, DejaVu where it is the font there is (the image, and CI's runners).
  it("draws each name with the real sharp, finds its ink, and every one ends clear of the frame", async () => {
    const r = await checkNames(measureName);
    for (const l of r.lines) expect(l.right, l.name).toBeGreaterThan(700);
    expect(r.ok).toBe(true);
  }, 30_000);
});

describe("running it", () => {
  it("draws the two cards for people and the three it checks into the folder it is given, and answers 0 when every name fits", async () => {
    const folder = mkdtempSync(join(tmpdir(), "share-cards-"));
    const said = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await main(folder)).toBe(0);
      const files = readdirSync(folder).sort();
      expect(files).toEqual([
        "check-1-detective-w-snowpaw.png",
        "check-2-detective-ruby-merrymittens.png",
        "check-3-detective-maximiliano-wolfgang-merrymittens.png",
        "share-card-leo-unticked-name.png",
        "share-card-ruby.png",
      ]);
      for (const file of files) {
        const meta = await sharp(join(folder, file)).metadata();
        expect([meta.format, meta.width, meta.height], file).toEqual(["png", 1200, 630]);
      }
      expect(said.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/Detective W\. Snowpaw: 48px, ends at x \d+/);
    } finally {
      said.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);

  it("answers 1, saying so, when a name runs onto the frame", async () => {
    const said = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const told = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await main(undefined, async () => FRAME_INSIDE + 5)).toBe(1);
      expect(told.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/runs onto or past the red frame/);
    } finally {
      said.mockRestore();
      told.mockRestore();
    }
  });
});
