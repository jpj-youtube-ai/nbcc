// NBCC Elf Detective School: the painted dress-up elf (docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md).
//
// The one place the painting tool talks to OpenAI. Every painting is an edit of a picture we
// already have (the master elf, or a painting made from it), so it keeps the same canvas and the
// layers line up. Jaimie asked for it to be cheap: gpt-image-2 at low quality, about $0.017 a
// painting, tested against high, medium and gpt-image-1-mini on 3 November 2026.
//
// What each painting cost is written to a ledger (.elf-paint/spend.json, never committed), and the
// tool refuses to paint once that passes BUDGET_USD, so it stops and asks before Jaimie's cap.
//
// The key is read from OPENAI_API_KEY in the environment of whoever runs the tool, and is never
// printed, logged or written anywhere. This runs on a person's own computer only: never on the
// site, never in CI. Unit tested in test/unit/elf-paint-openai.test.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Stop a little under £23 in all (Jaimie raised the cap for the paper elves, 4 November 2026; it was
 *  £15 on 3 November). The $2.50 of early tests sit outside the ledger: $27.50 here is $30 in all. */
export const BUDGET_USD = 27.5;

export const MODEL = "gpt-image-2";
const NO_USAGE_USD = 0.2;
const ENDPOINT = "https://api.openai.com/v1/images/edits";
const DEFAULT_LEDGER = resolve(ROOT, ".elf-paint/spend.json");

// OpenAI's published prices, US dollars per million tokens (read 3 November 2026).
const RATES = {
  "gpt-image-2": { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-1.5": { imageIn: 8, textIn: 5, imageOut: 32 },
};

/** Items (pieces and outfits on their own) are painted on a clear background, which gpt-image-2
 *  cannot do (Jaimie chose separate items, 3 November 2026). */
export const ITEM_MODEL = "gpt-image-1.5";

/** What one painting cost, in US dollars, from the tokens OpenAI reported for it. */
export function costOf(usage, model = MODEL) {
  const rate = RATES[model];
  if (!rate) throw new Error(`No prices are known for ${model}.`);
  const input = (usage && usage.input_tokens_details) || {};
  const output = (usage && usage.output_tokens_details) || {};
  return ((input.image_tokens || 0) * rate.imageIn + (input.text_tokens || 0) * rate.textIn + (output.image_tokens || 0) * rate.imageOut) / 1e6;
}

function readLedger(ledger) {
  if (!existsSync(ledger)) return [];
  const rows = JSON.parse(readFileSync(ledger, "utf8"));
  return Array.isArray(rows) ? rows : [];
}

/** Everything spent so far, in US dollars. */
export function spent(ledger = DEFAULT_LEDGER) {
  return readLedger(ledger).reduce((sum, row) => sum + (Number(row.usd) || 0), 0);
}

/**
 * Paints one picture and saves it to `job.out`.
 *   job.prompt   the words;
 *   job.images   the pictures it edits (the first one sets the canvas);
 *   job.mask     optional: where it may paint;
 *   job.quality  "low" (the default) or "high", for one painting that fails at low.
 * Resolves to { out, usd }.
 */
export async function paint(job, deps = {}) {
  const ledger = deps.ledger || DEFAULT_LEDGER;
  const send = deps.fetch || fetch;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("There is no OPENAI_API_KEY in this window. Set it in your own environment, never in the repo.");
  const sofar = spent(ledger);
  if (sofar >= BUDGET_USD) {
    throw new Error(`Stopped: $${sofar.toFixed(2)} has been spent, which is past the budget of $${BUDGET_USD}. Ask Jaimie before painting more.`);
  }

  const model = job.item ? ITEM_MODEL : MODEL;
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", job.prompt);
  form.append("size", job.size || "1024x1536");
  form.append("quality", job.quality === "high" ? "high" : "low");
  if (job.item) {
    form.append("background", "transparent");
    form.append("output_format", "png");
    form.append("input_fidelity", "high");
  } else form.append("background", "opaque");
  for (const path of job.images) form.append("image[]", new Blob([readFileSync(path)], { type: "image/png" }), basename(path));
  if (job.mask) form.append("mask", new Blob([readFileSync(job.mask)], { type: "image/png" }), basename(job.mask));

  const res = await send(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // OpenAI's own message only: never the request, which carries the key in its headers.
    const said = data && data.error && typeof data.error.message === "string" ? data.error.message : "no reason given";
    throw new Error(`OpenAI said ${res.status}: ${said.split(key).join("[key]").slice(0, 400)}`);
  }

  mkdirSync(dirname(job.out), { recursive: true });
  writeFileSync(job.out, Buffer.from(data.data[0].b64_json, "base64"));
  // No cost given counts as a high quality painting, so the budget can only over count.
  const usd = data.usage ? costOf(data.usage, model) : NO_USAGE_USD;
  mkdirSync(dirname(ledger), { recursive: true });
  writeFileSync(ledger, JSON.stringify([...readLedger(ledger), { at: new Date().toISOString(), out: basename(job.out), usd }], null, 1));
  return { out: job.out, usd };
}
