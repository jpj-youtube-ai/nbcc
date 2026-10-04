import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// The guard for All emails (Admin > Fundraising). The card promises "every email", so a new email
// must not be able to ship without a row there. Read from the source, five ways:
//
//   1. KINDS. Every send goes through sendAndLog / sendVerbatim in src/clients/email.ts and is
//      written to the email log under a kind ("fundraiseTeamInvite"). Every kind found there must
//      either be claimed by a catalogue entry (its logKinds) or be listed in OTHER_PARTS_OF_THE_SITE
//      below. So a new kind forces a choice: add it to the catalogue, or say here, on purpose, that
//      it belongs to another part of the site (donations, the newsletter, admin sign in, ...).
//   2. KINDS ARE WRITTEN OUT. Check 1 reads kinds as string literals, so a kind passed as a variable
//      would slip past it. Every call to sendAndLog / sendVerbatim must therefore name its kind as a
//      literal, apart from the three places that hand a kind on (the two definitions, and
//      sendVerbatim calling sendAndLog). And nothing in the four folders sends past them.
//   3. BUILDERS. Every exported build...Email (a function or a const, in any file under the
//      fundraising, pledge, ticket and Ball folders, however deep) and the Ball report's
//      renderReport must be called by the catalogue. A new email that reuses an existing kind (as
//      the team invite and its under 18 version do) is caught here.
//   4. VARIANTS BY KEY. The automatic emails and the staff invites are one builder each, switched by
//      a kind or a type: every TOUCH_KINDS kind and every INVITE_TYPES type must have its entry.
//   5. WORDS TYPED AT THE CALL. One builder takes its words from whoever calls it: the pledge note
//      to staff (buildPledgeStaffEmail, sent by sendPledgeStaffNote / notifyStaff). A new note
//      written inline at a call ("A pledge was ...", [...]) would be a new email with an existing
//      kind and an existing builder, invisible to checks 1 and 3. So its subject may never be a
//      string written at the call: the words live in a named function in src/pledges/emails.ts
//      (pledgeHiddenNote, pledgesPaidTwiceNote), and each of those must be in the catalogue.
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

/** Every .ts file under a folder, however deep, as a path from the repo's root. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(resolve(ROOT, path)).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const EMAIL_FOLDERS = ["src/fundraising", "src/pledges", "src/tickets", "src/ball"];
const emailFiles = EMAIL_FOLDERS.flatMap(tsFiles);
const catalogue = read("src/email/catalogue.ts");

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

describe("a kind is always written out where it is sent", () => {
  // The first thing in the brackets of every sendAndLog( and sendVerbatim( in the client.
  const firsts = [...client.matchAll(/\b(sendVerbatim|sendAndLog)\(\s*([^\s,)]+)/g)].map((m) => `${m[1]}(${m[2]}`);
  const notLiteral = firsts.filter((f) => !/\("[A-Za-z]+"$/.test(f));

  it("finds the calls to check", () => {
    expect(firsts.length).toBeGreaterThan(50);
  });

  it("except in the three places that hand a kind on", () => {
    // `async function sendAndLog(kind: string, ...`, `async function sendVerbatim(kind: string, ...`,
    // and sendVerbatim's own `await sendAndLog(kind, name, ...`. Anything else here is a kind the
    // checks above cannot read: write it out as a string where it is sent.
    expect(notLiteral.sort()).toEqual(["sendAndLog(kind", "sendAndLog(kind:", "sendVerbatim(kind:"]);
  });

  it("and neither is handed out of the client, where a kind could be made up elsewhere", () => {
    expect(client).not.toMatch(/export\s+(async\s+)?function\s+(sendAndLog|sendVerbatim)\b/);
    expect(client).not.toMatch(/export\s*\{[^}]*\b(sendAndLog|sendVerbatim)\b/);
  });

  it("and the fundraising, pledge, ticket and Ball code never sends past them", () => {
    const direct = emailFiles.filter((f) => /\b(sendSesEmail|SendEmailCommand|sesClient)\b/.test(read(f)));
    expect(direct).toEqual([]);
  });
});

describe("every email builder in the fundraising, pledge, ticket and Ball code", () => {
  // `export function buildXEmail(`, `export async function buildXEmail(` and `export const buildXEmail =`.
  const BUILDER = /^export (?:(?:async )?function|const) (build[A-Za-z0-9]*Email|renderReport)\b/gm;
  const builders: Array<{ name: string; file: string }> = [];
  for (const file of emailFiles) for (const m of read(file).matchAll(BUILDER)) builders.push({ name: m[1], file });

  // A builder the catalogue reaches through the function that really sends it, so the two cannot
  // drift: touchEmailAsSent is buildTouchEmail plus the hello to a parent or guardian.
  const SENT_THROUGH: Record<string, string> = { buildTouchEmail: "touchEmailAsSent" };

  it("finds the builders to check, in every file however deep", () => {
    expect(emailFiles.length).toBeGreaterThan(90);
    expect(builders.length).toBeGreaterThan(40);
    expect(builders.map((b) => b.name)).toContain("buildTeamInviteEmail");
    expect(builders.map((b) => b.name)).toContain("renderReport");
  });

  it("reads a builder written as a const, as well as a function", () => {
    const found = [..."export const buildNewEmail = () => 1;\nexport async function buildOtherEmail() {}\nexport function buildPlainEmail() {}".matchAll(BUILDER)].map((m) => m[1]);
    expect(found).toEqual(["buildNewEmail", "buildOtherEmail", "buildPlainEmail"]);
  });

  it("is used by the catalogue", () => {
    const used = (name: string) => new RegExp(`\\b${SENT_THROUGH[name] ?? name}\\(`).test(catalogue);
    const unused = builders.filter((b) => !used(b.name)).map((b) => `${b.name} (${b.file})`);
    expect(unused, "add these to src/email/catalogue.ts").toEqual([]);
  });

  it("and the function it is sent through really is built on it", () => {
    for (const [builder, through] of Object.entries(SENT_THROUGH)) {
      const src = read("src/fundraising/touch-emails.ts");
      const body = src.slice(src.indexOf(`export function ${through}(`));
      expect(body.slice(0, body.indexOf("\n}")), through).toContain(`${builder}(`);
    }
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

describe("the pledge note to staff, whose words come from its caller", () => {
  const HOME = "src/pledges/emails.ts";
  const everywhere = tsFiles("src");
  // A subject written at the call: sendPledgeStaffNote("...", notifyStaff(`...`, or
  // buildPledgeStaffEmail({ subject: "..." (in any order of its fields).
  const INLINE = [/\b(?:sendPledgeStaffNote|notifyStaff)\(\s*["'`]/, /\bbuildPledgeStaffEmail\(\s*\{[^}]*\bsubject:\s*["'`]/];

  it("never has its subject written where it is sent", () => {
    const inline = everywhere.filter((f) => f !== HOME && INLINE.some((re) => re.test(read(f))));
    expect(inline, `put the words in a named function in ${HOME}, and add it to src/email/catalogue.ts`).toEqual([]);
  });

  it("the check reads the shapes it is meant to", () => {
    for (const bad of ['await sendPledgeStaffNote("A pledge was moved", lines)', "deps.notifyStaff(`${n} pledges`, [])", 'buildPledgeStaffEmail({ lines, subject: "Hello" })']) {
      expect(INLINE.some((re) => re.test(bad)), bad).toBe(true);
    }
    for (const good of ["await deps.notifyStaff(note.subject, note.lines)", "buildPledgeStaffEmail({ subject, lines, adminUrl })", "sendPledgeStaffNote(subject, lines, deps)"]) {
      expect(INLINE.some((re) => re.test(good)), good).toBe(false);
    }
  });

  it("every named set of words for it is in the catalogue", () => {
    const notes = [...read(HOME).matchAll(/^export function ([A-Za-z0-9]+Note)\b/gm)].map((m) => m[1]);
    expect(notes).toEqual(expect.arrayContaining(["pledgeHiddenNote", "pledgesPaidTwiceNote"]));
    expect(notes.filter((n) => !new RegExp(`\\b${n}\\(`).test(catalogue))).toEqual([]);
  });
});
