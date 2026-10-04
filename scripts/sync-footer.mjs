#!/usr/bin/env node
// One footer, kept in one place.
//
// partials/footer.html is the master. This copies it into every page in the site's root that has a
// site footer, so a change to the footer is made once:
//
//   node scripts/sync-footer.mjs          copy the master into every page
//   node scripts/sync-footer.mjs --check  change nothing; list the pages out of step and exit 1
//
// test/unit/footer-master.test.ts fails when any page is out of step, so a footer edited by hand in
// one page cannot ship. Each page keeps its own indentation and line endings; only the footer
// element is replaced, and files are handled byte for byte (the master is plain ASCII).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MASTER_FILE = "partials/footer.html";

const FOOTER = /^([ \t]*)<footer class="site-footer"[\s\S]*?<\/footer>/m;

/** The master's lines, indented as the page indents its footer, with the page's line endings. */
export function footerFor(master, indent, newline) {
  return master
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join(newline);
}

/** The page with its footer replaced by the master. A page with no site footer comes back as it was. */
export function syncPage(html, master) {
  const found = FOOTER.exec(html);
  if (!found) return html;
  const newline = html.includes("\r\n") ? "\r\n" : "\n";
  return html.slice(0, found.index) + footerFor(master, found[1], newline) + html.slice(found.index + found[0].length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  const master = readFileSync(resolve(root, MASTER_FILE), "latin1");
  const changed = [];
  for (const file of readdirSync(root).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(resolve(root, file), "latin1");
    const next = syncPage(html, master);
    if (next === html) continue;
    changed.push(file);
    if (!check) writeFileSync(resolve(root, file), Buffer.from(next, "latin1"));
  }
  if (!changed.length) console.log("Every page's footer matches the master.");
  else console.log(`${check ? "Out of step" : "Updated"}: ${changed.join(", ")}`);
  if (check && changed.length) process.exit(1);
}
