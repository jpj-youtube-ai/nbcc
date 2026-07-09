import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// The deploy workflows run one-off ECS tasks that override the container command to an npm
// script (`npm run migrate`, `npm run bootstrap:stories`, `npm run migrate:stories`, …). Those
// scripts execute INSIDE the runtime image — so whatever file or migrations directory they touch
// must be COPYied into the image by the Dockerfile, or the deploy step dies with MODULE_NOT_FOUND
// at task start (this is exactly how the stories bootstrap broke staging: scripts/bootstrap-
// stories-db.mjs and migrations-stories/ were never COPYied). This guard ties the deploy-invoked
// scripts to the image contents so a new one-off task can't ship a command whose files are missing.

const repoRoot = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

// npm scripts that a deploy workflow runs as a one-off ECS task (containerOverrides command
// ["npm","run","<script>"]).
function deployInvokedScripts(): Set<string> {
  const dir = resolve(repoRoot, ".github/workflows");
  const scripts = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => /^deploy-.*\.ya?ml$/.test(n))) {
    const yml = readFileSync(resolve(dir, f), "utf8");
    for (const m of yml.matchAll(/"npm"\s*,\s*"run"\s*,\s*"([\w:-]+)"/g)) scripts.add(m[1]);
  }
  return scripts;
}

// Resolve an npm script body to the image paths it needs at runtime: a `node scripts/x.mjs`
// entrypoint file, and/or a node-pg-migrate migrations directory (`-m <dir>`, default "migrations").
function requiredPaths(scriptBody: string): string[] {
  const paths: string[] = [];
  const nodeFile = scriptBody.match(/\bnode\s+(scripts\/[\w./-]+\.mjs)/);
  if (nodeFile) paths.push(nodeFile[1]);
  if (/\bnode-pg-migrate\b/.test(scriptBody)) {
    const m = scriptBody.match(/-m\s+([\w./-]+)/);
    paths.push(m ? m[1] : "migrations");
  }
  return paths;
}

// Source paths the Dockerfile COPYs into the image (ignoring the `--from=<stage>` flag and the
// final destination arg).
function dockerfileCopySources(): string[] {
  const srcs: string[] = [];
  for (const line of dockerfile.split(/\r?\n/)) {
    if (!/^\s*COPY\b/.test(line)) continue;
    const toks = line.trim().replace(/^COPY\s+/, "").split(/\s+/).filter((t) => !t.startsWith("--"));
    toks.slice(0, -1).forEach((t) => srcs.push(t)); // drop the dest (last token)
  }
  return srcs;
}

// A required path is shipped if the Dockerfile COPYs it exactly or COPYs a parent directory of it.
function isShipped(required: string, sources: string[]): boolean {
  return sources.some((s) => s === required || required.startsWith(s.replace(/\/$/, "") + "/"));
}

describe("Dockerfile ships every file the deploy's one-off tasks run", () => {
  const sources = dockerfileCopySources();
  const invoked = [...deployInvokedScripts()];

  it("finds the deploy-invoked npm scripts (guards against the regex silently matching nothing)", () => {
    expect(invoked).toEqual(expect.arrayContaining(["migrate", "bootstrap:stories", "migrate:stories"]));
  });

  it("bakes each deploy-invoked script's files/migrations into the image", () => {
    const missing: string[] = [];
    for (const name of invoked) {
      const body = pkg.scripts[name];
      if (!body) continue;
      for (const p of requiredPaths(body)) {
        if (!isShipped(p, sources)) missing.push(`${name} needs ${p}`);
      }
    }
    expect(missing, `Dockerfile COPY missing for: ${missing.join("; ")}`).toEqual([]);
  });
});
