import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BALL_DONATE_FORM_MARKER,
  BALL_DONATE_PRESETS_PENCE,
  ballDonateOpen,
  renderBallDonateForm,
  renderBallDonatePage,
} from "../../src/ball/donate-page";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";

// The Festive Ball's "Can't make it? Donate" page, /ball/donate (Jaimie, 14 October 2026): a short
// page in the Ball's look with a once only give form. The form is drawn by the server so the Gift
// Aid declaration is word for word the one the site keeps (SINGLE_DONATION_WORDING).

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "ball-donate.html"), "utf8");
const ballPage = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const form = renderBallDonateForm();
const page = renderBallDonatePage(template);

describe("the page", () => {
  it("is headed for someone who cannot come", () => {
    expect(page).toContain("Can't make the Ball? You can still help.");
    expect(page).toContain("<title>");
    expect(page).toContain('<link rel="canonical" href="https://nbcc.scot/ball/donate" />');
  });

  it("is not a search destination, since people reach it from the Ball page", () => {
    expect(page).toContain('<meta name="robots" content="noindex" />');
  });

  it("puts the form where the template marks it, once", () => {
    expect(template).toContain(BALL_DONATE_FORM_MARKER);
    expect(page).not.toContain(BALL_DONATE_FORM_MARKER);
    expect(page.split('id="bdGiveForm"').length).toBe(2);
  });

  it("loads its own script, the Ball's styles and the give form's styles", () => {
    expect(page).toContain('<script defer src="/assets/js/ball-donate.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="/assets/css/ball.css" />');
    expect(page).toContain('<link rel="stylesheet" href="/assets/css/fundraising.css" />');
  });

  it("has the payment window, and sends businesses to the Donate page", () => {
    expect(page).toContain('id="bdEmbeddedCheckout"');
    expect(page).toContain('href="/donate"');
    expect(page).toMatch(/Giving as a business\?/);
  });

  it("says what £50 could do in the site's own approved words", () => {
    expect(page).toContain("£50 could help fill a whole Red Bag Full of Joy");
  });

  it("says what a gift could do with 'could', never 'will'", () => {
    const words = page.replace(/<[^>]+>/g, " ");
    expect(words).toMatch(/could/);
    expect(words).not.toMatch(/\bwill (pay|buy|fund|fill)/i);
  });

  it("keeps the house style: no dashes between words", () => {
    const words = page.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/[–—]/);
  });
});

describe("the form", () => {
  it("offers £10, £25, £50 and £100, or your own amount of £2 or more", () => {
    expect(BALL_DONATE_PRESETS_PENCE).toEqual([1000, 2500, 5000, 10000]);
    for (const p of ["£10", "£25", "£50", "£100"]) expect(form).toContain(`>${p}</span>`);
    expect(form).toContain('id="bdOwnAmount"');
    expect(form).toContain('min="2"');
    expect(form).toContain("£2 or more");
  });

  it("asks for a name and an email, and offers the newsletter unticked", () => {
    for (const id of ["bdFirstName", "bdSurname", "bdEmail", "bdEmailConsent"]) expect(form).toContain(`id="${id}"`);
    expect(form).not.toMatch(/id="bdEmailConsent"[^>]*checked/);
  });

  it("carries the site's own one off Gift Aid declaration, word for word, and its address questions", () => {
    expect(form).toContain(SINGLE_DONATION_WORDING.wording_snapshot.replace(/'/g, "&#39;").replace(/"/g, "&quot;"));
    for (const id of ["bdGiftAid", "bdHouse", "bdAddress", "bdPostcode", "bdNonUk"]) expect(form).toContain(`id="${id}"`);
    expect(form).toMatch(/id="bdDeclaration"[^>]*hidden/);
  });

  it("marks its button as a donate button, so Analytics counts the click as the donate page's is", () => {
    expect(form).toMatch(/<button[^>]*data-give-submit[^>]*data-give-pay/);
  });

  it("offers to cover the card fee, unticked", () => {
    expect(form).toContain('id="bdCoverFee"');
    expect(form).not.toMatch(/id="bdCoverFee"[^>]*checked/);
  });

  it("is hidden until its script runs, with a way to give without it", () => {
    expect(form).toMatch(/<form id="bdGiveForm"[^>]*hidden/);
    expect(form).toContain("data-nojs");
  });

  it("never asks about giving monthly", () => {
    expect(form.toLowerCase()).not.toContain("monthly");
  });
});

describe("when the page is open", () => {
  it("is open up to and on the day of the Ball, and not after", () => {
    expect(ballDonateOpen(new Date("2026-10-14T12:00:00Z"))).toBe(true);
    expect(ballDonateOpen(new Date("2026-11-07T22:59:00Z"))).toBe(true);
    // Sunday 8 November, just after midnight in the UK.
    expect(ballDonateOpen(new Date("2026-11-08T00:01:00Z"))).toBe(false);
  });
});

describe("the Ball page's button", () => {
  it("sits at the top, beside Book tickets and What's the night about", () => {
    const hero = ballPage.slice(ballPage.indexOf('class="ball-hero"'), ballPage.indexOf('id="the-night"'));
    expect(hero).toContain('<a class="btn btn-ghost-gold" href="/ball/donate">Can\'t make it? Donate</a>');
    expect(hero.indexOf("Book tickets")).toBeLessThan(hero.indexOf("Can't make it? Donate"));
    expect(hero.indexOf("What's the night about?")).toBeLessThan(hero.indexOf("Can't make it? Donate"));
  });
});
