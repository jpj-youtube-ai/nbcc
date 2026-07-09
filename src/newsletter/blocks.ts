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
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- vocabulary for tasks 7–15
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
    `<img src="${LOGO_URL}" alt="North Berwick Christmas Committee" width="${width}" style="display:inline-block;height:auto;max-width:${width}px" />`;

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
    return `<div style="padding:12px 40px"><div style="border:1px solid #e5ded3;padding:6px"><img src="${safeUrl}" alt="${alt}" width="580" style="display:block;width:100%;max-width:568px;height:auto" /></div></div>`;
  }

  // variant 0 (default): full-width
  return `<div style="padding:12px 40px"><img src="${safeUrl}" alt="${alt}" width="580" style="display:block;width:100%;max-width:580px;height:auto" /></div>`;
}

const stub = (): string => "";

export const RENDERERS: Record<BlockType, (b: Block, ctx: RenderCtx) => string> = {
  masthead,
  rawHtml,
  greeting,
  text,
  heading,
  image,
  story: stub,
  spotlight: stub,
  stats: stub,
  waysToHelp: stub,
  events: stub,
  donationCta: stub,
  button,
  divider,
};

export function renderBlock(block: Block, ctx: RenderCtx): string {
  return (RENDERERS[block.type] ?? stub)(block, ctx);
}

export function renderNewsletter(doc: NewsletterDoc, ctx: RenderCtx): string {
  return renderFrame(doc.blocks.map((b) => renderBlock(b, ctx)).join(""));
}
