#!/usr/bin/env node
// PreToolUse guard for the nbcc service — enforces the "never edit X / never run
// X" golden rules mechanically so they can't be tripped by accident.
//
// Reads the hook payload on stdin. Blocks a tool call by exiting 2 with a reason
// on stderr (Claude Code feeds that back to the model). Allows by exiting 0.
//
// Design rule: FAIL OPEN. Any unexpected error exits 0 so a bug in this guard
// can never brick the ability to edit files. The reviewer subagents + human PR
// review are the backstop for anything that slips through.

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

function block(reason) {
  process.stderr.write(reason + "\n");
  process.exit(2);
}

function toRel(filePath) {
  return path
    .relative(process.cwd(), path.resolve(filePath))
    .split(path.sep)
    .join("/");
}

// Return the verbatim machine-managed block (markers included) if the file has
// one, else null. Used to protect only the real span — not prose that merely
// mentions the word THROUGHLINE.
function managedSpan(absPath) {
  let text = "";
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const m = text.match(
    /<!-- THROUGHLINE:START -->[\s\S]*?<!-- THROUGHLINE:END -->/
  );
  return m ? m[0] : null;
}

// Strip heredoc bodies and quoted strings so a *mention* of a forbidden phrase
// (in a commit message, echo, grep pattern, etc.) doesn't trip a Bash guard —
// only an actual command invocation should.
function stripNonCommandText(cmd) {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, " ") // heredoc bodies
    .replace(/'[^']*'/g, " ") // single-quoted
    .replace(/"[^"]*"/g, " "); // double-quoted
}

// Is `rel` already committed on the main branch? (expand-contract: merged
// migrations are immutable). Returns false on any git error (fail open).
function existsOnMain(rel) {
  try {
    execFileSync("git", ["cat-file", "-e", "main:" + rel], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

try {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  const payload = JSON.parse(raw);
  const tool = payload.tool_name || "";
  const input = payload.tool_input || {};

  // --- Bash command guards ---------------------------------------------------
  if (tool === "Bash") {
    const cmd = stripNonCommandText(String(input.command || ""));
    // Match `terraform [flags] apply|destroy` at a command position (start, or
    // after a shell separator) — not the phrase buried in a string argument.
    if (
      /(^|[\n;&|(){}])\s*(sudo\s+)?terraform\b[^\n;&|]*\b(apply|destroy)\b/.test(
        cmd
      )
    ) {
      block(
        "Blocked: `terraform apply`/`destroy` must never run from app code or a\n" +
          "Claude session. Infra changes go through the Infra workflow (plan on PR,\n" +
          "manual apply via workflow_dispatch). See CLAUDE.md > Deploy model."
      );
    }
    process.exit(0);
  }

  // --- File edit guards (Edit / Write / MultiEdit / NotebookEdit) ------------
  if (
    tool === "Edit" ||
    tool === "Write" ||
    tool === "MultiEdit" ||
    tool === "NotebookEdit"
  ) {
    const filePath = input.file_path || input.notebook_path || "";
    if (!filePath) process.exit(0);

    const rel = toRel(filePath);
    const base = path.basename(filePath);

    // 1. SPEC.md is a generated projection of the requirement log.
    if (base === "SPEC.md") {
      block(
        "Blocked: SPEC.md is a generated projection of the requirement log — never\n" +
          "hand-edit it (CLAUDE.md > Spec contract). It is materialized upstream."
      );
    }

    // 2. .env holds local secrets and is gitignored. (.env.example is fine.)
    if (base === ".env") {
      block(
        "Blocked: .env holds local secrets and is gitignored — edit it yourself, not\n" +
          "via Claude (golden rule 4). The config surface lives in .env.example."
      );
    }

    // 3. Migrations merged to main are immutable (expand-contract, golden rule 2).
    //    New/unmerged migration files stay editable.
    if (/^migrations\//.test(rel) && existsOnMain(rel)) {
      block(
        "Blocked: " +
          rel +
          " is already merged to main. Migrations are immutable once\n" +
          "merged (expand-contract) — never edit a merged migration; add a NEW one\n" +
          "instead (CLAUDE.md > golden rule 2 / Resolving merge conflicts)."
      );
    }

    // 4. The machine-managed THROUGHLINE block must stay verbatim — but only
    //    block edits that actually alter that span (the markers or the text
    //    between them). Prose elsewhere that mentions THROUGHLINE is fine.
    if (/\.md$/.test(base)) {
      const span = managedSpan(path.resolve(filePath));
      if (span) {
        const inSpan = (s) =>
          typeof s === "string" &&
          s.length > 0 &&
          (span.includes(s) || /THROUGHLINE:(START|END)/.test(s));

        let touches = false;
        if (typeof input.content === "string") {
          // Write: overwriting the file must keep the managed span verbatim.
          touches = !input.content.includes(span);
        } else if (Array.isArray(input.edits)) {
          // MultiEdit: any sub-edit that removes/alters managed text.
          touches = input.edits.some((e) => inSpan(e.old_string));
        } else {
          // Edit: the replaced text falls within the managed span.
          touches = inSpan(input.old_string);
        }

        if (touches) {
          block(
            "Blocked: this edit alters the machine-managed THROUGHLINE block, which\n" +
              "must be preserved verbatim (CLAUDE.md > Resolving merge conflicts). Edit\n" +
              "around it, never inside it."
          );
        }
      }
    }
  }

  process.exit(0);
} catch {
  // Fail open — a guard bug must never block legitimate work.
  process.exit(0);
}
