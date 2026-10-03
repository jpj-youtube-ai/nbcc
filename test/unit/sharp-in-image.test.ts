import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Profile pictures, review: sharp (a native library) makes every picture organisers send, in the one
// 512 MB task. The image check in pr.yml proves sharp loads inside the built image (a library that
// only loads on a laptop would fail every upload in production, and only there), and the runtime
// image caps glibc's memory arenas, which otherwise let a native library's memory grow per thread.

const ROOT = resolve(__dirname, "../..");
const dockerfile = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
const prYml = readFileSync(resolve(ROOT, ".github/workflows/pr.yml"), "utf8");

describe("sharp in the runtime image", () => {
  it("is loaded inside the built image by the PR image check", () => {
    expect(prYml).toMatch(/docker run --rm nbcc-image-check node -e "require\('sharp'\)"/);
  });

  it("runs with glibc's memory arenas capped at two", () => {
    const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtime).toMatch(/^ENV MALLOC_ARENA_MAX=2$/m);
  });
});
