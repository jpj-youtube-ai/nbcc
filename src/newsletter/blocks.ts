// Pure block renderer for the newsletter builder (TASK-168/REQ-069). A newsletter is a block
// document (JSON). renderNewsletter compiles it to a brand-inlined HTML email via the shared frame
// in ./theme. The same function backs the live preview, the saved body_html, and the per-recipient
// merge send — one source of truth, no drift. DB-free + config-free → unit-tested directly.
import { z } from "zod";
import { type RenderCtx, renderFrame, escapeHtml, CRIMSON, HEAD, LOGO_URL } from "./theme";

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
    // no hero to sit the title on — degrade to a centered header
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

// rawHtml — legacy passthrough (a draft saved before the block builder). Not in the palette. The
// stored HTML is authored by staff (trusted), so it is emitted verbatim inside the frame.
function rawHtml(b: Block): string {
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
