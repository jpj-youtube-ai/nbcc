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

describe("every Designer Rooms mark is the same size (TASK-337)", () => {
  // The sponsor pays for the whole evening. NBCC asked for the credit to carry more weight, and
  // asked for it FOUR separate times — once per place it appears — which is the tell that these
  // live in four files and nobody could see them together.
  //
  // TASK-337 settled them at ONE number. The +50% pass gave three different widths because each
  // started from a different place, which just moved the problem: they still could not be
  // checked against each other by eye.
  const sizes: Array<[string, string, number]> = [
    ["hero, top of the ball page", rule(ballCss, ".ball-credit a"), 500],
    ["band, foot of the ball page", rule(ballCss, ".ball-sponsor-name a"), 500],
    ["home page promotion", rule(promo, ".ball-home-credit a"), 500],
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
    expect(rule(ballCss, ".ball-sponsor-name a").replace(/\s+/g, "")).toContain("width:500px");
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

  // TASK-337: the kicker is gone. It said "Your seat is booked", which is the wrong sentence for
  // the buyer this page matters most to — someone who has just taken a table of ten. Removing it
  // moves the headline into :nth-child(2), which is the child the stagger gives the scale-in
  // entrance to, so the biggest thing on the page is now also the one that arrives with it.
  it("no longer tells a table buyer they booked a seat", () => {
    // Scoped to what is RENDERED. The comment explaining the removal quotes the old line, so a
    // whole-file search fails on the very note saying it is gone.
    const wrap = thankYou.slice(
      thankYou.indexOf('<section class="ball-hero"'),
      thankYou.indexOf("</section>", thankYou.indexOf('<section class="ball-hero"')),
    );
    const rendered = wrap.replace(/<!--[\s\S]*?-->/g, "");
    expect(rendered).not.toContain("ball-kicker");
    expect(rendered).not.toMatch(/Your seat is booked/i);
  });

  it("puts the headline second, where the scale-in entrance lands", () => {
    const wrap = thankYou.slice(
      thankYou.indexOf('<section class="ball-hero"'),
      thankYou.indexOf("</section>", thankYou.indexOf('<section class="ball-hero"')),
    );
    const lockup = wrap.indexOf("ball-lockup");
    const title = wrap.indexOf("ball-ty-title");
    expect(lockup).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(lockup);
  });

  // The confirmation line is the one thing on this page a buyer needs to read at a glance, and
  // at 2.15rem it was barely bigger than the body copy beneath it.
  it("sets the headline at display scale, above the lockup's own size", () => {
    const title = rule(ballCss, ".ball-ty-title");
    const max = Number(title.match(/font-size:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/)?.[1] ?? 0);
    expect(max).toBeGreaterThanOrEqual(3.5);
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
    // "help cover", not "cover": the amount is grossed up against 1.2% + 20p and Amex is 2.9%,
    // so on an Amex the charity is still a little short. The bolding is what this test is
    // about and is unchanged; the phrase inside it gained the word that makes it true.
    ["coverFee", "help cover the card fee"],
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
