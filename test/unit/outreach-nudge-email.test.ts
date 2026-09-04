import { describe, it, expect } from "vitest";
import {
  buildOutreachNudge,
  nudgeSubject,
  type OutreachNudge,
} from "../../src/outreach/nudge-email";

// TASK-414: the one follow-up, for a business that did not reply.
//
// A second unanswered email is a nuisance unless it costs the reader nothing. Every test here is
// about that: it says outright that it is the last, the way out comes before the ask, and it is
// short enough to read in the preview pane.

const base: OutreachNudge = {
  businessName: "Ayr Joinery Ltd",
  contactName: "Jane Baxter",
  signerName: "Jaimie Wakefield",
  signerRole: "Project Manager, Night Before Christmas Campaign",
  donateUrl: "https://nbcc.scot/donate",
  privacyUrl: "https://nbcc.scot/privacy",
};
const build = (over: Partial<OutreachNudge> = {}) => buildOutreachNudge({ ...base, ...over });
const mail = build();
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("it makes it easy to say no", () => {
  // The promise that makes a second email acceptable. It has to be in both halves, because the
  // person deciding whether to be annoyed is reading whichever one their client shows.
  it("says outright that this is the last they will hear", () => {
    for (const half of [mail.html, mail.text]) {
      expect(flat(half)).toMatch(/the last you will hear from me/i);
    }
  });

  it("tells them that doing nothing is a complete answer", () => {
    expect(flat(mail.text)).toMatch(/there is nothing you need to do/i);
    expect(flat(mail.html)).toMatch(/we will not write again/i);
  });

  // The way out comes BEFORE the ask. A reader who has decided no should not have to get past a
  // button to find out they can ignore it.
  it("puts the way out above the button", () => {
    const outAt = mail.html.search(/nothing you need to do/i);
    const askAt = mail.html.search(/Become a supporter/);
    expect(outAt).toBeGreaterThan(-1);
    expect(outAt).toBeLessThan(askAt);
  });
});

describe("the subject line", () => {
  // "Following up" and "Just checking in" are what every unwanted second email says. This one
  // tells the truth in the list view, which is where the decision actually gets made.
  it("says what it is rather than sounding like a chase", () => {
    expect(nudgeSubject()).toBe("One last note from us");
    expect(nudgeSubject()).not.toMatch(/following up|checking in|reminder/i);
  });
});

describe("it is short", () => {
  // The whole point. A long second email is worse than none.
  it("is shorter than the first one", () => {
    const words = mail.text.split(/\s+/).length;
    expect(words).toBeLessThan(200);
  });

  it("makes one ask, not several", () => {
    expect((mail.html.match(/Become a supporter/g) ?? []).length).toBe(1);
  });
});

describe("the house rules still apply", () => {
  it("greets the person where we know them, and never the company", () => {
    expect(mail.html).toContain("Hello Jane,");
    expect(build({ contactName: null }).html).toContain("Hello,");
    expect(build({ contactName: null }).html).not.toMatch(/Hello Ayr Joinery/i);
  });

  it("carries the charity registration statement", () => {
    for (const half of [mail.html, mail.text]) {
      expect(half).toContain("SC047995");
    }
  });

  it("links the privacy notice, as the first email did", () => {
    expect(mail.html).toContain("https://nbcc.scot/privacy");
    expect(mail.text).toContain("https://nbcc.scot/privacy");
  });

  it("gives the phone number as well as a reply box", () => {
    expect(mail.text).toContain("01292 811 015");
    expect(mail.html).toContain('href="tel:+441292811015"');
  });

  it("uses no dashes of any kind in the human copy", () => {
    expect(mail.text.replace(/https?:\/\/\S+/g, "")).not.toMatch(/[-–—]/);
  });

  it("pins the colour scheme so dark mode does not invert it", () => {
    expect(mail.html).toContain('name="color-scheme" content="light"');
  });

  it("escapes what a volunteer typed into the business name", () => {
    const risky = build({ businessName: "<script>alert(1)</script> Smith & Sons" });
    expect(risky.html).not.toContain("<script>");
    expect(risky.html).toContain("Smith &amp; Sons");
  });
});
