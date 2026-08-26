// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// TASK-301: no source file may contain a raw NUL byte.
//
// src/newsletter/name-fallback.ts needs a sentinel character that cannot appear in a subject line,
// and NUL is the right choice - but it was written as a literal byte rather than the escape
// "\u0000". That works, right up until it does not: git and several tools classify a file with a
// NUL as BINARY (no diffs, no review), and an editor that normalises the file can drop the byte
// without saying anything. If that ever happened, MARK would silently become an empty string and
// every regex built from it would match everywhere - quietly wrecking the subject line of every
// newsletter sent to somebody whose name we do not have.
//
// The character is fine. Writing it as a raw byte is not. This pins the distinction.

const ROOT = resolve(__dirname, "../..");

/** Tracked text files, from git itself so nothing untracked or generated skews the sweep. */
function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.js", "*.json", "*.md", "*.html", "*.css", "*.feature", "*.yml"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

describe("source hygiene (TASK-301)", () => {
  it("finds files to check at all, so a silent empty sweep cannot pass", () => {
    // A sweep that examines nothing reports clean. That is exactly how the first attempt at this
    // check fooled me, so the guard gets its own assertion.
    expect(trackedTextFiles().length).toBeGreaterThan(50);
  });

  it("keeps every tracked text file free of raw NUL bytes", () => {
    const offenders = trackedTextFiles().filter((f) => readFileSync(resolve(ROOT, f)).includes(0));
    expect(offenders).toEqual([]);
  });
});
