import { describe, it, expect } from "vitest";
import {
  buildApprovedEmail,
  buildEditApprovedEmail,
  buildEditRejectedEmail,
  buildNewsApprovedEmail,
  buildNewsRejectedEmail,
  organiserFirstName,
  organiserGreeting,
} from "../../src/fundraising/emails";
import { buildTouchEmail, sampleTouchData, touchEmailData } from "../../src/fundraising/touch-emails";
import { TOUCH_KINDS, type TouchKind } from "../../src/fundraising/touch-rules";
import { buildTeamLiveEmail, buildTeamNudgeEmail } from "../../src/fundraising/team-page-emails";

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

// Review (PR #655): the same for every email that names the organiser. A title is no one's first
// name either; the automatic emails drop the name from their subject when there is none to use; and
// the team organiser's emails greet the same way. Which automatic emails exist is unchanged.
describe("a title is not a first name", () => {
  it("uses the word after the title", () => {
    for (const title of ["Mr", "Mrs", "Ms", "Miss", "Dr", "Rev", "Sir", "Cllr", "dr.", "MRS"]) {
      expect(organiserGreeting({ name: `${title} Sam Example` }), title).toBe("Hi Sam,");
    }
    expect(organiserFirstName({ name: "Dr Sam Example" })).toBe("Sam");
  });

  it("says Hi there when a title is all there is", () => {
    expect(organiserGreeting({ name: "Dr" })).toBe("Hi there,");
    expect(organiserGreeting({ name: "Dr Sam Example", firstName: "Dr" })).toBe("Hi there,");
    expect(organiserGreeting({ name: "Mrs The Example" })).toBe("Hi there,");
    expect(organiserFirstName({ name: "The Red Lion" })).toBeNull();
  });
});

describe("the automatic emails", () => {
  const BASE = "https://nbcc.test";
  const pub = (kind: TouchKind) => buildTouchEmail(kind, { ...sampleTouchData(kind, BASE), name: "The Red Lion" });

  it.each(TOUCH_KINDS.map((k) => [k]))("%s never calls a group The", (kind) => {
    const m = pub(kind);
    expect(m.text).toContain("Hi there,");
    expect(m.html).toContain("Hi there,");
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/Hi The,|, The[!?]/);
  });

  it("drop the name from the subject when there is no first name to use", () => {
    expect(pub("week_before").subject).toBe("One week to go!");
    expect(pub("need_a_hand").subject).toBe("Need a hand?");
    expect(pub("on_track").subject).toBe("You're doing great!");
  });

  it("keep the name in the subject for a person, as approved", () => {
    const sam = (kind: TouchKind) => buildTouchEmail(kind, sampleTouchData(kind, BASE)).subject;
    expect(sam("week_before")).toBe("One week to go, Sam!");
    expect(sam("need_a_hand")).toBe("Need a hand, Sam?");
    expect(sam("on_track")).toBe("You're doing great, Sam!");
  });

  it("use the first name given on the form, and know the name an event is credited to", () => {
    const record = { id: 1, slug: "x", title: "T", targetPence: null, meter: { raisedPence: 0 } };
    const stored = touchEmailData({ ...record, name: "The Red Lion", firstName: "Sam", creditName: "The Red Lion" } as never, BASE);
    expect(buildTouchEmail("week_before", stored).subject).toBe("One week to go, Sam!");
    const group = touchEmailData({ ...record, name: "Exampleton Rotary", firstName: null, creditName: "Exampleton Rotary" } as never, BASE);
    expect(buildTouchEmail("week_before", group).subject).toBe("One week to go!");
    expect(buildTouchEmail("week_before", group).text).toContain("Hi there,");
  });
});

describe("the team organiser's emails", () => {
  const team = { title: "Exampleton Juniors", kind: "santa_dash", kindOther: null, eventDate: null } as never as Parameters<typeof buildTeamLiveEmail>[0];
  const live = (who: Record<string, unknown>) =>
    buildTeamLiveEmail({ ...(team as object), ...who } as Parameters<typeof buildTeamLiveEmail>[0], { pageUrl: "https://nbcc.test/fundraise/ej", manageUrl: "m", joinUrl: "j", invited: 0 });
  const nudge = (who: Record<string, unknown>) =>
    buildTeamNudgeEmail(1, { title: "Exampleton Juniors", pageUrl: "p", joinUrl: "j", ...who } as Parameters<typeof buildTeamNudgeEmail>[1]);

  it("greet a group with Hi there, and a person by their first name", () => {
    for (const build of [live, nudge]) {
      expect(build({ name: "The Red Lion" }).text).toContain("Hi there,");
      expect(build({ name: "The Red Lion" }).text).not.toContain("Hi The,");
      expect(build({ name: "Dr Robin Organiser" }).text).toContain("Hi Robin,");
      expect(build({ name: "Robin Organiser" }).text).toContain("Hi Robin,");
      expect(build({ name: "The Red Lion", firstName: "Robin" }).text).toContain("Hi Robin,");
    }
  });
});
