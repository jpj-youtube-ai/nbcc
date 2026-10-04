import { describe, it, expect } from "vitest";
import { CATALOGUE, catalogueApprovalKeys, emailState, findEmail } from "../../src/email/catalogue";
import { TEAM_WORDING_KEYS } from "../../src/fundraising/teams";

// The wording pass (Jaimie, 2026-10-04), as All emails shows it: the new email to a team organiser,
// approvable there; the gentle sign in code; the parent versions of the automatic emails, written
// for the parent throughout; and the Ball reminder's true time to go. Every version is rendered by
// the real builder, so what is read here is what is sent.

const BASE = "https://nbcc.test";
const version = (emailId: string, versionId: string) => {
  const e = findEmail(emailId);
  if (!e) throw new Error(`no email ${emailId}`);
  const found = e.versions.find((x) => x.id === versionId);
  if (!found) throw new Error(`no version ${versionId} of ${emailId}: ${e.versions.map((x) => x.id).join(", ")}`);
  return { email: e, version: found, mail: found.render(BASE) };
};
const words = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");

describe("the new email to a team organiser", () => {
  it("is in Teams, after the join thanks, under its own log name", () => {
    const { email } = version("team-member-joined", "usual");
    expect(email.group).toBe("teams");
    expect(email.name).toBe("A new member has joined your team");
    expect(email.who).toBe("Goes to the team organiser when staff approve a new team member's page. Never about their own page.");
    expect(email.logKinds).toEqual(["fundraiseTeamMemberJoined"]);
    const ids = CATALOGUE.filter((e) => e.group === "teams").map((e) => e.id);
    expect(ids.indexOf("team-member-joined")).toBeGreaterThan(ids.indexOf("team-joined"));
  });

  it("is approval gated on team_joined, at the endpoint that approves it, in every version", () => {
    const { email } = version("team-member-joined", "usual");
    for (const v of email.versions) expect(v.approval).toEqual({ key: "team_joined", path: "/api/admin/fundraising/touch/approvals/team_joined" });
    expect(catalogueApprovalKeys()).toContain(TEAM_WORDING_KEYS[0]);
  });

  it("counts as waiting until it is approved", () => {
    const { email } = version("team-member-joined", "usual");
    expect(emailState(email, new Set())).toEqual({ state: "waiting", waitingVersion: "usual" });
    expect(emailState(email, new Set(["team_joined"]))).toEqual({ state: "approved", waitingVersion: null });
  });

  it("renders the usual one, a member under 18, and a team kept off the website", () => {
    expect(version("team-member-joined", "usual").mail.subject).toBe("Alex has joined The Example Runners");
    const child = version("team-member-joined", "under-18").mail;
    expect(child.subject).toBe("Jack has joined The Example Runners");
    expect(child.html).not.toContain("Sarah");
    expect(version("team-member-joined", "off-site").mail.html).not.toContain("See your team page");
    expect(version("team-member-joined", "usual").mail.html).toContain(">See your team page</a>");
  });
});

describe("the sign in code", () => {
  it("has the gentle version for a page in memory of someone", () => {
    const { version: v, mail } = version("sign-in-code", "in-memory");
    expect(v.label).toBe("They have a page in memory of someone (the gentle one)");
    expect(words(mail.html)).toContain("Dear Sam,");
    expect(words(mail.html)).toContain("With warmest thoughts,");
    expect(words(mail.html)).not.toContain("Happy fundraising");
    expect(words(version("sign-in-code", "usual").mail.html)).toContain("Happy fundraising!");
  });
});

describe("the automatic emails, for a page for someone under 18", () => {
  it("are written for the parent throughout, greeted once", () => {
    const m = version("touch-on-track", "under-18").mail;
    expect(m.subject).toBe("Jack is doing great!");
    const w = words(m.html);
    expect(w).toContain("Jack is doing great!");
    expect(w.match(/this is about/g)).toHaveLength(1);
    expect(w).toContain("Hi Sarah, this is about Jack's page.");
    expect(w).toContain("Jack is right on track for the £500 target!");
    expect(w).not.toMatch(/your page|You're doing great/);
  });

  it("keep the adult's as they were", () => {
    expect(words(version("touch-on-track", "usual").mail.html)).toContain("You're doing great!");
  });
});

describe("in memory emails", () => {
  it("greet by first name in the receipt, and Hello with none", () => {
    expect(words(version("memory-signup", "usual").mail.html)).toContain("Dear Sam,");
    expect(words(version("memory-signup", "no-name").mail.html)).toContain("Hello,");
  });

  it("greet the giver in the thank you on an in memory page", () => {
    expect(words(version("supporter-thanks", "in-memory").mail.html)).toContain("Dear Alex,");
  });
});

describe("the staff notices", () => {
  it("say when sales close, with the date as every email writes it", () => {
    const w = words(version("staff-tickets-to-approve", "custom-close").mail.html);
    expect(w).toMatch(/Sales close on Friday 4 ?th December 2026 at 5pm\./);
    expect(words(version("staff-tickets-to-approve", "usual").mail.html)).toContain("Sales close at midnight the day before.");
  });

  it("say what is true about a failed refund", () => {
    const w = words(version("staff-ticket-check", "refund-failed").mail.html);
    expect(w).toContain("The refund did not go through, and the buyer has not been told.");
    expect(w).not.toContain("has their tickets email");
  });
});

describe("the Ball reminder", () => {
  it("has a version for each thing it can say about the time to go", () => {
    expect(version("ball-week-to-go", "usual").mail.subject).toMatch(/^A week to go: /);
    expect(version("ball-week-to-go", "days-to-go").version.label).toBe("A few days to go (someone who booked in the last week)");
    expect(version("ball-week-to-go", "days-to-go").mail.subject).toMatch(/^4 days to go: /);
    expect(version("ball-week-to-go", "tomorrow").mail.subject).toMatch(/^Tomorrow: /);
    expect(version("ball-week-to-go", "today").mail.subject).toMatch(/^Today: /);
    expect(words(version("ball-week-to-go", "tomorrow").mail.html)).toContain("Tomorrow you'll be with us at The Park Hotel.");
  });
});
