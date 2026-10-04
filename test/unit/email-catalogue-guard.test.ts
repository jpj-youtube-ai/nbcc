import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The guard for All emails (Admin > Fundraising). The card promises "every email", so a new email
// must not be able to ship without a row there. Read from the source, three ways:
//
//   1. KINDS. Every send goes through sendAndLog / sendVerbatim in src/clients/email.ts and is
//      written to the email log under a kind ("fundraiseTeamInvite"). Every kind found there must
//      either be claimed by a catalogue entry (its logKinds) or be listed in OTHER_PARTS_OF_THE_SITE
//      below. So a new kind forces a choice: add it to the catalogue, or say here, on purpose, that
//      it belongs to another part of the site (donations, the newsletter, admin sign in, ...).
//   2. BUILDERS. Every exported build...Email function in the fundraising, pledge, ticket and Ball
//      code (and the Ball report's renderReport) must be imported by the catalogue. A new email that
//      reuses an existing kind (as the team invite and its under 18 version do) is caught here.
//   3. VARIANTS BY KEY. The automatic emails and the staff invites are one builder each, switched by
//      a kind or a type: every TOUCH_KINDS kind and every INVITE_TYPES type must have its entry.
//
// Nothing here is a real person: the catalogue's samples are invented.

vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", PORTAL_BASE_URL: "https://nbcc.test", BALL_FROM_EMAIL: "events@nbcc.test" },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { CATALOGUE, findEmail } from "../../src/email/catalogue";
import { TOUCH_KINDS } from "../../src/fundraising/touch-rules";
import { INVITE_TYPES } from "../../src/fundraising/invite";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// Kinds that are sent by other parts of the site, so they are not in All emails. Add a kind here
// only when it is truly not a fundraising, pledge, ticket or Festive Ball email.
const OTHER_PARTS_OF_THE_SITE = [
  "declaration", // Gift Aid declaration after an in-person donation
  "receipt", // a company's donation receipt
  "refund", // a donation refund
  "portal", // the donor portal's sign in link
  "adminInvite",
  "adminReset",
  "loginCode",
  "lapsedDonor",
  "lapsedAdmin",
  "newsletter",
  "thankYou", // thank you letters
  "businessInvite",
  "businessCapture",
  "businessReminder",
  "outreach",
  "backupAlert",
];

const client = read("src/clients/email.ts");
const sentKinds = [...new Set([...client.matchAll(/(?:sendVerbatim|sendAndLog)\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]))];
const claimed = new Set(CATALOGUE.flatMap((e) => e.logKinds));

describe("every kind of email in the log", () => {
  it("finds the kinds to check", () => {
    expect(sentKinds.length).toBeGreaterThan(40);
    expect(sentKinds).toContain("fundraiseTeamInvite");
    expect(sentKinds).toContain("ballConfirmation");
  });

  it("is in All emails, or is named here as another part of the site", () => {
    const missing = sentKinds.filter((k) => !claimed.has(k) && !OTHER_PARTS_OF_THE_SITE.includes(k));
    expect(missing, "add these to src/email/catalogue.ts").toEqual([]);
  });

  it("never both", () => {
    expect(OTHER_PARTS_OF_THE_SITE.filter((k) => claimed.has(k))).toEqual([]);
  });

  it("and the catalogue claims no kind that is not sent", () => {
    expect([...claimed].filter((k) => !sentKinds.includes(k))).toEqual([]);
  });
});

describe("every email builder in the fundraising, pledge, ticket and Ball code", () => {
  const catalogue = read("src/email/catalogue.ts");
  const builders: Array<{ name: string; file: string }> = [];
  for (const dir of ["src/fundraising", "src/pledges", "src/tickets", "src/ball"]) {
    for (const file of readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".ts"))) {
      const src = read(`${dir}/${file}`);
      for (const m of src.matchAll(/^export (?:async )?function (build[A-Za-z]*Email|renderReport)\b/gm)) builders.push({ name: m[1], file: `${dir}/${file}` });
    }
  }

  it("finds the builders to check", () => {
    expect(builders.length).toBeGreaterThan(40);
    expect(builders.map((b) => b.name)).toContain("buildTeamInviteEmail");
    expect(builders.map((b) => b.name)).toContain("renderReport");
  });

  it("is used by the catalogue", () => {
    const unused = builders.filter((b) => !new RegExp(`\\b${b.name}\\(`).test(catalogue)).map((b) => `${b.name} (${b.file})`);
    expect(unused, "add these to src/email/catalogue.ts").toEqual([]);
  });
});

describe("the emails that share one builder", () => {
  it("has one entry for each automatic email to an organiser", () => {
    for (const kind of TOUCH_KINDS) expect(CATALOGUE.filter((e) => e.touchKind === kind).length, kind).toBe(1);
  });

  it("has one entry for each type of invite staff can send", () => {
    for (const type of INVITE_TYPES) expect(findEmail(`invite-${type}`), type).not.toBeNull();
  });
});
