import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The site router serves the marketing pages from the app's WORKDIR at runtime
// (src/routes/site.ts resolves siteRoot to the repo root / container /app). Those files
// are baked into the Docker image by a COPY line in the Dockerfile — and drift there does
// NOT show up in the local/pr.yml BDD (which runs against `node dist/index.js` at the repo
// root, where every .html exists). It only surfaces as a 404/500 on the deployed image
// (the staging smoke caught /donate/thank-you 404 — thank-you.html was never COPYied). This
// guard ties the image contents to the actual served files so a new page can't ship a route
// whose file is missing from the image.

const repoRoot = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const redirects = readFileSync(resolve(repoRoot, "_redirects"), "utf8");

// The .html files the running app actually serves:
//  - index.html (the `/` route),
//  - every .html target/source named in _redirects (the clean-URL rewrites + canonical 301s),
//  - gift-aid.html (the declaration-form template read by src/routes/api.ts).
function servedHtmlFiles(): Set<string> {
  const files = new Set<string>(["index.html", "gift-aid.html"]);
  for (const m of redirects.matchAll(/[\w-]+\.html/g)) {
    files.add(m[0]);
  }
  return files;
}

// The files listed on the Dockerfile COPY line that bakes the site into the image (the one
// that also copies `_redirects` into WORKDIR).
function copiedFiles(): Set<string> {
  const line = dockerfile
    .split(/\r?\n/)
    .find((l) => l.startsWith("COPY ") && /\b_redirects\b/.test(l));
  expect(line, "Dockerfile must COPY _redirects with the site html into the image").toBeTruthy();
  return new Set([...(line as string).matchAll(/[\w-]+\.html/g)].map((m) => m[0]));
}

describe("Dockerfile bakes every served marketing page into the image", () => {
  it("COPYies every .html file the app serves at runtime", () => {
    const copied = copiedFiles();
    const missing = [...servedHtmlFiles()].filter((f) => !copied.has(f));
    expect(missing, `served .html files missing from the Dockerfile COPY: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});
