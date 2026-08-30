import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "../../src/admin/permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// TASK-313: the admin section list exists in THREE places — the server enum
// (src/admin/permissions.ts), the browser bundle (assets/js/admin/app.js) and the BDD steps.
// They are not cosmetic duplicates: PATCH /api/admin/users/:id/permissions validates a
// COMPLETE, .strict() matrix built from the server's list, so a section present on the server
// but missing in the browser copy makes EVERY permissions save fail with a 400 in production.
//
// That is exactly what happened when the "ball" section was added, and only a BDD scenario
// caught it by accident. This test makes the drift fail fast and name itself.

function parseJsArrayLiteral(source: string, name: string, where: string): string[] {
  // The two files declare it differently (var in the browser bundle, const in the steps), so
  // try each keyword. Plain string matching rather than a regex: this only has to find one
  // known declaration, and it keeps the guard readable.
  const start = ["var ", "const ", "let "]
    .map((keyword) => source.indexOf(keyword + name + " = ["))
    .find((index) => index !== -1);
  if (start === undefined) throw new Error(`could not find ${name} in ${where}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return source
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

describe("admin section list stays in sync", () => {
  it("the browser bundle lists exactly the server's sections, in the same order", () => {
    const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
    expect(parseJsArrayLiteral(appJs, "SECTIONS", "assets/js/admin/app.js")).toEqual([...SECTIONS]);
  });

  it("the BDD steps list exactly the server's sections", () => {
    const steps = readFileSync(
      resolve(ROOT, "features/steps/admin-permissions.steps.js"),
      "utf8",
    );
    const listed = parseJsArrayLiteral(steps, "SECTIONS", "the BDD steps");
    expect([...listed].sort()).toEqual([...SECTIONS].sort());
  });
});
