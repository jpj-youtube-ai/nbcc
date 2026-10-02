import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-487: every kind of email the server logs has a name on the admin's Email audit, where it is
// shown and filtered by. Without one it showed as its code ("ballTransferStaff") and could not be
// picked in the filter. Read from the source, so a new kind cannot ship without its name.

const ROOT = resolve(__dirname, "../..");
const client = readFileSync(resolve(ROOT, "src/clients/email.ts"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

const sent = [...client.matchAll(/(?:sendVerbatim|sendAndLog)\("([A-Za-z]+)"/g)].map((m) => m[1]);
const block = (app.match(/var EMAIL_KINDS = \[([\s\S]*?)\];/) || ["", ""])[1];
const labelled = [...block.matchAll(/\["([A-Za-z]+)", "[^"]+"\]/g)].map((m) => m[1]);

describe("the names of email kinds on the Email audit", () => {
  it("finds the kinds and the names to compare", () => {
    expect(sent.length).toBeGreaterThan(10);
    expect(labelled.length).toBeGreaterThan(10);
  });

  it("names every kind the server sends", () => {
    expect([...new Set(sent)].filter((k) => !labelled.includes(k))).toEqual([]);
  });
});

// TASK-493: the community fundraising emails each have a kind of their own, and a name.
describe("the fundraising email kinds", () => {
  it.each(["fundraiseThanks", "fundraiseStaff", "fundraiseApproved"])("sends and names %s", (kind) => {
    expect(sent).toContain(kind);
    expect(labelled).toContain(kind);
  });

  // TASK-501: the 24 hour link is no longer sent, but the rows already in the log keep their name.
  it("still names the retired manage link", () => {
    expect(sent).not.toContain("fundraiseManage");
    expect(labelled).toContain("fundraiseManage");
  });
});

// TASK-501: the sign in code (email 8) and the note to events@ when an organiser has finished.
describe("the fundraising private area email kinds", () => {
  it.each(["fundraiseCode", "fundraiseFinishedStaff"])("sends and names %s", (kind) => {
    expect(sent).toContain(kind);
    expect(labelled).toContain(kind);
  });
});

// TASK-497: the two emails about a change staff approved or rejected.
describe("the fundraising change email kinds", () => {
  it.each(["fundraiseEditApproved", "fundraiseEditRejected"])("sends and names %s", (kind) => {
    expect(sent).toContain(kind);
    expect(labelled).toContain(kind);
  });
});

// TASK-503: the invite staff send, and the Monday summary.
describe("the fundraising team email kinds", () => {
  it.each(["fundraiseInvite", "fundraiseSummary"])("sends and names %s", (kind) => {
    expect(sent).toContain(kind);
    expect(labelled).toContain(kind);
  });
});

// TASK-506: the two emails about a news update staff approved or did not use.
describe("the fundraising news update email kinds", () => {
  it.each(["fundraiseNewsApproved", "fundraiseNewsRejected"])("sends and names %s", (kind) => {
    expect(sent).toContain(kind);
    expect(labelled).toContain(kind);
  });
});
