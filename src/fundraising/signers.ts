import { createRequire } from "node:module";
import { resolve } from "node:path";

// Who can sign for NBCC: the admin's ONE "Signed by" list (TASK-251), which lives in
// assets/js/admin/helpers.js so the admin screens build their pickers from it. The server reads the
// same file (it ships with the app, like the fonts the printed pieces inline), so a signer chosen
// for a welcome letter is checked against exactly the list staff chose from, and the two can never
// drift apart. Read once and kept.

export interface ListedSigner {
  /** As it should be signed. */
  name: string;
  /** The title the letter prints under the signature. */
  role: string;
}

// This file compiles to dist/fundraising/signers.js, so ../.. is the app root (as ./materials.ts).
const HELPERS = resolve(__dirname, "../../assets/js/admin/helpers.js");
let cached: ListedSigner[] | null = null;

/** The Signed by list, in its order. Empty only if the list could not be read. */
export function listedSigners(): ListedSigner[] {
  if (cached) return cached;
  const api = createRequire(HELPERS)(HELPERS) as { SIGNERS?: unknown };
  const list = Array.isArray(api.SIGNERS) ? api.SIGNERS : [];
  cached = list
    .filter((s): s is ListedSigner => !!s && typeof (s as ListedSigner).name === "string" && (s as ListedSigner).name.trim() !== "")
    .map((s) => ({ name: s.name.trim(), role: typeof s.role === "string" ? s.role.trim() : "" }));
  return cached;
}

/** The listed signer of that name, with the title the list gives them; null when not on the list. */
export function listedSigner(name: string): ListedSigner | null {
  const wanted = name.trim();
  return listedSigners().find((s) => s.name === wanted) ?? null;
}
