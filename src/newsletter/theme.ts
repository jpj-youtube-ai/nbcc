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
export const CREAM_24 = "rgba(248,245,238,.24)";
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

// Inline contact icons mirroring src/thank-you (the maroon contact bar of the on-screen letter).
// SVGs render where the client supports them and simply fall back to the contact text where they're
// stripped — so the footer never renders worse than the old plain text.
const ICON_PHONE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${CREAM}" stroke-width="1.8" style="vertical-align:middle"><path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z"/></svg>`;
const ICON_MAIL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${CREAM}" stroke-width="1.8" style="vertical-align:middle"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M3 6l9 7 9-7"/></svg>`;
const ICON_FB = `<svg width="10" height="10" viewBox="0 0 24 24" fill="${CREAM}" style="vertical-align:middle"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v6h3v-6h3l1-3h-4v-2c0-.6.4-1 1-1z"/></svg>`;
const ICON_IG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${CREAM}" stroke-width="1.8" style="vertical-align:middle"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="${CREAM}" stroke="none"/></svg>`;

// A circular icon chip: fixed-size span with a hairline ring, holding one inline SVG.
function iconChip(svg: string, size = 22): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;margin-right:8px;vertical-align:middle">${svg}</span>`;
}

// One contact cell: an icon chip (or chips) followed by the contact text, matching the .ty-cell layout.
function contactCell(inner: string, divider: boolean): string {
  const border = divider ? `border-left:1px solid ${CREAM_24};` : "";
  return `<td style="${border}padding:0 20px;font-family:${BODY};font-weight:700;font-size:14px;color:${CREAM};white-space:nowrap">${inner}</td>`;
}

// Wrap the concatenated block HTML in the fixed email frame + NBCC contact/legal footer bar. The
// contact bar mirrors the thank-you letter footer: circular phone / envelope / social icon chips
// around the contact text (they degrade to plain text in clients that strip inline SVG).
export function renderFrame(innerHtml: string): string {
  const socialChips =
    `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;vertical-align:middle">${ICON_FB}</span>` +
    `<span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border:1px solid ${CREAM_82};border-radius:50%;margin:0 8px 0 4px;vertical-align:middle">${ICON_IG}</span>`;
  const footRow =
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>` +
    contactCell(`${iconChip(ICON_PHONE)}01292 811 015`, false) +
    contactCell(`${iconChip(ICON_MAIL)}info@nbcc.scot`, true) +
    contactCell(`${socialChips}nbcc.scot`, true) +
    `</tr></table>`;
  return `<!doctype html>
<html lang="en-GB">
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:0">${innerHtml}</td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY};font-size:14px;text-align:center">
      ${footRow}
      <div style="color:${CREAM_82};font-size:11px;margin-top:12px">Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.</div>
    </td></tr>
  </table>
</body>
</html>`;
}
