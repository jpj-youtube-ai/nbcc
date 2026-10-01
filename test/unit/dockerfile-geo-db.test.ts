import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-481: the image carries DB-IP's free City Lite location database at /app/geo/, fetched at
// build time by scripts/fetch-geo-db.mjs in a stage of its own. These guard the shape that matters:
//  - the fetch has its own stage, so ordinary code changes never re-download 60 MB, and the runtime
//    image gets only the unpacked file (no curl, no gzip leftovers);
//  - the stage is keyed on GEO_DAY, which the production build passes, so a failed or fallback
//    download is cached for one day at most (not a month), and a new month's file is picked up by
//    the first deploy of a day once DB-IP has published it;
//  - the production deploy checks the file made it into the image and warns loudly (without failing
//    the deploy) when it did not;
//  - PR builds pass GEO_SKIP=1 so the image check does not download 60 MB on every PR;
//  - the runtime stage copies it where src/analytics/geo-db.ts looks (/app/geo), before the app code
//    so a code change does not invalidate it.

const repoRoot = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const lines = dockerfile.split(/\r?\n/);
const deployProd = readFileSync(resolve(repoRoot, ".github/workflows/deploy-prod.yml"), "utf8");
const prYml = readFileSync(resolve(repoRoot, ".github/workflows/pr.yml"), "utf8");

/** The lines of the stage named `name`, from its FROM to the next FROM. */
function stage(name: string): string[] {
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, "i").test(l));
  expect(start, `Dockerfile has a stage named ${name}`).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, next < 0 ? lines.length : next);
}

/** A workflow's steps, each as its block of text (from "- name:" to the next one). */
function steps(yml: string): string[] {
  return yml.replace(/\r\n/g, "\n").split(/\n(?=\s+- name:)/);
}

describe("Dockerfile: the location database", () => {
  it("fetches it in a stage of its own, with the fetch script, keyed on GEO_DAY", () => {
    const geo = stage("geo");
    const copy = geo.findIndex((l) => /^COPY\s+scripts\/fetch-geo-db\.mjs\b/.test(l));
    const day = geo.findIndex((l) => /^ARG\s+GEO_DAY\b/.test(l));
    const skip = geo.findIndex((l) => /^ARG\s+GEO_SKIP\b/.test(l));
    const run = geo.findIndex((l) => /^RUN\b.*\bnode\s+\S*fetch-geo-db\.mjs\s+\/geo\s+"\$GEO_DAY"/.test(l));
    expect(copy, "geo stage COPYs scripts/fetch-geo-db.mjs").toBeGreaterThan(0);
    expect(day, "geo stage declares ARG GEO_DAY").toBeGreaterThan(0);
    expect(skip, "geo stage declares ARG GEO_SKIP").toBeGreaterThan(0);
    expect(run, 'geo stage runs: node fetch-geo-db.mjs /geo "$GEO_DAY"').toBeGreaterThan(Math.max(day, skip));
    expect(dockerfile).not.toMatch(/GEO_MONTH/);
  });

  it("skips the download when GEO_SKIP is set, and always leaves a /geo to copy", () => {
    const run = stage("geo").find((l) => /^RUN\b/.test(l)) ?? "";
    expect(run).toMatch(/if \[ -n "\$GEO_SKIP" \]; then .*; else node fetch-geo-db\.mjs \/geo "\$GEO_DAY"; fi/);
    expect(run).toMatch(/&& mkdir -p \/geo\s*$/);
  });

  it("leaves the runtime stage as the last one, so it is still the image that ships", () => {
    const froms = lines.filter((l) => /^FROM\s/i.test(l));
    expect(froms[froms.length - 1]).toMatch(/\sAS\s+runtime\s*$/i);
  });

  it("copies it to /app/geo after the npm install and before the app code", () => {
    const runtime = stage("runtime");
    const npmCi = runtime.findIndex((l) => /^RUN\s+npm ci\b/.test(l));
    const geo = runtime.findIndex((l) => /^COPY\s+--from=geo\s+\/geo\s+(\/app\/geo|\.\/geo)\/?\s*$/.test(l));
    const dist = runtime.findIndex((l) => /^COPY\s+--from=build\s+\/app\/dist\b/.test(l));
    expect(geo, "runtime COPY --from=geo /geo ./geo").toBeGreaterThan(npmCi);
    expect(dist).toBeGreaterThan(geo);
  });
});

describe("deploy-prod.yml: the location database", () => {
  it("passes today's date as GEO_DAY, so a bad download is cached for a day at most", () => {
    expect(deployProd).toMatch(/echo\s+"GEO_DAY=\$\(date\s+-u\s+\+%Y-%m-%d\)"\s+>>\s+"\$GITHUB_ENV"/);
    expect(deployProd).toMatch(/^\s+GEO_DAY=\$\{\{\s*env\.GEO_DAY\s*\}\}\s*$/m);
    expect(deployProd).not.toMatch(/GEO_MONTH/);
  });

  it("never skips the download", () => {
    expect(deployProd).not.toMatch(/GEO_SKIP/);
  });

  it("checks the built image has the file, and warns without failing the deploy when it does not", () => {
    const all = steps(deployProd);
    const build = all.findIndex((s) => /uses:\s*docker\/build-push-action/.test(s));
    const check = all.findIndex((s) => /test -s \/app\/geo\/dbip-city-lite\.mmdb/.test(s));
    expect(build, "the build-and-push step").toBeGreaterThan(0);
    expect(check, "a step checking the image for the location database").toBeGreaterThan(build);
    const step = all[check];
    expect(step).toMatch(/docker run --rm --entrypoint sh "\$IMAGE"/);
    expect(step).toMatch(/::warning[^:]*::/);
    expect(step).toMatch(/continue-on-error:\s*true/);
    expect(step).toMatch(/if:\s*steps\.img\.outputs\.exists == 'false'/);
  });
});

describe("pr.yml: the image check", () => {
  it("builds with GEO_SKIP=1, so a PR does not download the location database", () => {
    expect(prYml).toMatch(/docker build --build-arg GEO_SKIP=1 -t nbcc-image-check \./);
  });
});
