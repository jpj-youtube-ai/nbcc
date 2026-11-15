import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// Governance > Audit says each line in plain English, from a map of action code to words in app.js
// (AUDIT_WORDS). A code with no words still shows, as a tidy version of the code, but that is the
// fallback and not the plan: this reads every action code the server can write out of src/, so a
// new one cannot ship without its words. The same for the parts of the admin (AUDIT_AREAS): every
// kind of record the server writes a line about belongs to one, or its tile would never count it.

const ROOT = resolve(__dirname, "../..");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (p.endsWith(".ts")) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const src = sources(resolve(ROOT, "src")).join("\n");

// An action code is words joined by dots, lower case: "donation.refunded", "elf.door.tag.set".
// Plenty of other things in src look like that and are not one. Each is named here, so a string
// that is neither worded nor on this list fails the test and somebody decides which it is.
const NOT_AN_ACTION = [
  /\.(com|uk|scot|html|php|json|gz)$/, // addresses and files
  /^(charge|checkout|customer|refund|payment_intent)\./, // Stripe's own event names
  /^invoice\.payment_(failed|succeeded)$/, // Stripe's too
  /^(ctx\.typed|id\.hmac|input\.from|wants\.attend|parent\.subscription_details\.subscription)$/, // paths into an object
];
const written = [...new Set([...src.matchAll(/["'`]([a-z][a-z_]*(?:\.[a-z_]+)+)["'`]/g)].map((m) => m[1]))]
  .filter((code) => !NOT_AN_ACTION.some((not) => not.test(code)))
  .sort();
// One action is built from a list rather than written out: "fulfilment." and the flag ticked.
const flagBlock = (src.match(/export const FULFILMENT_FLAGS = \[([\s\S]*?)\]/) || ["", ""])[1];
const flags = [...flagBlock.matchAll(/"([a-z_]+)"/g)].map((m) => "fulfilment." + m[1]);

const wordsBlock = (app.match(/var AUDIT_WORDS = \{([\s\S]*?)\n {2}\};/) || ["", ""])[1];
const worded = [...wordsBlock.matchAll(/^\s*"([a-z_.]+)":\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => ({ code: m[1], words: m[2] }));
const wordedCodes = worded.map((w) => w.code);

describe("the words for each audit action", () => {
  it("finds the codes and the words to compare", () => {
    expect(written.length).toBeGreaterThan(200);
    expect(flags.length).toBeGreaterThanOrEqual(5);
    expect(worded.length).toBeGreaterThan(200);
  });

  it("has words for every action code the server can write", () => {
    expect(written.filter((code) => !wordedCodes.includes(code))).toEqual([]);
  });

  it("has words for each box ticked on a business supporter", () => {
    expect(flags.filter((code) => !wordedCodes.includes(code))).toEqual([]);
  });

  it("words each code once", () => {
    expect(wordedCodes.filter((code, i) => wordedCodes.indexOf(code) !== i)).toEqual([]);
  });

  // "Fern Example " + the words must read as a sentence: lower case to start, no full stop to end.
  // And the last form is the plain one, with no detail to fill in, so there is always a sentence.
  it("writes each as the rest of a sentence, ending in a form that needs no detail", () => {
    const wrong = worded.filter(({ words }) => {
      const forms = words.split(" | ");
      const last = forms[forms.length - 1];
      return (
        forms.some((f) => !/^(\[[A-Za-z]+=[a-z_]+\])?[a-z]/.test(f) || /[.!]$/.test(f.trim()) || f.includes("—")) ||
        last.includes("{") ||
        last.startsWith("[")
      );
    });
    expect(wrong.map((w) => w.code)).toEqual([]);
  });

  it("never shows a raw status word or a database name in a sentence", () => {
    const wrong = worded.filter(({ words }) => /_|\bid\b/i.test(words.replace(/\{[^}]*\}|\[[^\]]*\]/g, "")));
    expect(wrong.map((w) => w.code)).toEqual([]);
  });

  it("writes Elf Detective School in full", () => {
    const wrong = worded.filter(({ code, words }) => code.startsWith("elf.") && !words.includes("Elf Detective School"));
    expect(wrong.map((w) => w.code)).toEqual([]);
    expect(wordsBlock).not.toMatch(/the school\b/i);
  });
});

describe("the parts of the admin a line can belong to", () => {
  const areasBlock = (app.match(/var AUDIT_AREAS = \[([\s\S]*?)\n {2}\];/) || ["", ""])[1];
  const placed = [...areasBlock.matchAll(/\["([a-z_]+)", "[^"]+"\]/g)].map((m) => m[1]);
  // The audit rows written with entity: "…", and the two written straight into the table.
  const entities = [...new Set([...src.matchAll(/entity: ?["'`]([a-z_]+)["'`]/g)].map((m) => m[1]).concat(["uniform_payment", "sponsor_pledge"]))].sort();

  it("finds the kinds of record and the parts to compare", () => {
    expect(entities.length).toBeGreaterThan(40);
    expect(placed.length).toBeGreaterThan(40);
  });

  it("puts every kind of record the server writes about into one part", () => {
    expect(entities.filter((name) => !placed.includes(name))).toEqual([]);
  });

  it("puts each kind of record in one part only", () => {
    expect(placed.filter((name, i) => placed.indexOf(name) !== i)).toEqual([]);
  });
});
