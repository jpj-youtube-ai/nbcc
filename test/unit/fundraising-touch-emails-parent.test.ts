import { describe, it, expect } from "vitest";
import { buildTouchEmail, touchUrls, type TouchEmailData } from "../../src/fundraising/touch-emails";
import { TOUCH_KINDS, type TouchKind } from "../../src/fundraising/touch-rules";

// A page for someone under 18 (Jaimie, 2026-10-04): the automatic emails go to their parent or
// guardian, so they speak to the parent THROUGHOUT, not just in the greeting and the subject. "Your
// page" is the child's page, "you've raised" is what the child has raised, and a heading such as
// "You're doing great!" is "[Child] is doing great!". A name ending in s never gets an awkward
// possessive: it is "the page for James". An adult's page is unchanged. Every name here is invented.

const BASE = "https://nbcc.test";
const data = (over: Partial<TouchEmailData> = {}): TouchEmailData => ({
  name: "Jack Example",
  firstName: "Jack",
  guardianFirstName: "Sarah",
  title: "Jack's walk",
  raisedPence: 30000,
  targetPence: 50000,
  urls: touchUrls(BASE, { id: 7, slug: "jacks-walk" }),
  ...over,
});
const jack = (kind: TouchKind, over: Partial<TouchEmailData> = {}) => buildTouchEmail(kind, data(over));
const james = (kind: TouchKind, over: Partial<TouchEmailData> = {}) => buildTouchEmail(kind, data({ name: "James Example", firstName: "James", title: "A sponsored walk", ...over }));
const heading = (html: string) => (/<h1[^>]*>([^<]*)<\/h1>/.exec(html) ?? [])[1];
const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "\u00a6").replace(/&#39;/g, "'");

describe("an automatic email about a page for someone under 18", () => {
  it.each(TOUCH_KINDS.map((k) => [k]))("%s greets the parent and says whose page it is about", (kind) => {
    expect(jack(kind).text.split("\n")[0]).toBe("Hi Sarah, this is about Jack's page.");
    expect(jack(kind).html).toContain(">Hi Sarah, this is about Jack&#39;s page.</p>");
    expect(james(kind).text.split("\n")[0]).toBe("Hi Sarah, this is about the page for James.");
    // A parent's name we cannot greet by: never the child's.
    expect(jack(kind, { guardianFirstName: "Sarah2" }).text.split("\n")[0]).toBe("Hi there, this is about Jack's page.");
  });

  it.each(TOUCH_KINDS.map((k) => [k]))("%s never tells the parent it is their page, their meter or their target", (kind) => {
    for (const mail of [jack(kind), jack(kind, { raisedPence: 0 }), james(kind)]) {
      for (const part of [words(mail.html), mail.text, mail.subject]) {
        expect(part).not.toMatch(/\byour (?:page|meter|target|goal|new target|very own)\b/i);
        expect(part).not.toMatch(/\bmy (?:page|target|certificate)\b/i);
        expect(part).not.toMatch(/\byou(?:'ve| have) (?:raised|made|got this)\b/i);
        expect(part).not.toMatch(/\byou're (?:doing great|halfway|right on track)\b/i);
        expect(part).not.toMatch(/\bYou did it\b|\byou did\b/);
      }
    }
  });

  it.each(TOUCH_KINDS.map((k) => [k]))("%s never gives a name ending in s an awkward possessive", (kind) => {
    const mail = james(kind);
    expect(words(mail.html) + mail.text + mail.subject).not.toMatch(/James'/);
  });

  it("first gift", () => {
    const m = jack("first_gift");
    expect(m.subject).toBe("The first gift is in for Jack!");
    expect(heading(m.html)).toBe("The first gift is in for Jack!");
    expect(m.text).toContain("Exciting news: someone has just made the very first gift on Jack's walk, and the meter has started to fill!");
    expect(m.text).toContain("Top tip: share Jack's page again today. People are more likely to give once they see others already have.");
    expect(m.text).toContain(`See the page: ${BASE}/fundraise/jacks-walk`);
    expect(m.html).toContain(">See the page</a>");
    expect(james("first_gift").text).toContain("Top tip: share the page for James again today.");
  });

  it("halfway", () => {
    const m = jack("halfway");
    expect(m.subject).toBe("Jack is halfway there!");
    expect(heading(m.html)).toBe("Jack is halfway there!");
    expect(m.text).toContain("Jack's walk has raised £300 of the £500 target. That's amazing! Thank you, and a huge thank you to everyone who has given.");
    expect(m.text).toContain("The second half often goes faster than the first, so keep sharing. Jack has got this!");
    expect(m.html).toContain(">See the page</a>");
  });

  it("target reached", () => {
    const m = jack("target", { raisedPence: 50000 });
    expect(m.subject).toBe("Jack did it! Target reached");
    expect(heading(m.html)).toBe("Jack did it!");
    expect(m.text).toContain("WOW. Jack's walk has reached its £500 target!");
    expect(m.text).toContain("But why stop there? Jack's page stays open, so every gift from here on is a bonus for the children, young people and vulnerable adults we support. Why not see if Jack can beat the goal?");
    expect(m.text).toContain("Set a new target from your private area, then share Jack's page again to tell everyone. We'd love to see how far Jack can go!");
    expect(m.text).toContain("We check every change before it goes on Jack's page, so the new target may take a day or so to show.");
    expect(m.html).toContain(">Raise the target</a>");
    const s = james("target", { raisedPence: 50000 }).text;
    expect(s).toContain("But why stop there? The page for James stays open,");
    expect(s).toContain("then share the page for James again to tell everyone.");
    expect(s).toContain("before it goes on the page for James,");
  });

  it("doing great", () => {
    const m = jack("on_track");
    expect(m.subject).toBe("Jack is doing great!");
    expect(heading(m.html)).toBe("Jack is doing great!");
    expect(m.text).toContain("We've been keeping an eye on Jack's walk, and we just had to say: Jack is right on track for the £500 target!");
    expect(m.text).toContain("Top tip: keep the momentum going. Share Jack's page again, or post a news update from your private area so supporters can see how it's going. People love to see progress!");
    expect(m.html).toContain(">See the page</a>");
    expect(m.text).toContain("Keep up the brilliant work,\nNBCC Team");
  });

  it("need a hand", () => {
    const m = jack("need_a_hand");
    expect(m.subject).toBe("Can we give you and Jack a hand?");
    expect(heading(m.html)).toBe("Need a hand?");
    expect(m.text).toContain("Jack's walk is coming up soon, and we'd love to help you and Jack make the most of it.");
    expect(m.text).toContain("Just reply to this email or give us a ring, and tell us what would help. We'll get it sorted.");
  });

  it("one week to go", () => {
    const m = jack("week_before");
    expect(m.subject).toBe("One week to go for Jack!");
    expect(heading(m.html)).toBe("One week to go!");
    expect(m.text).toContain("Jack's walk is just a week away, and we're so excited for Jack! Everything you need is ready in your private area: your QR code, your poster and your sponsor form.");
    expect(m.text).toContain("Top tip: a last share of Jack's page this week usually brings in a few more gifts.");
    expect(m.text).toContain("Good luck to you both!\nNBCC Team");
    expect(m.html).toContain(">Open my private area</a>");
  });

  it("how did it go", () => {
    const m = jack("week_after");
    expect(m.subject).toBe("How did it go?");
    expect(m.text).toContain("We hope Jack's walk was a brilliant day! So far Jack has raised £300 for NBCC, which is just fantastic.");
    expect(m.html).toContain("So far Jack has raised <b>£300</b> for NBCC, which is just fantastic.");
    expect(m.text).toContain("Pay it in by card from your private area in a couple of minutes, and it goes straight onto the meter.");
    expect(jack("week_after", { raisedPence: 0 }).text).toContain("We hope Jack's walk was a brilliant day!\n");
  });

  it("thank you, from all of us", () => {
    const m = jack("finished");
    expect(m.text).toContain("Jack's walk raised an incredible £300 for NBCC. Thank you for every step, every share and every ask. Jack has made a real difference to the children, young people and vulnerable adults we support across South West Scotland.");
    expect(m.text).toContain("We've made Jack a certificate to say thank you. Print it, frame it, show it off!");
    expect(m.text).toContain("Jack's page stays up, so late gifts still count. And if Jack fancies doing something again, we'd love that.");
    expect(m.html).toContain(">See the certificate</a>");
    const zero = jack("finished", { raisedPence: 0 }).text;
    expect(zero).toContain("Thank you so much for Jack's walk, and for every step, every share and every ask. Jack has made a real difference to");
    expect(james("finished").text).toContain("The page for James stays up, so late gifts still count. And if James fancies doing something again, we'd love that.");
  });

  it("a year ago today", () => {
    const m = jack("year_on");
    expect(m.subject).toBe("A year ago today...");
    expect(m.text).toContain("...Jack did Jack's walk and raised £300 for NBCC. We still smile thinking about it!");
    expect(m.html).toContain("...Jack did <b>Jack&#39;s walk</b> and raised <b>£300</b> for NBCC.");
    expect(m.text).toContain("Fancy doing it again? We've kept the page details, so it only takes a minute to set up a new one.");
    expect(jack("year_on", { raisedPence: 0 }).text).toContain("...Jack did Jack's walk for NBCC. We still smile thinking about it!");
  });

  // Review, 2026-10-04: only a safe first name (one word of letters) ever goes in a subject or a
  // heading. Anything else is "your child", so a strange name can never carry a link or other words.
  it("says your child when the child's name is not a plain first name", () => {
    for (const odd of [{ name: "<b>Jack</b> Example", firstName: "<b>Jack</b>" }, { name: "J4ck Example", firstName: "J4ck" }, { name: "http://bad.example now", firstName: "http://bad.example" }]) {
      for (const kind of TOUCH_KINDS) {
        const m = buildTouchEmail(kind, data(odd));
        expect(m.subject + m.html + m.text).not.toMatch(/<b>Jack<\/b>|J4ck is|J4ck's|J4ck has|J4ck did|bad\.example/i);
        expect(m.text.split("\n")[0]).toBe("Hi Sarah, this is about your child's page.");
      }
    }
    const m = buildTouchEmail("on_track", data({ name: "J4ck Example", firstName: "J4ck" }));
    expect(heading(m.html)).toBe("Your child is doing great!");
    // The subject drops the name, as it does for anyone with no first name to use.
    expect(m.subject).toBe("You're doing great!");
    expect(m.text).toContain("and we just had to say: your child is right on track for the £500 target!");
    expect(m.text).toContain("Share your child's page again");
    expect(heading(buildTouchEmail("halfway", data({ firstName: "J4ck" })).html)).toBe("Your child is halfway there!");
    expect(buildTouchEmail("finished", data({ firstName: "J4ck" })).text).toContain("Your child has made a real difference");
  });

  it("writes the name as the page shows it, whatever capitals were typed", () => {
    expect(buildTouchEmail("on_track", data({ name: "JACK example", firstName: "JACK" })).subject).toBe("Jack is doing great!");
  });
});

describe("an adult's automatic emails", () => {
  it.each(TOUCH_KINDS.map((k) => [k]))("%s is the same with no parent or guardian on the page, however that is stored", (kind) => {
    const adult = buildTouchEmail(kind, data({ guardianFirstName: null }));
    expect(buildTouchEmail(kind, data({ guardianFirstName: undefined }))).toEqual(adult);
    expect(buildTouchEmail(kind, data({ guardianFirstName: "  " }))).toEqual(adult);
    expect(adult.text.split("\n")[0]).toBe("Hi Jack,");
    expect(adult.html + adult.text).not.toContain("this is about");
  });

  it("still speaks to them", () => {
    const adult = (kind: TouchKind) => buildTouchEmail(kind, data({ guardianFirstName: null }));
    expect(heading(adult("on_track").html)).toBe("You're doing great!");
    expect(heading(adult("halfway").html)).toBe("You're halfway there!");
    expect(heading(adult("target").html)).toBe("You did it!");
    expect(adult("first_gift").subject).toBe("Your first gift is in!");
    expect(adult("week_after").text).toContain("So far you've raised £300 for NBCC, which is just fantastic.");
    expect(adult("week_before").text).toContain("Good luck, you've got this!\nNBCC Team");
    expect(adult("first_gift").html).toContain(">See my page</a>");
  });
});
