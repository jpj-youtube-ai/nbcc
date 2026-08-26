// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_IMAGE_BYTES,
  IMAGE_JSON_BODY_LIMIT_BYTES,
} from "../../src/newsletter/image-validation";

// TASK-300: "I upload an image and it does not appear in the newsletter."
//
// Root cause was two layers of silence stacked on a cap that real photographs exceed:
//
//   1. Phone and camera photos are routinely 3-12 MB. The composer base64-encodes the file, which
//      inflates it by a third, and POSTs it as JSON. The parser cap on that route was 3 MB, so any
//      photo over roughly 2.2 MB was rejected by express BEFORE the handler ran.
//   2. Express answers its own 413 with an HTML page. The composer called r.json() on it, which
//      throws, and the promise chain had no .catch - so the rejection was swallowed entirely and
//      literally nothing happened on screen.
//   3. Even when the handler DID run and returned a proper JSON 413, the composer wrote the message
//      into #newsletterMsg - which lives inside the Send panel, hidden while you are writing. So
//      that path was invisible too.
//
// The fix downscales in the browser before upload (an email is 660px wide; a 4000px photo is pure
// weight), reports failures inline in the image field, and derives the parser cap from the image cap
// so the two can never drift apart again.

const ROOT = resolve(__dirname, "../..");
const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

/** Slice one function body out of app.js by brace matching, so assertions are scoped, not global. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`app.js no longer defines ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}`);
}

describe("image upload body limits (TASK-300)", () => {
  // Base64 costs four bytes for every three. A parser cap that does not account for it rejects the
  // body before our own validator can answer with something the composer is able to display.
  const inflate = (bytes: number) => Math.ceil((bytes * 4) / 3);

  it("never lets the parser reject an image that is within our own cap", () => {
    expect(IMAGE_JSON_BODY_LIMIT_BYTES).toBeGreaterThan(inflate(MAX_IMAGE_BYTES));
  });

  it("lets a full-size phone photo reach our validator, so the error is JSON we can show", () => {
    // The parser answers 413 with HTML, which the composer cannot parse - that was the silent path.
    // Anything a person might plausibly pick must get far enough to receive a real JSON error.
    const PLAUSIBLE_PHONE_PHOTO = 10 * 1024 * 1024;
    expect(IMAGE_JSON_BODY_LIMIT_BYTES).toBeGreaterThan(inflate(PLAUSIBLE_PHONE_PHOTO));
  });

  it("keeps app.ts using the shared constant rather than a second hand-written number", () => {
    const appTs = readFileSync(resolve(ROOT, "src/app.ts"), "utf8");
    expect(appTs).toContain("IMAGE_JSON_BODY_LIMIT");
    expect(appTs).not.toMatch(/newsletter-images",\s*express\.json\(\{\s*limit:\s*"3mb"/);
  });
});

describe("image upload feedback (TASK-300)", () => {
  const field = () => functionBody(appJs, "nlImageField");

  it("never reports upload problems into the Send panel, which is hidden while writing", () => {
    // The element itself, not the word: the comment in app.js explaining this fix names it too.
    expect(field()).not.toContain("el(\"newsletterMsg\")");
  });

  it("catches a failed upload instead of swallowing the rejection", () => {
    expect(field()).toContain(".catch(");
  });

  it("shrinks the picture before sending it, so a real photo is not rejected for size", () => {
    expect(field()).toContain("nlShrinkImage");
  });
});

describe("images inside repeating items (TASK-300)", () => {
  it("gives repeated items the same upload control as top-level fields", () => {
    // nlRenderItems used to call nlText for every field regardless of kind, so the story "two-up"
    // style offered a bare text box where every other style offered an upload button - even though
    // the renderer draws a per-item image.
    expect(functionBody(appJs, "nlRenderItems")).toContain("nlImageField");
  });

  it("marks the two-up story item image AS an image", () => {
    expect(appJs).toMatch(/items:\s*\{\s*fields:\s*\[\{ k: "imageUrl", label: "Image", kind: "image" \}/);
  });
});

describe("downscaling arithmetic (TASK-300)", () => {
  // Extracted and evaluated so the maths is genuinely exercised, not just present in the file.
  type Fit = (w: number, h: number, max: number) => { width: number; height: number };
  const fit: Fit = (w, h, max) =>
    (new Function(`${functionBody(appJs, "nlFitWithin")}; return nlFitWithin;`)() as Fit)(w, h, max);

  it("leaves a picture that already fits completely alone", () => {
    expect(fit(600, 400, 1200)).toEqual({ width: 600, height: 400 });
  });

  it("scales a big landscape photo down by its longest side", () => {
    expect(fit(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
  });

  it("scales a portrait photo by its height, not its width", () => {
    expect(fit(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
  });

  it("never returns a zero dimension for an extreme panorama", () => {
    const out = fit(8000, 200, 1200);
    expect(out.width).toBe(1200);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});
