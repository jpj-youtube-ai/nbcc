import { describe, it, expect } from "vitest";
import { giftsWords, paymentsWords, sourceLines, sourceTotalsFrom, BALL_BAGS_NOTE, ELF_PAYMENTS_NOTE, MONTHLY_NOTE, RED_BAG_COUNTED_FROM_NOTE, SLEIGH_NOTE, UNIFORM_NOTE } from "../../src/admin/gift-sources";
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
      ball: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      ballBags: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      invoices: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      elfSchool: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      donatePage: { month: { pence: 213_000, gifts: 64 }, all: { pence: 3_140_000, gifts: 902 } },
      fundraiser: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      cardReader: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      sleigh: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      monthly: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      uniform: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
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
    expect(t.ball.all.gifts).toBe(0);
    expect(t.ballBags.all.gifts).toBe(0);
    expect(t.donatePage.all.gifts).toBe(0);
  });

  it("keeps the Ball's table bags in a bucket of their own, never added into the Festive Ball", () => {
    const t = sourceTotalsFrom([row("ball", [7_500, 3], [12_000, 5]), row("ballBags", [10_000, 2], [15_000, 3])]);
    expect(t.ballBags).toEqual({ month: { pence: 10_000, gifts: 2 }, all: { pence: 15_000, gifts: 3 } });
    expect(t.ball).toEqual({ month: { pence: 7_500, gifts: 3 }, all: { pence: 12_000, gifts: 5 } });
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

  it("adds the Festive Ball's donate page as a third line, after Fill a Red Bag", () => {
    const t = sourceTotalsFrom([row("ball", [7_500, 3], [12_000, 5]), row("donatePage", [500, 1], [500, 1])]);
    expect(t.ball).toEqual({ month: { pence: 7_500, gifts: 3 }, all: { pence: 12_000, gifts: 5 } });
    expect(t.redBag.all.gifts).toBe(0);
    expect(sourceLines(t).map((l) => [l.key, l.name])).toEqual([
      ["redBag", "Fill a Red Bag"],
      ["ball", "Festive Ball"],
      ["ballBags", "Red bags at the Ball"],
      ["invoices", "Invoices"],
      ["elfSchool", "Elf Detective School"],
      ["donatePage", "Donate page"],
      ["fundraiser", "Fundraiser pages"],
      ["cardReader", "Card reader"],
      ["sleigh", "Santa Sleigh"],
      ["monthly", "Monthly gifts"],
      ["uniform", "Uniform"],
    ]);
    expect(sourceLines(t)[1]).toMatchObject({ month: "£75 from 3 gifts", all: "£120 from 5 gifts" });
  });

  it("names the lines exactly, Fill a Red Bag first", () => {
    const lines = sourceLines(sourceTotalsFrom([row("redBag", [41_200, 19], [196_000, 87]), row("donatePage", [213_000, 64], [3_140_000, 902])]));
    expect(lines).toEqual([
      { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
      { key: "ball", name: "Festive Ball", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "ballBags", name: "Red bags at the Ball", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "invoices", name: "Invoices", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "elfSchool", name: "Elf Detective School", month: "£0 from 0 payments", all: "£0 from 0 payments" },
      { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
      { key: "fundraiser", name: "Fundraiser pages", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "cardReader", name: "Card reader", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "sleigh", name: "Santa Sleigh", month: "£0 from 0 gifts", all: "£0 from 0 gifts" },
      { key: "monthly", name: "Monthly gifts", month: "£0 from 0 payments", all: "£0 from 0 payments" },
      { key: "uniform", name: "Uniform", month: "£0 from 0 payments", all: "£0 from 0 payments" },
    ]);
  });

  it("counts gifts that paid an invoice on their own line, after the Ball's table bags", () => {
    const t = sourceTotalsFrom([row("invoices", [50_000, 2], [75_000, 3])]);
    expect(t.invoices).toEqual({ month: { pence: 50_000, gifts: 2 }, all: { pence: 75_000, gifts: 3 } });
    expect(sourceLines(t)[3]).toEqual({ key: "invoices", name: "Invoices", month: "£500 from 2 gifts", all: "£750 from 3 gifts" });
  });

  it("counts the Elf Detective School's payments on their own line, as payments, before the Donate page", () => {
    const t = sourceTotalsFrom([row("elfSchool", [148_600, 128], [148_600, 128])]);
    expect(t.elfSchool).toEqual({ month: { pence: 148_600, gifts: 128 }, all: { pence: 148_600, gifts: 128 } });
    expect(sourceLines(t)[4]).toEqual({ key: "elfSchool", name: "Elf Detective School", month: "£1,486 from 128 payments", all: "£1,486 from 128 payments" });
    expect(paymentsWords({ pence: 500, gifts: 1 })).toBe("£5 from 1 payment");
    expect(ELF_PAYMENTS_NOTE).toBe("Elf Detective School payments are entries to take part, with any gift on top. Entries are never claimed for Gift Aid.");
    expect(ELF_PAYMENTS_NOTE).not.toMatch(/[–—-]/);
  });

  it("counts every monthly payment on a line of its own, last, as payments, and says they are in their place's figures too", () => {
    const t = sourceTotalsFrom([row("monthly", [12_000, 8], [96_000, 64])]);
    expect(t.monthly).toEqual({ month: { pence: 12_000, gifts: 8 }, all: { pence: 96_000, gifts: 64 } });
    expect(sourceLines(t)[9]).toEqual({ key: "monthly", name: "Monthly gifts", month: "£120 from 8 payments", all: "£960 from 64 payments" });
    expect(MONTHLY_NOTE).toBe("Monthly gifts are every monthly payment, wherever it was set up, so each is in its place's figures too.");
    expect(MONTHLY_NOTE).not.toMatch(/[–—]/);
  });

  it("counts card reader gifts and fundraiser page gifts on lines of their own, after the Donate page", () => {
    const t = sourceTotalsFrom([row("cardReader", [17_744_20, 27], [17_744_20, 27]), row("fundraiser", [5_000, 2], [60_000, 30])]);
    expect(t.cardReader).toEqual({ month: { pence: 17_744_20, gifts: 27 }, all: { pence: 17_744_20, gifts: 27 } });
    expect(sourceLines(t)[6]).toEqual({ key: "fundraiser", name: "Fundraiser pages", month: "£50 from 2 gifts", all: "£600 from 30 gifts" });
    expect(sourceLines(t)[7]).toEqual({ key: "cardReader", name: "Card reader", month: "£17,744 from 27 gifts", all: "£17,744 from 27 gifts" });
  });

  it("counts uniform payments on a line of their own, last of all, as payments, and says they are not donations", () => {
    const t = sourceTotalsFrom([row("uniform", [8_000, 2], [24_000, 6])]);
    expect(t.uniform).toEqual({ month: { pence: 8_000, gifts: 2 }, all: { pence: 24_000, gifts: 6 } });
    expect(sourceLines(t)[10]).toEqual({ key: "uniform", name: "Uniform", month: "£80 from 2 payments", all: "£240 from 6 payments" });
    expect(t.donatePage.all.gifts).toBe(0);
    expect(UNIFORM_NOTE).toBe("Uniform is payments for school uniforms. They are not donations, so they are in no other figure.");
    expect(UNIFORM_NOTE).not.toMatch(/[–—]/);
  });

  it("counts the Santa Sleigh on a line of its own, straight after the card reader, and says bucket cash is not in it", () => {
    const t = sourceTotalsFrom([row("sleigh", [12_500, 9], [12_500, 9]), row("cardReader", [3_000, 2], [3_000, 2])]);
    expect(t.sleigh).toEqual({ month: { pence: 12_500, gifts: 9 }, all: { pence: 12_500, gifts: 9 } });
    expect(sourceLines(t)[8]).toEqual({ key: "sleigh", name: "Santa Sleigh", month: "£125 from 9 gifts", all: "£125 from 9 gifts" });
    expect(sourceLines(t)[7]).toMatchObject({ key: "cardReader", month: "£30 from 2 gifts" });
    expect(SLEIGH_NOTE).toBe("Santa Sleigh is gifts on the sleigh page and card machine taps on sleigh nights. Bucket cash is in the Santa Sleigh section only.");
    expect(SLEIGH_NOTE).not.toMatch(/[–—-]/);
  });

  it("words the table bags line from its own figures, and explains where they come from", () => {
    const t = sourceTotalsFrom([row("ball", [7_500, 3], [12_000, 5]), row("ballBags", [10_000, 2], [15_000, 3])]);
    expect(sourceLines(t)[2]).toEqual({ key: "ballBags", name: "Red bags at the Ball", month: "£100 from 2 gifts", all: "£150 from 3 gifts" });
    expect(sourceLines(t)[1]).toMatchObject({ month: "£75 from 3 gifts", all: "£120 from 5 gifts" });
    expect(BALL_BAGS_NOTE).toBe("Red bags at the Ball are gifts from the table cards at the Festive Ball.");
    expect(BALL_BAGS_NOTE).not.toMatch(/[–—]/);
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
      // The headline's figure apart from its words, for the Overview's tile (2026-11-12, splitHeadline).
      figure: "£412",
      rest: "from 19 gifts this month",
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
