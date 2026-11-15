import { describe, it, expect } from "vitest";
import {
  BLOCK_TYPES,
  newsletterDocSchema,
  renderBlock,
  renderNewsletter,
  type Block,
  type BlockType,
} from "../../src/newsletter/blocks";
import { htmlToPlainText } from "../../src/newsletter/plain-text";
import { EMAIL_ART, STILL_PAPER_TYPES, stickerButton } from "../../src/newsletter/paper-blocks";

// The paper look blocks (Jaimie, 14 November 2026): new building blocks for the newsletter in the look
// of the newer pages (Fill a Red Bag's lined paper, the home page's gift tags, taped prints, the
// chunky "sticker" button). Each is a NEW block type: no existing block or variant changes, which
// test/unit/newsletter-golden.test.ts pins byte for byte.
//
// What every one of them must do, because it is an email and not a web page:
//   * escape everything an author types, and never write a link or a picture address we would not send;
//   * use only what mail clients have: tables and inline styles, hosted PNG and JPG, no SVG, no
//     position, transform, flex or grid, no script;
//   * keep every word a reader needs as live text, so it survives pictures being switched off and
//     reaches the plain-text version (which drops pictures and their descriptions);
//   * degrade to nothing, or to its words, when a field is empty;
//   * stay small: Gmail cuts an email short near 102 KB.

const ctx = { firstName: "Jane" };
const PIC = "https://example.com/photo.jpg";
const LINK = "https://example.com/go";
const NASTY = '<b>X</b> & "q"';
const VARIANTS = [0, 1, 2, 3];

const block = (type: BlockType, variant: number, data: Record<string, unknown>, size?: number): Block =>
  size === undefined ? { type, variant, data } : { type, variant, data, size };
const render = (type: BlockType, variant: number, data: Record<string, unknown>, size?: number): string =>
  renderBlock(block(type, variant, data, size), ctx);
const text = (type: BlockType, variant: number, data: Record<string, unknown>): string =>
  htmlToPlainText(render(type, variant, data));

// One filled-in example of each still block, with invented words.
const FULL: Record<string, Record<string, unknown>> = {
  hero: { imageUrl: PIC, alt: "The Workshop", eyebrow: "Christmas appeal", headline: "A Red Bag for every child", subline: "Here is how you can help." },
  photoRow: {
    items: [
      { url: PIC, alt: "One", caption: "First caption" },
      { url: PIC, alt: "Two", caption: "Second caption" },
      { url: PIC, alt: "Three", caption: "Third caption" },
    ],
  },
  note: { text: "Thank you for the bag.\nIt meant the world.", from: "A mum in Ayr", role: "Shared with her say-so" },
  eventCard: {
    imageUrl: PIC, alt: "The hall", date: "2026-12-12", day: "", month: "", name: "Packing night", when: "6pm to 9pm",
    location: "Kilmarnock", body: "Come and pack bags with us.", label: "Book a place", href: LINK,
    items: [
      { imageUrl: PIC, alt: "A", day: "12", month: "DEC", name: "Packing night", when: "6pm", location: "Kilmarnock", label: "Book", href: LINK },
      { imageUrl: PIC, alt: "B", day: "20", month: "DEC", name: "Delivery day", when: "9am", location: "Ayr", label: "Join in", href: LINK },
    ],
  },
  logoStrip: {
    heading: "With thanks to",
    items: [
      { url: PIC, name: "Alpha Joinery", href: LINK },
      { url: PIC, name: "Beta Bakery", href: "" },
      { url: PIC, name: "Gamma Garage", href: LINK },
      { url: PIC, name: "Delta Dairy", href: "" },
      { url: PIC, name: "Epsilon Electrics", href: "" },
      { url: PIC, name: "Zeta Zips", href: "" },
    ],
  },
  giftTags: {
    items: [
      { title: "Fill a bag", body: "Choose what goes in.", label: "Start", href: LINK, colour: "card" },
      { title: "Give time", body: "Pack with us.", label: "Volunteer", href: LINK, colour: "crimson" },
      { title: "Tell a friend", body: "Pass it on.", label: "Share", href: LINK, colour: "holly" },
    ],
  },
  bagList: {
    title: "What could go in a bag",
    items: [
      { name: "Warm pyjamas", price: "£5", pic: "pyjamas" },
      { name: "A soft toy", price: "£4", pic: "soft-toy" },
      { name: "A book", price: "£3", pic: "book" },
      { name: "Socks", price: "£1", pic: "socks" },
    ],
    footnote: "These show what gifts could do.",
    label: "Fill a Red Bag",
    href: LINK,
  },
  trim: {},
  paperStory: { imageUrl: PIC, alt: "Volunteers", kicker: "From the Workshop", title: "A night of packing", body: "Forty volunteers.\n\nOne evening.", label: "Read the story", href: LINK },
};
const TYPES = Object.keys(FULL) as BlockType[];
const CASES = TYPES.flatMap((type) => VARIANTS.map((variant) => [type, variant] as const));

// Every string in some data swapped for `value`, items included: to prove a field is escaped, or that a
// bad address is never written, without listing the fields by hand (a new field is covered the day it
// is added to FULL).
function everyString(data: unknown, value: (key: string) => string, key = ""): unknown {
  if (typeof data === "string") return value(key);
  if (Array.isArray(data)) return data.map((item) => everyString(item, value, key));
  if (data && typeof data === "object") {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, everyString(v, value, k)]));
  }
  return data;
}
const ADDRESS_KEYS = ["imageUrl", "url", "href"];
const PICKED_KEYS = ["colour", "pic", "date"]; // chosen from a list or a date picker, not typed as words

describe("the paper look blocks are new block types", () => {
  it("lists the nine still blocks", () => {
    expect([...STILL_PAPER_TYPES].sort()).toEqual(
      ["bagList", "eventCard", "giftTags", "hero", "logoStrip", "note", "paperStory", "photoRow", "trim"].sort(),
    );
    expect(TYPES.slice().sort()).toEqual([...STILL_PAPER_TYPES].sort());
  });

  it("adds them after the fifteen original types, which keep their places", () => {
    expect(BLOCK_TYPES.slice(0, 15)).toEqual([
      "masthead", "greeting", "text", "heading", "image", "story", "spotlight", "stats", "waysToHelp",
      "events", "donationCta", "button", "divider", "signoff", "rawHtml",
    ]);
    for (const type of STILL_PAPER_TYPES) expect(BLOCK_TYPES).toContain(type);
  });

  it.each(TYPES)("the document schema accepts %s at variants 0 to 3, and still refuses variant 4", (type) => {
    for (const variant of VARIANTS) {
      expect(newsletterDocSchema.safeParse({ blocks: [{ type, variant, data: FULL[type] }] }).success).toBe(true);
    }
    expect(newsletterDocSchema.safeParse({ blocks: [{ type, variant: 4, data: {} }] }).success).toBe(false);
  });
});

describe.each(CASES)("%s, variant %i", (type, variant) => {
  const html = render(type, variant, FULL[type]);

  it("renders something", () => {
    expect(html.length).toBeGreaterThan(40);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("NaN");
  });

  it("uses only what a mail client has", () => {
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("position:");
    expect(html.replace(/text-transform:/g, "")).not.toContain("transform:");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
    expect(html).not.toContain("gradient(");
    expect(html).not.toContain("clip-path");
    expect(html).not.toContain(".webp");
    expect(html).not.toContain("class=");
  });

  it("gives every picture a width, a description (which may be empty) and a full address", () => {
    const pictures = html.match(/<img\b[^>]*>/g) || [];
    for (const picture of pictures) {
      expect(picture).toMatch(/\salt="[^"]*"/);
      expect(picture).toMatch(/\swidth="\d+"/);
      expect(picture).toMatch(/\ssrc="https:\/\/[^"]+"/);
      expect(picture).toContain("border:0");
    }
  });

  it("escapes every word an author types", () => {
    const nasty = everyString(FULL[type], (key) => (ADDRESS_KEYS.includes(key) ? LINK : PICKED_KEYS.includes(key) ? "card" : NASTY));
    const out = render(type, variant, nasty as Record<string, unknown>);
    expect(out).not.toContain("<b>X</b>");
    expect(out).not.toContain('"q"');
  });

  it("never writes a link or a picture address we would not send", () => {
    const bad = everyString(FULL[type], (key) => (ADDRESS_KEYS.includes(key) ? "javascript:alert(1)" : key === "pic" ? "../../x" : "Words"));
    const out = render(type, variant, bad as Record<string, unknown>);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("../../x");
    // The words are still there: only the bad addresses are dropped. (The divider has no words, and a
    // photo row is nothing without its photos: a caption with no photo above it means nothing.)
    if (type !== "trim" && type !== "photoRow") expect(htmlToPlainText(out)).toContain("Words");
  });

  it("does not break on data of the wrong shape", () => {
    const wrong = { items: "not a list", imageUrl: 7, title: null, text: ["a"], date: {}, showNames: "yes" };
    expect(() => render(type, variant, wrong as Record<string, unknown>)).not.toThrow();
    expect(() => render(type, variant, { items: [null, 3, "x", { url: 9 }] })).not.toThrow();
  });

  it("is small enough for an email", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(4096);
  });

  it("sits inside the frame without leaking anything odd", () => {
    const doc = renderNewsletter({ blocks: [block(type, variant, FULL[type])] }, { firstName: "Jane", unsubscribeUrl: "#" });
    expect(doc).toContain(html);
    expect(doc).toContain("SC047995");
  });
});

describe("empty blocks degrade to nothing", () => {
  it.each(CASES.filter(([type]) => type !== "trim"))("%s, variant %i, renders nothing with nothing filled in", (type, variant) => {
    expect(render(type, variant, {})).toBe("");
    expect(render(type, variant, { items: [] })).toBe("");
    expect(render(type, variant, everyString(FULL[type], () => "   ") as Record<string, unknown>)).toBe("");
  });
});

describe("the sticker button", () => {
  it("is a table cell with a thick darker bottom edge, holding a real link", () => {
    const html = stickerButton("Fill a Red Bag", LINK);
    expect(html).toContain("<table");
    expect(html).toMatch(/border-bottom:5px solid #[0-9A-F]{6}/i);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain(">Fill a Red Bag</a>");
  });

  it("escapes its label and its link", () => {
    const html = stickerButton(NASTY, "https://example.com/?a=1&b=2");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
  });

  it("is nothing at all without a label, or without a link we would send", () => {
    expect(stickerButton("", LINK)).toBe("");
    expect(stickerButton("   ", LINK)).toBe("");
    expect(stickerButton("Go", "")).toBe("");
    expect(stickerButton("Go", "javascript:alert(1)")).toBe("");
    expect(stickerButton("Go", "nbcc.scot/fill")).toBe("");
  });

  it("takes an email or a phone link, as the checks before sending do", () => {
    expect(stickerButton("Email us", "mailto:hello@example.com")).toContain('href="mailto:hello@example.com"');
    expect(stickerButton("Call us", "tel:+441234567890")).toContain('href="tel:+441234567890"');
  });

  it("comes in the tones the tags and cards need, and can sit to the left", () => {
    const tones = (["crimson", "paper", "holly", "gold"] as const).map((tone) => stickerButton("Go", LINK, tone));
    expect(new Set(tones).size).toBe(4);
    expect(stickerButton("Go", LINK, "crimson", "left")).not.toBe(stickerButton("Go", LINK, "crimson", "center"));
  });

  it("does not use the classic button", () => {
    // brandButton's pill: border-radius:8px with 12px 26px padding. The sticker is its own shape.
    expect(stickerButton("Go", LINK)).not.toContain("padding:12px 26px");
  });
});

describe("hero, the picture header", () => {
  const data = FULL.hero;

  it("always writes the headline as live text, in every style", () => {
    for (const v of VARIANTS) {
      const html = render("hero", v, data);
      expect(html).toContain(">A Red Bag for every child</h1>");
      expect(text("hero", v, data)).toContain("Christmas appeal");
      expect(text("hero", v, data)).toContain("A Red Bag for every child");
      expect(text("hero", v, data)).toContain("Here is how you can help.");
    }
  });

  it("shows the picture edge to edge with its description", () => {
    const html = render("hero", 0, data);
    expect(html).toContain(`<img src="${PIC}" alt="The Workshop" width="636" style="display:block;width:100%;height:auto`);
    // Not capped at 636: the card can come out a few pixels wider, and a capped picture would leave a
    // sliver of cream down its right-hand side.
    expect(html).not.toContain("max-width:636px");
  });

  it("puts the words on a maroon band in style 1 and a holly band in style 2", () => {
    expect(render("hero", 1, data)).toContain('bgcolor="#800000"');
    expect(render("hero", 2, data)).toContain('bgcolor="#1A531A"');
  });

  it("opens with the band, then the picture, in the night style", () => {
    const html = render("hero", 2, data);
    expect(html.indexOf("A Red Bag for every child")).toBeLessThan(html.indexOf("<img"));
    const day = render("hero", 1, data);
    expect(day.indexOf("<img")).toBeLessThan(day.indexOf("A Red Bag for every child"));
  });

  it("sets the art beside the words in style 3, in columns that shrink on a phone", () => {
    const html = render("hero", 3, data);
    expect(html).toContain('width="200"');
    expect(html).toMatch(/width:3\d%/);
  });

  it("is the words alone without a picture, and the picture alone without words", () => {
    for (const v of VARIANTS) {
      const wordsOnly = render("hero", v, { ...data, imageUrl: "" });
      expect(wordsOnly).not.toContain("<img");
      expect(wordsOnly).toContain("A Red Bag for every child");
      const pictureOnly = render("hero", v, { imageUrl: PIC, alt: "The Workshop" });
      expect(pictureOnly).toContain("<img");
      expect(pictureOnly).not.toContain("<h1");
      expect(pictureOnly).not.toContain("bgcolor");
    }
  });

  it("cuts a field that runs past its limit rather than refusing it", () => {
    const html = render("hero", 0, { headline: "H".repeat(200), eyebrow: "E".repeat(200), subline: "S".repeat(400) });
    expect(html).toContain("H".repeat(80));
    expect(html).not.toContain("H".repeat(81));
    expect(html).not.toContain("E".repeat(41));
    expect(html).not.toContain("S".repeat(161));
  });
});

describe("photoRow, the photo row", () => {
  const data = FULL.photoRow;
  const count = (html: string) => (html.match(new RegExp(`<img src="${PIC}"`, "g")) || []).length;

  it("shows two photos in styles 0 and 2, and three in styles 1 and 3", () => {
    expect(count(render("photoRow", 0, data))).toBe(2);
    expect(count(render("photoRow", 1, data))).toBe(3);
    expect(count(render("photoRow", 2, data))).toBe(2);
    expect(count(render("photoRow", 3, data))).toBe(3);
  });

  it("keeps them in one row of columns that shrink with the screen", () => {
    expect(render("photoRow", 0, data)).toContain("width:50%");
    expect(render("photoRow", 1, data)).toContain("width:33%");
    expect((render("photoRow", 1, data).match(/<tr>/g) || []).length).toBe(1);
  });

  it("frames a print in white with tape above it and a handwritten caption", () => {
    const html = render("photoRow", 2, data);
    expect(html).toContain(`${EMAIL_ART}tape-top.png`);
    expect(html).toContain(`${EMAIL_ART}tape-on-white.png`);
    expect(html).toContain("background:#FFFFFF");
    expect(html).toContain("cursive");
    expect(render("photoRow", 0, data)).not.toContain("tape-");
  });

  it("carries each photo's description, and its caption into the plain text", () => {
    const html = render("photoRow", 1, data);
    expect(html).toContain('alt="One"');
    expect(html).toContain('alt="Three"');
    expect(text("photoRow", 1, data)).toContain("First caption");
    expect(text("photoRow", 1, data)).toContain("Third caption");
  });

  it("leaves out an item with no photo, and is nothing when none has one", () => {
    const some = { items: [{ url: "", caption: "No photo" }, { url: PIC, alt: "Two", caption: "Has one" }] };
    expect(count(render("photoRow", 0, some))).toBe(1);
    expect(render("photoRow", 0, some)).not.toContain("No photo");
    expect(render("photoRow", 0, { items: [{ url: "", caption: "No photo" }] })).toBe("");
  });
});

describe("note, the handwritten note", () => {
  const data = FULL.note;

  it("writes the note in a handwriting face, in quotes, with its line breaks", () => {
    for (const v of VARIANTS) {
      const html = render("note", v, data);
      expect(html).toContain("cursive");
      expect(html).toContain("&ldquo;Thank you for the bag.<br>It meant the world.&rdquo;");
    }
  });

  it("says who it is from and their line, each only when given", () => {
    expect(text("note", 0, data)).toContain("A mum in Ayr");
    expect(text("note", 0, data)).toContain("Shared with her say-so");
    const bare = render("note", 0, { text: "Thank you." });
    expect(bare).toContain("Thank you.");
    expect((bare.match(/<p\b/g) || []).length).toBe(1);
  });

  it("keeps bold and italic markers as emphasis, as the other prose fields do", () => {
    expect(render("note", 0, { text: "It was **so** kind." })).toContain("<strong>so</strong>");
  });

  it("is a paper card with a margin line in style 0, taped in style 1, bare in style 2, kraft in style 3", () => {
    expect(render("note", 0, data)).toContain("background:#FFFDFA");
    expect(render("note", 0, data)).not.toContain("tape-");
    expect(render("note", 1, data)).toContain(`${EMAIL_ART}tape-top.png`);
    expect(render("note", 1, data)).toContain(`${EMAIL_ART}tape-on-card.png`);
    expect(render("note", 2, data)).not.toContain("background:");
    expect(render("note", 3, data)).toContain("background:#F3E4DD");
    expect(render("note", 3, data)).toContain(`${EMAIL_ART}tape-on-kraft.png`);
  });

  it("is nothing without the note itself, even if it is signed", () => {
    expect(render("note", 0, { text: "  ", from: "Somebody" })).toBe("");
  });

  it("cuts a note that runs past 600 characters", () => {
    const html = render("note", 0, { text: "n".repeat(700) });
    expect(html).toContain("n".repeat(600));
    expect(html).not.toContain("n".repeat(601));
  });
});

describe("eventCard, the event card", () => {
  const data = FULL.eventCard;

  it("takes the badge's day and month from the date when they are left blank", () => {
    const plain = text("eventCard", 0, data);
    expect(plain).toContain("12 DEC");
    expect(plain).toContain("Packing night");
    expect(plain).toContain("6pm to 9pm");
    expect(plain).toContain("Kilmarnock");
    expect(plain).toContain("Come and pack bags with us.");
    expect(plain).toContain(`Book a place (${LINK})`);
  });

  it("lets the day and month be typed instead, for a run of nights", () => {
    const plain = text("eventCard", 0, { ...data, day: "1 to 24", month: "DEC" });
    expect(plain).toContain("1 to 24 DEC");
  });

  it("shows no badge without a day, and ignores a date that is not one", () => {
    const html = render("eventCard", 0, { name: "Sometime soon", date: "not-a-date" });
    expect(html).toContain("Sometime soon");
    expect(html).not.toContain("not-a-date");
    expect(text("eventCard", 0, { name: "Sometime soon", date: "2026-02-31" })).toBe("Sometime soon");
  });

  it("uses the sticker button, and shows none without a link we would send", () => {
    expect(render("eventCard", 0, data)).toContain("border-bottom:5px solid");
    expect(render("eventCard", 0, { ...data, href: "" })).not.toContain("<a ");
    expect(render("eventCard", 0, { ...data, href: "javascript:x" })).not.toContain("<a ");
  });

  it("says Find out more when the button has a link but no label", () => {
    expect(render("eventCard", 0, { ...data, label: "" })).toContain(">Find out more</a>");
  });

  it("has the picture on top in style 0, beside the words in style 1, and none on the ticket", () => {
    const top = render("eventCard", 0, data);
    expect(top.indexOf("<img")).toBeLessThan(top.indexOf("Packing night"));
    expect(render("eventCard", 1, data)).toMatch(/width:3\d%/);
    const ticket = render("eventCard", 2, data);
    expect(ticket).not.toContain("<img");
    expect(ticket).toContain("dashed");
    expect(ticket).toContain("background:#C02238");
  });

  it("shows two cards side by side in style 3, from its list", () => {
    const html = render("eventCard", 3, data);
    expect(html).toContain("Delivery day");
    expect(html).toContain("width:50%");
    expect(text("eventCard", 3, data)).toContain("20 DEC");
    expect(text("eventCard", 3, data)).toContain(`Join in (${LINK})`);
  });

  it("falls back to its own fields in style 3 when the list is empty", () => {
    const html = render("eventCard", 3, { ...data, items: [] });
    expect(html).toContain("Packing night");
  });

  it("draws the two cards as one table, a row of pictures over a row of words, so they end level", () => {
    const html = render("eventCard", 3, data);
    expect((html.match(/<tr>/g) || []).length).toBe(2 + 2); // the two rows, and a sticker button in each card
    expect(html.indexOf('alt="B"')).toBeLessThan(html.indexOf("Packing night"));
    // Read as plain text, each event's words still come one event after the other.
    const plain = text("eventCard", 3, data);
    expect(plain.indexOf("Book (")).toBeLessThan(plain.indexOf("20 DEC"));
  });

  it("keeps the badge a small square beside a long description, not a bar the height of the card", () => {
    // A table cell stretches to its row's height, so the badge is a table of its own inside the cell.
    const html = render("eventCard", 0, data);
    expect(html).toMatch(/<td width="64"[^>]*><table[^>]*><tr><td style="background:#C02238/);
  });
});

describe("logoStrip, the partner logos", () => {
  const data = FULL.logoStrip;
  const logos = (html: string) => (html.match(/<img\b/g) || []).length;

  it("shows four in a row, six in two rows, one beside its words, or four on a white band", () => {
    expect(logos(render("logoStrip", 0, data))).toBe(4);
    expect(logos(render("logoStrip", 1, data))).toBe(6);
    expect((render("logoStrip", 1, data).match(/<tr>/g) || []).length).toBe(2);
    expect(logos(render("logoStrip", 2, data))).toBe(1);
    expect(logos(render("logoStrip", 3, data))).toBe(4);
    expect(render("logoStrip", 3, data)).toContain('bgcolor="#FFFFFF"');
  });

  it("describes each logo by its partner's name", () => {
    expect(render("logoStrip", 0, data)).toContain('alt="Alpha Joinery"');
  });

  it("prints the names in a line of their own by default, because the plain text drops pictures", () => {
    const plain = text("logoStrip", 0, data);
    expect(plain).toContain("With thanks to");
    expect(plain).toContain(`Alpha Joinery (${LINK})`);
    expect(plain).toContain("Beta Bakery");
    expect(plain).toContain("Delta Dairy");
    expect(plain).not.toContain("Epsilon Electrics"); // only the four that are shown
  });

  it("links the name, not the logo, so the plain text never shows a bare address", () => {
    const html = render("logoStrip", 0, data);
    expect(html).not.toMatch(/<a [^>]*><img/);
    expect(html).toMatch(/<a [^>]*>Alpha Joinery<\/a>/);
  });

  it("links the logo itself only when the names are switched off", () => {
    const html = render("logoStrip", 0, { ...data, showNames: false });
    expect(html).toMatch(/<a [^>]*><img/);
    expect(htmlToPlainText(html)).not.toContain("Beta Bakery");
  });

  it("is nothing with no logos, even with a heading", () => {
    expect(render("logoStrip", 0, { heading: "With thanks to", items: [] })).toBe("");
    expect(render("logoStrip", 0, { heading: "With thanks to", items: [{ url: "", name: "" }] })).toBe("");
  });
});

describe("giftTags, the gift tags", () => {
  const data = FULL.giftTags;
  const tags = (html: string) => (html.match(/tag-top-/g) || []).length;

  it("hangs three, two, three stacked, or one large", () => {
    expect(tags(render("giftTags", 0, data))).toBe(3);
    expect(tags(render("giftTags", 1, data))).toBe(2);
    expect(tags(render("giftTags", 2, data))).toBe(3);
    expect(tags(render("giftTags", 3, data))).toBe(1);
    expect((render("giftTags", 0, data).match(/width:33%/g) || []).length).toBe(3);
    expect(render("giftTags", 2, data)).not.toContain("width:33%");
  });

  it("draws each tag's top as a hosted picture in its colour, over a plain coloured cell", () => {
    const html = render("giftTags", 0, data);
    expect(html).toContain(`${EMAIL_ART}tag-top-card.png`);
    expect(html).toContain(`${EMAIL_ART}tag-top-crimson.png`);
    expect(html).toContain(`${EMAIL_ART}tag-top-holly.png`);
    expect(html).toContain('bgcolor="#C02238"');
    expect(html).toContain('bgcolor="#1A531A"');
  });

  it("gives a tag with no colour, or a colour we do not have, the next one in turn", () => {
    const html = render("giftTags", 0, { items: [{ title: "A" }, { title: "B", colour: "purple" }, { title: "C", colour: "tan" }] });
    expect(html).toContain("tag-top-card.png");
    expect(html).toContain("tag-top-crimson.png");
    expect(html).toContain("tag-top-tan.png");
    expect(html).not.toContain("purple");
  });

  it("carries the title, the words and the link into the plain text", () => {
    const plain = text("giftTags", 0, data);
    expect(plain).toContain("Fill a bag");
    expect(plain).toContain("Choose what goes in.");
    expect(plain).toContain(`Start (${LINK})`);
    expect(plain).toContain(`Share (${LINK})`);
  });

  it("shows a tag without a link as a tag without a button", () => {
    const html = render("giftTags", 3, { items: [{ title: "Coming soon", body: "Watch this space.", label: "Go", href: "" }] });
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("<a ");
  });

  it("leaves out a tag with no title and no words", () => {
    expect(tags(render("giftTags", 0, { items: [{ title: "Only one" }, { title: "", body: "" }] }))).toBe(1);
  });
});

describe("bagList, what goes in a bag", () => {
  const data = FULL.bagList;

  it("writes each thing and its price on one line of the plain text", () => {
    const plain = text("bagList", 0, data);
    expect(plain).toContain("What could go in a bag");
    expect(plain).toContain("Warm pyjamas £5");
    expect(plain).toContain("Socks £1");
    expect(plain).toContain("These show what gifts could do.");
  });

  it("draws each thing's painting from the email pictures in styles 0, 2 and 3, and none in style 1", () => {
    expect(render("bagList", 0, data)).toContain(`${EMAIL_ART}item-pyjamas.png`);
    expect(render("bagList", 2, data)).toContain(`${EMAIL_ART}item-soft-toy.png`);
    expect(render("bagList", 3, data)).toContain(`${EMAIL_ART}item-book.png`);
    expect(render("bagList", 1, data)).not.toContain("<img");
  });

  it("only draws a painting it knows", () => {
    const html = render("bagList", 0, { title: "A bag", items: [{ name: "A mystery", price: "£2", pic: "dragon" }] });
    expect(html).toContain("A mystery");
    expect(html).not.toContain("dragon");
    expect(html).not.toContain("<img");
  });

  it("rules a line under every thing, like lined paper", () => {
    const html = render("bagList", 1, data);
    expect((html.match(/border-bottom:1px solid/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("cursive");
  });

  it("has its button only in style 2", () => {
    expect(render("bagList", 2, data)).toContain(`href="${LINK}"`);
    expect(render("bagList", 2, data)).toContain(">Fill a Red Bag</a>");
    expect(render("bagList", 0, data)).not.toContain("<a ");
    expect(render("bagList", 1, data)).not.toContain("<a ");
    expect(render("bagList", 3, data)).not.toContain("<a ");
  });

  it("sets the things in two columns in style 3", () => {
    expect(render("bagList", 3, data)).toContain("width:50%");
    expect(text("bagList", 3, data)).toContain("A book £3");
  });

  it("shows eight things at most", () => {
    const many = { title: "A bag", items: Array.from({ length: 12 }, (_, i) => ({ name: `Thing ${i + 1}`, price: "£1" })) };
    const html = render("bagList", 1, many);
    expect(html).toContain("Thing 8");
    expect(html).not.toContain("Thing 9");
    expect(Buffer.byteLength(render("bagList", 0, { ...many, items: many.items.map((i) => ({ ...i, pic: "colouring-book" })) }), "utf8")).toBeLessThan(5200);
  });
});

describe("trim, the festive divider", () => {
  it("is a different piece of art in each style", () => {
    expect(render("trim", 0, {})).toContain(`${EMAIL_ART}trim-bow.png`);
    expect(render("trim", 1, {})).toContain(`${EMAIL_ART}trim-snow.png`);
    expect(render("trim", 2, {})).toContain(`${EMAIL_ART}trim-torn.png`);
    expect(render("trim", 3, {})).toContain(`${EMAIL_ART}trim-stars.png`);
  });

  it("is for the eye only: an empty description, and nothing in the plain text", () => {
    for (const v of VARIANTS) {
      expect(render("trim", v, {})).toContain('alt=""');
      expect(text("trim", v, {})).toBe("");
    }
  });

  it("draws the gold ribbon either side of the bow as plain cells, so it still shows with pictures off", () => {
    expect(render("trim", 0, {})).toContain("background:#D9A93E");
  });

  it("is never resized", () => {
    for (const v of VARIANTS) expect(render("trim", v, {}, 2)).toBe(render("trim", v, {}));
  });
});

describe("paperStory, a story in the paper look", () => {
  const data = FULL.paperStory;

  it("always writes the kicker, title and body as live text", () => {
    for (const v of VARIANTS) {
      const plain = text("paperStory", v, data);
      expect(plain).toContain("From the Workshop");
      expect(plain).toContain("A night of packing");
      expect(plain).toContain("Forty volunteers.");
      expect(plain).toContain("One evening.");
      expect(plain).toContain(`Read the story (${LINK})`);
    }
  });

  it("shows the photo as a taped print in styles 0 to 2, and no photo in style 3", () => {
    for (const v of [0, 1, 2]) {
      const html = render("paperStory", v, data);
      expect(html).toContain(`<img src="${PIC}" alt="Volunteers"`);
      expect(html).toContain("tape-top.png");
    }
    expect(render("paperStory", 3, data)).not.toContain(PIC);
  });

  it("puts the print above the words in style 0 and beside them in style 1", () => {
    const above = render("paperStory", 0, data);
    expect(above.indexOf(PIC)).toBeLessThan(above.indexOf("A night of packing"));
    expect(render("paperStory", 1, data)).toMatch(/width:4\d%/);
  });

  it("sets the words on a paper card in styles 2 and 3", () => {
    expect(render("paperStory", 2, data)).toContain("background:#FFFDFA");
    expect(render("paperStory", 3, data)).toContain("background:#FFFDFA");
    expect(render("paperStory", 0, data)).not.toContain("background:#FFFDFA");
  });

  it("writes the kicker by hand", () => {
    expect(render("paperStory", 3, data)).toMatch(/cursive[^>]*>From the Workshop</);
  });

  it("uses the sticker button, says Read more with no label, and shows none without a link", () => {
    expect(render("paperStory", 0, data)).toContain("border-bottom:5px solid");
    expect(render("paperStory", 0, { ...data, label: "" })).toContain(">Read more</a>");
    expect(render("paperStory", 0, { ...data, href: "" })).not.toContain("<a ");
  });

  it("is the words alone when there is no photo", () => {
    for (const v of [0, 1, 2]) {
      const html = render("paperStory", v, { ...data, imageUrl: "" });
      expect(html).not.toContain('alt="Volunteers"');
      expect(html).not.toContain("tape-on-white.png"); // no print, so no frame and no tape on one
      expect(html).toContain("A night of packing");
    }
    // Styles 0 and 1 have no picture of any kind left; style 2's paper card keeps its own tape.
    expect(render("paperStory", 0, { ...data, imageUrl: "" })).not.toContain("<img");
    expect(render("paperStory", 1, { ...data, imageUrl: "" })).not.toContain("<img");
  });
});

describe("text size steps on the paper look blocks", () => {
  it.each(TYPES.filter((t) => t !== "trim"))("%s grows and shrinks along the newsletter's own ladder", (type) => {
    const base = render(type, 0, FULL[type]);
    const up = render(type, 0, FULL[type], 1);
    const down = render(type, 0, FULL[type], -1);
    expect(up).not.toBe(base);
    expect(down).not.toBe(base);
    expect(render(type, 0, FULL[type], 0)).toBe(base);
    // Every size a paper block uses is on the ladder, so a step moves all of its words together.
    for (const size of base.match(/font-size:(\d+)px/g) || []) {
      expect(["0", "10", "12", "13", "14", "15", "16", "18", "20", "22", "24", "26", "28"]).toContain(size.replace(/\D/g, ""));
    }
  });
});

describe("a whole newsletter of paper look blocks", () => {
  const doc = { blocks: CASES.map(([type, variant]) => block(type, variant, FULL[type])) };
  const html = renderNewsletter(doc, { firstName: "Jane", unsubscribeUrl: "#" });

  it("renders all thirty-six looks in one email, under Gmail's limit", () => {
    expect(doc.blocks).toHaveLength(36);
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(102 * 1024);
  });

  it("reads sensibly as plain text", () => {
    const plain = htmlToPlainText(html);
    expect(plain).toContain("A Red Bag for every child");
    expect(plain).not.toContain("<");
    expect(plain).not.toContain("&nbsp;");
    expect(plain).not.toMatch(/\n{3,}/);
  });

  it("renders the same thing twice", () => {
    expect(renderNewsletter(doc, { firstName: "Jane", unsubscribeUrl: "#" })).toBe(html);
  });
});
