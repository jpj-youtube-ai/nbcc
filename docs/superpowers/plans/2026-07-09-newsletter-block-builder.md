# Newsletter Block Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-HTML newsletter `<textarea>` with a two-pane block builder (left rail adds typed blocks with 4 style variants each; right rail live-previews the exact HTML email), backed by uploadable images stored in Postgres.

**Architecture:** A newsletter is a JSON **block document** stored in a new `newsletters.body_json` column. One pure renderer (`src/newsletter/blocks.ts` + `theme.ts`) compiles the document to a brand-inlined HTML email; the same function backs the live preview, the saved `body_html`, and the per-recipient merge send. Images upload as base64 to an Editor+ endpoint, are stored in a new `newsletter_images` table, and are served publicly by `GET /media/newsletter/:id`.

**Tech Stack:** Express + TypeScript, node-pg-migrate (CommonJS), Zod validation, Vitest (unit), Cucumber (BDD), vanilla JS admin UI (no framework).

## Global Constraints

- **Additive migrations only** (golden rule 2): new columns nullable / defaulted, new tables only. Never edit an already-merged migration.
- **Keep existing BDD green:** `POST/PUT /api/admin/newsletters` MUST still accept `{ subject, bodyHtml }` (features/newsletter.feature relies on it). New block docs arrive as `{ subject, bodyJson }`. At least one of the two is required.
- **No new config value.** Reuse `config.PORTAL_BASE_URL`, `config.NEWSLETTER_FROM_EMAIL`, `config.ADMIN_SESSION_SECRET`.
- **Role gates:** `authorizeAdmin(req, res, "editor")` for edit/preview/upload; `authorizeAdmin(req, res, "admin")` for send. `claims.sub` = user id, `claims.email` = email.
- **Brand palette (inline hex, mirrors `src/thank-you/letter.ts`):** MAROON `#800000`, CRIMSON `#C02238`, CREAM `#F8F5EE`, SLATE `#333333`, SLATE_SOFT `#6F6A66`, TAN_SOFT `#F3E4DD`, HOLLY_DARK `#123C12`, CREAM_82 `rgba(248,245,238,.82)`. Fonts: HEAD `'Playfair Display', Georgia, 'Times New Roman', serif`; BODY `'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`. Logo absolute URL `https://nbcc.scot/assets/img/nbcc-logo.png`.
- **Footer bar** (fixed, every render): `01292 811 015 · info@nbcc.scot · nbcc.scot` + `Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.`
- **Escape all** staff/donor strings via `escapeHtml`. Merge token is literal `{{firstName}}`; fallback name is `friend`.
- **Image upload:** allow-list `image/png`, `image/jpeg`, `image/webp`, `image/gif` (no SVG). Max 2 MB decoded.
- **Every task ends green:** `npm run lint` + `npm run build` clean; unit/BDD as noted. Commit at each task end.

---

### Task 1: Migration — add `body_json`, convert the seed draft

**Files:**
- Create: `migrations/<timestamp>_newsletter-body-json.js` (via `npx node-pg-migrate create newsletter-body-json`)

**Interfaces:**
- Produces: `newsletters.body_json jsonb` (nullable). Seed draft row now has a starter block document.

- [ ] **Step 1: Generate the migration file**

Run: `npx node-pg-migrate create newsletter-body-json`
Expected: prints the created file path under `migrations/`.

- [ ] **Step 2: Write the migration**

```js
/* eslint-disable */
// TASK-168 (REQ-069): the newsletter block document. Additive/expand-contract: one new nullable
// column on `newsletters`, no existing column dropped or narrowed (body_html is retained as the
// compiled render + immutable record). Converts the single seeded starter draft into a starter
// block document so the new builder demos on first load. Safe under a code-level rollback.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("newsletters", {
    body_json: { type: "jsonb" }, // NULL for legacy raw-HTML drafts; the block document otherwise
  });

  // Convert the starter seed (subject unchanged) into a minimal block document.
  pgm.sql(`
    UPDATE newsletters
       SET body_json = '{"blocks":[
             {"type":"masthead","variant":0,"data":{"issueTitle":"Newsletter"}},
             {"type":"greeting","variant":0,"data":{}},
             {"type":"text","variant":0,"data":{"text":"Write your update here."}},
             {"type":"donationCta","variant":3,"data":{"heading":"Support our work","label":"Make a donation today","href":"https://nbcc.scot/donate"}}
           ]}'::jsonb
     WHERE subject = 'North Berwick Christmas Committee — Newsletter'
       AND status = 'draft'
       AND body_json IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn("newsletters", "body_json");
};
```

- [ ] **Step 3: Run the migration up + down + up to verify reversibility**

Run: `npm run migrate` then `npx node-pg-migrate down` then `npm run migrate`
Expected: all succeed; `\d newsletters` shows a `body_json jsonb` column.

- [ ] **Step 4: Commit**

```bash
git add migrations/
git commit -m "[TASK-168] migration: add newsletters.body_json + convert seed to block doc"
```

---

### Task 2: Migration — `newsletter_images` table

**Files:**
- Create: `migrations/<timestamp>_newsletter-images.js`

**Interfaces:**
- Produces: table `newsletter_images(id uuid PK, mime text, bytes bytea, byte_size int, uploaded_by int FK users, created_at timestamptz)`.

- [ ] **Step 1: Generate the migration**

Run: `npx node-pg-migrate create newsletter-images`

- [ ] **Step 2: Write the migration**

```js
/* eslint-disable */
// TASK-168 (REQ-069): storage for uploaded newsletter images. Additive: one brand-new table, no
// existing table touched. Images are served publicly by GET /media/newsletter/:id; the uuid (app-
// generated with crypto.randomUUID) is the capability. No extension needed (id is supplied by the
// app, not gen_random_uuid). uploaded_by FK → users is ON DELETE SET NULL (keep the image if the
// staff account is later removed).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_images",
    {
      id: { type: "uuid", primaryKey: true }, // app-supplied crypto.randomUUID()
      mime: { type: "text", notNull: true },
      bytes: { type: "bytea", notNull: true },
      byte_size: { type: "integer", notNull: true },
      uploaded_by: { type: "integer", references: "users", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Uploaded newsletter images, served by GET /media/newsletter/:id (REQ-069)." },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_images");
};
```

- [ ] **Step 3: Run up/down/up**

Run: `npm run migrate && npx node-pg-migrate down && npm run migrate`
Expected: succeed; `\d newsletter_images` shows the columns.

- [ ] **Step 4: Commit**

```bash
git add migrations/
git commit -m "[TASK-168] migration: newsletter_images table"
```

---

### Task 3: `src/db/newsletters.ts` — persist `body_json`, recipient `fullName`

**Files:**
- Modify: `src/db/newsletters.ts`

**Interfaces:**
- Produces:
  - `Newsletter` gains `bodyJson: unknown | null`.
  - `NewsletterRecipient` gains `fullName: string | null`.
  - `createNewsletter(subject, bodyHtml, bodyJson)`, `updateNewsletterDraft(id, subject, bodyHtml, bodyJson)` where `bodyJson: unknown | null` is stored as jsonb.
- Consumes: `pool` from `./pool`.

- [ ] **Step 1: Extend the row type + mapper**

In `src/db/newsletters.ts`, add `body_json` to the `Row` interface and select it everywhere `body_html` is selected. Update interfaces + mapper:

```ts
export interface Newsletter extends NewsletterSummary {
  bodyHtml: string;
  bodyJson: unknown | null;
}

export interface NewsletterRecipient {
  email: string;
  donorId: number;
  fullName: string | null;
}

interface Row {
  id: number;
  subject: string;
  body_html: string;
  body_json: unknown | null;
  status: "draft" | "sent";
  sent_at: string | null;
  recipient_count: number | null;
}

function toNewsletter(r: Row): Newsletter {
  return {
    id: r.id,
    subject: r.subject,
    bodyHtml: r.body_html,
    bodyJson: r.body_json,
    status: r.status,
    sentAt: r.sent_at,
    recipientCount: r.recipient_count,
  };
}
```

- [ ] **Step 2: Add `body_json` to every SELECT/INSERT/UPDATE**

Update the four queries. In `listNewsletters` keep body blanked for the list (add `body_json: null` in the map). For `getNewsletter`, `claimNewsletterForSend` add `, body_json` to the RETURNING/SELECT column lists. Rewrite create/update:

```ts
export async function createNewsletter(
  subject: string,
  bodyHtml: string,
  bodyJson: unknown | null,
): Promise<Newsletter> {
  const row = (
    await pool.query<Row>(
      `INSERT INTO newsletters (subject, body_html, body_json, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count`,
      [subject, bodyHtml, bodyJson],
    )
  ).rows[0];
  return toNewsletter(row);
}

export async function updateNewsletterDraft(
  id: number,
  subject: string,
  bodyHtml: string,
  bodyJson: unknown | null,
): Promise<Newsletter | null> {
  const row = (
    await pool.query<Row>(
      `UPDATE newsletters SET subject = $2, body_html = $3, body_json = $4, updated_at = now()
        WHERE id = $1 AND status = 'draft'
       RETURNING id, subject, body_html, body_json, status, sent_at, recipient_count`,
      [id, subject, bodyHtml, bodyJson],
    )
  ).rows[0];
  return row ? toNewsletter(row) : null;
}
```

Note: node-postgres serialises a JS object bound to a `jsonb` param automatically; pass `null` through unchanged.

- [ ] **Step 3: Add `full_name` to the recipient query**

```ts
export async function listNewsletterRecipients(): Promise<NewsletterRecipient[]> {
  const rows = (
    await pool.query<{ email: string; donor_id: number; full_name: string | null }>(
      `SELECT lower(email) AS email, min(id) AS donor_id, min(full_name) AS full_name
         FROM donors
        WHERE email_consent = true AND email IS NOT NULL
        GROUP BY lower(email)
        ORDER BY email`,
    )
  ).rows;
  return rows.map((r) => ({ email: r.email, donorId: r.donor_id, fullName: r.full_name }));
}
```

- [ ] **Step 4: Update `listNewsletters` map to include `bodyJson: null`**

```ts
return rows.map((r) => toNewsletter({ ...r, body_html: "", body_json: null }));
```

- [ ] **Step 5: Build to verify types**

Run: `npm run build`
Expected: PASS (callers in admin.ts will error until Task 16 — if so, complete Task 16's signature change in the same commit or temporarily pass the new args; see Task 16). To keep this task self-contained, update the two call sites in `src/routes/admin.ts` minimally: `createNewsletter(subject, bodyHtml, null)` and `updateNewsletterDraft(id, subject, bodyHtml, null)`. Full route logic lands in Task 16.

- [ ] **Step 6: Commit**

```bash
git add src/db/newsletters.ts src/routes/admin.ts
git commit -m "[TASK-168] db: store newsletter body_json + recipient full_name"
```

---

### Task 4: `src/db/newsletter-images.ts` — insert/get image rows

**Files:**
- Create: `src/db/newsletter-images.ts`
- Test: `test/unit/newsletter-image-store.test.ts` (validation is pure; DB round-trip is exercised by BDD in Task 21)

**Interfaces:**
- Produces:
  - `MAX_IMAGE_BYTES = 2 * 1024 * 1024`
  - `ALLOWED_IMAGE_MIME: readonly string[]` = `["image/png","image/jpeg","image/webp","image/gif"]`
  - `validateUpload(mime: string, byteSize: number): { ok: true } | { ok: false; reason: "mime" | "size" }`
  - `insertNewsletterImage(mime: string, bytes: Buffer, uploadedBy: number | null): Promise<{ id: string }>`
  - `getNewsletterImage(id: string): Promise<{ mime: string; bytes: Buffer } | null>`

- [ ] **Step 1: Write the failing test (pure validation)**

```ts
// test/unit/newsletter-image-store.test.ts
import { describe, it, expect } from "vitest";
import { validateUpload, MAX_IMAGE_BYTES } from "../../src/db/newsletter-images";

describe("validateUpload", () => {
  it("accepts an allowed mime within the size cap", () => {
    expect(validateUpload("image/png", 1024)).toEqual({ ok: true });
  });
  it("rejects a disallowed mime (e.g. svg)", () => {
    expect(validateUpload("image/svg+xml", 1024)).toEqual({ ok: false, reason: "mime" });
  });
  it("rejects an over-cap payload", () => {
    expect(validateUpload("image/jpeg", MAX_IMAGE_BYTES + 1)).toEqual({ ok: false, reason: "size" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- newsletter-image-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/db/newsletter-images.ts
import { randomUUID } from "node:crypto";
import { pool } from "./pool";

// Uploaded newsletter images (TASK-168/REQ-069). Stored in Postgres and served publicly by
// GET /media/newsletter/:id. Raster-only allow-list (no SVG → served bytes can't carry script);
// 2 MB cap. The id is an app-generated uuid so no DB extension is required.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function validateUpload(
  mime: string,
  byteSize: number,
): { ok: true } | { ok: false; reason: "mime" | "size" } {
  if (!ALLOWED_IMAGE_MIME.includes(mime as (typeof ALLOWED_IMAGE_MIME)[number])) {
    return { ok: false, reason: "mime" };
  }
  if (byteSize <= 0 || byteSize > MAX_IMAGE_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

export async function insertNewsletterImage(
  mime: string,
  bytes: Buffer,
  uploadedBy: number | null,
): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO newsletter_images (id, mime, bytes, byte_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, mime, bytes, bytes.length, uploadedBy],
  );
  return { id };
}

export async function getNewsletterImage(
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const row = (
    await pool.query<{ mime: string; bytes: Buffer }>(
      `SELECT mime, bytes FROM newsletter_images WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return row ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- newsletter-image-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/newsletter-images.ts test/unit/newsletter-image-store.test.ts
git commit -m "[TASK-168] db: newsletter image store + upload validation"
```

---

### Task 5: `src/newsletter/theme.ts` — palette, escape, merge, frame, shared button

**Files:**
- Create: `src/newsletter/theme.ts`
- Test: `test/unit/newsletter-theme.test.ts`

**Interfaces:**
- Produces:
  - constants: `MAROON, CRIMSON, CREAM, SLATE, SLATE_SOFT, TAN_SOFT, HOLLY_DARK, CREAM_82, HEAD, BODY, LOGO_URL` (strings)
  - `interface RenderCtx { firstName: string }`
  - `escapeHtml(v: string): string`
  - `applyMerge(text: string, ctx: RenderCtx): string` — escapes `text`, then replaces `{{firstName}}` with the escaped ctx name
  - `renderFrame(innerHtml: string): string` — wraps blocks in maroon page → 660px cream card → footer bar → returns a full `<!doctype html>` email
  - `brandButton(label: string, href: string, style: "primary" | "outline" | "full" | "link"): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/newsletter-theme.test.ts
import { describe, it, expect } from "vitest";
import { escapeHtml, applyMerge, renderFrame, brandButton } from "../../src/newsletter/theme";

describe("newsletter theme", () => {
  it("escapes HTML-special characters", () => {
    expect(escapeHtml(`<b>&"x`)).toBe("&lt;b&gt;&amp;&quot;x");
  });
  it("merges the first name and escapes both text and name", () => {
    expect(applyMerge("Dear {{firstName}} <ok>", { firstName: "Jane & Co" })).toBe(
      "Dear Jane &amp; Co &lt;ok&gt;",
    );
  });
  it("frame wraps content with the cream card and the OSCR footer line", () => {
    const html = renderFrame("<p>BODYMARK</p>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("BODYMARK");
    expect(html).toContain("SC047995");
    expect(html).toContain("info@nbcc.scot");
    expect(html).toContain("#F8F5EE"); // cream card
  });
  it("brandButton renders an anchor with the label and href", () => {
    const b = brandButton("Donate", "https://nbcc.scot/donate", "primary");
    expect(b).toContain("https://nbcc.scot/donate");
    expect(b).toContain("Donate");
    expect(b).toContain("#C02238"); // crimson primary
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `npm run test:unit -- newsletter-theme`

- [ ] **Step 3: Implement**

```ts
// src/newsletter/theme.ts
// Shared brand theme + frame for the newsletter block renderer (TASK-168/REQ-069). Mirrors the
// inline-hex palette + 660px cream-card-on-maroon frame of src/thank-you/letter.ts, because email
// clients don't load the site stylesheet. Pure + DB-free — unit-tested directly.

export const MAROON = "#800000";
export const CRIMSON = "#C02238";
export const CREAM = "#F8F5EE";
export const SLATE = "#333333";
export const SLATE_SOFT = "#6F6A66";
export const TAN_SOFT = "#F3E4DD";
export const HOLLY_DARK = "#123C12";
export const CREAM_82 = "rgba(248,245,238,.82)";
export const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const BODY = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
export const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

export interface RenderCtx {
  firstName: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Escape the whole string, THEN substitute {{firstName}} with the escaped name — so neither the
// author's copy nor the donor's name can inject markup.
export function applyMerge(text: string, ctx: RenderCtx): string {
  return escapeHtml(text).replace(/\{\{firstName\}\}/g, escapeHtml(ctx.firstName));
}

export function brandButton(
  label: string,
  href: string,
  style: "primary" | "outline" | "full" | "link",
): string {
  const safeLabel = escapeHtml(label);
  const safeHref = escapeHtml(href);
  const base = `font-family:${BODY};font-weight:700;font-size:15px;text-decoration:none;display:inline-block`;
  if (style === "link") {
    return `<a href="${safeHref}" style="${base};color:${CRIMSON}">${safeLabel} &rarr;</a>`;
  }
  if (style === "outline") {
    return `<a href="${safeHref}" style="${base};color:${CRIMSON};border:2px solid ${CRIMSON};border-radius:8px;padding:10px 22px">${safeLabel}</a>`;
  }
  const width = style === "full" ? "display:block;text-align:center;" : "";
  return `<a href="${safeHref}" style="${base};${width}color:${CREAM};background:${CRIMSON};border-radius:8px;padding:12px 26px">${safeLabel}</a>`;
}

// Wrap the concatenated block HTML in the fixed email frame + NBCC contact/legal footer bar.
export function renderFrame(innerHtml: string): string {
  return `<!doctype html>
<html lang="en-GB">
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:0">${innerHtml}</td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
      <div style="font-weight:700">01292 811 015 &nbsp;·&nbsp; info@nbcc.scot &nbsp;·&nbsp; nbcc.scot</div>
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test:unit -- newsletter-theme`

- [ ] **Step 5: Commit**

```bash
git add src/newsletter/theme.ts test/unit/newsletter-theme.test.ts
git commit -m "[TASK-168] newsletter theme: palette, escape, merge, frame, button"
```

---

### Task 6: `src/newsletter/blocks.ts` — schema, dispatcher, `masthead` exemplar, `rawHtml`

**Files:**
- Create: `src/newsletter/blocks.ts`
- Test: `test/unit/newsletter-blocks.test.ts`

**Interfaces:**
- Consumes: everything from `./theme`.
- Produces:
  - `type BlockType` (the 14 names) and `BLOCK_TYPES: BlockType[]`
  - `interface Block { type: BlockType; variant: number; data: Record<string, unknown> }`
  - `interface NewsletterDoc { blocks: Block[] }`
  - `newsletterDocSchema` (Zod) — validates `{ blocks: Block[] }`, `variant` int 0..3, `type` in the enum
  - `renderBlock(block: Block, ctx: RenderCtx): string`
  - `renderNewsletter(doc: NewsletterDoc, ctx: RenderCtx): string` = `renderFrame(doc.blocks.map(b => renderBlock(b, ctx)).join(""))`
  - Each block renderer is registered in a `RENDERERS: Record<BlockType, (b: Block, ctx: RenderCtx) => string>` map. Later tasks (7–15) add the remaining entries; this task ships `masthead` + `rawHtml` and stubs the rest to `() => ""` so the module compiles.
- **Naming contract for later tasks** — each renderer reads `block.data` fields (all optional, defaulted):
  - `masthead`: `issueTitle`, `heroUrl?`
  - `greeting`: `heading?`, `lead?`
  - `text`: `text`
  - `heading`: `kicker?`, `title`
  - `image`: `url`, `caption?`, `alt?`
  - `story`: `imageUrl?`, `title`, `body`, `label?`, `href?` (and `items?: Array<{imageUrl?,title,body,label?,href?}>` for the two-up variant)
  - `spotlight`: `photoUrl?`, `name`, `quote`, `role?`
  - `stats`: `items: Array<{ number: string; label: string; caption?: string }>`
  - `waysToHelp`: `items: Array<{ icon?: string; title: string; body?: string; label?: string; href?: string }>`
  - `events`: `items: Array<{ day: string; month: string; name: string; location?: string; label?: string; href?: string }>`
  - `donationCta`: `imageUrl?`, `heading`, `label`, `href`
  - `button`: `label`, `href`
  - `divider`: (none)

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/newsletter-blocks.test.ts
import { describe, it, expect } from "vitest";
import { renderNewsletter, newsletterDocSchema } from "../../src/newsletter/blocks";

const ctx = { firstName: "Jane" };

describe("newsletter blocks — core", () => {
  it("renders the full framed email for a masthead block", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "masthead", variant: 0, data: { issueTitle: "July Newsletter" } }] },
      ctx,
    );
    expect(html).toContain("<!doctype html>"); // frame
    expect(html).toContain("July Newsletter");
    expect(html).toContain("nbcc-logo.png"); // logo present
    expect(html).toContain("SC047995"); // footer
  });

  it("rawHtml passthrough renders its HTML verbatim inside the frame", () => {
    const html = renderNewsletter(
      { blocks: [{ type: "rawHtml", variant: 0, data: { html: "<p>LEGACY-BODY</p>" } }] },
      ctx,
    );
    expect(html).toContain("<p>LEGACY-BODY</p>");
  });

  it("schema rejects an unknown type", () => {
    const r = newsletterDocSchema.safeParse({ blocks: [{ type: "nope", variant: 0, data: {} }] });
    expect(r.success).toBe(false);
  });

  it("schema rejects an out-of-range variant", () => {
    const r = newsletterDocSchema.safeParse({
      blocks: [{ type: "text", variant: 9, data: {} }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm run test:unit -- newsletter-blocks`

- [ ] **Step 3: Implement the module (schema + dispatcher + masthead + rawHtml + stubs)**

```ts
// src/newsletter/blocks.ts
// Pure block renderer for the newsletter builder (TASK-168/REQ-069). A newsletter is a block
// document (JSON). renderNewsletter compiles it to a brand-inlined HTML email via the shared frame
// in ./theme. The same function backs the live preview, the saved body_html, and the per-recipient
// merge send — one source of truth, no drift. DB-free + config-free → unit-tested directly.
import { z } from "zod";
import {
  type RenderCtx,
  renderFrame,
  escapeHtml,
  applyMerge,
  brandButton,
  MAROON,
  CRIMSON,
  CREAM,
  SLATE,
  TAN_SOFT,
  HEAD,
  BODY,
  LOGO_URL,
} from "./theme";

export const BLOCK_TYPES = [
  "masthead",
  "greeting",
  "text",
  "heading",
  "image",
  "story",
  "spotlight",
  "stats",
  "waysToHelp",
  "events",
  "donationCta",
  "button",
  "divider",
  "rawHtml",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface Block {
  type: BlockType;
  variant: number;
  data: Record<string, unknown>;
}
export interface NewsletterDoc {
  blocks: Block[];
}

export const newsletterDocSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.enum(BLOCK_TYPES),
      variant: z.number().int().min(0).max(3),
      data: z.record(z.unknown()).default({}),
    }),
  ),
});

// --- small readers so every renderer treats data as untrusted --------------------------------
const str = (d: Record<string, unknown>, k: string, fallback = ""): string =>
  typeof d[k] === "string" ? (d[k] as string) : fallback;
const list = (d: Record<string, unknown>, k: string): Record<string, unknown>[] =>
  Array.isArray(d[k]) ? (d[k] as Record<string, unknown>[]) : [];

// --- block renderers -------------------------------------------------------------------------
// masthead — the issue header. Variant 0: centered logo + issue title. (Variants 1–3 differ in
// layout; all include the logo + title.) This is the exemplar the other block tasks follow.
function masthead(b: Block, _ctx: RenderCtx): string {
  const title = escapeHtml(str(b.data, "issueTitle", "Newsletter"));
  const hero = str(b.data, "heroUrl");
  const heroImg = hero
    ? `<img src="${escapeHtml(hero)}" alt="" width="580" style="display:block;width:100%;max-width:580px;height:auto;margin:0 auto 12px" />`
    : "";
  // v2 puts the title over the hero; all other variants stack logo → title (→ optional hero).
  const logo = `<img src="${LOGO_URL}" alt="North Berwick Christmas Committee" width="150" style="display:inline-block;height:auto;max-width:150px" />`;
  const titleEl = `<h1 style="font-family:${HEAD};color:${CRIMSON};font-size:26px;font-weight:800;margin:8px 0 0">${title}</h1>`;
  const align = b.variant === 1 ? "left" : "center";
  return `<div style="padding:28px 40px 8px;text-align:${align}">${logo}${titleEl}${b.variant === 2 ? "" : ""}${heroImg}</div>`;
}

// rawHtml — legacy passthrough (a draft saved before the block builder). Not in the palette. The
// stored HTML is authored by staff (trusted), so it is emitted verbatim inside the frame.
function rawHtml(b: Block, _ctx: RenderCtx): string {
  return `<div style="padding:24px 40px">${str(b.data, "html")}</div>`;
}

const stub = (): string => "";

export const RENDERERS: Record<BlockType, (b: Block, ctx: RenderCtx) => string> = {
  masthead,
  rawHtml,
  greeting: stub,
  text: stub,
  heading: stub,
  image: stub,
  story: stub,
  spotlight: stub,
  stats: stub,
  waysToHelp: stub,
  events: stub,
  donationCta: stub,
  button: stub,
  divider: stub,
};

export function renderBlock(block: Block, ctx: RenderCtx): string {
  return (RENDERERS[block.type] ?? stub)(block, ctx);
}

export function renderNewsletter(doc: NewsletterDoc, ctx: RenderCtx): string {
  return renderFrame(doc.blocks.map((b) => renderBlock(b, ctx)).join(""));
}
```

> Later tasks replace the `stub` entries with real renderers and export any shared helpers they add. Keep the `str`/`list`/`applyMerge`/`brandButton` helpers as the vocabulary for all of them.

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test:unit -- newsletter-blocks`

- [ ] **Step 5: Commit**

```bash
git add src/newsletter/blocks.ts test/unit/newsletter-blocks.test.ts
git commit -m "[TASK-168] newsletter blocks: schema, dispatcher, masthead + rawHtml"
```

---

### Tasks 7–15: the remaining block renderers (one commit each)

Each task follows the **same TDD loop** as Task 6, using the helpers already defined (`str`, `list`, `escapeHtml`, `applyMerge`, `brandButton`, palette/font constants). For each: (1) add test cases to `test/unit/newsletter-blocks.test.ts` asserting the listed **markers** for each of the 4 variants; (2) run — FAIL; (3) replace the `stub` in `RENDERERS` with the renderer; (4) run — PASS; (5) commit `[TASK-168] newsletter block: <type>`.

Every renderer MUST: escape all strings (via `escapeHtml`/`applyMerge`), wrap its output in a `<div style="padding:…40px…">` consistent with the exemplar's horizontal rhythm, and degrade gracefully when optional fields are absent (render nothing for a missing image/button rather than a broken tag).

- [ ] **Task 7 — `greeting`** (merge). Variants: 0 plain `Dear {{firstName}},`; 1 greeting + `lead` intro paragraph; 2 `heading` (Playfair) above the greeting; 3 warm/casual `Hi {{firstName}} 👋`. Use `applyMerge` for the greeting line. **Test markers:** rendering variant 0 with `ctx.firstName="Jane"` contains `Dear Jane,`; variant 3 contains `Hi Jane`; a `lead` string appears in variant 1; unknown name path (`firstName:"friend"`) contains `Dear friend,`.

- [ ] **Task 8 — `text`, `heading`, `divider`, `button`** (simple blocks, one commit).
  - `text` variants: 0 body paragraph; 1 lead (18px); 2 pull-quote (`${HEAD}` italic, crimson, centered); 3 highlighted callout (`background:${TAN_SOFT};border-left:4px solid ${CRIMSON}`). All read `data.text` via `applyMerge`. **Markers:** the text appears; variant 3 contains `${TAN_SOFT}`; variant 2 contains `${HEAD}`.
  - `heading` variants: 0 crimson serif centered; 1 `kicker` (uppercase eyebrow) + `title`; 2 maroon band (`background:${MAROON};color:${CREAM}`); 3 uppercase letter-spaced eyebrow only. **Markers:** `title` appears; variant 2 contains `${MAROON}`.
  - `divider` variants: 0 hairline `<hr style="border:none;border-top:1px solid #e5ded3">`; 1 short crimson rule (48px wide, crimson); 2 blank 24px spacer; 3 small centered mark (`·`). **Markers:** variant 1 contains `${CRIMSON}`; variant 0 contains `<hr`.
  - `button` variants map to `brandButton` styles: 0 primary, 1 outline, 2 full, 3 link. Reads `data.label`, `data.href`. **Markers:** href + label appear; variant 1 contains `border:2px solid`.

- [ ] **Task 9 — `image`.** Variants: 0 full-width; 1 rounded (`border-radius:12px`); 2 with `caption` (small slate text under); 3 framed (`border:1px solid #e5ded3;padding:6px`). Reads `data.url`, `data.alt`, `data.caption`. Render nothing if `url` empty. **Markers:** the url appears in `src=`; variant 1 contains `border-radius`; variant 2 contains the caption text.

- [ ] **Task 10 — `story`** (image + title + text + Read-more). Variants: 0 image-top; 1 image-left (two-column table); 2 two-up row (reads `data.items[]`, renders each side by side); 3 text-only with a top rule. Uses `brandButton(label, href, "link")` when `href` present. **Markers:** `title` + `body` appear; variant 2 renders both items' titles; a `href` present → the link label appears.

- [ ] **Task 11 — `spotlight`** (person + quote). Variants: 0 photo-left + quote; 1 centered avatar (round `border-radius:50%`) + quote; 2 big-quote (`${HEAD}` 22px) with attribution; 3 tinted card (`background:${TAN_SOFT}`). Reads `photoUrl`, `name`, `quote`, `role`. **Markers:** `name` + `quote` appear; variant 1 contains `border-radius:50%`; variant 3 contains `${TAN_SOFT}`.

- [ ] **Task 12 — `stats`** (impact numbers). Variants: 0 one big number (`${HEAD}` 40px crimson) + label; 1 three-across row (table, reads `data.items[]`); 2 number + label + caption; 3 inline highlighted. Reads `data.items: [{number,label,caption?}]`. **Markers:** the first item's `number` + `label` appear; variant 1 renders all items' numbers.

- [ ] **Task 13 — `waysToHelp`** (Donate/Volunteer/Spread). Variants: 0 three icon columns (table; each item `icon` emoji + `title` + `body` + optional button); 1 stacked list; 2 two-up; 3 single primary CTA (first item only, `brandButton(...,"primary")`). Reads `data.items: [{icon,title,body,label,href}]`. **Markers:** each item `title` appears in variants 0–2; variant 3 renders one `brandButton`.

- [ ] **Task 14 — `events`** (date badge + name + location + Register). Variants: 0 date-badge rows (maroon square with `day`/`month`, name+location, Register button); 1 simple list; 2 cards; 3 single featured event. Reads `data.items: [{day,month,name,location,label,href}]`. **Markers:** each item `name` appears; variant 0 renders the `day` inside a maroon badge (`background:${MAROON}`).

- [ ] **Task 15 — `donationCta`** (closing banner). Variants: 0 image + button (`imageUrl` background image row + heading + `brandButton`); 1 tinted band (`background:${TAN_SOFT}`); 2 split (text left, button right); 3 centered. Reads `imageUrl`, `heading`, `label`, `href`. **Markers:** `heading` + button `href` appear; variant 1 contains `${TAN_SOFT}`.

After Task 15, add one integration test to `newsletter-blocks.test.ts`: build a document with **one block of every type** and assert `renderNewsletter` returns a string containing `<!doctype html>` and `SC047995`, and that no `undefined` or `[object Object]` leaks into the output.

Run after each: `npm run test:unit -- newsletter-blocks` (PASS) and `npm run lint`.

---

### Task 16: Routes — accept `bodyJson`, compile to `body_html`

**Files:**
- Modify: `src/routes/admin.ts` (the newsletter section, lines ~162–262)

**Interfaces:**
- Consumes: `renderNewsletter`, `newsletterDocSchema` from `../newsletter/blocks`; `createNewsletter`/`updateNewsletterDraft` (now 3-arg) from Task 3.
- Produces: create/update store both `body_html` (compiled) and `body_json`. GET returns `bodyJson`.

- [ ] **Step 1: Replace `newsletterBodySchema` with a dual-input schema**

```ts
import { renderNewsletter, newsletterDocSchema } from "../newsletter/blocks";

// A newsletter arrives as EITHER a block document (bodyJson, the builder) OR raw HTML (bodyHtml,
// legacy + BDD). At least one is required. When bodyJson is present it is the source of truth and
// body_html is the compiled render; otherwise the raw HTML is stored as-is (rawHtml passthrough).
const newsletterBodySchema = z
  .object({
    subject: z.string().min(1),
    bodyJson: newsletterDocSchema.optional(),
    bodyHtml: z.string().min(1).optional(),
  })
  .refine((v) => v.bodyJson !== undefined || v.bodyHtml !== undefined, {
    message: "Provide bodyJson or bodyHtml",
  });

// Compile the posted payload into { bodyHtml, bodyJson } for storage. Preview name is neutral for
// the stored render — the real per-recipient name is applied at send time.
function compileNewsletterBody(data: z.infer<typeof newsletterBodySchema>): {
  bodyHtml: string;
  bodyJson: unknown | null;
} {
  if (data.bodyJson !== undefined) {
    return { bodyHtml: renderNewsletter(data.bodyJson, { firstName: "friend" }), bodyJson: data.bodyJson };
  }
  return { bodyHtml: data.bodyHtml as string, bodyJson: null };
}
```

- [ ] **Step 2: Update POST + PUT handlers to use it**

In `postAdminNewsletter`: after parse, `const { bodyHtml, bodyJson } = compileNewsletterBody(parsed.data);` then `const created = await createNewsletter(parsed.data.subject, bodyHtml, bodyJson);`.

In `putAdminNewsletter`: same compile, then `updateNewsletterDraft(id, parsed.data.subject, bodyHtml, bodyJson)`.

`getAdminNewsletter` already returns the whole row (now including `bodyJson`) — no change needed beyond Task 3.

- [ ] **Step 3: Run build + unit + existing BDD**

Run: `npm run build && npm run test:unit`
Expected: PASS.
Run (BDD, app must be running — see project BDD setup): `npm run test:bdd -- --tags @newsletter`
Expected: the existing 5 scenarios still PASS (they post `bodyHtml`).

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "[TASK-168] routes: newsletters accept a block document (bodyJson)"
```

---

### Task 17: Route — `POST /api/admin/newsletters/preview`

**Files:**
- Modify: `src/routes/admin.ts`

**Interfaces:**
- Produces: `POST /api/admin/newsletters/preview` (Editor+) — body `{ bodyJson }`, returns `{ html }` rendered with `firstName:"Jane"`.

- [ ] **Step 1: Add the handler**

```ts
// POST /api/admin/newsletters/preview — render a block document to email HTML for the live builder
// preview (Editor+). Stateless, no DB. Uses a sample first name so merge fields show realistically.
export async function postAdminNewsletterPreview(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "editor")) return;
  const parsed = z.object({ bodyJson: newsletterDocSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid document", details: parsed.error.flatten() });
  }
  return res.json({ html: renderNewsletter(parsed.data.bodyJson, { firstName: "Jane" }) });
}
```

- [ ] **Step 2: Register the route BEFORE `/:id` GET**

In the route registration block, add (place it above `get("/api/admin/newsletters/:id", …)` so `preview` isn't captured as an `:id`):

```ts
adminRouter.post("/api/admin/newsletters/preview", postAdminNewsletterPreview);
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "[TASK-168] routes: newsletter preview endpoint"
```

---

### Task 18: Route — `POST /api/admin/newsletter-images` upload + JSON limit

**Files:**
- Modify: `src/routes/admin.ts`, `src/app.ts`

**Interfaces:**
- Consumes: `validateUpload`, `insertNewsletterImage` from `../db/newsletter-images`; `config.PORTAL_BASE_URL`.
- Produces: `POST /api/admin/newsletter-images` (Editor+) — body `{ mime, dataBase64, filename? }`, returns `201 { id, url }`.

- [ ] **Step 1: Give the upload path a larger JSON limit (before global parser)**

In `src/app.ts`, ABOVE `app.use(express.json());` add:

```ts
  // The newsletter image upload carries a base64 payload up to ~2 MB (×1.37 encoded), which exceeds
  // the global express.json 100kb cap. Give just this path a larger parser BEFORE the global one;
  // body-parser then sees the body already parsed and skips it. Mirrors the /api/my-story guard.
  app.use("/api/admin/newsletter-images", express.json({ limit: "3mb" }));
```

- [ ] **Step 2: Add the upload handler**

```ts
import { validateUpload, insertNewsletterImage } from "../db/newsletter-images";

// POST /api/admin/newsletter-images — upload one image for use in a newsletter block (Editor+).
// Body { mime, dataBase64 }. Validates mime allow-list + 2 MB cap, stores the bytes, returns the
// public serve URL. See src/routes/newsletter-images.ts for the GET side.
export async function postAdminNewsletterImage(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "editor");
  if (!claims) return;
  const parsed = z
    .object({ mime: z.string().min(1), dataBase64: z.string().min(1), filename: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid upload" });

  const bytes = Buffer.from(parsed.data.dataBase64, "base64");
  const check = validateUpload(parsed.data.mime, bytes.length);
  if (!check.ok) {
    const status = check.reason === "size" ? 413 : 400;
    return res.status(status).json({ error: check.reason === "size" ? "Image too large (2 MB max)" : "Unsupported image type" });
  }
  const { id } = await insertNewsletterImage(parsed.data.mime, bytes, claims.sub);
  return res.status(201).json({ id, url: `${config.PORTAL_BASE_URL}/media/newsletter/${id}` });
}
```

- [ ] **Step 3: Register the route**

```ts
adminRouter.post("/api/admin/newsletter-images", postAdminNewsletterImage);
```

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/app.ts
git commit -m "[TASK-168] routes: newsletter image upload endpoint"
```

---

### Task 19: Route — public `GET /media/newsletter/:id` serve

**Files:**
- Create: `src/routes/newsletter-images.ts`
- Modify: `src/app.ts` (mount before the site catch-all)

**Interfaces:**
- Consumes: `getNewsletterImage` from `../db/newsletter-images`.
- Produces: `newsletterImagesRouter`; `GET /media/newsletter/:id` streams bytes.

- [ ] **Step 1: Implement the router**

```ts
// src/routes/newsletter-images.ts
import { Router, type Request, type Response } from "express";
import { getNewsletterImage } from "../db/newsletter-images";

// Public serve for uploaded newsletter images (TASK-168/REQ-069). Email clients fetch images with
// no session, so this is unauthenticated. Lookup is by uuid only (no path input → no traversal);
// the raster-only upload allow-list + nosniff header prevent a served upload from being sniffed as
// script. The /media/* prefix is deliberately NOT under /assets (no static-server / page-guard clash).
export const newsletterImagesRouter = Router();

newsletterImagesRouter.get("/media/newsletter/:id", async (req: Request, res: Response) => {
  const img = await getNewsletterImage(req.params.id);
  if (!img) return res.status(404).type("text/plain").send("Not found");
  res.setHeader("Content-Type", img.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(img.bytes);
});
```

- [ ] **Step 2: Mount before the site router**

In `src/app.ts`: `import { newsletterImagesRouter } from "./routes/newsletter-images";` and, just above `app.use(createSiteRouter(...))`:

```ts
  // Public newsletter image serve — before the site catch-all so /media/* isn't shadowed.
  app.use(newsletterImagesRouter);
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/newsletter-images.ts src/app.ts
git commit -m "[TASK-168] routes: public /media/newsletter/:id image serve"
```

---

### Task 20: Route — per-recipient merge send

**Files:**
- Modify: `src/routes/admin.ts` (`postAdminSendNewsletter`)

**Interfaces:**
- Consumes: `NewsletterRecipient.fullName` (Task 3); `renderNewsletter`, `newsletterDocSchema`.
- Produces: each recipient's email rendered from `body_json` with their first name; legacy `body_html`-only rows send as-is.

- [ ] **Step 1: Add a first-name helper + render-per-recipient in the send loop**

Add near the other newsletter helpers:

```ts
// First name for the greeting merge: first whitespace-delimited token of the donor's full name,
// falling back to "friend" when we have no usable name.
function firstNameOf(fullName: string | null): string {
  const token = (fullName ?? "").trim().split(/\s+/)[0];
  return token.length > 0 ? token : "friend";
}
```

In `postAdminSendNewsletter`, replace the body-build inside the recipient loop. The claimed `newsletter` now carries `bodyJson`; parse it once before the loop, then render per recipient:

```ts
  const recipients = await listNewsletterRecipients();
  const parsedDoc = newsletterDocSchema.safeParse(newsletter.bodyJson);
  for (const r of recipients) {
    const token = signUnsubscribeToken(r.donorId, config.ADMIN_SESSION_SECRET);
    const unsubscribeUrl = `${config.PORTAL_BASE_URL}/unsubscribe/${token}`;
    // Block-doc newsletters render per recipient (merge the first name); legacy raw-HTML rows
    // (no valid bodyJson) fall back to the stored, already-compiled body_html.
    const rendered = parsedDoc.success
      ? renderNewsletter(parsedDoc.data, { firstName: firstNameOf(r.fullName) })
      : newsletter.bodyHtml;
    const html = buildNewsletterHtml(rendered, unsubscribeUrl);
    try {
      await sendNewsletter({
        email: r.email,
        from: config.NEWSLETTER_FROM_EMAIL,
        replyTo: config.NEWSLETTER_FROM_EMAIL,
        subject: newsletter.subject,
        html,
      });
    } catch (err) {
      console.error(`newsletter send to ${r.email} failed`, err);
    }
  }
```

- [ ] **Step 2: Build + lint + unit**

Run: `npm run build && npm run lint && npm run test:unit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.ts
git commit -m "[TASK-168] routes: per-recipient first-name merge on send"
```

---

### Task 21: BDD — block-doc create, preview, upload round-trip, merge send

**Files:**
- Modify: `features/newsletter.feature`, `features/steps/newsletter.steps.js`

**Interfaces:**
- Consumes: the endpoints from Tasks 16–20.

- [ ] **Step 1: Add scenarios to `features/newsletter.feature`**

```gherkin
  Scenario: an Editor creates a block-document draft and previews it
    Given a newsletter admin "editor3.newsletter.bdd@example.com" with role "editor" and password "pw-e3"
    When I create a block newsletter with subject "Blocks update"
    Then the newsletter response status should be 201
    When I preview the current block document
    Then the preview response status should be 200
    And the preview HTML should contain "Dear Jane,"
    And the preview HTML should contain "SC047995"

  Scenario: an Editor uploads an image and it serves back
    Given a newsletter admin "editor4.newsletter.bdd@example.com" with role "editor" and password "pw-e4"
    When I upload a newsletter image
    Then the image upload status should be 201
    When I fetch the uploaded image
    Then the image fetch status should be 200
    And the image content type should be "image/png"

  Scenario: an over-size image upload is rejected
    Given a newsletter admin "editor5.newsletter.bdd@example.com" with role "editor" and password "pw-e5"
    When I upload an oversize newsletter image
    Then the image upload status should be 413
```

Extend the `Before`/`After` cleanup subject list with `'Blocks update'`.

- [ ] **Step 2: Add the steps to `features/steps/newsletter.steps.js`**

```js
// A minimal valid block document (greeting merges the recipient first name).
const SAMPLE_DOC = {
  blocks: [
    { type: "masthead", variant: 0, data: { issueTitle: "Blocks update" } },
    { type: "greeting", variant: 0, data: {} },
    { type: "text", variant: 0, data: { text: "Hello from the committee." } },
  ],
};
// 1x1 transparent PNG.
const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

When("I create a block newsletter with subject {string}", async function (subject) {
  const r = await authFetch("/api/admin/newsletters", "POST", { subject, bodyJson: SAMPLE_DOC }, this.token);
  this.nlStatus = r.status;
  this.nlBody = r.json;
  if (r.json && r.json.id) this.newsletterId = r.json.id;
});

When("I preview the current block document", async function () {
  const r = await authFetch("/api/admin/newsletters/preview", "POST", { bodyJson: SAMPLE_DOC }, this.token);
  this.previewStatus = r.status;
  this.previewHtml = r.json.html || "";
});

Then("the preview response status should be {int}", function (expected) {
  assert.equal(this.previewStatus, expected);
});

Then("the preview HTML should contain {string}", function (needle) {
  assert.ok(this.previewHtml.includes(needle), `preview missing ${needle}`);
});

When("I upload a newsletter image", async function () {
  const r = await authFetch(
    "/api/admin/newsletter-images",
    "POST",
    { mime: "image/png", dataBase64: PNG_1PX_B64 },
    this.token,
  );
  this.imgUploadStatus = r.status;
  this.imgId = r.json.id;
});

When("I upload an oversize newsletter image", async function () {
  const big = Buffer.alloc(2 * 1024 * 1024 + 10, 0x41).toString("base64"); // > 2 MB decoded
  const r = await authFetch(
    "/api/admin/newsletter-images",
    "POST",
    { mime: "image/png", dataBase64: big },
    this.token,
  );
  this.imgUploadStatus = r.status;
});

Then("the image upload status should be {int}", function (expected) {
  assert.equal(this.imgUploadStatus, expected);
});

When("I fetch the uploaded image", async function () {
  const res = await fetch(`${BASE_URL}/media/newsletter/${this.imgId}`);
  this.imgFetchStatus = res.status;
  this.imgContentType = res.headers.get("content-type");
});

Then("the image fetch status should be {int}", function (expected) {
  assert.equal(this.imgFetchStatus, expected);
});

Then("the image content type should be {string}", function (expected) {
  assert.equal(this.imgContentType, expected);
});
```

Also extend the `Before`/`After` newsletter hooks to clean uploaded rows: `await pool.query("DELETE FROM newsletter_images WHERE uploaded_by IN (SELECT id FROM users WHERE email LIKE '%newsletter.bdd@example.com')");` (run this DELETE **before** the `DELETE FROM users` line so the FK is satisfied; note `uploaded_by` is `ON DELETE SET NULL`, so ordering isn't strictly required, but delete images first for tidiness).

- [ ] **Step 3: Run the newsletter BDD**

Run: `npm run test:bdd -- --tags @newsletter`
Expected: all scenarios (old + new) PASS.

- [ ] **Step 4: Commit**

```bash
git add features/newsletter.feature features/steps/newsletter.steps.js
git commit -m "[TASK-168] bdd: block newsletter create/preview/upload/serve"
```

---

### Task 22: UI — two-pane builder scaffold (HTML + CSS)

**Files:**
- Modify: `admin.html` (the `#view-newsletter` section, ~188–202), `assets/css/admin.css`

**Interfaces:**
- Produces: the DOM the builder JS (Tasks 23–25) drives. Element ids are the contract.

- [ ] **Step 1: Replace the newsletter view body with the two-pane shell**

Keep the list (`#newsletterList`) and hidden `#newsletterId`. Replace the raw textarea form with:

```html
<form id="newsletterForm">
  <input type="hidden" id="newsletterId" />
  <p><label>Subject<br /><input type="text" id="newsletterSubject" required style="width:100%" /></label></p>
  <div class="nl-builder">
    <div class="nl-left">
      <div class="nl-palette" id="nlPalette" aria-label="Add a block"></div>
      <ol class="nl-canvas" id="nlCanvas" aria-label="Newsletter blocks"></ol>
    </div>
    <div class="nl-right">
      <div class="nl-preview-label">Preview</div>
      <iframe id="nlPreview" title="Newsletter preview" class="nl-preview"></iframe>
    </div>
  </div>
  <div class="nl-actions">
    <button type="button" id="newsletterNew">New newsletter</button>
    <button type="submit" id="newsletterSave">Save</button>
    <button type="button" id="newsletterSend" hidden>Send to subscribers</button>
  </div>
  <p id="newsletterMsg" aria-live="polite"></p>
</form>
```

- [ ] **Step 2: Add `.nl-*` styles to `assets/css/admin.css`**

```css
/* Newsletter block builder (TASK-168). Two-pane: palette+canvas left, live preview right. */
.nl-builder { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
@media (max-width: 900px) { .nl-builder { grid-template-columns: 1fr; } }
.nl-palette { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .75rem; }
.nl-palette button { font-size: .85rem; padding: .3rem .6rem; }
.nl-variants { display: flex; gap: .4rem; flex-wrap: wrap; margin: .35rem 0 .5rem; }
.nl-variants button { border: 1px solid #ccc; background: #fff; padding: .25rem .5rem; cursor: pointer; }
.nl-variants button[aria-pressed="true"] { border-color: #c02238; background: #f3e4dd; }
.nl-canvas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
.nl-block { border: 1px solid #e0dccf; border-radius: 8px; padding: .6rem .7rem; background: #fff; }
.nl-block-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.nl-block-title { font-weight: 600; text-transform: capitalize; }
.nl-block-ctrls button { margin-left: .25rem; }
.nl-block label { display: block; font-size: .8rem; margin-top: .4rem; }
.nl-block input, .nl-block textarea { width: 100%; }
.nl-preview { width: 100%; height: 720px; border: 1px solid #e0dccf; border-radius: 8px; background: #fff; }
.nl-preview-label, .nl-actions { margin: .5rem 0; }
```

- [ ] **Step 3: Verify the page loads (manual)**

Run: `npm run dev`, open `http://localhost:3002/admin.html`, log in, open the Newsletter tab.
Expected: empty palette/canvas + preview iframe render without console errors (JS wiring lands next).

- [ ] **Step 4: Commit**

```bash
git add admin.html assets/css/admin.css
git commit -m "[TASK-168] admin ui: newsletter two-pane builder scaffold"
```

> Note: `admin.html` is served static and may be COPY'd in the `Dockerfile` — it already is (an existing served page), so no Dockerfile change. If a repo guard test (`test/unit/dockerfile-site-assets.test.ts`) checks the served page list, `admin.html` is already registered; no new page is introduced.

---

### Task 23: UI — block model, palette, variants, canvas render

**Files:**
- Modify: `assets/js/admin/app.js` (the newsletter section, ~722–820)

**Interfaces:**
- Produces (module-local, in the same IIFE/scope as the existing newsletter code): `nlDoc` (the in-memory `{ blocks: [] }`), `nlBlockDefs` (per-type default data + label + variant count), `renderCanvas()`, `addBlock(type)`, `schedulePreview()` (stub until Task 25).

- [ ] **Step 1: Define block metadata + palette rendering**

Add to `app.js` (near the existing `// ---- newsletter ----`):

```js
// Block builder model (TASK-168). Each def: label, default data, and how many of the 4 variants
// are meaningful (all 4 unless noted). The renderer server-side owns the visual variants; the UI
// just carries type/variant/data.
var nlBlockDefs = {
  masthead: { label: "Masthead", data: { issueTitle: "July Newsletter" } },
  greeting: { label: "Greeting", data: { heading: "", lead: "" } },
  text: { label: "Text", data: { text: "Your text here." } },
  heading: { label: "Heading", data: { kicker: "", title: "Section title" } },
  image: { label: "Image", data: { url: "", alt: "", caption: "" } },
  story: { label: "Story", data: { imageUrl: "", title: "Story title", body: "Story text.", label: "Read more", href: "" } },
  spotlight: { label: "Spotlight", data: { photoUrl: "", name: "Name", quote: "Quote", role: "" } },
  stats: { label: "Impact stats", data: { items: [{ number: "7,657", label: "Red Bags delivered" }] } },
  waysToHelp: { label: "Ways to help", data: { items: [{ icon: "🎁", title: "Donate", body: "", label: "Donate", href: "https://nbcc.scot/donate" }] } },
  events: { label: "Events", data: { items: [{ day: "15", month: "JUL", name: "Event name", location: "", label: "Register", href: "" }] } },
  donationCta: { label: "Donation CTA", data: { imageUrl: "", heading: "Support our work", label: "Make a donation today", href: "https://nbcc.scot/donate" } },
  button: { label: "Button", data: { label: "Learn more", href: "" } },
  divider: { label: "Divider", data: {} },
};

var nlDoc = { blocks: [] };

function nlRenderPalette() {
  var host = el("nlPalette");
  host.innerHTML = "";
  Object.keys(nlBlockDefs).forEach(function (type) {
    var b = doc.createElement("button");
    b.type = "button";
    b.textContent = "+ " + nlBlockDefs[type].label;
    b.addEventListener("click", function () { nlAddBlock(type); });
    host.appendChild(b);
  });
}

function nlAddBlock(type) {
  nlDoc.blocks.push({ type: type, variant: 0, data: JSON.parse(JSON.stringify(nlBlockDefs[type].data)) });
  nlRenderCanvas();
  nlSchedulePreview();
}
```

- [ ] **Step 2: Render the canvas (blocks with variant switcher + controls; fields land in Task 24)**

```js
function nlRenderCanvas() {
  var host = el("nlCanvas");
  host.innerHTML = "";
  nlDoc.blocks.forEach(function (block, i) {
    var li = doc.createElement("li");
    li.className = "nl-block";
    var head = doc.createElement("div");
    head.className = "nl-block-head";
    head.innerHTML =
      '<span class="nl-block-title">' + nlBlockDefs[block.type].label + "</span>" +
      '<span class="nl-block-ctrls">' +
      '<button type="button" data-nl="up">↑</button>' +
      '<button type="button" data-nl="down">↓</button>' +
      '<button type="button" data-nl="dup">⧉</button>' +
      '<button type="button" data-nl="del">✕</button>' +
      "</span>";
    li.appendChild(head);

    var variants = doc.createElement("div");
    variants.className = "nl-variants";
    for (var v = 0; v < 4; v++) {
      var vb = doc.createElement("button");
      vb.type = "button";
      vb.textContent = "Style " + (v + 1);
      vb.setAttribute("aria-pressed", String(block.variant === v));
      (function (vi) { vb.addEventListener("click", function () { block.variant = vi; nlRenderCanvas(); nlSchedulePreview(); }); })(v);
      variants.appendChild(vb);
    }
    li.appendChild(variants);

    var fields = doc.createElement("div");
    fields.className = "nl-fields";
    nlRenderFields(fields, block); // Task 24
    li.appendChild(fields);

    head.querySelector('[data-nl="up"]').addEventListener("click", function () { nlMove(i, -1); });
    head.querySelector('[data-nl="down"]').addEventListener("click", function () { nlMove(i, 1); });
    head.querySelector('[data-nl="dup"]').addEventListener("click", function () { nlDup(i); });
    head.querySelector('[data-nl="del"]').addEventListener("click", function () { nlDoc.blocks.splice(i, 1); nlRenderCanvas(); nlSchedulePreview(); });

    host.appendChild(li);
  });
}

function nlMove(i, delta) {
  var j = i + delta;
  if (j < 0 || j >= nlDoc.blocks.length) return;
  var tmp = nlDoc.blocks[i];
  nlDoc.blocks[i] = nlDoc.blocks[j];
  nlDoc.blocks[j] = tmp;
  nlRenderCanvas();
  nlSchedulePreview();
}

function nlDup(i) {
  nlDoc.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(nlDoc.blocks[i])));
  nlRenderCanvas();
  nlSchedulePreview();
}

// Filled in Task 24/25:
function nlRenderFields() {}
function nlSchedulePreview() {}
```

- [ ] **Step 3: Manual verify**

Run `npm run dev`; on the Newsletter tab, click palette buttons → blocks append with working up/down/dup/del + style toggles. No console errors.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/app.js
git commit -m "[TASK-168] admin ui: block model, palette, variants, canvas"
```

---

### Task 24: UI — per-block fields + image upload/library/URL

**Files:**
- Modify: `assets/js/admin/app.js`

**Interfaces:**
- Consumes: `nlDoc`, `nlSchedulePreview`.
- Produces: `nlRenderFields(host, block)` (replaces the Task 23 stub); `nlImageField(host, block, key)`; `NBCC_IMAGE_LIBRARY` (array of `{ label, url }`).

- [ ] **Step 1: Add the NBCC image library + a reusable field builder**

```js
var NBCC_IMAGE_LIBRARY = [
  { label: "Logo", url: "https://nbcc.scot/assets/img/nbcc-logo.png" },
  { label: "Elf", url: "https://nbcc.scot/assets/img/nbcc-elf.png" },
  { label: "Red bags handover", url: "https://nbcc.scot/assets/img/home-red-bags-handover.jpg" },
  { label: "Why packing", url: "https://nbcc.scot/assets/img/why-packing.jpg" },
  { label: "Story — Tygan", url: "https://nbcc.scot/assets/img/story-tygan.jpg" },
];

// A labelled text input bound to block.data[key].
function nlText(host, block, key, label, multiline) {
  var wrap = doc.createElement("label");
  wrap.textContent = label;
  var input = doc.createElement(multiline ? "textarea" : "input");
  if (multiline) input.rows = 3;
  input.value = block.data[key] != null ? block.data[key] : "";
  input.addEventListener("input", function () { block.data[key] = input.value; nlSchedulePreview(); });
  wrap.appendChild(input);
  host.appendChild(wrap);
}

// An image field: URL input + "NBCC library" quick-pick + Upload (POSTs base64 to the endpoint).
function nlImageField(host, block, key, label) {
  nlText(host, block, key, label + " URL", false);
  var row = doc.createElement("div");
  row.className = "nl-img-tools";

  var lib = doc.createElement("select");
  lib.innerHTML = '<option value="">NBCC library…</option>' +
    NBCC_IMAGE_LIBRARY.map(function (i) { return '<option value="' + i.url + '">' + i.label + "</option>"; }).join("");
  lib.addEventListener("change", function () {
    if (lib.value) { block.data[key] = lib.value; nlRenderCanvas(); nlSchedulePreview(); }
  });
  row.appendChild(lib);

  var file = doc.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp,image/gif";
  file.addEventListener("change", function () {
    var f = file.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(",")[1];
      authFetch("/api/admin/newsletter-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: f.type, dataBase64: base64, filename: f.name }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.url) { block.data[key] = j.url; nlRenderCanvas(); nlSchedulePreview(); }
          else el("newsletterMsg").textContent = j.error || "Upload failed.";
        });
    };
    reader.readAsDataURL(f);
  });
  row.appendChild(file);
  host.appendChild(row);
}
```

- [ ] **Step 2: Implement `nlRenderFields` per block type**

```js
function nlRenderFields(host, block) {
  host.innerHTML = "";
  switch (block.type) {
    case "masthead":
      nlText(host, block, "issueTitle", "Issue title", false);
      nlImageField(host, block, "heroUrl", "Hero image");
      break;
    case "greeting":
      nlText(host, block, "heading", "Heading (optional)", false);
      nlText(host, block, "lead", "Intro paragraph (optional)", true);
      break;
    case "text":
      nlText(host, block, "text", "Text (use {{firstName}} to merge)", true);
      break;
    case "heading":
      nlText(host, block, "kicker", "Kicker (optional)", false);
      nlText(host, block, "title", "Title", false);
      break;
    case "image":
      nlImageField(host, block, "url", "Image");
      nlText(host, block, "alt", "Alt text", false);
      nlText(host, block, "caption", "Caption (optional)", false);
      break;
    case "story":
      nlImageField(host, block, "imageUrl", "Image");
      nlText(host, block, "title", "Title", false);
      nlText(host, block, "body", "Body", true);
      nlText(host, block, "label", "Button label", false);
      nlText(host, block, "href", "Button link", false);
      break;
    case "spotlight":
      nlImageField(host, block, "photoUrl", "Photo");
      nlText(host, block, "name", "Name", false);
      nlText(host, block, "quote", "Quote", true);
      nlText(host, block, "role", "Role (optional)", false);
      break;
    case "donationCta":
      nlImageField(host, block, "imageUrl", "Image");
      nlText(host, block, "heading", "Heading", false);
      nlText(host, block, "label", "Button label", false);
      nlText(host, block, "href", "Button link", false);
      break;
    case "button":
      nlText(host, block, "label", "Label", false);
      nlText(host, block, "href", "Link", false);
      break;
    case "stats":
    case "waysToHelp":
    case "events":
      nlRenderItems(host, block); // repeaters
      break;
    case "divider":
    default:
      break;
  }
}

// Repeater for the list-shaped blocks (stats/waysToHelp/events). Renders each item's fields + an
// add/remove control. Item shape depends on block.type (see nlBlockDefs defaults).
function nlRenderItems(host, block) {
  var keysByType = {
    stats: ["number", "label", "caption"],
    waysToHelp: ["icon", "title", "body", "label", "href"],
    events: ["day", "month", "name", "location", "label", "href"],
  };
  var keys = keysByType[block.type];
  (block.data.items || []).forEach(function (item, idx) {
    var fs = doc.createElement("fieldset");
    fs.innerHTML = "<legend>Item " + (idx + 1) + "</legend>";
    keys.forEach(function (k) {
      var wrap = doc.createElement("label");
      wrap.textContent = k;
      var input = doc.createElement("input");
      input.value = item[k] != null ? item[k] : "";
      input.addEventListener("input", function () { item[k] = input.value; nlSchedulePreview(); });
      wrap.appendChild(input);
      fs.appendChild(wrap);
    });
    var rm = doc.createElement("button");
    rm.type = "button";
    rm.textContent = "Remove item";
    rm.addEventListener("click", function () { block.data.items.splice(idx, 1); nlRenderCanvas(); nlSchedulePreview(); });
    fs.appendChild(rm);
    host.appendChild(fs);
  });
  var add = doc.createElement("button");
  add.type = "button";
  add.textContent = "+ Add item";
  add.addEventListener("click", function () {
    var blank = {};
    keys.forEach(function (k) { blank[k] = ""; });
    block.data.items = (block.data.items || []).concat([blank]);
    nlRenderCanvas();
    nlSchedulePreview();
  });
  host.appendChild(add);
}
```

Add a `.nl-img-tools { display:flex; gap:.4rem; margin-top:.3rem; }` rule to `assets/css/admin.css`.

- [ ] **Step 3: Manual verify**

Run `npm run dev`; add each block type; type in fields; pick a library image; upload a small PNG → its URL populates. No console errors.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/app.js assets/css/admin.css
git commit -m "[TASK-168] admin ui: per-block fields + image upload/library"
```

---

### Task 25: UI — live preview, save `bodyJson`, load/hydrate, legacy

**Files:**
- Modify: `assets/js/admin/app.js` (replace the existing save/load newsletter functions ~736–820)

**Interfaces:**
- Consumes: `nlDoc`, `nlRenderCanvas`, `nlRenderPalette`, the `/preview` + CRUD endpoints.
- Produces: `nlSchedulePreview()` (debounced), updated `loadNewsletterInto`, `newsletterNew`, and the form submit.

- [ ] **Step 1: Debounced preview → iframe**

Replace the `nlSchedulePreview` stub:

```js
var nlPreviewTimer = null;
function nlSchedulePreview() {
  if (nlPreviewTimer) clearTimeout(nlPreviewTimer);
  nlPreviewTimer = setTimeout(nlRefreshPreview, 300);
}
function nlRefreshPreview() {
  authFetch("/api/admin/newsletters/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bodyJson: nlDoc }),
  })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j.html != null) el("nlPreview").srcdoc = j.html; })
    .catch(function () {});
}
```

- [ ] **Step 2: Load a newsletter into the builder (hydrate blocks; legacy → rawHtml)**

```js
function loadNewsletterInto(id) {
  authFetch("/api/admin/newsletters/" + id)
    .then(function (r) { return r.json(); })
    .then(function (n) {
      el("newsletterId").value = n.id;
      el("newsletterSubject").value = n.subject;
      // A block-doc newsletter hydrates its blocks; a legacy raw-HTML draft becomes one rawHtml block.
      if (n.bodyJson && Array.isArray(n.bodyJson.blocks)) {
        nlDoc = n.bodyJson;
      } else {
        nlDoc = { blocks: [{ type: "rawHtml", variant: 0, data: { html: n.bodyHtml || "" } }] };
      }
      var sent = n.status === "sent";
      el("newsletterSend").hidden = !(currentRole === "admin" && !sent);
      el("newsletterSave").disabled = sent;
      el("newsletterMsg").textContent = sent ? "This newsletter has been sent and is read-only." : "";
      nlRenderCanvas();
      nlRefreshPreview();
    });
}
```

Note: `nlBlockDefs` has no `rawHtml` entry (it isn't in the palette). Guard `nlRenderCanvas` label/field lookups: `var def = nlBlockDefs[block.type] || { label: "Raw HTML" };` and in `nlRenderFields` the `default` branch already renders nothing, so a legacy block shows as a read-through with no editable fields (staff rebuild it with real blocks). Add the `|| { label: "Raw HTML" }` guard where `nlBlockDefs[block.type].label` is read.

- [ ] **Step 3: New + Save wired to `bodyJson`**

```js
el("newsletterNew").addEventListener("click", function () {
  el("newsletterId").value = "";
  el("newsletterSubject").value = "";
  nlDoc = { blocks: [] };
  el("newsletterSend").hidden = true;
  el("newsletterSave").disabled = false;
  el("newsletterMsg").textContent = "";
  nlRenderCanvas();
  nlRefreshPreview();
});

nlForm.addEventListener("submit", function (e) {
  e.preventDefault();
  var id = el("newsletterId").value;
  var payload = { subject: el("newsletterSubject").value, bodyJson: nlDoc };
  var req = id
    ? authFetch("/api/admin/newsletters/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    : authFetch("/api/admin/newsletters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  req
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok) { el("newsletterMsg").textContent = res.j.error || "Save failed."; return; }
      el("newsletterMsg").textContent = "Saved.";
      loadNewsletters();
      loadNewsletterInto(res.j.id);
    });
});
```

- [ ] **Step 4: Initialise the palette when the tab loads**

Ensure `nlRenderPalette()` is called once when the newsletter view initialises (e.g. in `loadNewsletters` before it lists, guard so it only builds once):

```js
if (!el("nlPalette").childElementCount) nlRenderPalette();
```

- [ ] **Step 5: Manual verify end-to-end**

Run `npm run dev`. New newsletter → add masthead+greeting+text+donationCta → preview updates within ~300 ms and shows the branded email with `Dear Jane,`. Save → reload the tab → the draft re-hydrates its blocks. Open the seeded starter draft → its blocks hydrate. Upload an image in a story block → preview shows it via `/media/newsletter/<id>`.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin/app.js
git commit -m "[TASK-168] admin ui: live preview, save bodyJson, hydrate + legacy"
```

---

### Task 26: Docs — README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Newsletter section**

Document: the block builder (left palette / right live preview), the `body_json` column, per-recipient `{{firstName}}` merge, image upload (`POST /api/admin/newsletter-images`, 2 MB, png/jpeg/webp/gif) stored in `newsletter_images` and served at `GET /media/newsletter/:id`, and the NBCC image library quick-pick. Note no new config value.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "[TASK-168] docs: README newsletter block builder"
```

---

### Task 27: Verification + PR

- [ ] **Step 1: Full local gate**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all PASS.
Run (app up): `npm run test:bdd -- --tags @newsletter`
Expected: all PASS.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin task-168-newsletter-block-builder
gh pr create --title "[TASK-168] Newsletter block builder: compose, preview, image upload (REQ-069)" --body "<summary + test evidence>"
```

- [ ] **Step 3: Drive to green + squash-merge** (CLAUDE.md PR workflow)

`gh pr checks <pr> --watch`; on green `gh pr merge <pr> --squash --delete-branch`. Red → open the failing job, fix, push, re-watch.

---

## Self-Review

**Spec coverage:**
- Block document + jsonb column → Task 1, 3, 16. ✓
- 14 block types × 4 variants → Task 6 (masthead, rawHtml) + 7–15. ✓
- Pure single renderer backing preview/record/send → Task 5–6, 16 (compile), 17 (preview), 20 (send). ✓
- Fixed frame + NBCC footer bar → Task 5. ✓
- Per-recipient `{{firstName}}` merge, fallback "friend" → Task 5 (applyMerge), 3 (full_name), 20 (firstNameOf). ✓
- Image upload (table, endpoint, validation, serve, nosniff, no-SVG, 2 MB) → Task 2, 4, 18, 19. ✓
- JSON 100kb-cap gotcha → Task 18 Step 1. ✓
- Builder UX (palette, variants, canvas, fields, upload/library/URL, live preview) → Task 22–25. ✓
- Legacy raw-HTML back-compat → Task 6 (rawHtml), 16 (dual schema), 25 (hydrate). ✓
- Keep existing BDD green → Task 16 dual schema; verified Task 16 Step 3. ✓
- Tests (unit per block + variant, upload validation, BDD create/preview/upload/serve) → Task 4, 5, 6, 7–15, 21. ✓
- README → Task 26. ✓

**Placeholder scan:** Blocks 7–15 use a specification-by-markers form (interface + variant intents + exact test markers) rather than 48 verbatim email tables, following the Task 6 exemplar and its defined helpers — deliberate, not a TODO. No "TBD"/"handle edge cases" left.

**Type consistency:** `renderNewsletter(doc, ctx)`, `RenderCtx.firstName`, `newsletterDocSchema`, `createNewsletter(subject, bodyHtml, bodyJson)`, `updateNewsletterDraft(id, subject, bodyHtml, bodyJson)`, `NewsletterRecipient.fullName`, `validateUpload`, `insertNewsletterImage`, `getNewsletterImage` — names used identically across Tasks 3–25. `nlDoc`/`nlRenderCanvas`/`nlSchedulePreview`/`nlRenderFields`/`nlImageField` consistent across UI Tasks 23–25.
