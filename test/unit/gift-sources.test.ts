import { describe, it, expect } from "vitest";
import { giftsWords, sourceLines, sourceTotalsFrom, RED_BAG_COUNTED_FROM_NOTE } from "../../src/admin/gift-sources";
import { numbersLines } from "../../src/admin/overview-numbers";

// Fill a Red Bag against the Donate page: the pure rules that turn the one grouped read into the
// two buckets, and the words staff see. Every figure here is invented.

const row = (bucket: string, month: [number, number], all: [number, number]) => ({
  bucket,
  // Postgres hands SUM and COUNT back as strings.
  month_pence: String(month[0]),
  month_gifts: String(month[1]),
  all_pence: String(all[0]),
  all_gifts: String(all[1]),
});

describe("the two buckets", () => {
  it("reads each bucket's month and all time figures as numbers", () => {
    const t = sourceTotalsFrom([row("redBag", [41_200, 19], [196_000, 87]), row("donatePage", [213_000, 64], [3_140_000, 902])]);
    expect(t).toEqual({
      redBag: { month: { pence: 41_200, gifts: 19 }, all: { pence: 196_000, gifts: 87 } },
      donatePage: { month: { pence: 213_000, gifts: 64 }, all: { pence: 3_140_000, gifts: 902 } },
    });
  });

  it("gives a bucket with no gifts a real zero, not a gap", () => {
    const t = sourceTotalsFrom([row("donatePage", [500, 1], [500, 1])]);
    expect(t.redBag).toEqual({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
    expect(sourceTotalsFrom([]).donatePage).toEqual({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
  });

  it("ignores a bucket it does not know", () => {
    const t = sourceTotalsFrom([row("something_else", [900, 9], [900, 9])]);
    expect(t.redBag.all.gifts).toBe(0);
    expect(t.donatePage.all.gifts).toBe(0);
  });
});

describe("the words", () => {
  it("says money in whole pounds with commas, as the Overview does, and counts the gifts", () => {
    expect(giftsWords({ pence: 41_200, gifts: 19 })).toBe("£412 from 19 gifts");
    expect(giftsWords({ pence: 3_140_000, gifts: 902 })).toBe("£31,400 from 902 gifts");
  });

  it("says 1 gift, not 1 gifts", () => {
    expect(giftsWords({ pence: 2_500, gifts: 1 })).toBe("£25 from 1 gift");
  });

  it("says a real zero plainly", () => {
    expect(giftsWords({ pence: 0, gifts: 0 })).toBe("£0 from 0 gifts");
  });

  it("names the two lines exactly, Fill a Red Bag first", () => {
    const lines = sourceLines(sourceTotalsFrom([row("redBag", [41_200, 19], [196_000, 87]), row("donatePage", [213_000, 64], [3_140_000, 902])]));
    expect(lines).toEqual([
      { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
      { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
    ]);
  });

  it("says when counting began, with no dashes", () => {
    expect(RED_BAG_COUNTED_FROM_NOTE).toBe("Fill a Red Bag gifts are counted from 5 October 2026.");
    expect(RED_BAG_COUNTED_FROM_NOTE).not.toMatch(/[–—]/);
  });
});

describe("the Overview's line", () => {
  const month = (pence: number, gifts: number) => ({ pence, gifts });

  it("says what Fill a Red Bag brought in this month, with the Donate page beside it", () => {
    const [line] = numbersLines({ redBag: { redBag: month(41_200, 19), donatePage: month(213_000, 64) } });
    expect(line).toEqual({
      key: "redBag",
      title: "Fill a Red Bag",
      headline: "£412 from 19 gifts this month",
      detail: "Donate page: £2,130 from 64 gifts this month.",
      view: "donations",
      button: "Donations",
    });
  });

  it("shows a real zero rather than leaving the line out", () => {
    const [line] = numbersLines({ redBag: { redBag: month(0, 0), donatePage: month(0, 0) } });
    expect(line.headline).toBe("£0 from 0 gifts this month");
  });

  it("sits straight after Money in", () => {
    const lines = numbersLines({
      money: { donations: { now: 100, before: 0 } },
      redBag: { redBag: month(100, 1), donatePage: month(0, 0) },
      monthly: { giving: 1, monthlyPence: 1000, joined: 0, stopped: 0 },
    });
    expect(lines.map((l) => l.key)).toEqual(["money", "redBag", "monthly"]);
  });

  it("is left out when it was not read", () => {
    expect(numbersLines({ monthly: { giving: 1, monthlyPence: 1000, joined: 0, stopped: 0 } }).map((l) => l.key)).toEqual(["monthly"]);
  });
});
