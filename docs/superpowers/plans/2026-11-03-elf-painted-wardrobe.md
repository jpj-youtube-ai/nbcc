# Elf Detective School: the painted dress-up elf. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the code-drawn dress-up elf with OpenAI paintings, layered so every skin, hair and
piece still mixes and matches, with every painting approved by Jaimie by Friday 13 November 2026.

**Architecture:** A local tool in `scripts/elf-paint/` paints, cuts out, lines up and crops every
layer on one shared canvas, and writes WebP files in three sizes plus a generated manifest
(`assets/js/elf-paint.js`). `assets/js/elf-wardrobe.js` keeps its API (`drawElf`, `drawPiece`,
`drawOutfit`) but now stacks manifest layers as `<image>` elements in an SVG. The server builds
PNGs for emails and Detective HQ by stacking the large layer files with sharp. Nothing on the site
calls OpenAI.

**Tech Stack:** Node ES modules for the tool, sharp (already a dependency) for pixels, OpenAI
`/v1/images/edits`, Vitest, the existing Express pages.

**Spec:** `docs/superpowers/specs/2026-11-03-elf-painted-wardrobe-design.md`. Behaviour that is not
changing comes from `docs/superpowers/specs/2026-10-04-elf-detective-school-design.md`.

## Global Constraints

- Model `gpt-image-2`, quality `low`, size `1024x1536`, on `/v1/images/edits`. High quality only for
  a single painting that fails at low, never in bulk. No `gpt-image-1-mini` (its colours drift).
- Stop and ask Jaimie before total spend passes **£15**: the tool refuses to paint past
  `BUDGET_USD = 19`.
- The key is read only from `process.env.OPENAI_API_KEY`, never printed, logged, written to a file,
  or present in the repo, CI or the site.
- Paintings are on a flat magenta background. Sample the background from the corners: low quality
  paints it near `#E000E0`, not exactly `#FF00FF`.
- One canvas: 1024 by 1536, from one master (`t-m-high.png`, the approved sister with red mittens).
  The picture shown is the window `-79 0 1182 1536` of that canvas: 1.3 times as tall as wide, as
  every page and test expects today.
- Outline, eyes, eyebrows and smile are the approved browny red. On skin tones **s4 and s5** they
  are a deeper shade of the same browny red.
- Every elf wears red mittens. Gadgets and outfit props are painted once and fit every elf.
- Layer order, bottom to top: elf, feet, top, extra, face, neck, hat, hand. An outfit replaces all
  pieces.
- Catalogue unchanged: 5 skin tones, 5 hair colours, 3 hairstyles, 25 styles in 3 colours (75 pieces), 11
  outfits, every unlock door, every word. `normaliseLook` and the unlock functions are not touched.
- The repo is public: no real names or data in prompts, pictures, fixtures or the manifest.
- Raw paintings never get committed (`.elf-paint/` is git-ignored). Only finished WebP layers and
  the manifest are.
- Jaimie approves every batch before its layers are committed to the branch. Batches go to her
  daily from Wednesday 4 November; everything is approved by Friday 13 November.
- Nothing merges before Sunday 8 November (the Ball shares the Stripe webhook). The merge goes
  through `/ship`, with the migration order checked against `origin/main` first.

## Review Focus

1. **A look that needs a layer the manifest does not have** (a piece added later, a failed paint):
   the elf is drawn without it, never a broken picture or a crash. Test in Task 5.
2. **The darkest skin tone:** the face must still show. Test in Task 6 (the eyes are clearly darker
   than the cheek, measured in pixels, on s5).
3. **A gadget or outfit that replaces part of the elf:** the elf's own open right mitten, or a hand
   the reindeer paws should cover, must not peek out. Test in Task 6.
4. **The wardrobe page on a phone:** 75 piece tiles and 11 outfit tiles must not load the big
   layers. Test in Task 7 (the tiles' total bytes are capped).
5. **Several elves on one page** (HQ with three detectives, the certificate): each drawing's
   mask ids stay its own. Test in Task 5.

---

### Task 1: Paint call, spend ledger and budget guard

**Files:**
- Create: `scripts/elf-paint/openai.mjs`
- Modify: `.gitignore` (add `/.elf-paint/`)
- Test: `test/unit/elf-paint-openai.test.ts`

**Interfaces:**
- Produces:
  - `costOf(usage: OpenAIUsage, model: string): number`, the cost in US dollars, from the reported
    tokens at `gpt-image-2` rates: image input $8, text input $5, image output $30 per million.
  - `paint(job: { prompt: string; images: string[]; mask?: string; out: string; quality?: "low" | "high" }, deps?: { fetch?: typeof fetch; ledger?: string }): Promise<{ out: string; usd: number }>`
  - `spent(ledger?: string): number`
  - `BUDGET_USD = 19`
- The default ledger is `.elf-paint/spend.json`: a list of `{ at, out, usd }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("prices a painting from its reported tokens", () => {
  expect(costOf({ input_tokens_details: { image_tokens: 1536, text_tokens: 70 }, output_tokens_details: { image_tokens: 158 } }, "gpt-image-2")).toBeCloseTo(0.01738, 4);
});
it("asks for gpt-image-2 at low quality on a 1024x1536 canvas by default", async () => {
  /* fake fetch records the FormData */
  expect(sent.get("model")).toBe("gpt-image-2");
  expect(sent.get("quality")).toBe("low");
  expect(sent.get("size")).toBe("1024x1536");
});
it("refuses to paint once the ledger has passed the budget, without calling OpenAI", async () => {
  /* ledger holds 19.01 */
  await expect(paint(job, { fetch: fake, ledger })).rejects.toThrow(/budget/i);
  expect(fake).not.toHaveBeenCalled();
});
it("never puts the key in an error, even when OpenAI refuses", async () => {
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  /* fake fetch answers 400 */
  await expect(paint(job, { fetch: fake, ledger })).rejects.not.toThrow(/sk-test/);
});
it("writes what each painting cost to the ledger", async () => { /* spent(ledger) grows by costOf(usage) */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-paint-openai.test.ts`
Expected: FAIL, cannot find `scripts/elf-paint/openai.mjs`.

- [ ] **Step 3: Implement `openai.mjs`**, with the request shape from the session's `gen/paint.mjs`.
  The budget check comes before the request.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-paint-openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** with `.gitignore`.

### Task 2: Cutting out, lining up and cropping a layer

**Files:**
- Create: `scripts/elf-paint/cutout.mjs`
- Test: `test/unit/elf-paint-cutout.test.ts` (synthetic pictures made with sharp in the test)

**Interfaces:**
- Produces:
  - `type Rgba = { data: Uint8ClampedArray; width: number; height: number }`
  - `backgroundOf(img: Rgba): [number, number, number]`, the median colour of the four 16 by 16
    corners.
  - `keyOut(img: Rgba): Rgba`: the background becomes transparent, with soft edges (fully clear
    within 60 of the background colour, solid beyond 150), and the pink spill is taken off the
    edges.
  - `bestShift(a: Rgba, b: Rgba, box: [x0, y0, x1, y1], span = 24): { dx: number; dy: number }`
  - `isolate(alone: Rgba, worn: Rgba, master: Rgba): { layer: Rgba; cover: Rgba | null }`
    1. `alone` is the "piece on its own" painting and `worn` is the piece painted on the master.
    2. `alone` is lined up to `worn` on the piece's own pixels, and `worn` is lined up to `master`
       on the rows below the waist, or above the knees for feet.
    3. `cover` marks where the master is solid but `worn` is clear: the parts of the elf this piece
       hides. It is null when there are none.
  - `cropToContent(img: Rgba): { img: Rgba; x: number; y: number }`
  - `writeSizes(img: Rgba, at: { x: number; y: number }, name: string, outDir: string): Promise<void>`
    writes WebP at three scales: `tile` 0.12, `sm` 0.5 and `lg` 1.0. The names are
    `<outDir>/<size>/<name>.webp`, plus `<name>.cover.webp` for a cover. Quality 82.

- [ ] **Step 1: Write the failing tests**

```ts
it("finds an off-magenta background from the corners", () => { /* #E000E0 square */ expect(backgroundOf(img)).toEqual([224, 0, 224]); });
it("makes the background clear and keeps a dark outline solid", () => { /* alpha 0 at corner, 255 on a #6B191A ring */ });
it("takes the pink off a half-covered edge pixel", () => { /* edge pixel's green-vs-red/blue gap shrinks */ });
it("finds a picture moved by (-2, 4)", () => { expect(bestShift(a, moved, box)).toEqual({ dx: -2, dy: 4 }); });
it("lifts only the piece, and marks the part of the elf it hides", () => {
  /* master: body + right mitten; worn: body + hat, mitten moved; alone: hat only on magenta */
  expect(nonClear(layer)).toBe(hatPixels);
  expect(nonClear(cover!)).toBe(oldMittenPixelsNowGone);
});
it("writes three sizes, each the right width", async () => { /* tile, sm, lg widths = round(w * scale) */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-paint-cutout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `cutout.mjs`** on raw RGBA buffers. Read and write through `sharp(...).ensureAlpha().raw()`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-paint-cutout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

### Task 3: Every painting the wardrobe needs, and its words

**Files:**
- Create: `scripts/elf-paint/jobs.mjs`, `scripts/elf-paint/designs.json`
- Test: `test/unit/elf-paint-jobs.test.ts`

**Interfaces:**
- Consumes: `SKIN_TONES`, `HAIR_COLOURS`, `HAIR_STYLES`, `STYLES` and `OUTFITS` from
  `assets/js/elf-wardrobe.js`.
- Produces:
  - `type Job = { id: string; batch: Batch; kind: "elf" | "worn" | "alone" | "recolour"; prompt: string; from: string; dependsOn?: string }`
  - `type Batch = "elves" | "starter" | "hat" | "face" | "neck" | "top" | "feet" | "hand" | "extra" | "outfits"`
  - `allJobs(): Job[]`
  - `layerName(kind: "elf" | "piece" | "outfit", ...ids: string[]): string`, e.g. `elf-s2-curly-brown`,
    `piece-bobble-red`, `outfit-reindeer`.
- `designs.json` holds a fresh description of every style and outfit, in the logo's style. These
  are the "design from scratch" step: the reindeer stays a reindeer onesie, but each one is written
  new. For example: `"bobble": "a chunky knitted bobble hat with a turned up cream brim and a big fluffy cream bobble"`.
  Also the colour words for each colour id.

Job rules:
- **Elf jobs** come from the master. They change only skin and hair. On `s4` and `s5` the prompt
  adds the deeper browny red for the outline, eyes, eyebrows and smile.
- **Worn jobs.** The first colour of each style is a worn job on the master. Hats are worn on the
  fitting elf instead (`elf-s2-curly-brown`, the biggest hair).
- **Recolour jobs.** Every other colour is a recolour job from the first colour's worn painting:
  "the same piece, only its colour changes to …".
- **Alone jobs.** Each worn painting gets an alone job: "keep only the <piece> exactly as it is;
  paint everything else flat magenta".
- **Outfits.** Each outfit is one worn job on the master, plus one alone job that keeps the costume
  and leaves the face open.

- [ ] **Step 1: Write the failing tests**

```ts
it("needs 75 elves, one for each skin, hairstyle and hair colour", () => { expect(jobs("elf")).toHaveLength(75); });
it("asks for the deeper browny red on s4 and s5 only", () => { /* prompt includes "deeper" exactly for s4/s5 */ });
it("has a worn and an alone painting for every colour of every style, and every outfit", () => { /* 75 * 2 + 11 * 2 */ });
it("fits hats on curly hair", () => { expect(job("worn", "piece-elf-red").from).toBe("elf-s2-curly-brown"); });
it("has a fresh design for every style and outfit, and no real names", () => { /* designs.json keys = STYLES ids + OUTFITS ids */ });
it("puts the starter kit and the Workshop outfit in the starter batch", () => { /* elf red, tunic green, curly maroon, workshop */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-paint-jobs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `jobs.mjs` and write `designs.json`.**

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-paint-jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

### Task 4: The runner, the manifest writer and the sheets for Jaimie

**Files:**
- Create:
  - `scripts/elf-paint/run.mjs`, the command line tool: `node scripts/elf-paint/run.mjs <batch> [--only <id>] [--quality high]`
  - `scripts/elf-paint/manifest.mjs`
  - `scripts/elf-paint/sheet.mjs`
- Modify: `package.json` (add the script `"elf:paint": "node scripts/elf-paint/run.mjs"`)
- Test: `test/unit/elf-paint-manifest.test.ts`

**Interfaces:**
- Consumes: Task 1 `paint`, Task 2 `isolate`, `keyOut`, `cropToContent` and `writeSizes`, and Task 3
  `allJobs`.
- Produces: `buildManifest(dir: string): Manifest`, which writes `assets/js/elf-paint.js`.

  ```ts
  type Manifest = {
    canvas: { w: 1024; h: 1536; view: [-79, 0, 1182, 1536] };
    layers: Record<string, { x: number; y: number; w: number; h: number; cover?: true }>;
  };
  ```

  `elf-paint.js` exports the manifest as `module.exports` on the server and `window.NBCCElfPaint` in
  the browser, in the same wrapper as `elf-wardrobe.js`.
- Paintings are saved to `.elf-paint/raw/<job id>.png`, and the layers to `assets/img/elf/<size>/`.
- The runner skips any job whose raw painting already exists, so a rerun only paints what's
  missing. `--only` repaints one.
- `sheet.mjs <batch>` writes `.elf-paint/sheets/<batch>.png`. It shows every layer in the batch
  worn on three elves: `s1-bunches-ginger`, `s5-curly-black` and `s3-short-blonde`.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes a manifest that loads in node and in a browser", () => { /* require() it; and eval in jsdom window */ });
it("records each layer's place on the canvas and whether it hides part of the elf", () => {});
it("lists only layers whose three sizes all exist", () => { /* a layer missing tile/ is left out */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-paint-manifest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `manifest.mjs`, `run.mjs` and `sheet.mjs`. The runner and the sheet
  maker are thin wiring and have no unit tests. Task 8 proves them on real paintings.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-paint-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

### Task 5: Drawing the elf from painted layers

**Files:**
- Modify: `assets/js/elf-wardrobe.js`
  - Remove the shape drawings (`PIECES`, `OUTFIT_DRAW`, `PATTERNS`, `FACE` and the rest).
  - `drawElf`, `drawPiece` and `drawOutfit` read the manifest.
- Modify: `src/elf/wardrobe.ts` (`DrawOptions` gains `set?: "sm" | "lg"`)
- Modify: `test/unit/elf-wardrobe.test.ts` (the drawing tests are rewritten; the catalogue and
  unlock tests stay as they are) and `test/unit/elf-js-wardrobe.test.ts`
- First: `git revert 993dfa00` (the rejected restyle), so the branch starts from the old drawing.

**Interfaces:**
- Consumes: the Task 4 manifest, as `require("./elf-paint.js")` or `window.NBCCElfPaint`.
- Produces, with the same signatures as today:
  - `drawElf(look, state, opts)` returns an SVG with viewBox `-79 0 1182 1536`, width `size`, height
    `round(size * 1.3)`.
    - It has one `<image href="/assets/img/elf/<set>/<layer>.webp">` per worn layer, in layer order.
      The default set is `sm`.
    - The elf layer gets a `<mask id="m-<key>">` when a worn layer has a cover.
    - The backdrop circle and floor shadow stay drawn as shapes.
  - `drawPiece(style, colour, size)` returns `<img src="/assets/img/elf/tile/piece-<style>-<colour>.webp" width height alt="" loading="lazy" decoding="async">`.
    It's empty when the style is unknown or not in the manifest.
  - `drawOutfit(outfit, look, size)` returns the same kind of `<img>` for `outfit-<id>` at tile size,
    shown on the default elf.
    - Ruling for the executor: an outfit tile no longer shows the child's own skin. The tile is 72
      pixels and the mirror above it shows their own elf.
- Anything worn that the manifest lacks is left out. The elf layer falls back to
  `elf-s2-short-brown`, and then to no picture at all, never a broken one.

- [ ] **Step 1: Write the failing tests**

```ts
it("stacks one picture per worn layer, in layer order", () => { /* hrefs in order: elf, feet, top, hat */ });
it("draws only the elf and the outfit when an outfit is on", () => {});
it("uses the large pictures when asked, for print", () => { /* /assets/img/elf/lg/ */ });
it("hides the elf's own mitten under a gadget", () => { /* mask present and referenced when hand=mag */ });
it("keeps each drawing's mask its own when two share a page", () => { /* key a and key b give m-a, m-b */ });
it("leaves out a piece the manifest does not have, and still draws the elf", () => {});
it("is 1.3 times as tall as it is wide", () => {});
it("carries nothing typed: an unknown id can never reach an href", () => { /* look with '"><script>' ids */ });
it("has a picture for every skin, hairstyle, hair colour, style colour and outfit", () => { /* manifest completeness; enabled at the end of Task 8 by removing .skip */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-wardrobe.test.ts test/unit/elf-js-wardrobe.test.ts`
Expected: FAIL on the new drawing tests. The catalogue tests still PASS.

- [ ] **Step 3: Implement.** Commit a small fixture manifest with three layers, so the tests run
  before any painting exists. The tests can choose the manifest through an injectable `setPaint(m)`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-wardrobe.test.ts test/unit/elf-js-wardrobe.test.ts`
Expected: PASS, except the skipped completeness test.

- [ ] **Step 5: Commit.**

### Task 6: PNGs for emails and Detective HQ

**Files:**
- Modify: `src/elf/elf-png.ts` (stack the large layer files from disk with sharp, instead of
  rendering an SVG)
- Modify: `src/routes/elf.ts` (`/elf/hq/elf/:file` serves `<id>.png` through `elfPng`; a busy queue
  answers 503 with `Retry-After: 2`)
- Modify: `src/elf/pages/hq.ts` (the picture is `<id>.png`)
- Modify: `test/unit/elf-png.test.ts` and `test/unit/elf-routes-look.test.ts`

**Interfaces:**
- Consumes: the Task 4 manifest and Task 5's layer choice. Export
  `layersFor(look, state): { name: string; cover: boolean }[]` from `elf-wardrobe.js`, so the
  browser and the server pick the same layers.
- Produces: `elfPng(look, state, width, background)` with the same signature and queue as today.
  - It places each layer at `(x - (-79), y)` on a 1182 by 1536 transparent canvas.
  - It clears covered pixels from the elf layer with a `dest-out` composite.
  - Then it resizes to `width`.

- [ ] **Step 1: Write the failing tests** (on the fixture layers until Task 8, then on the real ones)

```ts
it("shows the hair colour chosen", async () => { /* average colour of hair region differs between blonde and black */ });
it("keeps the face showing on the darkest skin", async () => { /* s5: eye pixels at least 40 darker than cheek pixels */ });
it("hides the elf's own mitten when a gadget is held", async () => { /* pixels at the open-mitten spot change */ });
it("makes every outfit plainly different from the plain elf", async () => { /* > 3000 pixels differ at 200 wide */ });
it("serves HQ's elf as a PNG, private, never cached", async () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-png.test.ts test/unit/elf-routes-look.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/unit/elf-png.test.ts test/unit/elf-routes-look.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

### Task 7: Pages: the wardrobe, the certificate and the share card

**Files:**
- Modify: `src/elf/pages/wardrobe.ts` (scripts become `["elf-paint.js", "elf-wardrobe.js", "elf-wardrobe-ui.js"]`)
- Modify: `assets/js/elf-wardrobe-ui.js`, the mirror. Unchanged calls; check that it still redraws
  on every choice.
- Modify: `src/elf/print.ts`:
  - the certificate uses `set: "lg"`;
  - `shareCardSvg(s, elfPicture: string)` takes the elf as a PNG data URI made with `elfPng`, at 380
    wide on cream.
- Modify: `assets/css/elf.css` (tiles show `<img>`; the same box sizes as today)
- Modify: `test/unit/elf-page-wardrobe.test.ts`, `test/unit/elf-print.test.ts` and
  `test/unit/elf-pages-house-rules.test.ts` (if a script rule needs the new file)

- [ ] **Step 1: Write the failing tests**

```ts
it("loads the painted layers' list before the wardrobe script", () => { /* script order */ });
it("keeps all the tiles on a phone under 600 KB", () => { /* sum of tile/*.webp sizes referenced by the page */ });
it("never puts a large picture on the wardrobe page", () => { /* no /lg/ in the html */ });
it("prints the certificate with the large pictures", () => {});
it("puts the elf on the share card as a picture", () => { /* <image href="data:image/png;base64, */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/unit/elf-page-wardrobe.test.ts test/unit/elf-print.test.ts test/unit/elf-pages-house-rules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests to see them pass.** Then look at the wardrobe page in the preview
  server at 375 wide, using its scroll and measurement rules, not hidden-pane screenshots.

- [ ] **Step 5: Commit.**

### Task 8: Paint, check with Jaimie, commit, in batches

This task is the painting itself. Each batch follows the same steps:
1. `npm run elf:paint <batch>`.
2. Read the sheet yourself, and repaint anything with:
   - leftover hair;
   - a floating piece;
   - pink edges;
   - the wrong colour;
   - a face that has changed.
3. Send the sheet to Jaimie (SendUserFile, with a caption listing what's on it), then one pop-up:
   "approve / repaint these".
4. On her yes, commit that batch's layers and the regenerated manifest. Log it in the ledger, with
   the spend so far from `spent()`.

- [ ] **Batch 0 (Wed 4 Nov):**
  1. Show Jaimie the master with mittens (`t-m-high.png`) on its own, for her yes. She has only
     seen it inside the price test.
  2. Copy it and the test pictures into `docs/superpowers/specs/assets/2026-11-03-elf-painted/`.
  3. Paint `elf-s2-curly-brown` first: it's the fitting elf for hats.
- [ ] **Batch 1, elves (Wed 4 to Thu 5 Nov):** all 75. Sheets by skin tone.
- [ ] **Batch 2, starter (Thu 5 Nov):** red elf hat, green tunic, maroon curly shoes, and the
  Workshop outfit.
- [ ] **Batches 3 to 9 (Fri 6 to Wed 11 Nov):** hat, top, feet, neck, face, hand, extra.
- [ ] **Batch 10, outfits (Wed 11 to Thu 12 Nov).**
- [ ] **Close (Thu 12 Nov):**
  - remove `.skip` from the completeness test;
  - run the whole elf suite;
  - record the final spend;
  - push to PR #711. (Pushing a draft is allowed. Merging waits for `/ship` on or after 8 Nov.)

If a batch slips by more than a day, tell Jaimie that day and say which batch moves.

### Task 9: README and tidying

**Files:**
- Modify: `README.md`, the "Elf Detective School" section. Cover:
  - the painted wardrobe;
  - `npm run elf:paint` (it needs `OPENAI_API_KEY` in your own environment, and never runs in CI);
  - where the layers live;
  - the £15 guard.
- Modify: `src/elf/wardrobe.ts` comments, and `assets/js/elf-wardrobe.js`'s header, which says the
  pieces are drawn in code.
- Test: `npm run lint`, `npm run build`, and every elf test.

- [ ] **Step 1:** Update the words.
- [ ] **Step 2:** Run `npm run lint && npm run build && npx vitest run test/unit/elf-*.test.ts test/unit/admin-elf*.test.ts`.
  Expected: all PASS.
- [ ] **Step 3:** Commit.
