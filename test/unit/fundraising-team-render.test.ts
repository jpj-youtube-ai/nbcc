import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTeamExtras, renderMemberOfLine, renderJoinPage } from "../../src/fundraising/team-render";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter, publicPage, type FundraiserRecord } from "../../src/fundraising/model";

// Team pages (Jaimie, 2026-10-03): what the public sees. A team page has the combined meter, a
// "Join this team" button and the join link, and its members A to Z, each with a small meter and a
// link to their page: never a ranking. A member page says which team it is part of. The join form
// is short, says how the team shares when the whole team does, and asks the sharing question only
// when it is just the team organiser's split. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const m = (raised: number, target: number | null = 5000) => meter({ onlinePence: raised, cashPence: 0, targetPence: target });

const members = [
  { name: "Ava S.", url: "/fundraise/as", meter: m(1000) },
  { name: "Ben <E.>", url: "/fundraise/be", meter: m(4000, null) },
];

describe("the team part of a team page", () => {
  const x = renderTeamExtras({ slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", finished: false, members, joinUrl: "https://nbcc.scot/fundraise/ej/join" });

  it("lists the members in the order given (A to Z), each linked with a small meter, names escaped", () => {
    expect(x.mainHtml).toContain('<h2 id="fr-team-heading">The team</h2>');
    expect(x.mainHtml.indexOf("Ava S.")).toBeLessThan(x.mainHtml.indexOf("Ben &lt;E.&gt;"));
    expect(x.mainHtml).toContain('href="/fundraise/as"');
    expect((x.mainHtml.match(/class="fr-meter[ "]/g) ?? []).length).toBe(2);
    expect(x.mainHtml).toContain("2 people are fundraising as part of the team, A to Z.");
  });

  it("never ranks them", () => {
    expect(x.mainHtml).not.toMatch(/\btop\b|leader|rank|1st|first place/i);
  });

  it("names the team organiser, never a captain", () => {
    expect(x.mainHtml).toContain("Team organiser: Robin O.");
    expect(x.mainHtml + x.summaryHtml).not.toMatch(/captain/i);
  });

  it("has a Join this team button and the join link to copy, in the summary and the main column", () => {
    expect(x.summaryHtml).toContain('href="/fundraise/ej/join"');
    expect(x.summaryHtml).toContain("Join this team");
    expect(x.mainHtml).toContain('data-copy-link="https://nbcc.scot/fundraise/ej/join"');
    expect(x.mainHtml).toContain("nbcc.scot/fundraise/ej/join");
  });

  it("says nobody has joined yet, kindly, with no list", () => {
    const empty = renderTeamExtras({ slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", finished: false, members: [], joinUrl: "j" });
    expect(empty.mainHtml).toContain("Nobody has joined the team yet. Could you be the first?");
    expect(empty.mainHtml).not.toContain("<ol");
  });

  it("takes no new members once the team has finished", () => {
    const done = renderTeamExtras({ slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", finished: true, members, joinUrl: "j" });
    expect(done.summaryHtml).toBe("");
    expect(done.mainHtml).not.toContain("Join this team");
  });
});

describe("a team page, drawn whole", () => {
  const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
  const f = {
    id: 40, slug: "ej", path: "raising", kind: "santa_dash", kindLabel: "Santa dash", title: "Exampleton Juniors", description: "Dashing.",
    eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, name: "Robin Organiser", status: "approved", public: true,
  } as unknown as FundraiserRecord;
  const page = publicPage(f, m(6000, 200000), []);
  const x = renderTeamExtras({ slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", finished: false, members, joinUrl: "https://nbcc.scot/fundraise/ej/join" });
  const html = renderFundraiserPage(template, page, { pageUrl: "https://nbcc.scot/fundraise/ej", now: new Date("2026-10-20T10:00:00Z"), team: x });

  it("puts the join button in the summary, under the give button, and the team after the story", () => {
    expect(html.indexOf("Give to this fundraiser")).toBeLessThan(html.indexOf("Join this team"));
    expect(html.indexOf('id="fr-story-heading"')).toBeLessThan(html.indexOf('id="fr-team-heading"'));
    expect(html.indexOf('id="fr-team-heading"')).toBeLessThan(html.indexOf('id="give"'));
  });

  it("is unchanged for a page that is not a team", () => {
    const plain = renderFundraiserPage(template, page, { pageUrl: "https://nbcc.scot/fundraise/ej", now: new Date("2026-10-20T10:00:00Z") });
    expect(plain).not.toContain("fr-team");
  });
});

describe("a member page", () => {
  it("says which team it is part of, linked", () => {
    expect(renderMemberOfLine({ title: "Exampleton <Juniors>", url: "/fundraise/ej" })).toBe(
      '<p class="fr-team-of">Part of the team <a href="/fundraise/ej">Exampleton &lt;Juniors&gt;</a></p>',
    );
  });
});

describe("the join form's page", () => {
  const template = readFileSync(resolve(ROOT, "fundraise-join.html"), "utf8");
  const team = { slug: "ej", title: "Exampleton Juniors", organisedBy: "Robin O.", kindLabel: "Santa dash", eventDate: "2026-12-05" };

  it("names the team, its organiser and what it is doing, escaped", () => {
    const html = renderJoinPage(template, { open: true, team: { ...team, title: "Exampleton <Juniors>" }, shareNote: null, askShare: false });
    expect(html).toContain("Join Exampleton &lt;Juniors&gt;");
    expect(html).toContain("Team organiser: Robin O.");
    expect(html).toContain("Santa dash, Saturday 5 December 2026");
    expect(html).toContain('data-team-slug="ej"');
    expect(html).not.toMatch(/__TEAM_/);
  });

  it("asks first name, surname, email and 18 or over, nothing chosen; target and why optional", () => {
    const html = renderJoinPage(template, { open: true, team, shareNote: null, askShare: false });
    for (const id of ["firstName", "lastName", "email", "over18Yes", "over18No", "target", "why"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toMatch(/name="over18"[^>]*checked/);
    expect(html).not.toMatch(/t-shirt|tshirt/i);
  });

  it("only says how a whole team shares, and does not ask", () => {
    const html = renderJoinPage(template, { open: true, team, shareNote: "This team shares 50% with Exampleton Food Larder.", askShare: false });
    expect(html).toContain("This team shares 50% with Exampleton Food Larder.");
    expect(html).toMatch(/data-join-share hidden/);
  });

  it("asks the sharing question when it is just the team organiser's split", () => {
    const html = renderJoinPage(template, { open: true, team, shareNote: null, askShare: true });
    expect(html).toMatch(/data-join-share>/);
    expect(html).not.toMatch(/data-join-share hidden/);
  });

  it("says the team is not taking new members when it is not open", () => {
    const html = renderJoinPage(template, { open: false, team, shareNote: null, askShare: false });
    expect(html).toMatch(/data-join-closed>/);
    expect(html).toMatch(/data-join-open hidden>/);
  });
});

describe("a team page speaks of the team, not its organiser", () => {
  const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
  const f = (title: string) =>
    ({
      id: 40, slug: "ej", path: "raising", kind: "santa_dash", kindLabel: "Santa dash", title, description: "Dashing.",
      eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, name: "Robin Organiser", status: "approved", public: true,
    }) as unknown as FundraiserRecord;
  const draw = (title: string, teamName?: string) =>
    renderFundraiserPage(template, { ...publicPage(f(title), m(1000, 200000), []), ...(teamName ? { teamName } : {}) }, {
      pageUrl: "https://nbcc.scot/fundraise/ej",
      now: new Date("2026-10-20T10:00:00Z"),
      thanks: { message: false },
      // Two people on the team, so the give box can point to them under The team.
      team: { memberCount: 2 },
    });

  // Clarity audit (Jaimie, 2026-10-03): a gift on a team page counts towards the team, and to sponsor
  // one person a giver goes to that person's own page.
  it("says the gift counts towards the team's total, and where to sponsor one person", () => {
    const html = draw("Exampleton Juniors", "Exampleton Juniors");
    expect(html).toContain(
      "Your donation goes to NBCC and counts towards the team's total. To sponsor one person, give on their own page: you'll find everyone under The team.",
    );
  });

  it("once finished, still names the team's total, a name ending in s taking just an apostrophe", () => {
    const finished = (title: string) =>
      renderFundraiserPage(template, { ...publicPage(f(title), m(1000, 200000), []), teamName: title, finished: true }, {
        pageUrl: "https://nbcc.scot/fundraise/ej",
        now: new Date("2026-10-20T10:00:00Z"),
      });
    expect(finished("Exampleton Juniors")).toContain("Your donation goes to NBCC and still counts towards Exampleton Juniors' total.");
    expect(finished("Exampleton Dashers Team")).toContain("still counts towards Exampleton Dashers Team's total.");
  });

  it("says every share helps the team, and heads the story About the team", () => {
    const html = draw("Exampleton Juniors", "Exampleton Juniors");
    expect(html).toContain("Every share helps Exampleton Juniors reach more people.");
    expect(html).toContain('<h2 id="fr-story-heading">About the team</h2>');
    // The organiser is named only as the team organiser.
    expect(html).not.toMatch(/Robin&#39;s|Robin's|helps Robin|Organised by Robin/);
    expect(html).toContain("Team organiser: Robin O.");
    expect(html).toContain('content="Exampleton Juniors is raising money for NBCC.');
  });

  it("leaves every other page, member pages included, with the organiser's own name", () => {
    const html = draw("Jack's page for Exampleton Juniors");
    expect(html).toContain("counts towards Robin's total.");
    expect(html).toContain("Every share helps Robin reach more people.");
    expect(html).toContain('<h2 id="fr-story-heading">About this fundraiser</h2>');
  });
});
