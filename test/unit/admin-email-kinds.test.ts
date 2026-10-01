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
