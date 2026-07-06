import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-137: governance lines. The privacy page references the fundraising self-regulation framework
// (Code of Fundraising Practice, Scottish Fundraising Adjudication Panel, Fundraising Preference
// Service); the donate page states the BACS advance-notice duty for Direct Debit monthly gifts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

describe("fundraising governance copy (TASK-137)", () => {
  it("privacy.html references the fundraising self-regulation framework", () => {
    const html = read("privacy.html");
    expect(html).toContain("Code of Fundraising Practice");
    expect(html).toContain("Scottish Fundraising Adjudication Panel");
    expect(html).toContain("Fundraising Preference Service");
  });

  it("donate.html states BACS advance notice of amount and date before collection/change", () => {
    const html = read("donate.html");
    expect(html).toContain(
      "we tell you the amount and the date in advance, before the first collection and before any change",
    );
  });
});
