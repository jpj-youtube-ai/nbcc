import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The readthrough (2026-10-04): the admin's Fundraising and Events tabs are becoming one tab, "Get
// involved", with the sections "Sign ups", "Our events", "Tickets and pledges", "Emails" and
// "Settings". Every staff email and server message that sends staff to the admin names the new tab,
// and the section where that helps. Not the Festive Ball's. Every name here is invented.

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { CATALOGUE } from "../../src/email/catalogue";
import { buildFinishedStaffEmail, buildSignUpStaffEmail, type StaffSummary } from "../../src/fundraising/emails";
import { tidyStaffFacts } from "../../src/fundraising/signup-tidy-emails";
import { buildJoinStaffEmail } from "../../src/fundraising/team-page-emails";
import { buildPledgeStaffEmail, pledgeHiddenNote, pledgesPaidTwiceNote } from "../../src/pledges/emails";
import { buildOrderFlagStaffEmail, buildRefundRequestStaffEmail } from "../../src/tickets/emails";

const BASE = "https://nbcc.test";
const admin = { adminUrl: `${BASE}/admin` };
const OLD = [/Admin\s*(>|&gt;)\s*Fundraising/, /Admin, Fundraising/, /the Events page/];

const SIGN_UP = {
  id: 1, path: "raising", kind: "santa", kindLabel: "Santa dash", title: "Sam's Santa Dash", description: "A run.", eventDate: null, startTime: null,
  endTime: null, timeTbc: false, venue: "", town: "", targetPence: 50000, public: true, name: "Sam Example", email: "sam@example.com",
  phone: "07700 900000", socialLink: null, socialOk: true, newsletterOk: false,
  wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
} as unknown as StaffSummary;

describe("the notice of a new sign up", () => {
  const mail = buildSignUpStaffEmail(SIGN_UP, admin);

  it("sends staff to Get involved, Sign ups to approve or decline", () => {
    expect(mail.text).toContain("Approve or decline in Admin > Get involved > Sign ups.");
    expect(mail.html).toContain("Approve or decline in Admin &gt; Get involved &gt; Sign ups.");
  });

  it("says where the people to invite are, for a team", () => {
    const team = buildSignUpStaffEmail({ ...SIGN_UP, team: { isTeam: true, shareMode: null, members: [{ firstName: "Alex", lastName: "Example", email: "alex@example.com" }] } }, admin);
    expect(team.text).toContain("People to invite: 1 person to invite once you approve it: see Admin > Get involved > Sign ups");
  });

  it("says the same for a page in memory of someone", () => {
    const memory = buildSignUpStaffEmail({ ...SIGN_UP, inMemory: true, memoryName: "Mary Example" }, admin);
    expect(memory.text).toContain("Approve or decline in Admin > Get involved > Sign ups.");
  });

  it("says where to ask for a T-shirt size", () => {
    expect(tidyStaffFacts({ isSporting: true, tshirtSize: null })).toContainEqual(["T-shirt size", "Not given yet. Ask them from Admin > Get involved > Sign ups"]);
  });
});

describe("the other notices about a sign up", () => {
  it("a fundraiser says they've finished: Mark finished is in Sign ups", () => {
    const mail = buildFinishedStaffEmail({ id: 1, name: "Sam Example", title: "Sam's Santa Dash", email: "sam@example.com", raisedPence: 61200 }, admin);
    expect(mail.text).toContain("When everything is in, press Mark finished in Admin > Get involved > Sign ups.");
  });

  it("a new team member: approve or decline in Sign ups", () => {
    const mail = buildJoinStaffEmail(
      { name: "Alex Example", email: "alex@example.com", title: "Alex's Santa Dash", targetPence: 20000, description: "Joining." },
      { title: "The Example Runners", name: "Sam Example" },
      { ...admin, split: "No, all of it comes to NBCC" },
    );
    expect(mail.text).toContain("Approve or decline it in Admin > Get involved > Sign ups. Nothing shows until you do.");
  });
});

describe("the notes about sponsor pledges", () => {
  it("open the new tab", () => {
    const mail = buildPledgeStaffEmail({ ...pledgeHiddenNote({ title: "Sam's Santa Dash", pledgeId: 42, amountPence: 1000 }), ...admin });
    expect(mail.html).toContain(">Open Admin, Get involved</a>");
    expect(mail.text).toContain(`Open Admin, Get involved: ${BASE}/admin`);
  });

  it("name the section the pledges are in", () => {
    expect(pledgeHiddenNote({ title: "Sam's Santa Dash", pledgeId: 42, amountPence: 1000 }).lines[1]).toBe(
      "If its name or message should not have been there at all, you can cancel it or hide its message in Admin, Get involved, Tickets and pledges, Sponsor pledges.",
    );
    expect(pledgesPaidTwiceNote([{ title: "Sam's Santa Dash", pledgeId: 42, amountPence: 1000, cashMarked: false }]).lines[0]).toBe(
      "Please look at these in Admin, Get involved, Tickets and pledges, Sponsor pledges, then press Mark as checked.",
    );
  });
});

describe("the notices about event tickets", () => {
  const host = { title: "The Example Christmas Fair", organiserName: "Sam Example" };

  it("a refund asked for: the refund is made in Tickets and pledges", () => {
    const mail = buildRefundRequestStaffEmail(host, { reference: "NBCC-EXAMPLE", buyerName: "Alex Example", tickets: "2 Adult", reason: "They cannot come." }, admin);
    expect(mail.text).toContain("Only an admin can make the refund, in Admin > Get involved > Tickets and pledges > Event tickets.");
  });

  it("a booking to check: the booking is in Tickets and pledges", () => {
    const mail = buildOrderFlagStaffEmail({ title: host.title }, { reference: "NBCC-EXAMPLE", buyerName: "Alex Example", tickets: "2 Adult", paid: "£26" }, ["Paid late."], admin);
    expect(mail.text).toContain("Open the booking in Admin > Get involved > Tickets and pledges > Event tickets and check it against Stripe.");
  });
});

describe("the server's own messages", () => {
  const src = (file: string) => readFileSync(join(__dirname, "../../src", file), "utf8");

  it("the print view of every piece says where to open one on its own", () => {
    expect(src("fundraising/materials.ts")).toContain('tip: "Each page prints on its own paper size. To print just one, open it on its own from Admin > Get involved > Sign ups."');
  });

  it("the switch for the public page names the page as it is called now", () => {
    expect(src("routes/admin-events.ts")).toContain('{ error: "Only an admin can switch the Get involved page on or off" }');
  });
});

// Everything an admin can read in All emails, bar the Festive Ball's: none of it names the old tabs.
describe("All emails", () => {
  const versions = CATALOGUE.filter((e) => e.group !== "ball" && !e.id.startsWith("staff-ball")).flatMap((e) => e.versions.map((x) => [`${e.id}/${x.id}`, x] as const));

  it.each(versions)("%s does not name the old Fundraising or Events tab", (_id, x) => {
    const { html } = x.render(BASE);
    for (const old of OLD) expect(html).not.toMatch(old);
  });
});
