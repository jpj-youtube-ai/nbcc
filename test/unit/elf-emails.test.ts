import { describe, it, expect } from "vitest";
import { badgeWords, buildElfSignInCodeEmail, buildElfWelcomeEmail } from "../../src/elf/emails";

// NBCC Elf Detective School: the welcome email and the sign in code. Every family is invented.

const welcome = () =>
  buildElfWelcomeEmail({
    grownUpName: "Sam Example",
    detectives: [
      { name: "Detective Ruby Tinselfoot", badge: badgeWords(1) },
      { name: "Detective Leo Frostwhistle", badge: badgeWords(42) },
    ],
    hqUrl: "https://nbcc.scot/elf/hq",
    signInUrl: "https://nbcc.scot/elf/sign-in",
    firstClueAt: new Date("2026-12-01T17:30:00.000Z"),
  });

describe("the welcome email", () => {
  it("names each detective by detective name, with their badge number", () => {
    const e = welcome();
    expect(badgeWords(1)).toBe("EDS 0001");
    expect(e.html).toContain("Detective Ruby Tinselfoot");
    expect(e.html).toContain("EDS 0042");
    expect(e.text).toContain("Detective Leo Frostwhistle, badge EDS 0042");
    expect(e.subject).toContain("Welcome to NBCC Elf Detective School");
  });

  it("says when school starts and how to sign in", () => {
    const e = welcome();
    expect(e.text).toContain("Tuesday 1 December at 5:30pm");
    expect(e.text).toContain("https://nbcc.scot/elf/sign-in");
    expect(e.html).toContain('href="https://nbcc.scot/elf/hq');
  });

  it("greets the grown up by first name only", () => {
    expect(welcome().text.startsWith("Hi Sam,")).toBe(true);
  });

  // The paper wardrobe (docs/superpowers/specs/2026-11-04-elf-paper-design.md): two costumes unlock
  // with every door done, so the email says costumes and doors, not clothes and finding elves.
  it("says that more costumes unlock as the detectives crack doors", () => {
    const e = welcome();
    expect(e.text).toContain("More costumes unlock as they crack doors in December.");
    expect(e.html).toContain("More costumes unlock as they crack doors in December.");
    expect(e.text).not.toContain("clothes");
  });

  it("uses no dashes, and says what money could do", () => {
    const e = welcome();
    const words = `${e.subject}\n${e.text}`;
    expect(words).not.toMatch(/[‒–—―]| - /);
    for (const line of e.text.split("\n")) {
      if (/\b(pounds?|gifts?|donations?|money)\b[^.]*\b(helps?|pays?|buys?|will)\b/i.test(line)) expect(line).toMatch(/\bcould\b/);
    }
  });
});

describe("the sign in code", () => {
  it("carries the code and no link", () => {
    const e = buildElfSignInCodeEmail("123456");
    expect(e.text).toContain("123456");
    expect(e.subject).toBe("Your Elf Detective School sign in code: 123 456");
    expect(e.html).not.toMatch(/href="https?:\/\/[^"]*elf/);
  });
});
