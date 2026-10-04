import { describe, it, expect } from "vitest";
import { buildTouchEmail, sampleTouchData, touchEmailData, type TouchEmailData } from "../../src/fundraising/touch-emails";
import { TOUCH_KINDS } from "../../src/fundraising/touch-rules";
import { meterBar } from "../../src/email/brand";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";

// TASK-515: the automatic emails to an organiser, in the words Jaimie approved on 2026-10-02 (12 to
// 18), the target one changed as she asked, and two new ones for her to sign off. Every name and
// amount here is invented.

const BASE = "https://nbcc.test";
const data = (over: Partial<TouchEmailData> = {}): TouchEmailData => ({ ...sampleTouchData("first_gift", BASE), ...over });
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&pound;/g, "£");

describe("every automatic email", () => {
  it.each(TOUCH_KINDS.map((k) => [k]))("%s has a subject, an html part and a plain text part, signed and with the questions box", (kind) => {
    const mail = buildTouchEmail(kind, sampleTouchData(kind, BASE));
    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.html).toMatch(/^<!doctype html>/);
    expect(mail.html).toContain("NBCC Team");
    expect(mail.html).toContain("Got any questions?");
    expect(mail.html).toContain("events@nbcc.scot");
    expect(mail.text).toContain("NBCC Team");
    expect(mail.text).toContain("Call us: 01292 811 015");
    expect(mail.text).toContain("Email us: events@nbcc.scot");
    expect(mail.text).toContain("Hi Sam,");
    // No dashes in the words.
    expect(strip(mail.html)).not.toMatch(/[–—]/);
    expect(mail.text).not.toMatch(/[–—]| - /);
  });

  // Jaimie's rule: NBCC supports children, young people and vulnerable adults, never "families".
  it.each(TOUCH_KINDS.map((k) => [k]))("%s never says families, in either part", (kind) => {
    const mail = buildTouchEmail(kind, sampleTouchData(kind, BASE));
    // The words only: the html's styles say font-family, which is not about anyone.
    const words = mail.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    for (const part of [mail.subject, words, mail.text]) expect(part).not.toMatch(/famil(y|ies)/i);
  });

  it("says who NBCC supports in the words Jaimie uses", () => {
    const all = TOUCH_KINDS.map((k) => buildTouchEmail(k, sampleTouchData(k, BASE)).text).join(" ");
    expect(all).toContain("the children, young people and vulnerable adults we support");
  });

  it("escapes everything the organiser typed", () => {
    for (const kind of TOUCH_KINDS) {
      const mail = buildTouchEmail(kind, data({ title: "<b>Bad</b> & co", name: "<i>Al</i> Ex" }));
      expect(mail.html).not.toContain("<b>Bad</b>");
      expect(mail.html).not.toContain("<i>Al</i>");
    }
  });
});

describe("the approved words", () => {
  it("12, the first gift", () => {
    const mail = buildTouchEmail("first_gift", data({ raisedPence: 2000, targetPence: 50000 }));
    expect(mail.subject).toBe("Your first gift is in!");
    expect(mail.html).toContain("Exciting news: someone has just made the very first gift on <b>Sam&#39;s Santa Dash</b>, and your meter has started to fill!");
    expect(mail.html).toContain("The first gift is often the hardest, so this is a lovely moment to celebrate.");
    expect(mail.html).toContain("<b>Top tip:</b> share your page again today. People are more likely to give once they see others already have.");
    expect(mail.html).toContain(">See my page</a>");
    expect(mail.html).toContain("High fives all round,");
    expect(mail.html).toContain("width:4%");
    expect(mail.text).toContain("See my page: https://nbcc.test/fundraise/sams-santa-dash");
  });

  it("13, halfway", () => {
    const mail = buildTouchEmail("halfway", data({ raisedPence: 25000, targetPence: 50000 }));
    expect(mail.subject).toBe("You're halfway there!");
    expect(strip(mail.html)).toContain("Sam&#39;s Santa Dash has raised £250 of your £500 target. That’s amazing! Thank you, and a huge thank you to everyone who has given.");
    expect(mail.html).toContain("The second half often goes faster than the first, so keep sharing. You’ve got this!");
    expect(mail.html).toContain("Onwards and upwards,");
  });

  it("14, the target, changed to cheer them on to beat it, with a button to raise it", () => {
    const mail = buildTouchEmail("target", data({ raisedPence: 50000, targetPence: 50000 }));
    expect(mail.subject).toBe("You did it! Target reached");
    expect(mail.html).toContain("WOW. <b>Sam&#39;s Santa Dash</b> has reached its £500 target! That is a truly wonderful thing to have done for the children, young people and vulnerable adults we support.");
    expect(mail.html).toMatch(/beat your goal/);
    expect(mail.html).toContain(">Raise my target</a>");
    expect(mail.html).toContain('href="https://nbcc.test/fundraise/manage#mineEditHeading"');
    expect(mail.text).toContain("Raise my target: https://nbcc.test/fundraise/manage#mineEditHeading");
    expect(mail.html).toContain("With the biggest thanks,");
  });

  it("15, a week before", () => {
    const mail = buildTouchEmail("week_before", data());
    expect(mail.subject).toBe("One week to go, Sam!");
    expect(mail.html).toContain(
      "<b>Sam&#39;s Santa Dash</b> is just a week away, and we’re so excited for you! Everything you need is ready in your private area: your QR code, your poster and your sponsor form.",
    );
    expect(mail.html).toContain(">Open my private area</a>");
    expect(mail.html).toContain("Good luck, you’ve got this!");
  });

  it("16, a week after, asking them to pay in", () => {
    const mail = buildTouchEmail("week_after", data({ raisedPence: 54000 }));
    expect(mail.subject).toBe("How did it go?");
    expect(mail.html).toContain("We hope <b>Sam&#39;s Santa Dash</b> was a brilliant day! So far you’ve raised <b>£540</b> for NBCC, which is just fantastic.");
    expect(mail.html).toContain("Collected some cash or sponsor money?");
    expect(mail.html).toContain(">Pay in what I collected</a>");
    expect(mail.html).toContain("Please send us any paper sponsor forms too, so we can claim Gift Aid on them.");
  });

  it("16 leaves out the total when nothing has come in yet", () => {
    const mail = buildTouchEmail("week_after", data({ raisedPence: 0 }));
    expect(mail.html).toContain("We hope <b>Sam&#39;s Santa Dash</b> was a brilliant day!");
    expect(mail.html).not.toContain("£0");
  });

  it("17, finished, with the certificate", () => {
    const mail = buildTouchEmail("finished", data({ raisedPence: 61200 }));
    expect(mail.subject).toBe("Thank you from all of us at NBCC");
    expect(mail.html).toContain(
      "<b>Sam&#39;s Santa Dash</b> raised an incredible <b>£612</b> for NBCC. Thank you for every step, every share and every ask. You’ve made a real difference to the children, young people and vulnerable adults we support.",
    );
    expect(mail.html).toContain(">See my certificate</a>");
    expect(mail.html).toContain('href="https://nbcc.test/api/fundraise/manage/fundraisers/7/materials/certificate"');
    expect(mail.html).toContain("With love and huge thanks,");
  });

  it("17 with nothing raised thanks them without an amount (new wording)", () => {
    const mail = buildTouchEmail("finished", data({ raisedPence: 0 }));
    expect(mail.html).toContain("Thank you so much for <b>Sam&#39;s Santa Dash</b>, and for every step, every share and every ask.");
    expect(mail.html).not.toContain("£0");
  });

  it("18, a year on", () => {
    const mail = buildTouchEmail("year_on", data({ raisedPence: 61200 }));
    expect(mail.subject).toBe("A year ago today...");
    expect(mail.html).toContain("&hellip;you did <b>Sam&#39;s Santa Dash</b> and raised <b>£612</b> for NBCC. We still smile thinking about it!");
    expect(mail.html).toContain(">Do it again</a>");
    expect(mail.html).toContain("Here all year, and here for you,");
  });
});

describe("the two new ones, for sign off", () => {
  it("need a hand offers posters, a bucket, a shout out and the help page", () => {
    const mail = buildTouchEmail("need_a_hand", data({ raisedPence: 12000 }));
    expect(mail.subject).toBe("Need a hand, Sam?");
    const words = strip(mail.html);
    expect(words).toMatch(/posters/i);
    expect(words).toMatch(/bucket/i);
    expect(words).toMatch(/shout out/i);
    expect(mail.html).toContain('href="https://nbcc.test/fundraise/help"');
    // Never tells them they are behind.
    expect(words).not.toMatch(/behind|only raised|under a third/i);
  });

  it("you're doing great cheers them on with their meter", () => {
    const mail = buildTouchEmail("on_track", data({ raisedPence: 30000, targetPence: 50000 }));
    expect(mail.subject).toBe("You're doing great, Sam!");
    expect(mail.html).toContain("width:60%");
    expect(mail.html).toContain(">See my page</a>");
  });
});

describe("the meter line", () => {
  it("fills to the percentage, held at 100", () => {
    expect(meterBar(25000, 50000)).toContain("width:50%");
    expect(meterBar(70000, 50000)).toContain("width:100%");
    expect(meterBar(25000, 50000)).toContain("£250");
    expect(meterBar(25000, 50000)).toContain("raised of £500");
  });

  it("is a plain total when there is no target", () => {
    const line = meterBar(2000, null);
    expect(line).toContain("£20");
    expect(line).toContain("raised so far");
    expect(line).not.toContain("width:");
  });
});

describe("the details from a real fundraiser", () => {
  it("are its first name, title, money and links", () => {
    const f = {
      id: 12, slug: "robins-walk", name: "Robin Sample", title: "Robin's Walk", targetPence: 30000,
      meter: meter({ onlinePence: 12000, cashPence: 500, targetPence: 30000 }),
    } as unknown as FundraiserRecord & { meter: ReturnType<typeof meter> };
    const d = touchEmailData(f, "https://nbcc.test/");
    expect(d).toMatchObject({ name: "Robin Sample", title: "Robin's Walk", raisedPence: 12500, targetPence: 30000 });
    expect(d.urls.page).toBe("https://nbcc.test/fundraise/robins-walk");
    expect(d.urls.certificate).toBe("https://nbcc.test/api/fundraise/manage/fundraisers/12/materials/certificate");
    expect(d.urls.signUp).toBe("https://nbcc.test/fundraise");
  });
});

// A page for someone under 18: the email goes to their parent or guardian (greetGuardian says hello
// to them), so a subject must not speak to the child by name. Invented names.
describe("a subject on a page for someone under 18", () => {
  const child = (over: Partial<TouchEmailData> = {}) => data({ name: "Jack Example", firstName: "Jack", guardianFirstName: "Sarah", ...over });

  it("reads right for the parent, where an adult's has their first name", () => {
    expect(buildTouchEmail("week_before", child()).subject).toBe("One week to go for Jack!");
    expect(buildTouchEmail("need_a_hand", child()).subject).toBe("Can we give you and Jack a hand?");
    expect(buildTouchEmail("on_track", child()).subject).toBe("Jack is doing great!");
  });

  it("never needs a possessive, so a name ending in s reads well", () => {
    for (const kind of ["week_before", "need_a_hand", "on_track"] as const) {
      const subject = buildTouchEmail(kind, child({ name: "James Example", firstName: "James" })).subject;
      expect(subject).toContain("James");
      expect(subject).not.toMatch(/James['’]/);
    }
  });

  it("no subject speaks to the child", () => {
    for (const kind of TOUCH_KINDS) expect(buildTouchEmail(kind, child()).subject).not.toMatch(/, Jack[!?]/);
  });

  it("leaves an adult's subjects as they were", () => {
    const adult = data({ name: "Jack Example", firstName: "Jack" });
    expect(buildTouchEmail("week_before", adult).subject).toBe("One week to go, Jack!");
    expect(buildTouchEmail("need_a_hand", adult).subject).toBe("Need a hand, Jack?");
    expect(buildTouchEmail("on_track", adult).subject).toBe("You're doing great, Jack!");
  });

  it("is carried from the stored fundraiser", () => {
    const f = { id: 7, slug: "jacks-walk", name: "Jack Example", firstName: "Jack", guardianFirstName: "Sarah", title: "Jack's walk", targetPence: 50000, meter: { raisedPence: 100 } };
    expect(buildTouchEmail("week_before", touchEmailData(f, BASE)).subject).toBe("One week to go for Jack!");
  });
});
