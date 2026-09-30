import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-481: the image carries DB-IP's free City Lite location database at /app/geo/, fetched at
// build time by scripts/fetch-geo-db.mjs in a stage of its own. These guard the shape that matters:
//  - the fetch has its own stage, so ordinary code changes never re-download 60 MB, and the runtime
//    image gets only the unpacked file (no curl, no gzip leftovers);
//  - the stage is keyed on GEO_MONTH, which the production build passes, so the cached layer is
//    replaced each month instead of living forever in the Actions build cache;
//  - the runtime stage copies it where src/analytics/geo-db.ts looks (/app/geo), before the app code
//    so a code change does not invalidate it.

const repoRoot = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const lines = dockerfile.split(/\r?\n/);
const deployProd = readFileSync(resolve(repoRoot, ".github/workflows/deploy-prod.yml"), "utf8");

/** The lines of the stage named `name`, from its FROM to the next FROM. */
function stage(name: string): string[] {
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, "i").test(l));
  expect(start, `Dockerfile has a stage named ${name}`).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, next < 0 ? lines.length : next);
}

describe("Dockerfile: the location database", () => {
  it("fetches it in a stage of its own, with the fetch script, keyed on GEO_MONTH", () => {
    const geo = stage("geo");
    const copy = geo.findIndex((l) => /^COPY\s+scripts\/fetch-geo-db\.mjs\b/.test(l));
    const arg = geo.findIndex((l) => /^ARG\s+GEO_MONTH\b/.test(l));
    const run = geo.findIndex((l) => /^RUN\s+node\s+\S*fetch-geo-db\.mjs\s+\/geo\s+"\$GEO_MONTH"/.test(l));
    expect(copy, "geo stage COPYs scripts/fetch-geo-db.mjs").toBeGreaterThan(0);
    expect(arg, "geo stage declares ARG GEO_MONTH").toBeGreaterThan(0);
    expect(run, 'geo stage runs: node fetch-geo-db.mjs /geo "$GEO_MONTH"').toBeGreaterThan(arg);
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

  it("is refreshed month by month: the production build passes this month as GEO_MONTH", () => {
    expect(deployProd).toMatch(/^\s+GEO_MONTH=\$\{\{\s*env\.GEO_MONTH\s*\}\}\s*$/m);
    expect(deployProd).toMatch(/echo\s+"GEO_MONTH=\$\(date\s+-u\s+\+%Y-%m\)"\s+>>\s+"\$GITHUB_ENV"/);
  });
});
