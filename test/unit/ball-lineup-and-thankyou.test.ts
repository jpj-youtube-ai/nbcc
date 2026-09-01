import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BALL_HOST, BALL_LINE_UP, lineUpSentence } from "../../src/ball/page";
import { buildBallConfirmationEmail } from "../../src/ball/confirmation-email";

// TASK-335: the line-up announcement, the sponsor marks at their new size, and the thank-you
// page rebuilt on the ball page's own hero.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const ballCss = read("assets/css/ball.css");
const ballJs = read("assets/js/ball.js");
const ballHtml = read("ball.html");
const promo = read("src/ball/home-promo.ts");
const thankYou = read("src/ball/thank-you-page.ts");

// Both brace styles: styles.css writes `.sel{...}`, ball.css writes `.sel {...}`. A helper that
// knows only one returns "" for a rule that is right there, and "" passes a "does not contain".
function rule(css: string, selector: string): string {
  let start = css.indexOf(selector + " {");
  if (start === -1) start = css.indexOf(selector + "{");
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return end === -1 ? "" : css.slice(start, end);
}

describe("every Designer Rooms mark is the same 50% larger (TASK-335)", () => {
  // The sponsor pays for the whole evening. NBCC asked for the credit to carry more weight, and
  // asked for it FOUR separate times — once per place it appears — which is the tell that these
  // live in four files and nobody could see them together.
  const sizes: Array<[string, string, number]> = [
    ["hero, top of the ball page", rule(ballCss, ".ball-credit a"), 315],
    ["band, foot of the ball page", rule(ballCss, ".ball-sponsor-name a"), 480],
    ["home page promotion", rule(promo, ".ball-home-credit a"), 375],
  ];

  it.each(sizes)("%s is %s", (_where, css, px) => {
    expect(css).not.toBe("");
    expect(css.replace(/\s+/g, "")).toContain(`width:${px}px`);
  });

  it("the thank-you page mark is the SAME one, not a fourth size", () => {
    // It has no width of its own any more. The thank-you page now ends on the ball page's own
    // .ball-sponsor band, so its mark is that band's 480px and cannot drift from it — which is
    // the better answer to "make this one bigger too" than a fourth number to keep in step.
    expect(thankYou).toContain('<p class="ball-sponsor-name">');
    expect(rule(ballCss, ".ball-sponsor-name a").replace(/\s+/g, "")).toContain("width:480px");
  });
});

describe("the thank-you page follows the ball page (TASK-335)", () => {
  // It was the standard cream site page while everything it followed was night and gold, so the
  // moment someone had just paid £100 looked like the least considered page in the flow.
  it("uses the ball hero itself, not a copy of it", () => {
    expect(thankYou).toContain('<section class="ball-hero"');
    expect(thankYou).not.toContain('class="page-top"');
  });

  it("carries the gold lockup", () => {
    expect(thankYou).toContain("/assets/img/ball-lockup.svg");
  });

  // The stagger in ball.css gives :nth-child(2) the lockup's own entrance. If the artwork is not
  // the second child it gets a plain rise and something else gets the flourish.
  it("puts the lockup second in the hero, where the animation expects it", () => {
    const wrap = thankYou.slice(
      thankYou.indexOf('<section class="ball-hero"'),
      thankYou.indexOf("</section>", thankYou.indexOf('<section class="ball-hero"')),
    );
    const kicker = wrap.indexOf("ball-kicker");
    const lockup = wrap.indexOf("ball-lockup");
    const title = wrap.indexOf("ball-ty-title");
    expect(kicker).toBeGreaterThan(-1);
    expect(lockup).toBeGreaterThan(kicker);
    expect(title).toBeGreaterThan(lockup);
  });

  it("ends on the same sponsor band as the ball page, in cream not dark", () => {
    expect(thankYou).toContain('<section class="ball-sponsor"');
    expect(thankYou).toContain("the-designer-rooms-cream.png");
    expect(thankYou).not.toContain('"/assets/img/the-designer-rooms.png"');
  });

  it("leaves no dead rules behind for the block it replaced", () => {
    // The SELECTOR, not the string: the comment above the replacement names the old class to
    // explain where it went, and a plain substring search fails on that comment.
    expect(ballCss).not.toMatch(/\.ball-ty-sponsor\s*[,{]/);
  });

  it("loads ball.js, which is what puts snow on the hero", () => {
    expect(thankYou).toContain('src="/assets/js/ball.js"');
  });
});

describe("ball.js survives a page with no booking form (TASK-335)", () => {
  // startSnow() runs LAST in the file. Every earlier read was guarded except one, so on the
  // thank-you page recalculate() would throw and the snow would simply never start — a failure
  // that looks like a missing feature rather than an error.
  it("guards the form before reading its elements", () => {
    expect(ballJs).toContain("form && form.elements.coverFee");
  });

  it("still only starts snow where there is a hero", () => {
    expect(ballJs).toContain('document.querySelector(".ball-hero")');
  });
});

describe("the hero stagger still runs top to bottom (TASK-335)", () => {
  // The line-up went in at position 4, pushing the CTA to 5 and the sponsor credit to 6. The
  // stagger stopped at 5, so the credit fell off the end and animated at zero delay — arriving
  // BEFORE the buttons above it.
  it("gives every hero child a delay, including the two the line-up pushed down", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(ballCss).toContain(`.ball-hero .wrap > :nth-child(${n})`);
    }
  });

  it("keeps those delays in ascending order", () => {
    const delays = [3, 4, 5, 6, 7].map((n) => {
      const r = rule(ballCss, `.ball-hero .wrap > :nth-child(${n})`);
      return Number(r.match(/animation-delay:\s*([\d.]+)s/)?.[1] ?? NaN);
    });
    expect(delays.some(Number.isNaN)).toBe(false);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});

describe("the tick boxes are scannable (TASK-335)", () => {
  // Four boxes of similar-length sentences read as one grey block, and the one that MUST be
  // ticked looked exactly like the three that are optional.
  const box = (name: string): string => {
    const at = ballHtml.indexOf(`name="${name}"`);
    if (at === -1) return "";
    return ballHtml.slice(at, ballHtml.indexOf("</label>", at));
  };

  it.each([
    ["coverFee", "cover the card fee"],
    ["addDonation", "add a donation"],
    ["newsletterOptIn", "NBCC newsletter"],
  ])("bolds the point of the %s box", (name, phrase) => {
    expect(box(name)).toContain(`<b>${phrase}</b>`);
  });

  it("marks the terms box Required, in bold, before anything else", () => {
    const terms = box("termsAccepted");
    expect(terms).toContain("<b>Required:</b>");
    // Before the sentence, not tucked in behind it.
    expect(terms.indexOf("<b>Required:</b>")).toBeLessThan(terms.indexOf("I have read"));
  });

  it("bolds agreeing to the terms, and still names the onerous term", () => {
    const terms = box("termsAccepted");
    expect(terms).toMatch(/<b>agree to the <a[^>]*>ticket terms<\/a><\/b>/);
    expect(terms).toMatch(/non-refundable/i);
  });
});

describe("the line-up is named in one place (TASK-335)", () => {
  // ball.html is a static file and cannot import the constants, so this is what stops the page
  // and the email drifting. The failure it guards against is not a typo: it is a fourth act
  // being added in one place and the other two still advertising three.
  it("matches what the page advertises", () => {
    for (const act of BALL_LINE_UP) expect(ballHtml).toContain(act);
    expect(ballHtml).toContain(BALL_HOST);
  });

  it("reads as a sentence, with the host first", () => {
    const sentence = lineUpSentence();
    expect(sentence.startsWith(BALL_HOST)).toBe(true);
    expect(sentence).toContain("and The Kilted DJ.");
    expect(sentence).not.toContain(",  ");
  });

  it("tells buyers who is playing, in both halves of the confirmation email", () => {
    const mail = buildBallConfirmationEmail(
      {
        reference: "NBCC-BALL-TEST",
        buyerName: "Test Buyer",
        buyerEmail: "test@example.com",
        seats: 2,
        tables: 0,
        ticketsPence: 20000,
        donationPence: 0,
        feeCoverPence: 0,
        totalPence: 20000,
      } as Parameters<typeof buildBallConfirmationEmail>[0],
      { arrivalTime: null, includedNote: null, guestLink: null },
    );
    for (const act of BALL_LINE_UP) {
      expect(mail.html).toContain(act);
      expect(mail.text).toContain(act);
    }
  });
});
