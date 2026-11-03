import { describe, it, expect } from "vitest";
import { buildSignInCodeEmail, dearGreeting } from "../../src/fundraising/emails";
import { buildMemoryReceiptEmail } from "../../src/fundraising/signup-tidy-emails";
import { buildInMemoryApprovedEmail } from "../../src/fundraising/memory-emails";
import { buildSupporterThanksEmail } from "../../src/fundraising/thanks-email";
import { buildInviteEmail } from "../../src/fundraising/team-emails";

// Every email about a page in memory of someone, to a family or a funeral director (Jaimie,
// 2026-10-04): it opens "Dear [first name]," ("Hello," when there is no first name we can use), has
// "In memory" above the heading, signs off "With warmest thoughts,", and has no exclamation marks.
// Every name here is invented.

const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "\u00a6");

const invite = (firstName: string) => buildInviteEmail({ firstName, note: "It was good to talk today.", signer: "Fern", url: "https://nbcc.test/fundraise?invite=x", type: "memory" });
const live = (over: object = {}) => buildInMemoryApprovedEmail({ name: "Sam Example", firstName: "Sam", memoryName: "Pat Example", setupBy: "family", ...over }, { pageUrl: "https://nbcc.test/fundraise/pat" });
const thanks = (giverName?: string | null) => buildSupporterThanksEmail({ organiserName: "Sam Example", title: "For Pat", message: "Thank you all.", inMemory: true, giverName, baseUrl: "https://nbcc.test" });

const named: Array<[string, { subject: string; html: string; text: string }]> = [
  ["13 the in memory invite", invite("Sam")],
  ["34 we have your details", buildMemoryReceiptEmail("Sam Example")],
  ["35 the page is live, family", live()],
  ["36 the page is live, funeral director", live({ setupBy: "funeral_director" })],
  ["33 a thank you, in memory", thanks("Sam Example")],
  ["4 the sign in code, in memory", buildSignInCodeEmail("Sam Example", "123456", { gentle: true })],
];

describe("dearGreeting", () => {
  it("is Dear and the first name, or Hello with none", () => {
    expect(dearGreeting("Sam")).toBe("Dear Sam,");
    expect(dearGreeting(null)).toBe("Hello,");
    expect(dearGreeting("  ")).toBe("Hello,");
  });
});

describe("every in memory email", () => {
  it.each(named)("%s opens Dear and the first name", (_name, m) => {
    expect(m.text).toContain("Dear Sam,\n");
    expect(m.html).toContain(">Dear Sam,</p>");
    expect(m.html + m.text).not.toMatch(/\bHi\b/);
  });

  it.each(named)("%s signs off With warmest thoughts", (_name, m) => {
    // The charity, 2026-10-04: every in memory email is signed by Jodie, the invite included.
    expect(m.text).toMatch(/With warmest thoughts,\nJodie\nNBCC Team/);
    expect(words(m.html)).toMatch(/With warmest thoughts,\u00a6+Jodie\u00a6+NBCC Team/);
    expect(m.html + m.text).not.toContain("With warm wishes");
  });

  it.each(named)("%s has In memory above the heading", (_name, m) => {
    expect(m.html).toMatch(/text-transform:uppercase[^>]*>In memory<\/p><h1/);
    expect(m.html).not.toContain("Fundraising for NBCC");
  });

  it.each(named)("%s has no exclamation marks", (_name, m) => {
    expect(m.subject).not.toContain("!");
    expect(m.text).not.toContain("!");
    expect(words(m.html)).not.toContain("!");
  });
});

describe("with no first name we can use", () => {
  it("each opens Hello, and never Dear with a business's name or nothing", () => {
    const none = [
      invite("  "),
      buildMemoryReceiptEmail("4x4 Club"),
      buildMemoryReceiptEmail(null),
      live({ name: "The Example Funeral Home", firstName: null, setupBy: "funeral_director" }),
      live({ name: "", firstName: null }),
      thanks(null),
      thanks("4x4 Club"),
      buildSignInCodeEmail("4x4 Club", "123456", { gentle: true }),
    ];
    for (const m of none) {
      expect(m.text).toContain("Hello,\n");
      expect(m.html).toContain(">Hello,</p>");
      expect(m.html + m.text).not.toMatch(/\bDear\b|\bHi\b/);
    }
  });
});

describe("the sign in code", () => {
  const gentle = buildSignInCodeEmail("Sam Example", "123456", { gentle: true });
  const usual = buildSignInCodeEmail("Sam Example", "123456");

  it("is gentle for a page in memory: the same code and the same practical words", () => {
    expect(gentle.subject).toBe(usual.subject);
    expect(gentle.text).toContain("Your code: 123456");
    expect(gentle.text).toContain("Here's your code to open your private fundraising area. It works for 10 minutes.");
    expect(gentle.text).toContain("Nobody can get in without the code.");
    expect(gentle.html + gentle.text).not.toContain("Happy fundraising");
  });

  it("is as it always was for everyone else", () => {
    expect(usual.text).toContain("Hi Sam,");
    expect(usual.text).toContain("Happy fundraising!\nNBCC Team");
    expect(usual.html).toContain(">Fundraising for NBCC</p>");
    expect(buildSignInCodeEmail("Sam Example", "123456", { gentle: false })).toEqual(usual);
  });
});

describe("a thank you from the fundraiser, on any other page", () => {
  it("is as it always was: Hello, with no name, and Thanks so much", () => {
    const usual = buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you all.", giverName: "Alex Example", baseUrl: "https://nbcc.test" });
    expect(usual.text).toContain("Hello,\n");
    expect(usual.text).not.toContain("Dear");
    expect(usual.text).toContain("Thanks so much,\nNBCC Team");
    expect(usual).toEqual(buildSupporterThanksEmail({ organiserName: "Sam Example", title: "Sam's Santa Dash", message: "Thank you all.", baseUrl: "https://nbcc.test" }));
  });
});
