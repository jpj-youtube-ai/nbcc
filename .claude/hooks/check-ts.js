#!/usr/bin/env node
// PostToolUse "fail fast" feedback for the nbcc service — runs ESLint on the
// edited TypeScript file and a project typecheck (tsc --noEmit) right after an
// edit, so problems surface in-session instead of a CI round-trip (CLAUDE.md >
// PR workflow: "lint locally first").
//
// On failure: exit 2 with details on stderr (PostToolUse exit 2 feeds stderr
// back to the model). On success: exit 0, silent. Fails OPEN on any error.
//
// Binaries are invoked via the current `node` against the package's JS entry
// points (not the `.bin` shim) so this works identically on Windows and POSIX.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function run(scriptRel, args) {
  // Returns combined output on failure, or null on success / when not installed.
  if (!fs.existsSync(scriptRel)) return null;
  try {
    execFileSync(process.execPath, [scriptRel, ...args], { stdio: "pipe" });
    return null;
  } catch (e) {
    const out = (e.stdout && e.stdout.toString()) || "";
    const err = (e.stderr && e.stderr.toString()) || "";
    return (out + err).trim() || e.message;
  }
}

try {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  const payload = JSON.parse(raw);
  const input = payload.tool_input || {};
  const resp = payload.tool_response || {};
  const filePath = resp.filePath || input.file_path || "";
  if (!filePath) process.exit(0);

  const rel = path
    .relative(process.cwd(), path.resolve(filePath))
    .split(path.sep)
    .join("/");

  // Only react to the TypeScript sources we lint/build.
  if (!/\.ts$/.test(rel)) process.exit(0);
  if (!/^(src|test)\//.test(rel)) process.exit(0);

  const problems = [];

  const eslint = run(path.join("node_modules", "eslint", "bin", "eslint.js"), [
    rel,
  ]);
  if (eslint) problems.push("ESLint (" + rel + "):\n" + eslint);

  const tsc = run(path.join("node_modules", "typescript", "bin", "tsc"), [
    "-p",
    "tsconfig.json",
    "--noEmit",
  ]);
  if (tsc) problems.push("tsc --noEmit:\n" + tsc);

  if (problems.length) {
    process.stderr.write(
      "Lint/typecheck failed after editing " +
        rel +
        " — fix before continuing (golden rule 1: every change is green with tests):\n\n" +
        problems.join("\n\n") +
        "\n"
    );
    process.exit(2);
  }

  process.exit(0);
} catch {
  // Fail open — never block work on a hook bug.
  process.exit(0);
}
