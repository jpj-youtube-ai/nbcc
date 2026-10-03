import { describe, it, expect } from "vitest";
import {
  buildApprovedEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  buildNewsApprovedEmail,
  buildNewsRejectedEmail,
  organiserGreeting,
} from "../../src/fundraising/emails";

// Jaimie, 2026-10-03: "Your update is live" greeted a pub by "Hi The,". These emails greeted by the
// first word of the organiser's name, which for a group or a business is no one's first name. They
// greet by the person's own first name when we have it, and say "Hi there," to a group. Every name
// here is invented.

const TITLE = "Exampleton Quiz Night";
const PAGE = "https://nbcc.scot/event/eqn";

describe("how an organiser is greeted", () => {
  it("uses the first name they gave on the form", () => {
    expect(organiserGreeting({ name: "Sam Example", firstName: "Sam" })).toBe("Hi Sam,");
    expect(organiserGreeting({ name: "The Red Lion", firstName: "sam", creditName: "The Red Lion" })).toBe("Hi Sam,");
    expect(organiserGreeting({ name: "Mary Anne Example", firstName: " Mary Anne " })).toBe("Hi Mary,");
  });

  it("uses the first word of their name for a sign up from before first names were asked", () => {
    expect(organiserGreeting({ name: "Sam Example" })).toBe("Hi Sam,");
    expect(organiserGreeting({ name: "robin o'example", firstName: null })).toBe("Hi Robin,");
  });

  it("says Hi there to a group or a business", () => {
    expect(organiserGreeting({ name: "The Red Lion" })).toBe("Hi there,");
    expect(organiserGreeting({ name: "the red lion", firstName: null, creditName: null })).toBe("Hi there,");
    // The name they gave is the one their event is credited to: a group's, not a person's.
    expect(organiserGreeting({ name: "Exampleton Rotary", creditName: "exampleton rotary " })).toBe("Hi there,");
    // "The" typed into the first name box is still no one's first name.
    expect(organiserGreeting({ name: "The Red Lion", firstName: "The" })).toBe("Hi there,");
    expect(organiserGreeting({ name: "" })).toBe("Hi there,");
  });

  it("still greets a person whose event is credited to their group", () => {
    expect(organiserGreeting({ name: "Sam Example", creditName: "The Red Lion" })).toBe("Hi Sam,");
  });
});

describe("the emails that greet an organiser", () => {
  const pub = { name: "The Red Lion", title: TITLE, creditName: "The Red Lion" };
  const mails = () => [
    buildEditApprovedEmail(pub, { pageUrl: PAGE }),
    buildEditApprovedEmail(pub, { pageUrl: null }),
    buildEditRejectedEmail(pub, { pageLive: true }),
    buildNewsApprovedEmail(pub, { pageUrl: PAGE }),
    buildNewsRejectedEmail(pub, { pageLive: true }),
    buildApprovedEmail({ ...pub, path: "event", booking: "door" }, { pageUrl: PAGE, manageUrl: "https://nbcc.scot/fundraise/manage" }),
    buildApprovedEmail({ ...pub, path: "raising" }, { pageUrl: null, manageUrl: null }),
  ];

  it("never say Hi The, to a group", () => {
    for (const m of mails()) {
      expect(m.text, m.subject).toContain("Hi there,");
      expect(m.html, m.subject).toContain("Hi there,");
      expect(`${m.text}${m.html}`, m.subject).not.toContain("Hi The,");
    }
  });

  it("greet a person by the first name they gave, as before", () => {
    const sam = { name: "Sam Example", firstName: "Sam", title: TITLE };
    expect(buildEditApprovedEmail(sam, { pageUrl: PAGE }).text).toContain("Hi Sam,");
    expect(buildNewsApprovedEmail(sam, { pageUrl: PAGE }).text).toContain("Hi Sam,");
    expect(buildNewsApprovedEmail({ name: "Sam Example", title: TITLE }, { pageUrl: PAGE }).html).toContain("Hi Sam,");
  });
});
