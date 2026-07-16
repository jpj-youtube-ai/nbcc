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
  CRIMSON,
  MAROON,
  CREAM,
  SLATE,
  SLATE_SOFT,
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
  size?: number; // TASK-248: optional text-size step, -2..+2. Absent/0 = the variant's own sizes.
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
      // Defaulted, so every newsletter written before TASK-248 parses and renders unchanged.
      size: z.number().int().min(-2).max(2).default(0),
    }),
  ),
});

// TASK-248: the newsletter's OWN size ladder — every font-size the block variants use, in order. A
// block's size step moves each of its text elements this many notches along the ladder, so a resized
// block still lands on a size the design already uses. Steps clamp at the ends rather than inventing
// sizes off the scale: the clamp is the feature, not a limitation.
const SIZE_LADDER = [10, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28];

// Blocks a step never touches:
//   rawHtml  — the user authored that HTML; rewriting it is fragile and they already set the size.
//   masthead — the brand signature. It should look identical every issue, and its four variants
//              already span 16→26px, so a step adds drift without adding capability.
//   divider/image — no text to size.
const NO_SIZE_STEP: readonly BlockType[] = ["rawHtml", "masthead", "divider", "image"];

// Shift every font-size in one block's OWN rendered html N notches along the ladder. Safe to do on
// the output because this is html we generated from our own templates, never user input (rawHtml is
// excluded above). Shifting all of a block's elements by the same step is what preserves its internal
// hierarchy — a story's heading stays above its body. An off-ladder size is left alone.
export function applySizeStep(html: string, step: number): string {
  if (!step) return html;
  return html.replace(/font-size:(\d+)px/g, (whole, px: string) => {
    const i = SIZE_LADDER.indexOf(Number(px));
    if (i === -1) return whole;
    const j = Math.min(SIZE_LADDER.length - 1, Math.max(0, i + step));
    return `font-size:${SIZE_LADDER[j]}px`;
  });
}

// --- small readers so every renderer treats data as untrusted --------------------------------
const str = (d: Record<string, unknown>, k: string, fallback = ""): string =>
  typeof d[k] === "string" ? (d[k] as string) : fallback;
const list = (d: Record<string, unknown>, k: string): Record<string, unknown>[] =>
  Array.isArray(d[k]) ? (d[k] as Record<string, unknown>[]) : [];

// --- block renderers -------------------------------------------------------------------------
// masthead — the issue header. This is the exemplar the other block tasks follow.
//   0: centered logo + issue title
//   1: logo left, issue title (+ optional date) right
//   2: issue title over the hero image (hero as banner, title on/under it)
//   3: slim wordmark strip — small logo + title inline
//
// data contract: issueTitle (string, optional — falls back to "Newsletter"), heroUrl (string,
// optional — read by variant 0 as an accent and variant 2 as the banner), date (string,
// optional — read only by variant 1, rendered as a small line under the title when present).
function masthead(b: Block): string {
  const title = escapeHtml(str(b.data, "issueTitle", "Newsletter"));
  const hero = str(b.data, "heroUrl");
  const date = str(b.data, "date");
  const logo = (width: number): string =>
    `<img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="${width}" style="display:inline-block;height:auto;max-width:${width}px" />`;

  if (b.variant === 1) {
    // logo left, title (+ optional date) right
    const dateEl = date
      ? `<div style="font-family:${HEAD};color:${CRIMSON};font-size:13px;margin-top:2px">${escapeHtml(date)}</div>`
      : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 40px 8px"><tr>
  <td style="vertical-align:middle">${logo(120)}</td>
  <td style="vertical-align:middle;text-align:right">
    <h1 style="font-family:${HEAD};color:${CRIMSON};font-size:24px;font-weight:800;margin:0">${title}</h1>
    ${dateEl}
  </td>
</tr></table>`;
  }

  if (b.variant === 2) {
    // title over the hero image (hero as banner, title on/under it)
    if (hero) {
      return `<div style="padding:0 0 8px;text-align:center">
  <div style="position:relative">
    <img src="${escapeHtml(hero)}" alt="" width="660" style="display:block;width:100%;max-width:660px;height:auto" />
  </div>
  <div style="padding:16px 40px 0">
    ${logo(100)}
    <h1 style="font-family:${HEAD};color:${CRIMSON};font-size:26px;font-weight:800;margin:8px 0 0">${title}</h1>
  </div>
</div>`;
    }
    // no hero to sit the title on — degrade to the same centered header as variant 0's
    // hero-less form (byte-identical to the no-hero branch below). Intentional convergence:
    // both are the "just logo + title" baseline once there is no hero to compose against, so
    // there is no separate markup to invent here. Pinned by the variant-2-without-heroUrl test.
    return `<div style="padding:28px 40px 8px;text-align:center">${logo(150)}<h1 style="font-family:${HEAD};color:${CRIMSON};font-size:26px;font-weight:800;margin:8px 0 0">${title}</h1></div>`;
  }

  if (b.variant === 3) {
    // slim wordmark strip — compact, small logo + title inline
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="padding:14px 40px"><tr>
  <td style="vertical-align:middle">${logo(60)}</td>
  <td style="vertical-align:middle;padding-left:12px">
    <span style="font-family:${HEAD};color:${CRIMSON};font-size:16px;font-weight:700">${title}</span>
  </td>
</tr></table>`;
  }

  // variant 0 (default): centered logo + issue title, optional hero underneath
  const heroImg = hero
    ? `<img src="${escapeHtml(hero)}" alt="" width="580" style="display:block;width:100%;max-width:580px;height:auto;margin:12px auto 0" />`
    : "";
  return `<div style="padding:28px 40px 8px;text-align:center">${logo(150)}<h1 style="font-family:${HEAD};color:${CRIMSON};font-size:26px;font-weight:800;margin:8px 0 0">${title}</h1>${heroImg}</div>`;
}

// greeting — the salutation line, merging ctx.firstName via applyMerge.
//   0: plain "Dear {{firstName}},"
//   1: greeting line + a lead intro paragraph below it
//   2: a heading (Playfair/HEAD font) ABOVE the greeting line
//   3: warm/casual "Hi {{firstName}} 👋"
//
// data contract: heading (string, optional — read only by variant 2), lead (string, optional —
// read only by variant 1). Neither field is present in the "Dear {{firstName}}," line itself,
// which always comes from ctx via applyMerge rather than from data.
function greeting(b: Block, ctx: RenderCtx): string {
  const heading = str(b.data, "heading");
  const lead = str(b.data, "lead");
  const dearLine = `<p style="font-family:${BODY};color:${SLATE};font-size:16px;margin:0">${applyMerge("Dear {{firstName}},", ctx)}</p>`;

  if (b.variant === 1) {
    const leadEl = lead
      ? `<p style="font-family:${BODY};color:${SLATE_SOFT};font-size:15px;margin:8px 0 0">${escapeHtml(lead)}</p>`
      : "";
    return `<div style="padding:12px 40px">${dearLine}${leadEl}</div>`;
  }

  if (b.variant === 2) {
    const headingEl = heading
      ? `<h2 style="font-family:${HEAD};color:${MAROON};font-size:20px;font-weight:800;margin:0 0 8px">${escapeHtml(heading)}</h2>`
      : "";
    return `<div style="padding:12px 40px">${headingEl}${dearLine}</div>`;
  }

  if (b.variant === 3) {
    return `<div style="padding:12px 40px"><p style="font-family:${BODY};color:${SLATE};font-size:16px;margin:0">${applyMerge("Hi {{firstName}} 👋", ctx)}</p></div>`;
  }

  // variant 0 (default): plain "Dear {{firstName}},"
  return `<div style="padding:12px 40px">${dearLine}</div>`;
}

// rawHtml — legacy passthrough (a draft saved before the block builder). Not in the palette. The
// stored HTML is authored by staff (trusted), so it is emitted verbatim inside the frame.
function rawHtml(b: Block): string {
  return `<div style="padding:24px 40px">${str(b.data, "html")}</div>`;
}

// text — a block of copy, merged via applyMerge so {{firstName}} personalises the body.
//   0: body paragraph
//   1: lead paragraph (larger, ~18px)
//   2: pull-quote (HEAD serif, italic, CRIMSON, centered)
//   3: highlighted callout (TAN_SOFT background, CRIMSON left border)
//
// data contract: text (string, optional — falls back to "").
function text(b: Block, ctx: RenderCtx): string {
  const body = applyMerge(str(b.data, "text"), ctx);

  if (b.variant === 1) {
    return `<div style="padding:12px 40px"><p style="font-family:${BODY};color:${SLATE};font-size:18px;line-height:1.6;margin:0">${body}</p></div>`;
  }

  if (b.variant === 2) {
    return `<div style="padding:12px 40px;text-align:center"><p style="font-family:${HEAD};color:${CRIMSON};font-style:italic;font-size:20px;line-height:1.5;margin:0">${body}</p></div>`;
  }

  if (b.variant === 3) {
    return `<div style="padding:12px 40px"><div style="background:${TAN_SOFT};border-left:4px solid ${CRIMSON};padding:16px 20px"><p style="font-family:${BODY};color:${SLATE};font-size:15px;line-height:1.6;margin:0">${body}</p></div></div>`;
  }

  // variant 0 (default): plain body paragraph
  return `<div style="padding:12px 40px"><p style="font-family:${BODY};color:${SLATE};font-size:15px;line-height:1.6;margin:0">${body}</p></div>`;
}

// heading — a section title.
//   0: CRIMSON serif (HEAD), centered
//   1: uppercase eyebrow kicker above the title
//   2: maroon band behind the title
//   3: uppercase letter-spaced eyebrow only (title styled as the eyebrow itself)
//
// data contract: title (string, optional — falls back to ""), kicker (string, optional — read
// only by variant 1).
function heading(b: Block): string {
  const title = escapeHtml(str(b.data, "title"));
  const kicker = str(b.data, "kicker");

  if (b.variant === 1) {
    const kickerEl = kicker
      ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 4px">${escapeHtml(kicker)}</div>`
      : "";
    return `<div style="padding:12px 40px">${kickerEl}<h2 style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:800;margin:0">${title}</h2></div>`;
  }

  if (b.variant === 2) {
    return `<div style="padding:12px 40px"><div style="background:${MAROON};color:${CREAM};padding:16px 24px;text-align:center"><h2 style="font-family:${HEAD};font-size:22px;font-weight:800;margin:0">${title}</h2></div></div>`;
  }

  if (b.variant === 3) {
    return `<div style="padding:12px 40px;text-align:center"><div style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${title}</div></div>`;
  }

  // variant 0 (default): CRIMSON serif, centered
  return `<div style="padding:12px 40px;text-align:center"><h2 style="font-family:${HEAD};color:${CRIMSON};font-size:24px;font-weight:800;margin:0">${title}</h2></div>`;
}

// divider — a visual break between blocks. No data fields.
//   0: hairline rule
//   1: short CRIMSON rule
//   2: blank spacer
//   3: small centered mark
function divider(b: Block): string {
  if (b.variant === 1) {
    return `<div style="padding:12px 40px;text-align:center"><hr style="border:none;border-top:3px solid ${CRIMSON};width:48px;margin:0 auto" /></div>`;
  }

  if (b.variant === 2) {
    return `<div style="padding:24px 40px 0"></div>`;
  }

  if (b.variant === 3) {
    return `<div style="padding:12px 40px;text-align:center;font-family:${HEAD};color:${SLATE_SOFT};font-size:18px">&middot;</div>`;
  }

  // variant 0 (default): hairline rule
  return `<div style="padding:12px 40px"><hr style="border:none;border-top:1px solid #e5ded3" /></div>`;
}

// button — a call-to-action link, delegating to the shared brandButton styles.
//   0: primary, 1: outline, 2: full, 3: link
//
// data contract: label (string, optional — falls back to ""), href (string, optional — falls
// back to ""). Degrades to nothing when href is empty, rather than emitting a dead link.
const BUTTON_STYLES = ["primary", "outline", "full", "link"] as const;

function button(b: Block): string {
  const label = str(b.data, "label");
  const href = str(b.data, "href");
  if (!href) return "";

  const style = BUTTON_STYLES[b.variant] ?? "primary";
  return `<div style="padding:12px 40px;text-align:center">${brandButton(label, href, style)}</div>`;
}

// image — a standalone photo.
//   0: full-width
//   1: rounded corners
//   2: with a small SLATE caption underneath
//   3: framed with a thin border
//
// data contract: url (string, optional — falls back to ""), alt (string, optional — falls back
// to "", escaped either way), caption (string, optional — read only by variant 2). Degrades to
// nothing when url is empty, rather than emitting a broken <img src="">.
function image(b: Block): string {
  const url = str(b.data, "url");
  if (!url) return "";

  const alt = escapeHtml(str(b.data, "alt"));
  const caption = str(b.data, "caption");
  const safeUrl = escapeHtml(url);

  if (b.variant === 1) {
    return `<div style="padding:12px 40px"><img src="${safeUrl}" alt="${alt}" width="580" style="display:block;width:100%;max-width:580px;height:auto;border-radius:12px" /></div>`;
  }

  if (b.variant === 2) {
    const captionEl = caption
      ? `<p style="font-family:${BODY};color:${SLATE};font-size:13px;margin:8px 0 0">${escapeHtml(caption)}</p>`
      : "";
    return `<div style="padding:12px 40px"><img src="${safeUrl}" alt="${alt}" width="580" style="display:block;width:100%;max-width:580px;height:auto" />${captionEl}</div>`;
  }

  if (b.variant === 3) {
    // width=566 matches max-width:566px (580 total minus 2x(6px padding + 1px border)).
    return `<div style="padding:12px 40px"><div style="border:1px solid #e5ded3;padding:6px"><img src="${safeUrl}" alt="${alt}" width="566" style="display:block;width:100%;max-width:566px;height:auto" /></div></div>`;
  }

  // variant 0 (default): full-width
  return `<div style="padding:12px 40px"><img src="${safeUrl}" alt="${alt}" width="580" style="display:block;width:100%;max-width:580px;height:auto" /></div>`;
}

// story — a news item: image + title + body + optional Read-more link.
//   0: image-top (image above title/body)
//   1: image-left (two-column table: image left, text right)
//   2: two-up row — reads data.items[] and renders each item side by side; when items is empty,
//      falls back to a single synthetic item from the top-level fields so it is never blank
//   3: text-only with a top rule (no image, even if imageUrl is present)
//
// data contract: imageUrl (string, optional), title (string, optional — falls back to ""), body
// (string, optional — falls back to ""), label (string, optional — read-more link text, falls
// back to "Read more"), href (string, optional). items (array of {imageUrl?, title, body, label?,
// href?}, optional) is read by variant 2, which renders every item; if items is empty, variant 2
// instead renders one item built from the top-level imageUrl/title/body/label/href fields.
// Degrades to nothing for a missing image, and to no link for a missing href.
function readMoreLink(label: string, href: string): string {
  if (!href) return "";
  return `<div style="margin-top:8px">${brandButton(label || "Read more", href, "link")}</div>`;
}

function storyBody(data: Record<string, unknown>, titleSize: string, bodySize: string): string {
  const title = escapeHtml(str(data, "title"));
  const body = escapeHtml(str(data, "body"));
  const label = str(data, "label");
  const href = str(data, "href");
  return `<h3 style="font-family:${HEAD};color:${MAROON};font-size:${titleSize};font-weight:800;margin:0">${title}</h3>
    <p style="font-family:${BODY};color:${SLATE};font-size:${bodySize};line-height:1.6;margin:6px 0 0">${body}</p>
    ${readMoreLink(label, href)}`;
}

function story(b: Block): string {
  const imageUrl = str(b.data, "imageUrl");

  if (b.variant === 1) {
    // image-left / text-right two-column table
    const imgCell = imageUrl
      ? `<td style="vertical-align:top;width:200px"><img src="${escapeHtml(imageUrl)}" alt="" width="200" style="display:block;width:100%;max-width:200px;height:auto" /></td>`
      : "";
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${imgCell}
  <td style="vertical-align:top;padding-left:${imageUrl ? "16px" : "0"}">
    ${storyBody(b.data, "18px", "14px")}
  </td>
</tr></table></div>`;
  }

  if (b.variant === 2) {
    // two-up row: each item side by side, reading data.items[] only. The builder UI added an
    // items repeater for story (TASK-168 fix), but a doc with no items yet (or a legacy/hand-
    // authored doc) would otherwise render an empty table — fall back to a single synthetic item
    // built from the top-level fields so the variant is never blank.
    const rawItems = list(b.data, "items");
    const items = rawItems.length > 0 ? rawItems : [b.data];
    const cells = items
      .map((item) => {
        const itemImageUrl = str(item, "imageUrl");
        const itemImg = itemImageUrl
          ? `<img src="${escapeHtml(itemImageUrl)}" alt="" width="260" style="display:block;width:100%;max-width:260px;height:auto" />`
          : "";
        return `<td style="vertical-align:top;width:50%;padding:0 8px">
    ${itemImg}
    ${storyBody(item, "16px", "13px")}
  </td>`;
      })
      .join("");
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></div>`;
  }

  if (b.variant === 3) {
    // text-only with a top rule — never shows an image, even if imageUrl is present
    return `<div style="padding:12px 40px"><hr style="border:none;border-top:1px solid #e5ded3;margin:0 0 12px" />
  ${storyBody(b.data, "18px", "14px")}
</div>`;
  }

  // variant 0 (default): image-top
  const imgEl = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" width="580" style="display:block;width:100%;max-width:580px;height:auto;margin:0 0 12px" />`
    : "";
  return `<div style="padding:12px 40px">${imgEl}${storyBody(b.data, "18px", "14px")}</div>`;
}

// spotlight — a person's photo + name + quote (volunteer/donor/beneficiary spotlight).
//   0: photo-left + quote (two-column table: photo left, name/quote/role right)
//   1: centered round avatar + quote below
//   2: big-quote (HEAD font, ~22px) with name/role attribution, never shows a photo
//   3: tinted card (TAN_SOFT background) with photo, quote, name/role
//
// data contract: photoUrl (string, optional), name (string, optional — falls back to ""), quote
// (string, optional — falls back to ""), role (string, optional — rendered only when present).
// Degrades to no photo markup when photoUrl is absent (variant 2 never shows one at all).
function spotlightRoleLine(role: string): string {
  return role
    ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;margin-top:2px">${escapeHtml(role)}</div>`
    : "";
}

function spotlightPhoto(photoUrl: string, alt: string, size: number): string {
  if (!photoUrl) return "";
  return `<img src="${escapeHtml(photoUrl)}" alt="${alt}" width="${size}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" />`;
}

function spotlight(b: Block): string {
  const photoUrl = str(b.data, "photoUrl");
  const name = escapeHtml(str(b.data, "name"));
  const quote = escapeHtml(str(b.data, "quote"));
  const role = str(b.data, "role");

  if (b.variant === 1) {
    // centered round avatar + quote below
    return `<div style="padding:12px 40px;text-align:center">
  ${spotlightPhoto(photoUrl, name, 96)}
  <p style="font-family:${HEAD};color:${CRIMSON};font-style:italic;font-size:18px;line-height:1.5;margin:12px 0 0">&ldquo;${quote}&rdquo;</p>
  <div style="font-family:${HEAD};color:${MAROON};font-size:15px;font-weight:800;margin-top:8px">${name}</div>
  ${spotlightRoleLine(role)}
</div>`;
  }

  if (b.variant === 2) {
    // big-quote with attribution — quote-focused, no photo even when photoUrl is provided
    return `<div style="padding:12px 40px;text-align:center">
  <p style="font-family:${HEAD};color:${MAROON};font-style:italic;font-size:22px;line-height:1.5;margin:0">&ldquo;${quote}&rdquo;</p>
  <div style="font-family:${HEAD};color:${CRIMSON};font-size:14px;font-weight:800;margin-top:12px">${name}</div>
  ${spotlightRoleLine(role)}
</div>`;
  }

  if (b.variant === 3) {
    // tinted card
    return `<div style="padding:12px 40px"><div style="background:${TAN_SOFT};padding:20px 24px;text-align:center">
  ${spotlightPhoto(photoUrl, name, 72)}
  <p style="font-family:${HEAD};color:${MAROON};font-style:italic;font-size:16px;line-height:1.5;margin:12px 0 0">&ldquo;${quote}&rdquo;</p>
  <div style="font-family:${HEAD};color:${CRIMSON};font-size:14px;font-weight:800;margin-top:8px">${name}</div>
  ${spotlightRoleLine(role)}
</div></div>`;
  }

  // variant 0 (default): photo-left + quote, two-column table
  const imgCell = photoUrl
    ? `<td style="vertical-align:top;width:100px">${spotlightPhoto(photoUrl, name, 80)}</td>`
    : "";
  return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  ${imgCell}
  <td style="vertical-align:top;padding-left:${photoUrl ? "16px" : "0"}">
    <p style="font-family:${HEAD};color:${CRIMSON};font-style:italic;font-size:16px;line-height:1.5;margin:0">&ldquo;${quote}&rdquo;</p>
    <div style="font-family:${HEAD};color:${MAROON};font-size:14px;font-weight:800;margin-top:8px">${name}</div>
    ${spotlightRoleLine(role)}
  </td>
</tr></table></div>`;
}

// stats — impact numbers (donation totals, meals served, etc.).
//   0: one big number (HEAD font ~40px, CRIMSON) + label — uses the FIRST item only
//   1: three-across row — a table rendering ALL items (number over label)
//   2: number + label + caption — first item, with an optional caption line
//   3: inline highlighted — all items' numbers rendered inline as tinted pills
//
// data contract: items (array of {number, label, caption?}, optional — read via the `list`
// helper). All fields are read as strings via `str` since impact figures are author-formatted
// display text (e.g. "500+", "£12,000"), not numbers to compute with. Degrades to "" when items
// is empty/absent — an impact block with no figures has nothing to show.
function statFigure(item: Record<string, unknown>, size: string): string {
  const number = escapeHtml(str(item, "number"));
  const label = escapeHtml(str(item, "label"));
  return `<div style="font-family:${HEAD};color:${CRIMSON};font-size:${size};font-weight:800">${number}</div>
  <div style="font-family:${BODY};color:${SLATE};font-size:13px;margin-top:4px">${label}</div>`;
}

function stats(b: Block): string {
  const items = list(b.data, "items");
  if (items.length === 0) return "";

  if (b.variant === 1) {
    // three-across row: a table rendering ALL items, number over label
    const cells = items
      .map(
        (item) =>
          `<td style="vertical-align:top;text-align:center;padding:0 8px">${statFigure(item, "24px")}</td>`,
      )
      .join("");
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></div>`;
  }

  if (b.variant === 2) {
    // number + label + caption — first item only
    const first = items[0];
    const caption = str(first, "caption");
    const captionEl = caption
      ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;margin-top:4px">${escapeHtml(caption)}</div>`
      : "";
    return `<div style="padding:12px 40px;text-align:center">${statFigure(first, "36px")}${captionEl}</div>`;
  }

  if (b.variant === 3) {
    // inline highlighted — all items' numbers rendered inline as tinted pills
    const pills = items
      .map((item) => {
        const number = escapeHtml(str(item, "number"));
        const label = escapeHtml(str(item, "label"));
        return `<span style="display:inline-block;background:${TAN_SOFT};border-radius:999px;padding:6px 16px;margin:0 4px 8px"><strong style="font-family:${HEAD};color:${CRIMSON}">${number}</strong> <span style="font-family:${BODY};color:${SLATE};font-size:13px">${label}</span></span>`;
      })
      .join("");
    return `<div style="padding:12px 40px;text-align:center">${pills}</div>`;
  }

  // variant 0 (default): one big number + label, using the FIRST item only
  return `<div style="padding:12px 40px;text-align:center">${statFigure(items[0], "40px")}</div>`;
}

// waysToHelp — Donate / Volunteer / Spread-the-word calls to action.
//   0: three icon columns (table; each item: icon emoji + title + body + optional button)
//   1: stacked list (each item stacked vertically)
//   2: two-up (two columns)
//   3: single primary CTA — the FIRST item only, rendered as brandButton(label, href, "primary")
//
// data contract: items (array of {icon?, title, body?, label?, href?}, optional — read via the
// `list` helper). Variants 0-2 render EVERY item; variant 3 reads only items[0] and renders
// nothing but its button. An item's button (label+href) is rendered via brandButton only when
// href is present — a label with no href degrades to no button rather than a dead link. Degrades
// to "" when items is empty/absent (0-2), or when the first item has no href (3, since a CTA
// block with nothing to link to has nothing to show).
function wayToHelpItem(item: Record<string, unknown>): string {
  const icon = str(item, "icon");
  const title = escapeHtml(str(item, "title"));
  const body = str(item, "body");
  const label = str(item, "label");
  const href = str(item, "href");

  const iconEl = icon
    ? `<div style="font-size:28px;line-height:1;margin:0 0 8px">${escapeHtml(icon)}</div>`
    : "";
  const bodyEl = body
    ? `<p style="font-family:${BODY};color:${SLATE};font-size:13px;line-height:1.6;margin:6px 0 0">${escapeHtml(body)}</p>`
    : "";
  const buttonEl = href
    ? `<div style="margin-top:10px">${brandButton(label, href, "outline")}</div>`
    : "";
  return `${iconEl}<h3 style="font-family:${HEAD};color:${MAROON};font-size:16px;font-weight:800;margin:0">${title}</h3>${bodyEl}${buttonEl}`;
}

function wayToHelpTable(items: Record<string, unknown>[], columnWidth: string): string {
  const cells = items
    .map(
      (item) =>
        `<td style="vertical-align:top;width:${columnWidth};padding:0 8px;text-align:center">${wayToHelpItem(item)}</td>`,
    )
    .join("");
  return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></div>`;
}

// wayToHelpTwoUpRows — chunks items into rows of 2 so variant 2 renders a TRUE two-up grid.
// Each pair becomes its own <tr> with two 50%-width <td> cells; a trailing odd item gets its
// own <tr> with a single 50% cell (no empty second cell). Rendering all items in one <tr> at
// 50% each (the previous implementation) totals more than 100% width for 3+ items, which
// Outlook's Word rendering engine does not gracefully wrap.
function wayToHelpTwoUpRows(items: Record<string, unknown>[]): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    const cells = pair
      .map(
        (item) =>
          `<td style="vertical-align:top;width:50%;padding:0 8px;text-align:center">${wayToHelpItem(item)}</td>`,
      )
      .join("");
    rows.push(`<tr>${cells}</tr>`);
  }
  return rows.join("");
}

function waysToHelp(b: Block): string {
  const items = list(b.data, "items");

  if (b.variant === 3) {
    // single primary CTA — first item only
    if (items.length === 0) return "";
    const first = items[0];
    const label = str(first, "label");
    const href = str(first, "href");
    if (!href) return "";
    return `<div style="padding:12px 40px;text-align:center">${brandButton(label, href, "primary")}</div>`;
  }

  if (items.length === 0) return "";

  if (b.variant === 1) {
    // stacked list — each item stacked vertically
    const rows = items
      .map(
        (item) =>
          `<div style="padding:12px 0;border-bottom:1px solid #e5ded3">${wayToHelpItem(item)}</div>`,
      )
      .join("");
    return `<div style="padding:12px 40px">${rows}</div>`;
  }

  if (b.variant === 2) {
    // two-up — a true two-column grid: items chunked into rows of 2, each row its own <tr>
    // (see wayToHelpTwoUpRows). Never puts 3+ 50%-width cells in a single <tr>.
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${wayToHelpTwoUpRows(items)}</table></div>`;
  }

  // variant 0 (default): three icon columns
  return wayToHelpTable(items, `${Math.floor(100 / items.length)}%`);
}

// events — date badge + name + location + Register (upcoming events list).
//   0: date-badge rows — each item: a MAROON square badge (day over month) beside name/location,
//      then a Register button (brandButton) when href is present
//   1: simple list — name + date inline, minimal, no table markup
//   2: cards — each event in its own bordered card
//   3: single featured event — the FIRST item only, rendered larger
//
// data contract: items (array of {day, month, name, location?, label?, href?}, optional — read
// via the `list` helper). All fields are read as strings via `str`. An item's Register button is
// rendered via brandButton only when href is present — a label with no href degrades to no button
// rather than a dead link. Degrades to "" when items is empty/absent.
function eventLocationLine(location: string, size: string): string {
  return location
    ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:${size};margin-top:2px">${escapeHtml(location)}</div>`
    : "";
}

function eventRegisterButton(item: Record<string, unknown>, style: "outline" | "primary"): string {
  const href = str(item, "href");
  if (!href) return "";
  const label = str(item, "label") || "Register";
  return `<div style="margin-top:8px">${brandButton(label, href, style)}</div>`;
}

function eventBadge(day: string, month: string): string {
  return `<td style="vertical-align:top;width:64px;background:${MAROON};color:${CREAM};text-align:center;padding:10px 0;border-radius:6px">
    <div style="font-family:${HEAD};font-size:22px;font-weight:800;line-height:1">${day}</div>
    <div style="font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:2px">${month}</div>
  </td>`;
}

function eventRow(item: Record<string, unknown>): string {
  const day = escapeHtml(str(item, "day"));
  const month = escapeHtml(str(item, "month"));
  const name = escapeHtml(str(item, "name"));
  const location = str(item, "location");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px"><tr>
  ${eventBadge(day, month)}
  <td style="vertical-align:top;padding-left:16px">
    <h3 style="font-family:${HEAD};color:${MAROON};font-size:16px;font-weight:800;margin:0">${name}</h3>
    ${eventLocationLine(location, "13px")}
    ${eventRegisterButton(item, "outline")}
  </td>
</tr></table>`;
}

function events(b: Block): string {
  const items = list(b.data, "items");
  if (items.length === 0) return "";

  if (b.variant === 1) {
    // simple list — name + date inline, minimal, no table markup
    const rows = items
      .map((item) => {
        const day = escapeHtml(str(item, "day"));
        const month = escapeHtml(str(item, "month"));
        const name = escapeHtml(str(item, "name"));
        return `<div style="padding:8px 0;border-bottom:1px solid #e5ded3">
  <span style="font-family:${BODY};color:${CRIMSON};font-weight:700;font-size:13px">${day} ${month}</span>
  <span style="font-family:${BODY};color:${SLATE};font-size:14px;margin-left:8px">${name}</span>
</div>`;
      })
      .join("");
    return `<div style="padding:12px 40px">${rows}</div>`;
  }

  if (b.variant === 2) {
    // cards — each event in its own bordered card
    const cards = items
      .map((item) => {
        const day = escapeHtml(str(item, "day"));
        const month = escapeHtml(str(item, "month"));
        const name = escapeHtml(str(item, "name"));
        const location = str(item, "location");
        return `<div style="border:1px solid #e5ded3;border-radius:8px;padding:16px;margin-bottom:12px">
  <div style="font-family:${HEAD};color:${CRIMSON};font-size:13px;font-weight:800;text-transform:uppercase">${day} ${month}</div>
  <h3 style="font-family:${HEAD};color:${MAROON};font-size:16px;font-weight:800;margin:4px 0 0">${name}</h3>
  ${eventLocationLine(location, "13px")}
  ${eventRegisterButton(item, "outline")}
</div>`;
      })
      .join("");
    return `<div style="padding:12px 40px">${cards}</div>`;
  }

  if (b.variant === 3) {
    // single featured event — first item only, rendered larger
    const first = items[0];
    const day = escapeHtml(str(first, "day"));
    const month = escapeHtml(str(first, "month"));
    const name = escapeHtml(str(first, "name"));
    const location = str(first, "location");
    return `<div style="padding:12px 40px;text-align:center">
  <div style="font-family:${HEAD};color:${CRIMSON};font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px">${day} ${month}</div>
  <h2 style="font-family:${HEAD};color:${MAROON};font-size:26px;font-weight:800;margin:8px 0 0">${name}</h2>
  ${eventLocationLine(location, "15px")}
  ${eventRegisterButton(first, "primary")}
</div>`;
  }

  // variant 0 (default): date-badge rows
  return `<div style="padding:12px 40px">${items.map(eventRow).join("")}</div>`;
}

// donationCta — the closing "Make a donation today" banner. Always renders the button via
// brandButton(label, href, "primary") since href is expected present (no href degradation, per
// the task brief — unlike button/story/waysToHelp/events, this block's whole purpose is the ask).
//   0: image row (imageUrl) + heading + button
//   1: tinted band (background:${TAN_SOFT}) + heading + button
//   2: split — heading left, button right (two-cell table)
//   3: centered — heading + button, both centered
//
// data contract: imageUrl (string, optional — read only by variant 0), heading (string, optional
// — falls back to ""), label (string, optional — falls back to ""), href (string, optional —
// falls back to ""). Degrades to no image markup when imageUrl is absent (variant 0 only; the
// other variants never show one).
function donationCtaImage(imageUrl: string): string {
  if (!imageUrl) return "";
  return `<img src="${escapeHtml(imageUrl)}" alt="" width="580" style="display:block;width:100%;max-width:580px;height:auto;margin:0 0 12px" />`;
}

function donationCta(b: Block): string {
  const imageUrl = str(b.data, "imageUrl");
  const heading = escapeHtml(str(b.data, "heading"));
  const label = str(b.data, "label");
  const href = str(b.data, "href");

  if (b.variant === 1) {
    // tinted band
    return `<div style="padding:12px 40px"><div style="background:${TAN_SOFT};padding:24px;text-align:center">
  <h2 style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:800;margin:0 0 12px">${heading}</h2>
  ${brandButton(label, href, "primary")}
</div></div>`;
  }

  if (b.variant === 2) {
    // split — heading left, button right
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="vertical-align:middle">
    <h2 style="font-family:${HEAD};color:${MAROON};font-size:20px;font-weight:800;margin:0">${heading}</h2>
  </td>
  <td style="vertical-align:middle;text-align:right">${brandButton(label, href, "primary")}</td>
</tr></table></div>`;
  }

  if (b.variant === 3) {
    // centered
    return `<div style="padding:12px 40px;text-align:center">
  <h2 style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:800;margin:0 0 12px">${heading}</h2>
  ${brandButton(label, href, "primary")}
</div>`;
  }

  // variant 0 (default): image row + heading + button
  return `<div style="padding:12px 40px;text-align:center">${donationCtaImage(imageUrl)}
  <h2 style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:800;margin:0 0 12px">${heading}</h2>
  ${brandButton(label, href, "primary")}
</div>`;
}

const stub = (): string => "";

export const RENDERERS: Record<BlockType, (b: Block, ctx: RenderCtx) => string> = {
  masthead,
  rawHtml,
  greeting,
  text,
  heading,
  image,
  story,
  spotlight,
  stats,
  waysToHelp,
  events,
  donationCta,
  button,
  divider,
};

export function renderBlock(block: Block, ctx: RenderCtx): string {
  const html = (RENDERERS[block.type] ?? stub)(block, ctx);
  // TASK-248: the size step is applied HERE, at the one dispatch every surface goes through, so the
  // live preview, the saved body_html and the per-recipient merge send can never disagree about it.
  if (NO_SIZE_STEP.includes(block.type)) return html;
  return applySizeStep(html, block.size ?? 0);
}

export function renderNewsletter(doc: NewsletterDoc, ctx: RenderCtx): string {
  return renderFrame(doc.blocks.map((b) => renderBlock(b, ctx)).join(""), ctx.unsubscribeUrl);
}
