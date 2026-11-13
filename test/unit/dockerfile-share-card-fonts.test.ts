import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NBCC Elf Detective School, Plan 2c-2, Task 6: a graduate's share card is a picture drawn on the server (sharp, from
// shareCardSvg in src/elf/print.ts), and a picture drawn on the server can only use the fonts the server has. The
// runtime image starts from node:20-slim, which has none, so without them every card would go out with no words on
// it at all, and nothing but the image itself could show it. These guard the two parts that keep the words:
//  - the runtime stage's first apt-get install brings fontconfig (how sharp finds a font) and fonts-dejavu-core
//    (DejaVu Sans and Serif, for the card's words), with a comment saying why;
//  - pr.yml's image check asks fontconfig inside the built image for a sans serif font, and fails unless it is
//    DejaVu (ruling F12: no unit test can see the server's fonts, and there is no Docker on a laptop here).

const repoRoot = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const lines = dockerfile.split(/\r?\n/);
const prYml = readFileSync(resolve(repoRoot, ".github/workflows/pr.yml"), "utf8").replace(/\r\n/g, "\n");

/** The lines of the stage named `name`, from its FROM to the next FROM. */
function stage(name: string): string[] {
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, "i").test(l));
  expect(start, `Dockerfile has a stage named ${name}`).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, next < 0 ? lines.length : next);
}

/** The packages a line of `apt-get install` names. */
const packagesOf = (line: string): string[] =>
  line
    .replace(/^.*apt-get install\b/, "")
    .replace(/\\\s*$/, "")
    .split(/\s+/)
    .filter((w) => w !== "" && !w.startsWith("-"));

/** One job's steps in pr.yml, each as its block of text (from "- name:" to the next one). */
function jobSteps(job: string): string[] {
  const start = prYml.indexOf(`\n  ${job}:\n`);
  expect(start, `pr.yml has a job named ${job}`).toBeGreaterThanOrEqual(0);
  const rest = prYml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  return body.split(/\n(?=\s+- name:)/).slice(1);
}

describe("Dockerfile: fonts for the share card", () => {
  const runtime = stage("runtime");
  const installs = runtime.filter((l) => /apt-get install\b/.test(l));

  it("brings fontconfig and DejaVu in the runtime stage's first apt-get install", () => {
    expect(installs.length, "the runtime stage installs packages").toBeGreaterThan(0);
    const first = packagesOf(installs[0]);
    expect(first).toContain("fonts-dejavu-core");
    expect(first).toContain("fontconfig");
    // Still the backup's packages too: nothing was swapped out to make room.
    expect(first).toEqual(expect.arrayContaining(["ca-certificates", "curl", "gnupg", "p7zip-full"]));
  });

  it("never takes them away again with the tools the install only needed for a while", () => {
    const purge = runtime.find((l) => /apt-get purge\b/.test(l)) ?? "";
    expect(purge).not.toMatch(/fontconfig|fonts-dejavu/);
  });

  it("says why, beside the install: the card is drawn on the server, which can only use the fonts it has", () => {
    const install = runtime.findIndex((l) => /apt-get install\b/.test(l));
    const comment = runtime.slice(0, install).filter((l) => l.startsWith("#")).join(" ");
    expect(comment).toMatch(/share card/i);
    expect(comment).toMatch(/drawn on the server/i);
    expect(comment).toMatch(/only use the fonts/i);
  });
});

describe("pr.yml: the image check proves the share card's fonts are in the image", () => {
  const steps = jobSteps("image");
  const fonts = steps.find((s) => /fc-match/.test(s)) ?? "";

  it("asks fontconfig for a sans serif font inside the image it built", () => {
    expect(fonts, "the image job has a step that runs fc-match").not.toBe("");
    expect(fonts).toMatch(/docker run --rm nbcc-image-check fc-match sans-serif/);
    // After the build, beside the image's other checks.
    const build = steps.findIndex((s) => /docker build\b.*-t nbcc-image-check/.test(s));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(fonts)).toBeGreaterThan(build);
  });

  it("fails, saying why, unless the font it finds is DejaVu", () => {
    expect(fonts).toMatch(/set -euo pipefail/);
    expect(fonts).toMatch(/grep -q "?DejaVu"?/);
    expect(fonts).toMatch(/::error::[^\n]*share card/);
    expect(fonts).toMatch(/exit 1/);
  });
});
