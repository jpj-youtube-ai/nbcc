import { describe, it, expect } from "vitest";
import {
  buildTeamLiveEmail,
  buildTeamInviteEmail,
  buildTeamInviteReminderEmail,
  buildTeamNudgeEmail,
  buildJoinThanksEmail,
  buildJoinStaffEmail,
  buildMemberRemovedStaffEmail,
  buildHandoverCodeEmail,
  teamEventWords,
  NOT_FOR_YOU,
  INVITE_NOT_FOR_YOU,
} from "../../src/fundraising/team-page-emails";

// Team pages (Jaimie, 2026-10-03): the emails. Every email to someone who did not sign up with us
// themselves says why they got it, who asked, and that they can ask NBCC (the events inbox and the
// phone). The person who runs a team is always the "team organiser", never the captain. Every name,
// team and address here is invented.

const both = (m: { html: string; text: string }) => `${m.html}\n${m.text}`;

function neverSays(m: { subject: string; html: string; text: string }) {
  // The shell's styles say font-family; the words never say family or families.
  for (const part of [m.subject, m.html.replace(/font-family/g, ""), m.text]) {
    expect(part).not.toMatch(/captain/i);
    expect(part).not.toMatch(/famil(y|ies)/i);
  }
}

const team = {
  title: "Exampleton Juniors",
  name: "Robin Organiser",
  kind: "santa_dash",
  kindLabel: "Santa dash",
  kindOther: null,
  eventDate: "2026-12-05",
};

describe("what the team is doing, in words", () => {
  it("is the kind and the date", () => {
    expect(teamEventWords(team)).toBe("their Santa dash on Saturday 5 December");
    expect(teamEventWords({ ...team, eventDate: null })).toBe("their Santa dash");
    expect(teamEventWords({ ...team, kind: "other", kindLabel: "Other", kindOther: "Sponsored silence" })).toBe("their sponsored silence on Saturday 5 December");
  });
});

describe("your team page is live", () => {
  const m = buildTeamLiveEmail(team, {
    pageUrl: "https://nbcc.scot/fundraise/ej",
    manageUrl: "https://nbcc.scot/fundraise/manage",
    joinUrl: "https://nbcc.scot/fundraise/ej/join",
    invited: 3,
  });

  it("always carries the join link and a ready to forward message", () => {
    expect(m.subject).toBe("Your team page is live: Exampleton Juniors");
    expect(both(m)).toContain("https://nbcc.scot/fundraise/ej/join");
    expect(m.text).toContain("I've set up a team, Exampleton Juniors");
    expect(m.html).toContain("Copy and send this to your team");
  });

  it("says who has been invited, and that the link is in their private area too", () => {
    expect(m.text).toContain("We’ve emailed an invite to the 3 people you added.");
    expect(m.text).toContain("Your private area");
    expect(buildTeamLiveEmail(team, { pageUrl: "p", manageUrl: "m", joinUrl: "j", invited: 1 }).text).toContain("the 1 person you added");
    expect(buildTeamLiveEmail(team, { pageUrl: "p", manageUrl: "m", joinUrl: "j", invited: 0 }).text).not.toContain("emailed an invite");
  });

  it("calls them the team organiser, with the questions box", () => {
    expect(m.text).toContain("team organiser");
    expect(both(m)).toContain("events@nbcc.scot");
    expect(both(m)).toContain("01292 811 015");
    neverSays(m);
  });

  it("for a team kept off the website, says it is approved, with the join link and no page button", () => {
    const x = buildTeamLiveEmail(team, { pageUrl: null, manageUrl: "https://nbcc.scot/fundraise/manage", joinUrl: "https://nbcc.scot/fundraise/ej/join", invited: 0 });
    expect(x.subject).toBe("Your team is approved: Exampleton Juniors");
    expect(x.text).toContain("https://nbcc.scot/fundraise/ej/join");
    expect(x.text).not.toContain("See our team page");
    expect(x.text).toContain("is approved");
  });

  it("escapes the team name", () => {
    const x = buildTeamLiveEmail({ ...team, title: "<b>Team</b>" }, { pageUrl: "p", manageUrl: "m", joinUrl: "j", invited: 0 });
    expect(x.html).not.toContain("<b>Team</b>");
  });
});

describe("the invite to someone the team organiser added", () => {
  const m = buildTeamInviteEmail({ firstName: "Jack", organiserName: "Robin Organiser", team, joinUrl: "https://nbcc.scot/fundraise/ej/join?invite=abc" });

  it("says, kindly, why they got it and who asked", () => {
    expect(m.subject).toBe("Robin has invited you to join Exampleton Juniors");
    expect(m.text).toContain(
      "Robin Organiser gave us your email so we could invite you (or Jack, if this is a parent or guardian’s email) to join Exampleton Juniors for their Santa dash on Saturday 5 December.",
    );
    expect(m.text).toContain("Robin is the team organiser");
  });

  it("says questions can still come to NBCC: a reply, the events inbox or the phone", () => {
    expect(m.text).toContain("reply to this email, email events@nbcc.scot or call 01292 811 015");
  });

  it("has the button to the prefilled join form, and the footer line", () => {
    expect(m.html).toContain('href="https://nbcc.scot/fundraise/ej/join?invite=abc"');
    expect(m.html).toContain("Join the team");
    // Review: the invite says a reminder may follow; the reminder says it is the last.
    expect(both(m)).toContain(INVITE_NOT_FOR_YOU);
    expect(INVITE_NOT_FOR_YOU).toBe("Not for you? Just ignore this. We’ll send one gentle reminder at most, then we won’t email you again.");
    expect(m.text).not.toContain(NOT_FOR_YOU);
    expect(NOT_FOR_YOU).toBe("Not for you? Ignore this and we won’t email again.");
    neverSays(m);
  });

  it("escapes what the team organiser typed", () => {
    const x = buildTeamInviteEmail({ firstName: "<i>J</i>", organiserName: "R <script>", team, joinUrl: "j" });
    expect(x.html).not.toContain("<script>");
    expect(x.html).not.toContain("<i>J</i>");
  });
});

describe("the one reminder", () => {
  const m = buildTeamInviteReminderEmail({ firstName: "Jack", organiserName: "Robin Organiser", team, joinUrl: "https://nbcc.scot/fundraise/ej/join?invite=abc" });

  it("is gentle, says again why they got it and who asked, and that it is the only one", () => {
    expect(m.subject).toBe("A gentle reminder: join Exampleton Juniors");
    expect(m.text).toContain("Robin Organiser gave us your email");
    expect(m.text).toContain("Robin is the team organiser");
    expect(m.text).toContain("This is the only reminder we’ll send.");
    expect(both(m)).toContain(NOT_FOR_YOU);
    expect(m.text).toContain("events@nbcc.scot or call 01292 811 015");
    neverSays(m);
  });
});

describe("the nudges to the team organiser", () => {
  const o = { name: "Robin Organiser", title: "Exampleton Juniors", pageUrl: "https://nbcc.scot/fundraise/ej", joinUrl: "https://nbcc.scot/fundraise/ej/join" };

  it("asks on day 3 whether they sent the invite, with the link to share", () => {
    const m = buildTeamNudgeEmail(1, o);
    expect(m.subject).toBe("Did you send the invite to your team?");
    expect(m.text).toContain("Hi Robin,");
    expect(m.text).toContain("Here’s the link to share with them");
    expect(m.text).toContain("https://nbcc.scot/fundraise/ej/join");
    expect(m.text).toContain("I've set up a team");
    neverSays(m);
  });

  it("is the last nudge on day 10", () => {
    const m = buildTeamNudgeEmail(2, o);
    expect(m.subject).toBe("Nobody on Exampleton Juniors yet: here’s your team link again");
    expect(m.text).toContain("We won’t nudge you about this again.");
    neverSays(m);
  });
});

describe("after someone joins", () => {
  it("thanks them, with only a safe first name and the approved team's name", () => {
    const m = buildJoinThanksEmail("Jack <b>", "Exampleton Juniors");
    expect(m.subject).toBe("Thanks for joining Exampleton Juniors!");
    expect(m.text).toContain("Hi Jack,");
    expect(m.text).toContain("we’ll email you the link to your own page");
    expect(m.html).not.toContain("<b>");
    neverSays(m);
    expect(buildJoinThanksEmail("1234", "T").text).toContain("Hi there,");
  });

  it("tells the events inbox, with the team, to approve in the admin", () => {
    const m = buildJoinStaffEmail(
      { name: "Jack Sample", email: "parent@example.com", title: "Jack's page for Exampleton Juniors", targetPence: 5000, description: "For Christmas." },
      { title: "Exampleton Juniors", name: "Robin Organiser" },
      { adminUrl: "https://nbcc.scot/admin", split: "50% to NBCC, the rest to Exampleton Food Larder (the whole team’s split)" },
    );
    expect(m.subject).toBe("New team member: Jack Sample wants to join Exampleton Juniors");
    expect(m.text).toContain("Approve or decline it in Admin > Fundraising");
    expect(m.text).toContain("Team organiser: Robin Organiser");
    expect(m.text).toContain("Target: £50");
    expect(m.text).toContain("50% to NBCC");
    neverSays(m);
  });
});

describe("a member taken off the team", () => {
  it("tells the events inbox who did it", () => {
    const m = buildMemberRemovedStaffEmail({ memberName: "Jack Sample", teamTitle: "Exampleton Juniors", organiserName: "Robin Organiser" }, { adminUrl: "https://nbcc.scot/admin" });
    expect(m.subject).toBe("Jack Sample was taken off Exampleton Juniors");
    expect(m.text).toContain("Robin Organiser, the team organiser, took Jack Sample off Exampleton Juniors");
    expect(m.text).toContain("Their page stays up as their own");
    neverSays(m);
  });
});

describe("the handover code", () => {
  it("says why, carries the code and where to put it, and how long it works", () => {
    const m = buildHandoverCodeEmail({ firstName: "Sam", teamTitle: "Exampleton Juniors", code: "123456", manageUrl: "https://nbcc.scot/fundraise/manage" });
    expect(m.subject).toBe("Your code to become team organiser of Exampleton Juniors");
    expect(m.text).toContain("Hi Sam,");
    expect(m.text).toContain("We’ve been asked to make you the team organiser of Exampleton Juniors.");
    expect(both(m)).toContain("123456");
    expect(m.text).toContain("https://nbcc.scot/fundraise/manage");
    expect(m.text).toContain("It works for 3 days.");
    expect(m.text).toContain("Not expecting this? Ignore it and nothing changes.");
    expect(both(m)).toContain("01292 811 015");
    neverSays(m);
  });
});

// The team organiser ticked "This person is under 18" beside someone they added: the email box was
// their parent's or guardian's, so the invite and its one reminder speak to the parent. Invented names.
describe("the invite for someone under 18, to their parent or guardian", () => {
  const o = { firstName: "Jack", organiserName: "Robin Organiser", team, joinUrl: "https://nbcc.scot/fundraise/ej/join?invite=abc", under18: true };
  const m = buildTeamInviteEmail(o);
  const r = buildTeamInviteReminderEmail(o);

  it("says in the subject who is invited, so the parent is not asked to join", () => {
    expect(m.subject).toBe("Robin has invited Jack to join Exampleton Juniors");
    expect(r.subject).toBe("A gentle reminder: Jack is invited to join Exampleton Juniors");
  });

  it("says why the parent got it, with no maybe about whose email it is", () => {
    const why = "Robin Organiser gave us your email, as the parent or guardian of Jack, so we could invite Jack to join Exampleton Juniors for their Santa dash on Saturday 5 December.";
    expect(m.text).toContain(why);
    expect(r.text).toContain(why);
    expect(both(m) + both(r)).not.toContain("if this is a parent or guardian");
  });

  it("tells the parent they set the page up", () => {
    expect(m.text).toContain("Robin is the team organiser. Joining takes a couple of minutes: Jack gets a page with a meter, and everything it raises counts towards the team’s total too.");
    expect(m.text).toContain("As Jack is under 18, you set up the page as the parent or guardian, and can name Jack on it.");
    expect(m.html).toContain("Jack is invited to join a team!");
    expect(r.html).toContain("Still keen for Jack to join Exampleton Juniors?");
  });

  it("keeps the button, the questions and the way out, with no possessive on the name", () => {
    for (const x of [m, r]) {
      expect(x.text).toContain("Join the team: https://nbcc.scot/fundraise/ej/join?invite=abc");
      expect(x.text).toContain("reply to this email, email events@nbcc.scot or call 01292 811 015");
      expect(both(x)).not.toMatch(/Jack['’]s/);
      neverSays(x);
    }
    expect(m.text).toContain(INVITE_NOT_FOR_YOU);
    expect(r.text).toContain(NOT_FOR_YOU);
  });

  it("escapes the name", () => {
    expect(buildTeamInviteEmail({ ...o, firstName: "<i>J</i>" }).html).not.toContain("<i>J</i>");
  });

  // Review: the name the team organiser typed goes in a subject line, so only a safe first name
  // does (one word of letters); anything else is "your child", and the email still goes.
  it("never puts a strange name in the subject or the heading", () => {
    for (const odd of ["Jack123", "http://x.example", "J".repeat(30), "<b>"]) {
      const x = buildTeamInviteEmail({ ...o, firstName: odd });
      const y = buildTeamInviteReminderEmail({ ...o, firstName: odd });
      expect(x.subject).toBe("Robin has invited your child to join Exampleton Juniors");
      expect(x.html).toContain("Your child is invited to join a team!");
      expect(y.subject).toBe("A gentle reminder: your child is invited to join Exampleton Juniors");
      expect(y.html).toContain("Still keen for your child to join Exampleton Juniors?");
    }
    // The first word of a name of two words, with its first letter a capital.
    expect(buildTeamInviteEmail({ ...o, firstName: "mary jane" }).subject).toBe("Robin has invited Mary to join Exampleton Juniors");
  });

  it("leaves an adult's invite as it was", () => {
    const a = buildTeamInviteEmail({ ...o, under18: false });
    expect(a.subject).toBe("Robin has invited you to join Exampleton Juniors");
    expect(a.text).toContain("(or Jack, if this is a parent or guardian’s email)");
  });
});

// Jaimie, 2026-10-03: "Hi The," for a pub. The same care for the team organiser's name in an invite.
describe("the team organiser's name in an invite, when it is a group's or has a title", () => {
  const o = { firstName: "Jack", team, joinUrl: "j" };

  it("uses the whole name of a group, never 'The has invited you'", () => {
    for (const x of [buildTeamInviteEmail({ ...o, organiserName: "The Example Arms" }), buildTeamInviteReminderEmail({ ...o, organiserName: "The Example Arms" })]) {
      expect(x.subject).not.toMatch(/^The has/);
      expect(x.text).toContain("The Example Arms is the team organiser");
      expect(x.text).toContain("Ask The Example Arms, or ask us");
    }
    expect(buildTeamInviteEmail({ ...o, organiserName: "The Example Arms" }).subject).toBe("The Example Arms has invited you to join Exampleton Juniors");
  });

  it("skips a title, and uses the first name they gave on the form when there is one", () => {
    expect(buildTeamInviteEmail({ ...o, organiserName: "Dr Robin Organiser" }).subject).toBe("Robin has invited you to join Exampleton Juniors");
    expect(buildTeamInviteEmail({ ...o, organiserName: "R Organiser", organiserFirstName: "Robin" }).subject).toBe("Robin has invited you to join Exampleton Juniors");
  });
});
