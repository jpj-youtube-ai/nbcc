import { describe, it, expect } from "vitest";
import { preflightNewsletter, hasBlockingFindings } from "../../src/newsletter/preflight";
import type { NewsletterDoc, BlockType } from "../../src/newsletter/blocks";

// The checks before sending, for the paper look blocks (14 November 2026), and the two warnings every
// newsletter now gets: an email that Gmail may cut short, and words left in [square brackets].
// The checks for the classic blocks are pinned in newsletter-preflight.test.ts and do not change.

const LINK = "https://example.com/go";
const PIC = "https://example.com/p.jpg";
const ctx = (over: Partial<{ subject: string; testSent: boolean; today: string }> = {}) => ({
  subject: "A subject",
  testSent: true,
  ...over,
});
const doc = (...blocks: [BlockType, number, Record<string, unknown>][]): NewsletterDoc => ({
  blocks: blocks.map(([type, variant, data]) => ({ type, variant, data, size: 0 })),
});
const check = (d: NewsletterDoc, over = {}) => preflightNewsletter(d, ctx(over));
const messages = (d: NewsletterDoc, over = {}) => check(d, over).map((f) => `${f.level}: ${f.message}`);

describe("a well-filled paper look newsletter has nothing to say", () => {
  it("raises nothing", () => {
    const d = doc(
      ["hero", 0, { imageUrl: PIC, alt: "The Workshop", headline: "A Red Bag for every child" }],
      ["photoRow", 0, { items: [{ url: PIC, alt: "One" }, { url: PIC, alt: "Two" }] }],
      ["note", 0, { text: "Thank you." }],
      ["eventCard", 0, { name: "Packing night", date: "2026-12-12", href: LINK, imageUrl: PIC, alt: "The hall" }],
      ["logoStrip", 0, { items: [{ url: PIC, name: "A partner" }] }],
      ["giftTags", 0, { items: [{ title: "Fill a bag", href: LINK }] }],
      ["bagList", 2, { title: "A bag", items: [{ name: "Pyjamas" }], footnote: "These show what gifts could do.", href: LINK }],
      ["trim", 0, {}],
      ["paperStory", 0, { imageUrl: PIC, alt: "Volunteers", title: "A story", href: LINK }],
    );
    expect(check(d, { today: "2026-11-14" })).toEqual([]);
  });
});

describe("pictures with no description", () => {
  it("counts the paper look blocks' pictures with the classic image block's", () => {
    const d = doc(
      ["image", 0, { url: PIC, alt: "" }],
      ["hero", 0, { imageUrl: PIC, headline: "Hi" }],
      ["photoRow", 0, { items: [{ url: PIC, alt: "" }, { url: PIC, alt: "Fine" }] }],
      ["eventCard", 3, { items: [{ name: "A", imageUrl: PIC, href: LINK }] }],
      ["paperStory", 1, { imageUrl: PIC, title: "A story" }],
    );
    expect(messages(d)).toContain(
      "warn: 5 images have no description. Many inboxes block images by default, so those readers see nothing there.",
    );
  });

  it("does not count a picture a style does not show, or a story with no photo", () => {
    expect(messages(doc(["paperStory", 3, { imageUrl: PIC, title: "A story" }]))).toEqual([]);
    expect(messages(doc(["hero", 0, { headline: "Words only" }]))).toEqual([]);
  });
});

describe("each paper look block's own checks", () => {
  it("warns about a picture header with no headline", () => {
    expect(messages(doc(["hero", 0, { imageUrl: PIC, alt: "A" }]))).toContain(
      "warn: A picture header has no headline. The headline is what readers see first, even with pictures off.",
    );
  });

  it("warns about a photo row with fewer than two photos", () => {
    expect(messages(doc(["photoRow", 0, { items: [{ url: PIC, alt: "One" }] }]))).toContain(
      "warn: A photo row has fewer than two photos.",
    );
  });

  it("warns about an empty handwritten note", () => {
    expect(messages(doc(["note", 0, { text: "  ", from: "Somebody" }]))).toContain("warn: A handwritten note is empty.");
  });

  it("blocks an event card with no working link, counted with the other buttons", () => {
    const d = doc(["eventCard", 0, { name: "A", href: "" }], ["button", 0, { label: "Go", href: "" }]);
    expect(messages(d)).toContain("block: 2 buttons have no working link — they will go nowhere.");
    expect(hasBlockingFindings(check(doc(["eventCard", 1, { name: "A", href: "nbcc.scot" }])))).toBe(true);
    // Two cards: each card's own link.
    expect(hasBlockingFindings(check(doc(["eventCard", 3, { items: [{ name: "A", href: LINK }, { name: "B", href: "" }] }])))).toBe(true);
  });

  it("warns about an event that has already happened, given today's date", () => {
    const d = doc(["eventCard", 0, { name: "A", date: "2026-11-01", href: LINK }]);
    expect(messages(d, { today: "2026-11-14" })).toContain("warn: An event card is for a date that has already passed.");
    expect(messages(d)).toEqual([]); // without today, no clock is assumed
    expect(messages(doc(["eventCard", 0, { name: "A", date: "2026-11-14", href: LINK }]), { today: "2026-11-14" })).toEqual([]);
  });

  it("blocks a partner logo with no name, and warns when the names are switched off", () => {
    expect(messages(doc(["logoStrip", 0, { items: [{ url: PIC, name: "" }] }]))).toContain(
      "block: A partner logo has no name. Readers with pictures off, and the plain-text version, would not know who it is.",
    );
    expect(messages(doc(["logoStrip", 0, { showNames: false, items: [{ url: PIC, name: "A" }] }]))).toContain(
      "warn: The partners' names are switched off, so readers with pictures off will not see who they are.",
    );
  });

  it("blocks a gift tag with no working link", () => {
    expect(hasBlockingFindings(check(doc(["giftTags", 0, { items: [{ title: "A", href: LINK }, { title: "B", href: "" }] }])))).toBe(true);
  });

  it("blocks a bag list's button with no working link, only in the style that has one", () => {
    expect(hasBlockingFindings(check(doc(["bagList", 2, { title: "A", href: "" }])))).toBe(true);
    expect(hasBlockingFindings(check(doc(["bagList", 0, { title: "A", href: "" }])))).toBe(false);
  });

  it("warns when a bag list says a gift will buy something, since it must say could", () => {
    expect(messages(doc(["bagList", 1, { title: "What £50 will buy", items: [{ name: "Pyjamas" }] }]))).toContain(
      'warn: A bag list says what a gift "will buy". Say what it "could" do instead: a gift goes where it is needed most.',
    );
    expect(messages(doc(["bagList", 1, { footnote: "Your gift will pay for a coat", items: [{ name: "Coat" }] }])).join()).toContain("will buy");
  });

  it("blocks a paper story link that is not a link, but not a story with no link at all", () => {
    expect(hasBlockingFindings(check(doc(["paperStory", 3, { title: "A", href: "javascript:x" }])))).toBe(true);
    expect(hasBlockingFindings(check(doc(["paperStory", 3, { title: "A", href: "" }])))).toBe(false);
  });

  it("never minds a festive divider", () => {
    expect(messages(doc(["trim", 2, {}]))).toEqual([]);
  });
});

describe("two warnings for every newsletter", () => {
  it("warns when the finished email passes 80 KB", () => {
    const big = "A long paragraph of words. ".repeat(160);
    const d: NewsletterDoc = { blocks: Array.from({ length: 22 }, () => ({ type: "text" as const, variant: 0, data: { text: big }, size: 0 })) };
    const found = check(d);
    expect(found).toContainEqual({ level: "warn", message: "Gmail may cut this email short: it is over 80 KB. Try taking out a block or two." });
    expect(hasBlockingFindings(found)).toBe(false);
  });

  it("warns about words left in square brackets, in the blocks or the subject", () => {
    const want = { level: "warn", message: "This still has a note to yourself in square brackets: [A thank-you, with consent]." };
    expect(check(doc(["note", 0, { text: "[A thank-you, with consent]" }]))).toContainEqual(want);
    expect(check(doc(["giftTags", 0, { items: [{ title: "A", href: LINK, body: "[A thank-you, with consent]" }] }]))).toContainEqual(want);
    expect(messages(doc(["text", 0, { text: "Hello" }]), { subject: "[Month] update" })).toContain(
      "warn: This still has a note to yourself in square brackets: [Month].",
    );
  });

  it("names the first one and says how many more", () => {
    const d = doc(["text", 0, { text: "[one] and [two]" }], ["note", 0, { text: "[three]" }]);
    expect(messages(d)).toContain("warn: This still has notes to yourself in square brackets: [one], and 2 more.");
  });

  it("does not mind brackets that are not notes, such as an empty pair", () => {
    expect(messages(doc(["text", 0, { text: "A list [] and a ] stray" }]))).toEqual([]);
  });
});
